// Pure helpers for classifying, describing and logging failed/slow API requests made from the browser.
import { describeUpstreamError } from './upstreamErrorMessages';
import type { UpstreamErrorPayload } from './upstreamErrorMessages';

export type RequestErrorKind = 'timeout' | 'network' | 'cancelled' | 'http' | 'unknown';

export interface ClassifiedRequestError {
  kind:     RequestErrorKind;
  status?:  number;
  payload?: UpstreamErrorPayload;
}

/** Classifies an axios-style error without depending on axios (duck-typed for testability). */
export function classifyRequestError(err: unknown): ClassifiedRequestError {
  const e = (err ?? {}) as {
    code?: string;
    name?: string;
    response?: { status?: number; data?: unknown };
  };
  if (e.code === 'ERR_CANCELED' || e.name === 'CanceledError' || e.name === 'AbortError') return { kind: 'cancelled' };
  if (e.response?.status) {
    const data = e.response.data;
    const payload = data && typeof data === 'object' ? data as UpstreamErrorPayload : undefined;
    return { kind: 'http', status: e.response.status, payload };
  }
  if (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT') return { kind: 'timeout' };
  if (e.code === 'ERR_NETWORK') return { kind: 'network' };
  return { kind: 'unknown' };
}

/** Short label for logs, e.g. "timeout", "HTTP 503", "network error". */
export function describeErrorForLog(c: ClassifiedRequestError): string {
  switch (c.kind) {
    case 'http':      return `HTTP ${c.status}${c.payload?.code ? ` (${c.payload.code}${c.payload.service ? `, ${c.payload.service}` : ''})` : ''}`;
    case 'timeout':   return 'timed out in the browser';
    case 'network':   return 'network error (no response)';
    case 'cancelled': return 'cancelled';
    default:          return 'unknown error';
  }
}

/**
 * User-facing message for a failed request. Browser-side timeouts and network errors are about
 * reaching BurdyGurdy itself; HTTP errors carrying an upstream payload name the slow service.
 */
export function describeRequestError(err: unknown, fallback: string): string {
  const c = classifyRequestError(err);
  switch (c.kind) {
    case 'timeout':
      return 'BurdyGurdy is taking too long to respond right now. Please try again in a moment.';
    case 'network':
      return "Couldn't reach BurdyGurdy - check your internet connection and try again.";
    case 'http':
      return describeUpstreamError(c.payload, fallback);
    default:
      return fallback;
  }
}

/** Requests slower than this are logged even when they succeed. */
export const SLOW_REQUEST_MS = 5_000;

export function shouldLogRequest(durationMs: number, failed: boolean, cancelled: boolean): boolean {
  if (cancelled) return false;
  return failed || durationMs >= SLOW_REQUEST_MS;
}
