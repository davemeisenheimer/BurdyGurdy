import { Router } from 'express';
import type { Request, Response } from 'express';
import { Resend } from 'resend';
import type { User } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '../lib/supabase';
import {
  validateFeedbackSubmission,
  validateFeedbackReply,
  buildAdminFeedbackEmail,
  buildFeedbackReplyEmail,
  excerpt,
  FEEDBACK_STATUSES,
} from '../lib/feedback';
import type { FeedbackStatus } from '../lib/feedback';
import { classifyAuthFailure } from '../lib/authFailure';

const router = Router();

type AdminClient = ReturnType<typeof getSupabaseAdmin>;

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

/** Verifies the Bearer token. Sends the error response and returns null on failure. */
async function authenticate(
  req: Request,
  res: Response,
  requireAdmin: boolean,
): Promise<{ admin: AdminClient; caller: User } | null> {
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  if (!token) { res.status(401).json({ error: 'Missing auth token' }); return null; }

  let admin: AdminClient;
  try { admin = getSupabaseAdmin(); }
  catch (e) { res.status(500).json({ error: (e as Error).message }); return null; }

  const { data: { user: caller }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !caller) {
    const kind = authErr ? classifyAuthFailure(authErr) : 'invalid-token';
    console.warn(`[feedback] auth failed (${kind}) on ${req.method} ${req.baseUrl}${req.path}: ${authErr?.message ?? 'no user returned'}`);
    if (kind === 'auth-unavailable') {
      res.status(503).json({ error: 'Could not verify sign-in right now', code: kind });
    } else {
      res.status(401).json({ error: 'Invalid token', code: kind });
    }
    return null;
  }
  if (requireAdmin && caller.user_metadata?.is_admin !== true) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return { admin, caller };
}

// POST /api/feedback
// Submits user feedback. Requires authentication. Notifies all admins in-app and by email.
router.post('/', async (req, res) => {
  const auth = await authenticate(req, res, false);
  if (!auth) return;
  const { admin, caller } = auth;

  const parsed = validateFeedbackSubmission(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const fb = parsed.value;
  const senderName = displayNameOf(caller);

  const { error: insertErr } = await admin.from('feedback').insert({
    user_id:           caller.id,
    user_display_name: senderName,
    user_email:        caller.email ?? null,
    category:          fb.category,
    message:           fb.message,
    source:            fb.source,
    context:           fb.context,
    notify_email:      fb.notifyEmail,
    status:            'new',
  });
  if (insertErr) {
    console.error('[feedback] insert:', insertErr.message);
    return res.status(500).json({ error: insertErr.message });
  }

  res.json({ ok: true });

  // Fire-and-forget: in-app + email notifications to all admins
  (async () => {
    try {
      const { data: usersPage } = await admin.auth.admin.listUsers({ perPage: 1000 });
      const adminUsers = (usersPage?.users ?? []).filter(u => u.user_metadata?.is_admin === true);
      const mail  = getResend();
      const email = buildAdminFeedbackEmail({
        senderName, senderEmail: caller.email ?? null, category: fb.category, source: fb.source, message: fb.message,
      });

      for (const adminUser of adminUsers) {
        await admin.from('notifications').insert({
          recipient_user_id:   adminUser.id,
          sender_user_id:      caller.id,
          sender_display_name: senderName,
          type:                'new_feedback',
          data:                { category: fb.category, excerpt: excerpt(fb.message) },
          read:                false,
        });

        if (mail && adminUser.email) {
          mail.resend.emails.send({
            from:    `BurdyGurdy <${mail.fromEmail}>`,
            to:      adminUser.email,
            ...(caller.email ? { replyTo: caller.email } : {}),
            ...email,
          }).catch(err => console.error('[feedback] admin email:', (err as Error).message));
        }
      }
    } catch (err) {
      console.error('[feedback] admin notify:', (err as Error).message);
    }
  })();
});

// GET /api/feedback?status=new
// Lists feedback for admins, newest first. Optional status filter.
router.get('/', async (req, res) => {
  const auth = await authenticate(req, res, true);
  if (!auth) return;

  const status = typeof req.query.status === 'string' ? req.query.status : null;
  if (status && !(FEEDBACK_STATUSES as readonly string[]).includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  let query = auth.admin
    .from('feedback')
    .select('id, user_id, user_display_name, user_email, category, message, source, context, notify_email, status, admin_reply, replied_at, created_at')
    .order('created_at', { ascending: false })
    .limit(500);
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

// PATCH /api/feedback/:id/status
// Admin-only. Marks a feedback item new/read (replied is set by the reply endpoint).
router.patch('/:id/status', async (req, res) => {
  const auth = await authenticate(req, res, true);
  if (!auth) return;

  const status = req.body?.status as FeedbackStatus | undefined;
  if (status !== 'new' && status !== 'read') return res.status(400).json({ error: 'Invalid status' });

  const { error } = await auth.admin.from('feedback').update({ status }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// POST /api/feedback/:id/reply
// Admin-only. Saves the reply, notifies the user in-app, and emails them if they opted in.
router.post('/:id/reply', async (req, res) => {
  const auth = await authenticate(req, res, true);
  if (!auth) return;
  const { admin, caller } = auth;

  const parsed = validateFeedbackReply(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const reply = parsed.value;

  const { data: row, error: fetchErr } = await admin
    .from('feedback')
    .select('id, user_id, user_email, message, notify_email')
    .eq('id', req.params.id)
    .maybeSingle();
  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!row) return res.status(404).json({ error: 'Feedback not found' });
  const fb = row as { id: string; user_id: string; user_email: string | null; message: string; notify_email: boolean };

  const repliedAt = new Date().toISOString();
  const { error: updateErr } = await admin
    .from('feedback')
    .update({ admin_reply: reply, replied_at: repliedAt, status: 'replied' })
    .eq('id', fb.id);
  if (updateErr) return res.status(500).json({ error: updateErr.message });

  const replierName = displayNameOf(caller);
  const { error: notifErr } = await admin.from('notifications').insert({
    recipient_user_id:   fb.user_id,
    sender_user_id:      caller.id,
    sender_display_name: replierName,
    type:                'feedback_reply',
    data:                { reply, excerpt: excerpt(fb.message) },
    read:                false,
  });
  if (notifErr) {
    console.error('[feedback-reply] notification insert:', notifErr.message);
    return res.status(500).json({ error: notifErr.message });
  }

  let emailed = false;
  const mail = getResend();
  if (fb.notify_email && fb.user_email && mail) {
    mail.resend.emails.send({
      from: `BurdyGurdy <${mail.fromEmail}>`,
      to:   fb.user_email,
      ...buildFeedbackReplyEmail({ replierName, originalMessage: fb.message, reply }),
    }).catch(err => console.error('[feedback-reply] email:', (err as Error).message));
    emailed = true;
  }

  res.json({ ok: true, repliedAt, emailed });
});

export default router;
