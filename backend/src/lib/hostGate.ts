/**
 * Per-upstream-host request gate: caps concurrent requests, and pauses all requests to a host
 * for a cooldown period after it rate-limits us (HTTP 429), so we stop hammering a service that
 * has already told us to back off. No I/O of its own - callers wrap their requests in `run`.
 */

export class HostCoolingDownError extends Error {
  readonly code = 'HOST_COOLING_DOWN';
  constructor(readonly host: string, readonly retryInMs: number) {
    super(`${host} is cooling down (${Math.ceil(retryInMs / 1000)}s left)`);
    this.name = 'HostCoolingDownError';
  }
}

export class GateQueueTimeoutError extends Error {
  readonly code = 'GATE_QUEUE_TIMEOUT';
  constructor(readonly host: string) {
    super(`${host} request waited too long in the queue`);
    this.name = 'GateQueueTimeoutError';
  }
}

/** Thrown when a request is aborted while still waiting in the queue. Mirrors axios's cancel code. */
export class GateAbortedError extends Error {
  readonly code = 'ERR_CANCELED';
  constructor(readonly host: string) {
    super(`${host} request aborted while queued`);
    this.name = 'GateAbortedError';
  }
}

/** True for errors caused by an AbortSignal (axios cancel, fetch abort, or a gate-queue abort). */
export function isAbortLike(err: unknown): boolean {
  const e = (err ?? {}) as { code?: string; name?: string };
  return e.code === 'ERR_CANCELED' || e.name === 'CanceledError' || e.name === 'AbortError' || e.name === 'GateAbortedError';
}

/**
 * Parses a Retry-After header (delta-seconds or HTTP-date) into milliseconds, clamped to
 * [0, capMs]. Falls back to `fallbackMs` when absent or unparseable.
 */
export function parseRetryAfterMs(
  header: unknown,
  fallbackMs: number,
  capMs: number,
  now: number = Date.now(),
): number {
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw === undefined || raw === null || String(raw).trim() === '') return Math.min(fallbackMs, capMs);
  const asSeconds = Number(raw);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) return Math.min(asSeconds * 1000, capMs);
  const asDate = Date.parse(String(raw));
  if (!Number.isNaN(asDate)) return Math.min(Math.max(0, asDate - now), capMs);
  return Math.min(fallbackMs, capMs);
}

interface Waiter {
  grant: () => void;
}

export class HostGate {
  private active = 0;
  private queue: Waiter[] = [];
  private cooldownUntil = 0;

  constructor(
    readonly host: string,
    private readonly maxConcurrent: number,
    private readonly maxQueueMs = 8_000,
    private readonly now: () => number = Date.now,
  ) {}

  get cooldownRemainingMs(): number {
    return Math.max(0, this.cooldownUntil - this.now());
  }

  /** Starts (or extends) a cooldown. Returns true only if the host was not already cooling down. */
  coolDown(ms: number): boolean {
    const wasCooling = this.cooldownRemainingMs > 0;
    this.cooldownUntil = Math.max(this.cooldownUntil, this.now() + ms);
    return !wasCooling;
  }

  /**
   * Runs `fn` once a concurrency slot is free. Rejects immediately while the host is cooling down,
   * if `signal` aborts while queued, or if the request waits longer than maxQueueMs in the queue.
   */
  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.assertNotCoolingDown();
    if (signal?.aborted) throw new GateAbortedError(this.host);
    await this.acquire(signal);
    try {
      // A cooldown may have started while this request waited its turn.
      this.assertNotCoolingDown();
      return await fn();
    } finally {
      this.release();
    }
  }

  private assertNotCoolingDown(): void {
    const remaining = this.cooldownRemainingMs;
    if (remaining > 0) throw new HostCoolingDownError(this.host, remaining);
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { grant: () => {} };
      const remove = () => {
        const i = this.queue.indexOf(waiter);
        if (i >= 0) this.queue.splice(i, 1);
      };
      const onAbort = () => {
        clearTimeout(timer);
        remove();
        reject(new GateAbortedError(this.host));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        remove();
        reject(new GateQueueTimeoutError(this.host));
      }, this.maxQueueMs);
      waiter.grant = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.queue.push(waiter);
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) next.grant(); // hand the slot straight to the next waiter; `active` is unchanged
    else this.active--;
  }
}
