import type { Request, Response } from 'express';
import type { User } from '@supabase/supabase-js';
import { getSupabaseAdmin } from './supabase';
import { classifyAuthFailure } from './authFailure';

export type AdminClient = ReturnType<typeof getSupabaseAdmin>;

/**
 * Verifies the Bearer token. Sends the error response and returns null on failure.
 * `logTag` prefixes the warning logged when the token can't be verified.
 */
export async function authenticate(
  req: Request,
  res: Response,
  requireAdmin: boolean,
  logTag: string,
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
    console.warn(`[${logTag}] auth failed (${kind}) on ${req.method} ${req.baseUrl}${req.path}: ${authErr?.message ?? 'no user returned'}`);
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
