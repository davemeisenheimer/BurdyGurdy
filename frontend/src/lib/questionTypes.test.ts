import { describe, it, expect } from 'vitest';
import { expandQuestionTypes } from './questionTypes';
import type { AppSettings } from './settings';

// ── Helpers ───────────────────────────────────────────────────────────────────

// Base settings with all variant options disabled.  Individual tests spread
// this and override only the fields relevant to what they are testing.
const BASE: AppSettings = {
  autoplayRevealAudio: false,
  includeLatinAnswerVariants: false,
  includeSongAnswerVariants: false,
  randomizeQuestionPhotos: false,
  maxRecentSightings: 4,
  autoScrollRelatedSpecies: false,
  recentWindow: 'month',
  enableAdminFeatures: false,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('expandQuestionTypes', () => {

  it('returns the base list unchanged when no variant settings are enabled', () => {
    // Baseline: with both variant toggles off the output should be identical
    // to the input — no extra types appended, no types removed.
    const result = expandQuestionTypes(['song', 'image', 'family'], BASE);
    expect(result).toEqual(['song', 'image', 'family']);
  });

  it('appends latin variants for each eligible base type when the latin setting is on', () => {
    // Latin-answer variants exist for image, song, and family.  Enabling the
    // setting with all three base types present should add all three -latin variants.
    const result = expandQuestionTypes(
      ['image', 'song', 'family'],
      { ...BASE, includeLatinAnswerVariants: true },
    );
    expect(result).toContain('image-latin');
    expect(result).toContain('song-latin');
    expect(result).toContain('family-latin');
  });

  it('does not add latin variants for types that have no latin counterpart', () => {
    // "sono" has no -latin variant.  Enabling the setting with only sono in the
    // base list should produce no additions.
    const result = expandQuestionTypes(
      ['sono'],
      { ...BASE, includeLatinAnswerVariants: true },
    );
    expect(result).toEqual(['sono']);
  });

  it('appends song-answer variants for each eligible base type when the song setting is on', () => {
    // Song-answer variants exist for image, sono, and latin.  Enabling the
    // setting with all three base types present should add all three -song variants.
    const result = expandQuestionTypes(
      ['image', 'sono', 'latin'],
      { ...BASE, includeSongAnswerVariants: true },
    );
    expect(result).toContain('image-song');
    expect(result).toContain('sono-song');
    expect(result).toContain('latin-song');
  });

  it('does not add song-answer variants for types that have no song counterpart', () => {
    // "family" has no -song variant, so enabling the setting with only family
    // in the base list should produce no additions.
    const result = expandQuestionTypes(
      ['family'],
      { ...BASE, includeSongAnswerVariants: true },
    );
    expect(result).toEqual(['family']);
  });

  it('applies both variant expansions together without introducing duplicates', () => {
    // When both variant settings are on, image should gain image-latin AND
    // image-song.  No type should appear more than once.
    const result = expandQuestionTypes(
      ['image'],
      { ...BASE, includeLatinAnswerVariants: true, includeSongAnswerVariants: true },
    );
    expect(result).toContain('image');
    expect(result).toContain('image-latin');
    expect(result).toContain('image-song');
    expect(new Set(result).size).toBe(result.length); // no duplicates
  });

  it('preserves original type order and appends variants after the base types', () => {
    // The contract is: base types first in their original order, with any
    // expanded variants appended afterward.  This keeps the base type always
    // "before" its own variants in the list.
    const result = expandQuestionTypes(
      ['song', 'image'],
      { ...BASE, includeLatinAnswerVariants: true },
    );
    expect(result.indexOf('song')).toBeLessThan(result.indexOf('song-latin'));
    expect(result.indexOf('image')).toBeLessThan(result.indexOf('image-latin'));
  });

  it('handles an empty base list without error', () => {
    // Edge case: no base types selected.  The result should be an empty array
    // regardless of which variant settings are on.
    const result = expandQuestionTypes(
      [],
      { ...BASE, includeLatinAnswerVariants: true, includeSongAnswerVariants: true },
    );
    expect(result).toEqual([]);
  });

});
