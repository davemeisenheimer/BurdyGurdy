import { describe, it, expect } from 'vitest';
import { assessAttempt, classifyPhotoResult, type SourceOutcome } from './photoOutcome';

const ok      = (name: string): SourceOutcome => ({ name, state: 'ok' });
const blocked = (name: string): SourceOutcome => ({ name, state: 'blocked' });
const pending = (name: string): SourceOutcome => ({ name, state: 'pending' });
const failed  = (name: string, reason: string, rateLimited = false): SourceOutcome =>
  ({ name, state: 'failed', reason, rateLimited });

describe('assessAttempt', () => {
  it('is complete when every source answered', () => {
    const r = assessAttempt([ok('macaulay'), ok('inat'), ok('wiki')]);
    expect(r).toEqual({ complete: true, retryable: false, problems: [] });
  });

  it('ignores blocked sources when deciding completeness', () => {
    const r = assessAttempt([blocked('macaulay'), ok('inat'), ok('wiki')]);
    expect(r.complete).toBe(true);
  });

  it('is incomplete when a source failed, and reports why', () => {
    const r = assessAttempt([blocked('macaulay'), failed('inat', 'timeout'), ok('wiki')]);
    expect(r.complete).toBe(false);
    expect(r.problems).toEqual(['inat: timeout']);
  });

  it('is incomplete when a source is still pending', () => {
    const r = assessAttempt([ok('inat'), pending('wiki')]);
    expect(r.complete).toBe(false);
    expect(r.problems).toEqual(['wiki: still pending when the window closed']);
  });

  it('is retryable after a non-rate-limit failure', () => {
    expect(assessAttempt([failed('inat', 'timeout'), ok('wiki')]).retryable).toBe(true);
  });

  it('is retryable when something is merely pending', () => {
    expect(assessAttempt([ok('inat'), pending('wiki')]).retryable).toBe(true);
  });

  it('is not retryable when every problem is rate limiting', () => {
    const r = assessAttempt([
      failed('inat', 'HTTP 429 (rate-limited)', true),
      failed('wiki', 'Wikipedia is cooling down (9s left)', true),
    ]);
    expect(r.retryable).toBe(false);
  });

  it('is retryable when rate limiting is mixed with another kind of failure', () => {
    const r = assessAttempt([failed('inat', 'HTTP 429', true), failed('wiki', 'timeout')]);
    expect(r.retryable).toBe(true);
  });
});

describe('classifyPhotoResult', () => {
  it('returns photos whenever a photo was found, even if a source failed', () => {
    expect(classifyPhotoResult(true, false)).toBe('photos');
    expect(classifyPhotoResult(true, true)).toBe('photos');
  });

  it('returns confirmed-empty only when every source answered', () => {
    expect(classifyPhotoResult(false, true)).toBe('confirmed-empty');
  });

  it('returns unavailable - never confirmed-empty - when a source failed', () => {
    expect(classifyPhotoResult(false, false)).toBe('unavailable');
  });
});
