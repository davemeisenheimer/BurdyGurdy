import { Router } from 'express';
import { Resend } from 'resend';
import { getSupabaseAdmin } from '../lib/supabase';

const router = Router();

// POST /api/friends/send-invite-email
// Sends a friend invite email via Resend.
// Called by the frontend after it has written the invite record to Supabase.
router.post('/send-invite-email', async (req, res) => {
  const { token, toEmail, fromDisplayName, appUrl } = req.body as {
    token: string;
    toEmail: string;
    fromDisplayName: string;
    appUrl: string;
  };

  if (!token || !toEmail || !fromDisplayName || !appUrl) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev';

  if (!apiKey) {
    console.error('RESEND_API_KEY not set');
    return res.status(500).json({ error: 'Email service not configured' });
  }

  const inviteUrl = `${appUrl}?invite=${token}`;
  const resend = new Resend(apiKey);

  try {
    await resend.emails.send({
      from: `BurdyGurdy <${fromEmail}>`,
      to: toEmail,
      subject: `${fromDisplayName} invited you to be friends on BurdyGurdy`,
      text: `${fromDisplayName} has invited you to be friends on BurdyGurdy — the bird identification quiz app.\n\nAccept the invite here:\n${inviteUrl}\n\nThis invite expires in 7 days. If you don't have a BurdyGurdy account yet, you'll be able to create one when you click the link above.\n\nIf you didn't expect this email, you can safely ignore it.`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #2d6a4f;">You've been invited to BurdyGurdy!</h2>
          <p><strong>${fromDisplayName}</strong> wants to be friends with you on BurdyGurdy — the bird identification quiz app.</p>
          <p style="margin: 24px 0;">
            <a href="${inviteUrl}"
               style="background: #2d6a4f; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">
              Accept Friend Request
            </a>
          </p>
          <p style="color: #666; font-size: 13px;">
            This invite expires in 7 days. If you don't have a BurdyGurdy account yet,
            you'll be able to create one when you click the link above.
          </p>
          <p style="color: #999; font-size: 12px;">
            If you didn't expect this email, you can safely ignore it.
          </p>
        </div>
      `,
    });
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Resend error:', message);
    res.status(500).json({ error: `Failed to send email: ${message}` });
  }
});

// POST /api/friends/notify
// Fan-out: inserts one notification row per friend of the authenticated caller.
router.post('/notify', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing auth token' });
  }
  const token = authHeader.slice(7);

  let admin;
  try { admin = getSupabaseAdmin(); }
  catch (e) { return res.status(500).json({ error: (e as Error).message }); }

  // Verify the caller's JWT and get their user ID
  const { data: { user }, error: authError } = await admin.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Invalid token' });

  const { type, data } = req.body as { type: string; data: Record<string, unknown> };
  if (!type) return res.status(400).json({ error: 'type is required' });

  // Get sender's display name from profiles
  const { data: profile } = await admin
    .from('profiles')
    .select('display_name')
    .eq('id', user.id)
    .single();
  const displayName: string = (profile as { display_name: string } | null)?.display_name
    ?? user.email?.split('@')[0]
    ?? 'A friend';

  // Look up friends
  const { data: friendships } = await admin
    .from('friendships')
    .select('user_id_a, user_id_b')
    .or(`user_id_a.eq.${user.id},user_id_b.eq.${user.id}`);

  if (!friendships?.length) return res.json({ ok: true, notified: 0 });

  const friendIds = (friendships as Array<{ user_id_a: string; user_id_b: string }>)
    .map(f => f.user_id_a === user.id ? f.user_id_b : f.user_id_a);

  const rows = friendIds.map(recipientId => ({
    recipient_user_id:   recipientId,
    sender_user_id:      user.id,
    sender_display_name: displayName,
    type,
    data: data ?? {},
  }));

  const { error } = await admin.from('notifications').insert(rows);
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ ok: true, notified: friendIds.length });
});

export default router;
