import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  HostGate, HostCoolingDownError, GateQueueTimeoutError, GateAbortedError,
  isAbortLike, parseRetryAfterMs,
} from './hostGate';

/** A promise you resolve/reject by hand, to hold a gate slot open. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

afterEach(() => { vi.useRealTimers(); });

describe('parseRetryAfterMs', () => {
  it('parses delta-seconds', () => {
    expect(parseRetryAfterMs('11', 30_000, 300_000)).toBe(11_000);
  });

  it('accepts a numeric value', () => {
    expect(parseRetryAfterMs(5, 30_000, 300_000)).toBe(5_000);
  });

  it('parses an HTTP-date relative to now', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfterMs('Thu, 01 Jan 2026 00:00:20 GMT', 30_000, 300_000, now)).toBe(20_000);
  });

  it('clamps a date in the past to zero', () => {
    const now = Date.parse('2026-01-01T00:01:00Z');
    expect(parseRetryAfterMs('Thu, 01 Jan 2026 00:00:00 GMT', 30_000, 300_000, now)).toBe(0);
  });

  it('caps very long values', () => {
    expect(parseRetryAfterMs('86400', 30_000, 300_000)).toBe(300_000);
  });

  it('falls back when the header is missing', () => {
    expect(parseRetryAfterMs(undefined, 30_000, 300_000)).toBe(30_000);
  });

  it('falls back when the header is unparseable', () => {
    expect(parseRetryAfterMs('soon', 30_000, 300_000)).toBe(30_000);
  });

  it('never returns more than the cap even for the fallback', () => {
    expect(parseRetryAfterMs(undefined, 600_000, 300_000)).toBe(300_000);
  });
});

describe('isAbortLike', () => {
  it('recognises axios cancel errors', () => {
    expect(isAbortLike({ code: 'ERR_CANCELED', name: 'CanceledError' })).toBe(true);
  });

  it('recognises gate abort errors', () => {
    expect(isAbortLike(new GateAbortedError('x'))).toBe(true);
  });

  it('does not match ordinary errors', () => {
    expect(isAbortLike(new Error('boom'))).toBe(false);
    expect(isAbortLike({ response: { status: 429 } })).toBe(false);
  });
});

describe('HostGate concurrency', () => {
  it('runs immediately when under the cap', async () => {
    const gate = new HostGate('h', 2);
    await expect(gate.run(async () => 42)).resolves.toBe(42);
  });

  it('never exceeds maxConcurrent in flight', async () => {
    const gate = new HostGate('h', 2);
    let inFlight = 0;
    let peak = 0;
    const holds = Array.from({ length: 5 }, () => deferred());
    const runs = holds.map(h => gate.run(async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await h.promise;
      inFlight--;
    }));
    await Promise.resolve();
    expect(inFlight).toBe(2);
    for (const h of holds) { h.resolve(); await Promise.resolve(); await Promise.resolve(); }
    await Promise.all(runs);
    expect(peak).toBe(2);
  });

  it('serves queued requests in FIFO order', async () => {
    const gate = new HostGate('h', 1);
    const order: number[] = [];
    const first = deferred();
    const p1 = gate.run(async () => { await first.promise; order.push(1); });
    const p2 = gate.run(async () => { order.push(2); });
    const p3 = gate.run(async () => { order.push(3); });
    first.resolve();
    await Promise.all([p1, p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('frees the slot when the request throws', async () => {
    const gate = new HostGate('h', 1);
    await expect(gate.run(async () => { throw new Error('nope'); })).rejects.toThrow('nope');
    await expect(gate.run(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('HostGate queue limits', () => {
  it('rejects a request that waits longer than maxQueueMs', async () => {
    vi.useFakeTimers();
    const gate = new HostGate('h', 1, 1_000);
    const hold = deferred();
    const first = gate.run(() => hold.promise);
    const waiting = gate.run(async () => 'never');
    const assertion = expect(waiting).rejects.toBeInstanceOf(GateQueueTimeoutError);
    await vi.advanceTimersByTimeAsync(1_001);
    await assertion;
    hold.resolve();
    await first;
  });

  it('drops a queued request when its signal aborts, without running it', async () => {
    const gate = new HostGate('h', 1);
    const hold = deferred();
    const first = gate.run(() => hold.promise);
    const ctrl = new AbortController();
    const fn = vi.fn(async () => 'ran');
    const queued = gate.run(fn, ctrl.signal);
    ctrl.abort();
    await expect(queued).rejects.toBeInstanceOf(GateAbortedError);
    hold.resolve();
    await first;
    expect(fn).not.toHaveBeenCalled();
    // the aborted waiter must not have leaked a slot
    await expect(gate.run(async () => 'next')).resolves.toBe('next');
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const gate = new HostGate('h', 1);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(gate.run(async () => 'x', ctrl.signal)).rejects.toBeInstanceOf(GateAbortedError);
  });
});

describe('HostGate cooldown', () => {
  it('rejects new requests while cooling down, without running them', async () => {
    let now = 1_000;
    const gate = new HostGate('Wikipedia', 2, 8_000, () => now);
    expect(gate.coolDown(11_000)).toBe(true);
    const fn = vi.fn(async () => 'x');
    await expect(gate.run(fn)).rejects.toBeInstanceOf(HostCoolingDownError);
    expect(fn).not.toHaveBeenCalled();
    now += 11_001;
    await expect(gate.run(async () => 'ok')).resolves.toBe('ok');
  });

  it('reports remaining cooldown time', () => {
    let now = 0;
    const gate = new HostGate('h', 1, 8_000, () => now);
    gate.coolDown(10_000);
    now = 4_000;
    expect(gate.cooldownRemainingMs).toBe(6_000);
  });

  it('only reports a new cooldown once, and never shortens an existing one', () => {
    let now = 0;
    const gate = new HostGate('h', 1, 8_000, () => now);
    expect(gate.coolDown(10_000)).toBe(true);
    expect(gate.coolDown(2_000)).toBe(false);
    expect(gate.cooldownRemainingMs).toBe(10_000);
    expect(gate.coolDown(20_000)).toBe(false);
    expect(gate.cooldownRemainingMs).toBe(20_000);
  });

  it('fails requests that were queued when a cooldown began', async () => {
    let now = 0;
    const gate = new HostGate('h', 1, 8_000, () => now);
    const hold = deferred();
    const first = gate.run(() => hold.promise);
    await Promise.resolve(); // let the first request actually start running before the cooldown
    const fn = vi.fn(async () => 'x');
    const queued = gate.run(fn);
    // attach the assertion before releasing the slot, so the rejection is never unhandled
    const assertion = expect(queued).rejects.toBeInstanceOf(HostCoolingDownError);
    gate.coolDown(5_000);
    hold.resolve();
    await first;
    await assertion;
    expect(fn).not.toHaveBeenCalled();
  });
});
