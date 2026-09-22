import { describe, it, expect, vi } from 'vitest';
import { shareInFlight } from './inFlight';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('shareInFlight', () => {
  it('runs the operation once for concurrent callers with the same key', async () => {
    const store = new Map<string, Promise<number>>();
    const d = deferred<number>();
    const run = vi.fn(() => d.promise);
    const a = shareInFlight(store, 'k', run);
    const b = shareInFlight(store, 'k', run);
    d.resolve(7);
    expect(await a).toBe(7);
    expect(await b).toBe(7);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs separately for different keys', async () => {
    const store = new Map<string, Promise<string>>();
    const run = vi.fn(async () => 'x');
    await Promise.all([shareInFlight(store, 'a', run), shareInFlight(store, 'b', run)]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('starts a fresh run once the previous one has finished', async () => {
    const store = new Map<string, Promise<number>>();
    const run = vi.fn(async () => 1);
    await shareInFlight(store, 'k', run);
    await shareInFlight(store, 'k', run);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('shares a failure with concurrent callers, then allows a retry', async () => {
    const store = new Map<string, Promise<number>>();
    const d = deferred<number>();
    const run = vi.fn(() => d.promise);
    const a = shareInFlight(store, 'k', run);
    const b = shareInFlight(store, 'k', run);
    const assertions = Promise.all([expect(a).rejects.toThrow('boom'), expect(b).rejects.toThrow('boom')]);
    d.reject(new Error('boom'));
    await assertions;
    expect(run).toHaveBeenCalledTimes(1);
    const retry = vi.fn(async () => 2);
    await expect(shareInFlight(store, 'k', retry)).resolves.toBe(2);
  });

  it('leaves nothing behind in the store when done', async () => {
    const store = new Map<string, Promise<number>>();
    await shareInFlight(store, 'k', async () => 1);
    expect(store.size).toBe(0);
  });
});
