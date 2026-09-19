import { describe, it, expect } from 'vitest';
import { describeUpstreamError } from './upstreamErrorMessages';

const FALLBACK = 'Could not load this. Please try again.';

describe('describeUpstreamError', () => {
  it('names the failed service and explains a timeout', () => {
    const msg = describeUpstreamError({ code: 'timeout', service: 'eBird' }, FALLBACK);
    expect(msg).toContain('eBird');
    expect(msg).toMatch(/slow/i);
  });

  it('explains a rate-limited response', () => {
    const msg = describeUpstreamError({ code: 'rate-limited', service: 'eBird' }, FALLBACK);
    expect(msg).toContain('eBird');
    expect(msg).toMatch(/limiting requests/i);
  });

  it('includes the status code for an upstream 5xx when provided', () => {
    const msg = describeUpstreamError({ code: 'upstream-5xx', service: 'eBird', statusCode: 503 }, FALLBACK);
    expect(msg).toContain('eBird');
    expect(msg).toContain('503');
  });

  it('omits the status-code parenthetical when none is given', () => {
    const msg = describeUpstreamError({ code: 'upstream-5xx', service: 'eBird' }, FALLBACK);
    expect(msg).not.toContain('()');
    expect(msg).toContain('eBird');
  });

  it('uses the caller-supplied fallback for an upstream 4xx', () => {
    expect(describeUpstreamError({ code: 'upstream-4xx', service: 'eBird' }, FALLBACK)).toBe(FALLBACK);
  });

  it('explains a network failure', () => {
    const msg = describeUpstreamError({ code: 'network', service: 'eBird' }, FALLBACK);
    expect(msg).toMatch(/connection/i);
  });

  it('falls back to a generic bird-data-service name when service is missing', () => {
    const msg = describeUpstreamError({ code: 'timeout' }, FALLBACK);
    expect(msg).toContain('the bird data service');
  });

  it('uses the caller-supplied fallback for an unrecognized or missing code', () => {
    expect(describeUpstreamError({ code: 'unknown' }, FALLBACK)).toBe(FALLBACK);
    expect(describeUpstreamError({}, FALLBACK)).toBe(FALLBACK);
  });

  it('handles a completely missing payload without throwing', () => {
    expect(describeUpstreamError(undefined, FALLBACK)).toBe(FALLBACK);
    expect(describeUpstreamError(null, FALLBACK)).toBe(FALLBACK);
  });
});
