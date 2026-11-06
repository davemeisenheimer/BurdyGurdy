import { describe, it, expect } from 'vitest';
import { classifyAuthFailure } from './authFailure';

describe('classifyAuthFailure', () => {
  it('treats a 4xx from Supabase as an invalid token', () => {
    expect(classifyAuthFailure({ status: 401, message: 'invalid JWT' })).toBe('invalid-token');
    expect(classifyAuthFailure({ status: 403 })).toBe('invalid-token');
  });

  it('treats a fetch failure (status 0) or 5xx as auth being unavailable', () => {
    expect(classifyAuthFailure({ status: 0, message: 'fetch failed' })).toBe('auth-unavailable');
    expect(classifyAuthFailure({ status: 503 })).toBe('auth-unavailable');
  });

  it('treats an error with no status as auth being unavailable', () => {
    expect(classifyAuthFailure(new Error('network'))).toBe('auth-unavailable');
    expect(classifyAuthFailure(null)).toBe('auth-unavailable');
  });
});
