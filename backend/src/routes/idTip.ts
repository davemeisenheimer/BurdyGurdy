import { Router } from 'express';
import { Resend } from 'resend';
import type { User } from '@supabase/supabase-js';
import { cache } from '../cache';
import {
  validateIdTipRequest, validateIdTipReport, validateIdTipResolution, validateIdTipSave,
  photoBelongsToSpecies, idTipCacheKey, guessKey, createRateLimiter,
  idTipResolutionText, ID_TIP_ISSUE_LABELS,
  countReportsByTip, indexTaxonomy, tipKeyString, describeError,
} from '../lib/idTip';
import { getTaxonomy } from '../services/ebird';
import { escapeHtml } from '../lib/feedback';
import { authenticate } from '../lib/authenticate';
import { generateIdTip, idTipsConfigured } from '../services/idTipModel';
import { loadStoredTip, saveStoredTip, loadTipRecord, saveCuratedTip, listAllTips, listReportKeys } from '../services/idTipStore';
import { getSpeciesPhotoUrls } from '../services/macaulay';

/**
 * AI ID tips after a wrong photo answer, and player reports about them.
 *
 *   POST /api/id-tip                       { speciesCode, comName, sciName, guess, photoUrl } → { tip }
 *   POST /api/id-tip/report                (signed in) tip fields + { issueType, description, notifyEmail, regionCode }
 *   GET  /api/id-tip/reports               (admin) pending reports, newest first
 *   POST /api/id-tip/reports/:id/resolve   (admin) { action: fixed | kept | dismissed, note? } - never changes the tip
 *   GET  /api/id-tip/admin/tip?<tip fields>  (admin) the stored tip record, or { record: null }
 *   POST /api/id-tip/admin/draft           (admin) tip fields → { tip } freshly generated, NOT saved
 *   PUT  /api/id-tip/admin/tip             (admin) tip fields + { tip } → saves the text players see
 *   GET  /api/id-tip/admin/tips            (admin) every stored tip, with family, taxonomic position and report count
 *
 * Each uncached tip spends Anthropic credit, so the endpoint only analyses photos we actually serve
 * for that species, stores every tip (memory, then the `id_tips` table), and rate-limits per client IP.
 *
 * Note: without `app.set('trust proxy', ...)`, req.ip behind a reverse proxy is the proxy's address,
 * so all clients would share one rate-limit bucket.
 */

const router = Router();

const TIP_TTL_MS = 24 * 60 * 60 * 1000; // hot copy in memory; the table is the record
const allow = createRateLimiter(30, 10 * 60 * 1000); // 30 new tips per IP per 10 minutes
const inflight = new Map<string, Promise<string | null>>();

function displayNameOf(user: User): string {
  return (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    user.email ?? 'A user';
}

function getResend(): { resend: Resend; fromEmail: string } | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return { resend: new Resend(apiKey), fromEmail: process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev' };
}

/** The tip currently served for this key, from memory or the table. */
async function currentTip(k: { speciesCode: string; guess: string; photoUrl: string }): Promise<string | null> {
  const key = idTipCacheKey(k);
  const hot = cache.get<string>(key);
  if (hot) return hot;
  const stored = await loadStoredTip(k);
  if (stored) cache.set(key, stored, TIP_TTL_MS);
  return stored;
}

router.post('/', async (req, res) => {
  const parsed = validateIdTipRequest(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const r = parsed.value;
  const key = idTipCacheKey(r);

  const existing = await currentTip(r);
  if (existing) return res.json({ tip: existing });
  if (!idTipsConfigured()) return res.status(503).json({ error: 'ID tips are not configured' });

  try {
    let pending = inflight.get(key);
    if (!pending) {
      if (!allow(req.ip ?? 'unknown')) return res.status(429).json({ error: 'Too many tip requests - try again later' });

      const photos = await getSpeciesPhotoUrls(r.speciesCode, r.comName, r.sciName);
      if (!photoBelongsToSpecies(r.photoUrl, photos)) {
        return res.status(404).json({ error: 'Photo not found for this species' });
      }
      pending = generateIdTip(r)
        .then(async tip => {
          if (tip) {
            cache.set(key, tip, TIP_TTL_MS);
            await saveStoredTip(r, tip);
          }
          return tip;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }

    const tip = await pending;
    if (!tip) return res.status(502).json({ error: 'No tip available for this photo' });
    res.json({ tip });
  } catch (err) {
    console.error(`[id-tip] ${r.speciesCode} vs "${r.guess}": ${describeError(err)}`);
    res.status(502).json({ error: 'Could not generate a tip' });
  }
});

// POST /api/id-tip/report - signed-in players report a problem with the tip they were shown.
// The tip text is looked up here (not taken from the client) so the report shows what we served.
router.post('/report', async (req, res) => {
  const auth = await authenticate(req, res, false, 'id-tip-report');
  if (!auth) return;
  const { admin, caller } = auth;

  const parsed = validateIdTipReport(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const rep = parsed.value;

  const tip = await currentTip(rep);
  if (!tip) return res.status(404).json({ error: 'That tip is no longer available' });

  const reporterName = displayNameOf(caller);
  const { error: insertErr } = await admin.from('id_tip_reports').insert({
    species_code:   rep.speciesCode,
    guess_key:      guessKey(rep.guess),
    photo_url:      rep.photoUrl,
    com_name:       rep.comName,
    sci_name:       rep.sciName,
    guess:          rep.guess,
    tip,
    issue_type:     rep.issueType,
    description:    rep.description,
    reporter_id:    caller.id,
    reporter_name:  reporterName,
    reporter_email: caller.email ?? null,
    region_code:    rep.regionCode,
    notify_email:   rep.notifyEmail,
  });
  if (insertErr) {
    console.error('[id-tip-report] insert:', insertErr.message);
    return res.status(500).json({ error: insertErr.message });
  }
  res.json({ ok: true });

  // Fire-and-forget: in-app + email notifications to all admins
  (async () => {
    try {
      const { data: usersPage } = await admin.auth.admin.listUsers({ perPage: 1000 });
      const adminUsers = (usersPage?.users ?? []).filter(u => u.user_metadata?.is_admin === true);
      const mail = getResend();
      const issue = ID_TIP_ISSUE_LABELS[rep.issueType];

      for (const adminUser of adminUsers) {
        await admin.from('notifications').insert({
          recipient_user_id:   adminUser.id,
          sender_user_id:      caller.id,
          sender_display_name: reporterName,
          type:                'new_report',
          data:                { comName: rep.comName, mediaType: 'ID tip', issueType: rep.issueType },
          read:                false,
        });
        if (mail && adminUser.email) {
          mail.resend.emails.send({
            from:    `BurdyGurdy <${mail.fromEmail}>`,
            to:      adminUser.email,
            subject: `New ID tip report for ${rep.comName}`,
            text:    `${reporterName} reported the ID tip for ${rep.comName} (guessed ${rep.guess}).\n\nIssue: ${issue}\n"${rep.description}"\n\nOpen Curation → Tips to review it.`,
            html: `
              <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
                <h2 style="color: #2d6a4f;">New ID tip report</h2>
                <p><strong>${escapeHtml(reporterName)}</strong> reported the ID tip for <strong>${escapeHtml(rep.comName)}</strong> (guessed ${escapeHtml(rep.guess)}).</p>
                <p>Issue: ${escapeHtml(issue)}</p>
                <p style="font-style: italic;">"${escapeHtml(rep.description)}"</p>
                <p style="color: #666; font-size: 13px;">Open Curation → Tips to review it.</p>
              </div>
            `,
          }).catch(err => console.error('[id-tip-report] admin email:', (err as Error).message));
        }
      }
    } catch (err) {
      console.error('[id-tip-report] admin notify:', (err as Error).message);
    }
  })();
});

const REPORT_COLUMNS = 'id, species_code, guess_key, photo_url, com_name, sci_name, guess, tip, issue_type, description, reporter_id, reporter_name, reporter_email, region_code, notify_email, status, created_at';

// GET /api/id-tip/reports - admin: pending reports, newest first.
router.get('/reports', async (req, res) => {
  const auth = await authenticate(req, res, true, 'id-tip-report');
  if (!auth) return;
  const { data, error } = await auth.admin.from('id_tip_reports')
    .select(REPORT_COLUMNS).eq('status', 'pending')
    .order('created_at', { ascending: false }).limit(500);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

interface ReportRow {
  id: string; species_code: string; guess_key: string; photo_url: string; com_name: string; guess: string;
  reporter_id: string | null; reporter_email: string | null; notify_email: boolean;
}

// POST /api/id-tip/reports/:id/resolve - admin: resolves every pending report about the same tip and
// tells each reporter the outcome. The tip text is edited separately (PUT /admin/tip).
router.post('/reports/:id/resolve', async (req, res) => {
  const auth = await authenticate(req, res, true, 'id-tip-report');
  if (!auth) return;
  const { admin, caller } = auth;

  const parsed = validateIdTipResolution(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const { action, note } = parsed.value;

  const { data: row, error: fetchErr } = await admin.from('id_tip_reports')
    .select('species_code, guess_key, photo_url').eq('id', req.params.id).maybeSingle();
  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!row) return res.status(404).json({ error: 'Report not found' });
  const tipKey = row as { species_code: string; guess_key: string; photo_url: string };

  const { data: resolved, error: updateErr } = await admin.from('id_tip_reports')
    .update({ status: action, curator_note: note, resolved_by: caller.id, resolved_at: new Date().toISOString() })
    .eq('species_code', tipKey.species_code).eq('guess_key', tipKey.guess_key).eq('photo_url', tipKey.photo_url)
    .eq('status', 'pending')
    .select('id, species_code, guess_key, photo_url, com_name, guess, reporter_id, reporter_email, notify_email');
  if (updateErr) return res.status(500).json({ error: updateErr.message });

  res.json({ ok: true, resolved: resolved?.length ?? 0 });

  // Fire-and-forget: tell each reporter (once per person) how their report was resolved.
  (async () => {
    const curatorName = displayNameOf(caller);
    const outcome = idTipResolutionText(action);
    const mail = getResend();
    const seen = new Set<string>();
    for (const r of (resolved ?? []) as ReportRow[]) {
      if (!r.reporter_id || seen.has(r.reporter_id)) continue;
      seen.add(r.reporter_id);
      try {
        await admin.from('notifications').insert({
          recipient_user_id:   r.reporter_id,
          sender_user_id:      caller.id,
          sender_display_name: curatorName,
          type:                'tip_report_resolved',
          data:                { action, comName: r.com_name, guess: r.guess, ...(note ? { note } : {}) },
          read:                false,
        });
        if (mail && r.notify_email && r.reporter_email) {
          const intro = `Your report about the ID tip for ${r.com_name} (when you answered ${r.guess}) has been reviewed.`;
          mail.resend.emails.send({
            from:    `BurdyGurdy <${mail.fromEmail}>`,
            to:      r.reporter_email,
            subject: 'Your BurdyGurdy ID tip report has been reviewed',
            text:    `${intro}\n\n${outcome}${note ? `\n\nNote from reviewer: ${note}` : ''}\n\nThank you for helping improve BurdyGurdy!`,
            html: `
              <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
                <h2 style="color: #2d6a4f;">Your report has been reviewed</h2>
                <p>${escapeHtml(intro)}</p>
                <p>${escapeHtml(outcome)}</p>
                ${note ? `<p><strong>Note from reviewer:</strong> ${escapeHtml(note)}</p>` : ''}
                <p style="color: #666; font-size: 13px;">Thank you for helping improve BurdyGurdy!</p>
              </div>
            `,
          }).catch(err => console.error('[id-tip-report] reporter email:', (err as Error).message));
        }
      } catch (err) {
        console.error('[id-tip-report] reporter notify:', (err as Error).message);
      }
    }
  })();
});

// ── Curator tip editing ──────────────────────────────────────────────────────

// GET /api/id-tip/admin/tip?speciesCode&comName&sciName&guess&photoUrl - admin: the stored tip record.
router.get('/admin/tip', async (req, res) => {
  const auth = await authenticate(req, res, true, 'id-tip-admin');
  if (!auth) return;
  const parsed = validateIdTipRequest(req.query);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    res.json({ record: await loadTipRecord(parsed.value) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/id-tip/admin/tips - admin: the whole tip library. Taxonomy is best-effort: if eBird can't
// be reached, tips come back without family/position and the panel files them under "Unknown family".
router.get('/admin/tips', async (req, res) => {
  const auth = await authenticate(req, res, true, 'id-tip-admin');
  if (!auth) return;
  try {
    const [tips, reportKeys, taxonomy] = await Promise.all([
      listAllTips(),
      listReportKeys(),
      getTaxonomy().catch(err => { console.warn(`[id-tip-admin] taxonomy unavailable: ${(err as Error).message}`); return []; }),
    ]);
    const counts = countReportsByTip(reportKeys);
    const taxa = indexTaxonomy(taxonomy);
    res.json(tips.map(t => {
      const taxon = taxa.get(t.species_code);
      return {
        speciesCode:   t.species_code,
        guessKey:      t.guess_key,
        photoUrl:      t.photo_url,
        comName:       t.com_name,
        sciName:       t.sci_name,
        guess:         t.guess,
        tip:           t.tip,
        model:         t.model,
        createdAt:     t.created_at,
        editedAt:      t.edited_at,
        reportCount:   counts.get(tipKeyString(t.species_code, t.guess_key, t.photo_url)) ?? 0,
        familyComName: taxon?.familyComName ?? null,
        familySciName: taxon?.familySciName ?? null,
        taxonIndex:    taxon?.taxonIndex ?? null,
      };
    }));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/id-tip/admin/draft - admin: generates a new tip for review. Not saved, not rate-limited.
router.post('/admin/draft', async (req, res) => {
  const auth = await authenticate(req, res, true, 'id-tip-admin');
  if (!auth) return;
  if (!idTipsConfigured()) return res.status(503).json({ error: 'ID tips are not configured' });
  const parsed = validateIdTipRequest(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    const tip = await generateIdTip(parsed.value);
    if (!tip) return res.status(502).json({ error: 'The model returned no tip for this photo' });
    res.json({ tip });
  } catch (err) {
    console.error(`[id-tip-admin] draft ${parsed.value.speciesCode}: ${describeError(err)}`);
    res.status(502).json({ error: 'Could not generate a tip' });
  }
});

// PUT /api/id-tip/admin/tip - admin: saves the text players see, and refreshes the in-memory copy.
router.put('/admin/tip', async (req, res) => {
  const auth = await authenticate(req, res, true, 'id-tip-admin');
  if (!auth) return;
  const parsed = validateIdTipSave(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const { tip, ...key } = parsed.value;
  try {
    const record = await saveCuratedTip(key, tip, auth.caller.id);
    cache.set(idTipCacheKey(key), tip, TIP_TTL_MS);
    res.json({ record });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
