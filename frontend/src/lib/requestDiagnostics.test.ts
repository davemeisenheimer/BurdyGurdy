import { describe, it, expect } from 'vitest';
import {
  classifyRequestError,
  describeErrorForLog,
  describeRequestError,
  shouldLogRequest,
  SLOW_REQUEST_MS,
} from './requestDiagnostics';

const FALLBACK = 'Failed to load questions.';

describe('classifyRequestError', () => {
  it('classifies a browser-side timeout', () => {
    expect(classifyRequestError({ code: 'ECONNABORTED' })).toEqual({ kind: 'timeout' });
    expect(classifyRequestError({ code: 'ETIMEDOUT' })).toEqual({ kind: 'timeout' });
  });

  it('classifies a network error with no response', () => {
    expect(classifyRequestError({ code: 'ERR_NETWORK' })).toEqual({ kind: 'network' });
  });

  it('classifies a cancelled request', () => {
    expect(classifyRequestError({ code: 'ERR_CANCELED' }).kind).toBe('cancelled');
    expect(classifyRequestError({ name: 'CanceledError' }).kind).toBe('cancelled');
  });

  it('classifies an HTTP error and keeps an object payload', () => {
    const c = classifyRequestError({ response: { status: 503, data: { code: 'timeout', service: 'eBird' } } });
    expect(c).toEqual({ kind: 'http', status: 503, payload: { code: 'timeout', service: 'eBird' } });
  });

  it('drops a non-object payload (e.g. an HTML error page)', () => {
    const c = classifyRequestError({ response: { status: 413, data: '<html>Payload Too Large</html>' } });
    expect(c).toEqual({ kind: 'http', status: 413, payload: undefined });
  });

  it('returns unknown for anything else', () => {
    expect(classifyRequestError(new Error('boom')).kind).toBe('unknown');
    expect(classifyRequestError(undefined).kind).toBe('unknown');
  });
});

describe('describeErrorForLog', () => {
  it('includes status and upstream code/service for HTTP errors', () => {
    expect(describeErrorForLog({ kind: 'http', status: 503, payload: { code: 'timeout', service: 'eBird' } }))
      .toBe('HTTP 503 (timeout, eBird)');
    expect(describeErrorForLog({ kind: 'http', status: 401 })).toBe('HTTP 401');
  });

  it('labels timeouts and network errors', () => {
    expect(describeErrorForLog({ kind: 'timeout' })).toMatch(/timed out/);
    expect(describeErrorForLog({ kind: 'network' })).toMatch(/network/);
  });
});

describe('describeRequestError', () => {
  it('explains a browser timeout as BurdyGurdy being slow', () => {
    expect(describeRequestError({ code: 'ECONNABORTED' }, FALLBACK)).toMatch(/BurdyGurdy is taking too long/);
  });

  it('explains a network error as a connection problem', () => {
    expect(describeRequestError({ code: 'ERR_NETWORK' }, FALLBACK)).toMatch(/internet connection/);
  });

  it('names the upstream service for a classified HTTP error', () => {
    expect(describeRequestError({ response: { status: 503, data: { code: 'timeout', service: 'eBird' } } }, FALLBACK))
      .toContain('eBird');
  });

  it('uses the fallback for an unclassified HTTP error or unknown error', () => {
    expect(describeRequestError({ response: { status: 413, data: '<html>' } }, FALLBACK)).toBe(FALLBACK);
    expect(describeRequestError(new Error('x'), FALLBACK)).toBe(FALLBACK);
  });
});

describe('shouldLogRequest', () => {
  it('logs failures regardless of duration', () => {
    expect(shouldLogRequest(10, true, false)).toBe(true);
  });

  it('logs successes only when slow', () => {
    expect(shouldLogRequest(SLOW_REQUEST_MS - 1, false, false)).toBe(false);
    expect(shouldLogRequest(SLOW_REQUEST_MS, false, false)).toBe(true);
  });

  it('never logs cancelled requests', () => {
    expect(shouldLogRequest(60_000, true, true)).toBe(false);
  });
});
