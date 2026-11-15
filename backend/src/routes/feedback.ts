import { Router } from 'express';
import { Resend } from 'resend';
import type { User } from '@supabase/supabase-js';
import { authenticate } from '../lib/authenticate';
import {
  validateFeedbackSubmission,
  validateFeedbackReply,
  buildAdminFeedbackEmail,
  buildFeedbackReplyEmail,
  excerpt,
  FEEDBACK_STATUSES,
} from '../lib/feedback';
import type { FeedbackStatus } from '../lib/feedback';

const router = Router();

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

// POST /api/feedback
// Submits user feedback. Requires authentication. Notifies all admins in-app and by email.
router.post('/', async (req, res) => {
  const auth = await authenticate(req, res, false, 'feedback');
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
  const auth = await authenticate(req, res, true, 'feedback');
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
  const auth = await authenticate(req, res, true, 'feedback');
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
  const auth = await authenticate(req, res, true, 'feedback');
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
