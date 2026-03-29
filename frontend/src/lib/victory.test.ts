import { describe, it, expect } from 'vitest';
import { describeMastery, describeWindow } from './victory';

// ── describeMastery ───────────────────────────────────────────────────────────
// Produces the human-readable "you mastered X and Y" string shown on the
// victory screen. Multiple question types that map to the same category
// (e.g. image + image-latin) should be deduplicated.

describe('describeMastery', () => {
  it('returns a generic fallback when no types are active', () => {
    expect(describeMastery([])).toBe('all question types');
  });

  it('maps image types to "visual appearance"', () => {
    expect(describeMastery(['image'])).toBe('visual appearance');
    expect(describeMastery(['image-latin'])).toBe('visual appearance');
    expect(describeMastery(['image-song'])).toBe('visual appearance');
  });

  it('deduplicates types that map to the same category', () => {
    // image and image-latin both map to "visual appearance" — expect one mention
    expect(describeMastery(['image', 'image-latin'])).toBe('visual appearance');
  });

  it('maps song types to "song"', () => {
    expect(describeMastery(['song'])).toBe('song');
    expect(describeMastery(['song-latin'])).toBe('song');
  });

  it('maps sono types to "spectrogram"', () => {
    expect(describeMastery(['sono'])).toBe('spectrogram');
    expect(describeMastery(['sono-song'])).toBe('spectrogram');
  });

  it('maps latin types to "Latin name"', () => {
    expect(describeMastery(['latin'])).toBe('Latin name');
    expect(describeMastery(['latin-song'])).toBe('Latin name');
  });

  it('maps family types to "family name"', () => {
    expect(describeMastery(['family'])).toBe('family name');
    expect(describeMastery(['family-latin'])).toBe('family name');
  });

  it('maps order to "order name"', () => {
    expect(describeMastery(['order'])).toBe('order name');
  });

  it('joins two categories with "and"', () => {
    const result = describeMastery(['image', 'song']);
    expect(result).toBe('visual appearance and song');
  });

  it('joins three or more categories with Oxford comma', () => {
    const result = describeMastery(['image', 'song', 'latin']);
    expect(result).toMatch(/visual appearance.+song.+Latin name/);
    expect(result).toContain(', and ');
  });
});

// ── describeWindow ────────────────────────────────────────────────────────────

describe('describeWindow', () => {
  it('describes day window', () => {
    expect(describeWindow('day')).toBe('today');
  });

  it('describes week window', () => {
    expect(describeWindow('week')).toBe('in the past week');
  });

  it('describes month window', () => {
    expect(describeWindow('month')).toBe('in the past month');
  });
});
