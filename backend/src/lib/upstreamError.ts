/**
 * Pure classification of an axios (or axios-like) error into a machine-readable
 * category, so routes can tell the frontend specifically what kind of upstream
 * failure occurred instead of a generic 500. No I/O - takes the already-caught
 * error object.
 */

export type UpstreamErrorCode =
  | 'timeout'
  | 'rate-limited'
  | 'upstream-5xx'
  | 'upstream-4xx'
  | 'network'
  | 'unknown';

export interface ClassifiedUpstreamError {
  code: UpstreamErrorCode;
  statusCode?: number;
}

interface AxiosLikeError {
  code?: string;
  message?: string;
  response?: { status?: number };
  request?: unknown;
  config?: { url?: string; baseURL?: string };
}

const NETWORK_ERROR_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN']);

export function classifyUpstreamError(err: unknown): ClassifiedUpstreamError {
  const e = (err ?? {}) as AxiosLikeError;
  const status = e.response?.status;

  if (typeof status === 'number') {
    if (status === 429) return { code: 'rate-limited', statusCode: status };
    if (status >= 500) return { code: 'upstream-5xx', statusCode: status };
    if (status >= 400) return { code: 'upstream-4xx', statusCode: status };
  }

  if (e.code === 'ECONNABORTED' || /timeout/i.test(e.message ?? '')) {
    return { code: 'timeout' };
  }

  const isNetworkFailure =
    (e.code !== undefined && NETWORK_ERROR_CODES.has(e.code)) ||
    /network error/i.test(e.message ?? '') ||
    (e.request !== undefined && e.response === undefined);
  if (isNetworkFailure) {
    return { code: 'network' };
  }

  return { code: 'unknown' };
}

// ── Service attribution ──────────────────────────────────────────────────────
// Matches the failed request's URL against known upstream hosts, so routes that
// call several external APIs (eBird, xeno-canto, Macaulay, iNaturalist, Wikipedia)
// can report which one actually failed without wrapping every call site in its
// own try/catch. Relies on axios populating `err.config.url` / `baseURL`.

const SERVICE_HOSTS: Array<{ match: string; name: string }> = [
  { match: 'api.ebird.org',           name: 'eBird' },
  { match: 'xeno-canto.org',          name: 'xeno-canto' },
  { match: 'macaulaylibrary.org',     name: 'the Macaulay Library' },
  { match: 'birds.cornell.edu',       name: 'the Macaulay Library' },
  { match: 'inaturalist.org',         name: 'iNaturalist' },
  { match: 'wikipedia.org',           name: 'Wikipedia' },
];

/** Returns a human-readable upstream service name for an axios error, or undefined if unrecognized. */
export function identifyUpstreamService(err: unknown): string | undefined {
  const e = (err ?? {}) as AxiosLikeError;
  const url = `${e.config?.baseURL ?? ''}${e.config?.url ?? ''}`;
  if (!url) return undefined;
  return SERVICE_HOSTS.find(h => url.includes(h.match))?.name;
}
