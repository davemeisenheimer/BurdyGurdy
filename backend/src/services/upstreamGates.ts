import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { HostGate, parseRetryAfterMs } from '../lib/hostGate';

// One gate per third-party host we call. Caps concurrent requests and pauses the host after a 429.
export const inatGate     = new HostGate('iNaturalist', 4);
export const wikiGate     = new HostGate('Wikipedia', 5);
export const macaulayGate = new HostGate('Macaulay Library', 4);

/** Used when a 429 carries no Retry-After header (iNaturalist sends none). */
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 30_000;
/** Upper bound on any cooldown, however long the upstream asks for. */
const MAX_RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;

/**
 * axios.get routed through a HostGate: respects the host's concurrency cap and cooldown, and
 * starts a cooldown (honouring Retry-After) whenever the host answers 429.
 * Pass `signal` in the config to drop the request if it is still queued when the signal aborts.
 */
export function gatedGet<T = any>( // eslint-disable-line @typescript-eslint/no-explicit-any
  gate: HostGate,
  url: string,
  config: AxiosRequestConfig = {},
): Promise<AxiosResponse<T>> {
  return gate.run(async () => {
    try {
      return await axios.get<T>(url, config);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 429) {
        const ms = parseRetryAfterMs(err.response.headers?.['retry-after'], DEFAULT_RATE_LIMIT_COOLDOWN_MS, MAX_RATE_LIMIT_COOLDOWN_MS);
        if (gate.coolDown(ms)) {
          console.warn(`[${gate.host}] rate-limited (HTTP 429) - pausing requests to it for ${Math.ceil(ms / 1000)}s`);
        }
      }
      throw err;
    }
  }, config.signal as AbortSignal | undefined);
}
