import { describe, it, expect } from 'vitest';
import { buildUserAgent } from './userAgent';

describe('buildUserAgent', () => {
  it('includes the contact when provided', () => {
    expect(buildUserAgent('me@example.org')).toBe('BurdyGurdy/1.0 (bird identification learning app; me@example.org)');
  });

  it('trims whitespace around the contact', () => {
    expect(buildUserAgent('  me@example.org \n')).toBe('BurdyGurdy/1.0 (bird identification learning app; me@example.org)');
  });

  it('omits the contact when undefined', () => {
    expect(buildUserAgent(undefined)).toBe('BurdyGurdy/1.0 (bird identification learning app)');
  });

  it('omits the contact when blank', () => {
    expect(buildUserAgent('   ')).toBe('BurdyGurdy/1.0 (bird identification learning app)');
  });
});
