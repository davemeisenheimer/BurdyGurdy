import { createClient } from '@supabase/supabase-js';

/** Service-role client for server-side operations (bypasses RLS). */
export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
