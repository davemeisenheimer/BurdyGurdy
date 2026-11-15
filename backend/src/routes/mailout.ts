import express, { Router } from 'express';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { randomUUID } from 'crypto';
import { Resend } from 'resend';
import type { User } from '@supabase/supabase-js';
import { authenticate } from '../lib/authenticate';
import type { AdminClient } from '../lib/authenticate';
import { getSupabaseAdmin } from '../lib/supabase';
import {
  validateMailout,
  buildMailoutEmail,
  buildUnsubscribeUrl,
  unsubscribeHeaders,
  verifyUnsubscribe,
  selectRecipients,
  chunk,
  unsubscribeConfirmPage,
  unsubscribeDonePage,
  unsubscribeErrorPage,
  unsubscribeInvalidPage,
  detectImageType,
  mailoutImagePath,
  MAILOUT_BATCH_SIZE,
  MAILOUT_IMAGE_BUCKET,
  MAILOUT_IMAGE_MAX_BYTES,
} from '../lib/mailout';
import type { MailoutRecipient } from '../lib/mailout';

const router = Router();

/** Resend allows about 2 requests a second by default. */
const BATCH_PAUSE_MS = 600;

interface MailoutConfig { resend: Resend; from: string; secret: string; baseUrl: string }

/** Returns the sending config, or an error message naming what's missing. */
function getConfig(): MailoutConfig | { error: string } {
  const apiKey = process.env.RESEND_API_KEY;
  const secret = process.env.MAILOUT_UNSUBSCRIBE_SECRET;
  if (!apiKey) return { error: 'RESEND_API_KEY is not set on the server.' };
  if (!secret) return { error: 'MAILOUT_UNSUBSCRIBE_SECRET is not set on the server.' };
  return {
    resend:  new Resend(apiKey),
    from:    `BurdyGurdy <${process.env.MAILOUT_FROM_EMAIL ?? 'noreply@burdygurdy.com'}>`,
    secret,
    baseUrl: process.env.PUBLIC_APP_URL ?? 'https://burdygurdy.com',
  };
}

function displayNameOf(user: User): string {
  return (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    user.email ?? 'An admin';
}

/** Every opted-in user, reading all pages of the auth user list. */
async function loadRecipients(admin: AdminClient): Promise<MailoutRecipient[]> {
  const perPage = 1000;
  const recipients: MailoutRecipient[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    recipients.push(...selectRecipients(data.users));
    if (data.users.length < perPage) return recipients;
  }
}

/** Public URL of the image bucket, ending in "/". Mailout images must start with this. */
function imageBaseUrl(admin: AdminClient): string {
  return admin.storage.from(MAILOUT_IMAGE_BUCKET).getPublicUrl('').data.publicUrl.replace(/\/*$/, '/');
}

function emailFor(config: MailoutConfig, subject: string, cleanHtml: string, recipient: MailoutRecipient) {
  const unsubscribeUrl = buildUnsubscribeUrl(config.baseUrl, recipient.id, config.secret);
  return {
    from:    config.from,
    to:      recipient.email,
    headers: unsubscribeHeaders(unsubscribeUrl),
    ...buildMailoutEmail({ subject, cleanHtml, unsubscribeUrl }),
  };
}

// GET /api/mailout/recipients
// Admin-only. How many users a mailout would go to.
router.get('/recipients', async (req, res) => {
  const auth = await authenticate(req, res, true, 'mailout');
  if (!auth) return;
  try {
    res.json({ count: (await loadRecipients(auth.admin)).length });
  } catch (err) {
    console.error('[mailout] recipients:', (err as Error).message);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/mailout/preview
// Admin-only. Returns the full email HTML as recipients will see it.
router.post('/preview', async (req, res) => {
  const auth = await authenticate(req, res, true, 'mailout');
  if (!auth) return;
  const parsed = validateMailout(req.body, imageBaseUrl(auth.admin));
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const { html } = buildMailoutEmail({ subject: parsed.value.subject, cleanHtml: parsed.value.html, unsubscribeUrl: '#' });
  res.json({ html });
});

// POST /api/mailout/test
// Admin-only. Sends the mailout to the caller only, with "[Test]" in the subject.
router.post('/test', async (req, res) => {
  const auth = await authenticate(req, res, true, 'mailout');
  if (!auth) return;
  const config = getConfig();
  if ('error' in config) return res.status(500).json({ error: config.error });
  const parsed = validateMailout(req.body, imageBaseUrl(auth.admin));
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  if (!auth.caller.email) return res.status(400).json({ error: 'Your account has no email address.' });

  const { error } = await config.resend.emails.send(
    emailFor(config, `[Test] ${parsed.value.subject}`, parsed.value.html, { id: auth.caller.id, email: auth.caller.email }),
  );
  if (error) {
    console.error('[mailout] test send:', error.message);
    return res.status(502).json({ error: `Email service error: ${error.message}` });
  }
  res.json({ ok: true, to: auth.caller.email });
});

/** Guards against a double-click starting two sends at once. */
let sendInProgress = false;

// POST /api/mailout
// Admin-only. Sends the mailout to every opted-in user and records it.
router.post('/', async (req, res) => {
  const auth = await authenticate(req, res, true, 'mailout');
  if (!auth) return;
  const { admin, caller } = auth;
  const config = getConfig();
  if ('error' in config) return res.status(500).json({ error: config.error });
  const parsed = validateMailout(req.body, imageBaseUrl(admin));
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const { subject, html } = parsed.value;

  if (sendInProgress) return res.status(409).json({ error: 'Another mailout is still sending.' });
  sendInProgress = true;
  try {
    const recipients = await loadRecipients(admin);
    if (recipients.length === 0) return res.status(400).json({ error: 'Nobody has opted in to news yet.' });

    const { data: row, error: insertErr } = await admin.from('mailouts').insert({
      subject, html,
      sent_by:         caller.id,
      sent_by_name:    displayNameOf(caller),
      recipient_count: recipients.length,
      status:          'sending',
    }).select('id').single();
    if (insertErr || !row) {
      console.error('[mailout] record:', insertErr?.message);
      return res.status(500).json({ error: `Could not record the mailout: ${insertErr?.message ?? 'no row returned'}` });
    }
    const mailoutId = (row as { id: string }).id;

    let sentCount = 0;
    let failedCount = 0;
    const batches = chunk(recipients, MAILOUT_BATCH_SIZE);
    for (let i = 0; i < batches.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, BATCH_PAUSE_MS));
      const batch = batches[i];
      try {
        const { data, error } = await config.resend.batch.send(
          batch.map(r => emailFor(config, subject, html, r)),
          { batchValidation: 'permissive', idempotencyKey: `mailout-${mailoutId}-${i}` },
        );
        if (error || !data) {
          console.error(`[mailout] batch ${i + 1}/${batches.length} failed: ${error?.message ?? 'no response'}`);
          failedCount += batch.length;
          continue;
        }
        for (const e of data.errors ?? []) {
          console.error(`[mailout] ${batch[e.index]?.email ?? `#${e.index}`}: ${e.message}`);
        }
        failedCount += data.errors?.length ?? 0;
        sentCount   += batch.length - (data.errors?.length ?? 0);
      } catch (err) {
        console.error(`[mailout] batch ${i + 1}/${batches.length} threw: ${(err as Error).message}`);
        failedCount += batch.length;
      }
    }

    const { error: updateErr } = await admin.from('mailouts').update({
      sent_count:   sentCount,
      failed_count: failedCount,
      status:       'sent',
      completed_at: new Date().toISOString(),
    }).eq('id', mailoutId);
    if (updateErr) console.error('[mailout] record result:', updateErr.message);

    console.log(`[mailout] "${subject}": ${sentCount} sent, ${failedCount} failed of ${recipients.length}`);
    res.json({ recipientCount: recipients.length, sentCount, failedCount });
  } catch (err) {
    console.error('[mailout] send:', (err as Error).message);
    res.status(500).json({ error: (err as Error).message });
  } finally {
    sendInProgress = false;
  }
});

/** Turns body-parser failures (mainly "too large") into a JSON error the panel can show. */
const imageBodyError: ErrorRequestHandler = (err, _req, res, _next) => {
  const tooLarge = (err as { type?: string }).type === 'entity.too.large';
  res.status(tooLarge ? 413 : 400).json({
    error: tooLarge ? `That image is too large (${MAILOUT_IMAGE_MAX_BYTES / (1024 * 1024)} MB max).` : 'Could not read the image.',
  });
};

// POST /api/mailout/images   (body: the raw image file)
// Admin-only. Stores an image for use in a mailout and returns its public URL.
/** Checks the caller is an admin before the image body is read, so others can't upload large files. */
const requireAdminForImage: RequestHandler = async (req, res, next) => {
  const auth = await authenticate(req, res, true, 'mailout');
  if (!auth) return;
  res.locals.admin = auth.admin;
  next();
};

const storeImage: RequestHandler = async (req, res) => {
  const admin = res.locals.admin as AdminClient;
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const image = detectImageType(body);
  if (!image) return res.status(400).json({ error: 'Please use a PNG, JPEG, GIF or WebP image.' });

  const path = mailoutImagePath(randomUUID(), image.ext, new Date());
  const { error } = await admin.storage.from(MAILOUT_IMAGE_BUCKET).upload(path, body, {
    contentType:  image.contentType,
    cacheControl: '31536000', // a file's content never changes - each upload gets a new name
  });
  if (error) {
    console.error('[mailout] image upload:', error.message);
    return res.status(502).json({ error: `Image storage error: ${error.message}` });
  }
  res.json({ url: admin.storage.from(MAILOUT_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl });
};

router.post(
  '/images',
  requireAdminForImage,
  express.raw({ type: () => true, limit: MAILOUT_IMAGE_MAX_BYTES }),
  storeImage,
  imageBodyError,
);

// GET /api/mailout/history
// Admin-only. Past mailouts, newest first.
router.get('/history', async (req, res) => {
  const auth = await authenticate(req, res, true, 'mailout');
  if (!auth) return;
  const { data, error } = await auth.admin
    .from('mailouts')
    .select('id, subject, sent_by_name, recipient_count, sent_count, failed_count, status, created_at')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

// ── Unsubscribe (public - opened from the email link) ─────────────────────────

function unsubscribeParams(query: Record<string, unknown>): { userId: string; token: string } {
  return {
    userId: typeof query.u === 'string' ? query.u : '',
    token:  typeof query.t === 'string' ? query.t : '',
  };
}

// GET /api/mailout/unsubscribe?u=<userId>&t=<token>
// Shows a confirmation page; the button POSTs back to the same URL.
router.get('/unsubscribe', (req, res) => {
  const secret = process.env.MAILOUT_UNSUBSCRIBE_SECRET ?? '';
  const { userId, token } = unsubscribeParams(req.query);
  if (!verifyUnsubscribe(userId, token, secret)) return res.status(400).type('html').send(unsubscribeInvalidPage());
  res.type('html').send(unsubscribeConfirmPage(req.originalUrl));
});

// POST /api/mailout/unsubscribe?u=<userId>&t=<token>
// Turns off news emails. Also the target of mail apps' one-click unsubscribe.
router.post('/unsubscribe', async (req, res) => {
  const secret = process.env.MAILOUT_UNSUBSCRIBE_SECRET ?? '';
  const { userId, token } = unsubscribeParams(req.query);
  if (!verifyUnsubscribe(userId, token, secret)) return res.status(400).type('html').send(unsubscribeInvalidPage());

  try {
    const admin = getSupabaseAdmin();
    const { data, error: getErr } = await admin.auth.admin.getUserById(userId);
    if (getErr || !data.user) {
      // Account deleted since the email went out - nothing left to unsubscribe
      console.warn(`[mailout] unsubscribe: user ${userId} not found: ${getErr?.message ?? 'no user'}`);
      return res.type('html').send(unsubscribeDonePage());
    }
    const { error } = await admin.auth.admin.updateUserById(userId, {
      user_metadata: { ...data.user.user_metadata, news_opt_in: false },
    });
    if (error) throw new Error(error.message);
    console.log(`[mailout] unsubscribed ${userId}`);
    res.type('html').send(unsubscribeDonePage());
  } catch (err) {
    console.error('[mailout] unsubscribe:', (err as Error).message);
    res.status(500).type('html').send(unsubscribeErrorPage());
  }
});

export default router;
