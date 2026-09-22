import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => {
  const get = vi.fn();
  return { default: { get, isAxiosError: (e: unknown) => !!(e as { isAxiosError?: boolean })?.isAxiosError } };
});

import axios from 'axios';
import { gatedGet } from './upstreamGates';
import { HostGate, HostCoolingDownError } from '../lib/hostGate';

const mockedGet = vi.mocked(axios.get);

function httpError(status: number, headers: Record<string, string> = {}) {
  return Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status, headers } });
}

beforeEach(() => {
  mockedGet.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('gatedGet', () => {
  it('returns the response of a successful request', async () => {
    mockedGet.mockResolvedValueOnce({ data: { ok: true } });
    const gate = new HostGate('h', 2);
    const res = await gatedGet(gate, 'https://example.test/a');
    expect(res.data).toEqual({ ok: true });
  });

  it('starts a cooldown from Retry-After on a 429 and rethrows the error', async () => {
    mockedGet.mockRejectedValueOnce(httpError(429, { 'retry-after': '11' }));
    const gate = new HostGate('Wikipedia', 2);
    await expect(gatedGet(gate, 'https://example.test/a')).rejects.toMatchObject({ response: { status: 429 } });
    expect(gate.cooldownRemainingMs).toBeGreaterThan(10_000);
    expect(gate.cooldownRemainingMs).toBeLessThanOrEqual(11_000);
  });

  it('uses a default cooldown when a 429 has no Retry-After', async () => {
    mockedGet.mockRejectedValueOnce(httpError(429));
    const gate = new HostGate('iNaturalist', 2);
    await expect(gatedGet(gate, 'https://example.test/a')).rejects.toBeDefined();
    expect(gate.cooldownRemainingMs).toBeGreaterThan(0);
  });

  it('short-circuits later requests during the cooldown without calling axios', async () => {
    mockedGet.mockRejectedValueOnce(httpError(429, { 'retry-after': '30' }));
    const gate = new HostGate('Wikipedia', 2);
    await expect(gatedGet(gate, 'https://example.test/a')).rejects.toBeDefined();
    mockedGet.mockClear();
    await expect(gatedGet(gate, 'https://example.test/b')).rejects.toBeInstanceOf(HostCoolingDownError);
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('does not start a cooldown for other HTTP errors', async () => {
    mockedGet.mockRejectedValueOnce(httpError(500));
    const gate = new HostGate('h', 2);
    await expect(gatedGet(gate, 'https://example.test/a')).rejects.toBeDefined();
    expect(gate.cooldownRemainingMs).toBe(0);
  });

  it('logs the pause only once for a burst of 429s', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warn.mockClear(); // the spy persists across tests, so drop warnings logged by earlier ones
    mockedGet.mockRejectedValue(httpError(429, { 'retry-after': '11' }));
    const gate = new HostGate('Wikipedia', 5);
    await Promise.allSettled([
      gatedGet(gate, 'https://example.test/1'),
      gatedGet(gate, 'https://example.test/2'),
      gatedGet(gate, 'https://example.test/3'),
    ]);
    expect(warn.mock.calls.filter(c => String(c[0]).includes('rate-limited'))).toHaveLength(1);
  });
});
