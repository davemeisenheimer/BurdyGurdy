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
  name?: string;
  code?: string;
  message?: string;
  response?: { status?: number; headers?: Record<string, unknown> };
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

/**
 * One-line description of an upstream failure for server logs, e.g. "HTTP 429 (rate-limited, retry-after 30)",
 * "timeout", "network (ECONNRESET)". Complements classifyUpstreamError, which drives client-facing messages.
 */
export function describeUpstreamFailure(err: unknown): string {
  const e = (err ?? {}) as AxiosLikeError;
  // Errors raised by our own HostGate (cooldown / queue wait) already carry a readable message.
  if (e.name === 'HostCoolingDownError' || e.name === 'GateQueueTimeoutError') return e.message ?? e.name;
  const { code, statusCode } = classifyUpstreamError(err);
  if (statusCode !== undefined) {
    const retryAfter = e.response?.headers?.['retry-after'];
    const extras = [code === 'rate-limited' ? 'rate-limited' : '', retryAfter !== undefined ? `retry-after ${String(retryAfter)}` : '']
      .filter(Boolean).join(', ');
    return `HTTP ${statusCode}${extras ? ` (${extras})` : ''}`;
  }
  if (code === 'network' && e.code) return `network (${e.code})`;
  if (code === 'unknown') return `unknown (${e.message ?? String(err)})`;
  return code;
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
