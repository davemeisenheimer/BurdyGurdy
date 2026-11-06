/**
 * Tells a rejected token apart from failing to ask Supabase at all.
 *
 * supabase-js `auth.getUser(token)` reports both as an error: an AuthApiError with a 4xx status
 * when Supabase rejected the token (expired, malformed, revoked), or an AuthRetryableFetchError
 * (status 0 or 5xx) when the request to Supabase itself failed. Treating the latter as "invalid
 * token" sends the user a misleading 401.
 */
export type AuthFailureKind = 'invalid-token' | 'auth-unavailable';

export function classifyAuthFailure(err: unknown): AuthFailureKind {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) return 'invalid-token';
  return 'auth-unavailable';
}
