/**
 * Pure formatter: turns a classified upstream-error payload from the backend
 * (see backend/src/lib/upstreamError.ts) into a plain-language message, instead
 * of showing the raw exception text / JSON to the user. Shared by every screen
 * that fetches from eBird/xeno-canto/Macaulay/Wikipedia/iNaturalist through the
 * backend proxy - quiz loading, bird info, sightings, and audio.
 */

export type UpstreamErrorCode =
  | 'timeout'
  | 'rate-limited'
  | 'upstream-5xx'
  | 'upstream-4xx'
  | 'network'
  | 'unknown';

export interface UpstreamErrorPayload {
  code?: UpstreamErrorCode;
  service?: string;
  statusCode?: number;
}

const DEFAULT_SERVICE_NAME = 'the bird data service';

/**
 * `fallback` is shown for an `upstream-4xx` (which is usually about the specific
 * request, not the service being down) and for a missing/unrecognized code - so
 * each call site can phrase that case in terms of what the user was doing.
 */
export function describeUpstreamError(payload: UpstreamErrorPayload | undefined | null, fallback: string): string {
  const service = payload?.service ?? DEFAULT_SERVICE_NAME;

  switch (payload?.code) {
    case 'timeout':
      return `${service} is responding slowly right now. This usually clears up in a few minutes — please try again shortly.`;
    case 'rate-limited':
      return `${service} is temporarily limiting requests. Please wait a moment and try again.`;
    case 'upstream-5xx': {
      const suffix = payload?.statusCode ? ` (error ${payload.statusCode})` : '';
      return `${service} is having issues on their end right now${suffix}. Please try again in a few minutes.`;
    }
    case 'upstream-4xx':
      return fallback;
    case 'network':
      return `Couldn't reach ${service} — check your internet connection and try again.`;
    default:
      return fallback;
  }
}
