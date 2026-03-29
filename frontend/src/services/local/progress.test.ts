import { describe, it, expect } from 'vitest';
import { typeLevel0MaxSize, selectSpeciesToPromote, buildNoAudioGraduation } from './progress';
import type { BirdProgress, CachedSpecies } from '../../types';
import { HISTORY_WEIGHT } from '../../lib/adaptive';
import {
  MAX_LEVEL_0_SIZE,
  MAX_LEVEL_0_SIZE_FIRST,
  MAX_LEVEL_0_SIZE_SECOND,
  MAX_LEVEL_0_SIZE_THIRD,
} from '../../lib/adaptive';

// ── selectSpeciesToPromote ────────────────────────────────────────────────────
// Previously, promotion used a sequential index that advanced through the
// species list. Once the index reached the end it was stuck there. When the
// cache refreshed, new birds appeared anywhere in the sorted list (most common
// / most recent first) — but because they landed *behind* the saved index they
// were silently skipped and never promoted.
//
// The fix: always scan from position 0 and skip species that already have a
// progress record for the current type.  This pure function encapsulates that
// logic so it can be tested without touching IndexedDB.

function bird(code: string, historical = false): CachedSpecies {
  return { speciesCode: code, comName: code, sciName: code, isHistorical: historical };
}

describe('selectSpeciesToPromote', () => {

  it('selects the first N unseeded species from the front of the list', () => {
    const list = [bird('A'), bird('B'), bird('C'), bird('D')];
    const result = selectSpeciesToPromote(list, new Set(), 2);
    expect(result.map(s => s.speciesCode)).toEqual(['A', 'B']);
  });

  it('skips species that are already seeded', () => {
    const list = [bird('A'), bird('B'), bird('C'), bird('D')];
    const result = selectSpeciesToPromote(list, new Set(['A', 'C']), 2);
    expect(result.map(s => s.speciesCode)).toEqual(['B', 'D']);
  });

  it('finds new birds at the front even when all old birds are already seeded', () => {
    // Simulates the core bug:
    //   Old list was [B, C, D]. Index advanced to 3 (= list.length, loop exits).
    //   Cache refreshes to [A, B, C, D] — A is a new recent bird sorted to the front.
    //   Old index approach: starts at 3, processes D (seeded, wasNew=false),
    //     index→4, 4<4 false, exits. A is never promoted.
    //   New approach: scans from 0, skips B/C/D, promotes A.
    const list = [bird('A'), bird('B'), bird('C'), bird('D')];
    const alreadySeeded = new Set(['B', 'C', 'D']);
    const result = selectSpeciesToPromote(list, alreadySeeded, 2);
    expect(result.map(s => s.speciesCode)).toEqual(['A']);
  });

  it('promotes nothing when the saved index was past the list end and no new birds exist', () => {
    // Old list [A, B, C] with index=3; cache refreshes but same species.
    // All are already seeded — nothing to do.
    const list = [bird('A'), bird('B'), bird('C')];
    const result = selectSpeciesToPromote(list, new Set(['A', 'B', 'C']), 2);
    expect(result).toHaveLength(0);
  });

  it('respects sort order — earlier positions are promoted before later ones', () => {
    // The backend sorts: recent+common → recent+less → historical+common → historical+less.
    // selectSpeciesToPromote must preserve that ordering by scanning front-to-back.
    const list = [
      bird('recentCommon'),
      bird('recentLess'),
      bird('histCommon',  true),
      bird('histLess',    true),
    ];
    const result = selectSpeciesToPromote(list, new Set(['recentCommon']), 2);
    expect(result.map(s => s.speciesCode)).toEqual(['recentLess', 'histCommon']);
  });

  it('returns fewer than count when the list is nearly exhausted', () => {
    const list = [bird('A'), bird('B'), bird('C')];
    const result = selectSpeciesToPromote(list, new Set(['B']), 10);
    expect(result.map(s => s.speciesCode)).toEqual(['A', 'C']);
  });

  it('returns an empty array for an empty species list', () => {
    expect(selectSpeciesToPromote([], new Set(), 5)).toHaveLength(0);
  });

  it('returns an empty array when count is 0', () => {
    const list = [bird('A'), bird('B')];
    expect(selectSpeciesToPromote(list, new Set(), 0)).toHaveLength(0);
  });

  it('promotes birds from all four groups when early groups are exhausted', () => {
    // Simulates a user who has mastered all recent birds (Groups 0 & 1 are fully seeded).
    // Group 2 (historical+common) and Group 3 (historical+non-common) should still be promoted.
    const list = [
      bird('G0a'), bird('G0b'),          // Group 0: recent + common   (already seeded)
      bird('G1a'), bird('G1b'),          // Group 1: recent + non-common (already seeded)
      bird('G2a', true), bird('G2b', true), // Group 2: historical + common
      bird('G3a', true), bird('G3b', true), // Group 3: historical + non-common
    ];
    const seeded = new Set(['G0a', 'G0b', 'G1a', 'G1b']);
    const result = selectSpeciesToPromote(list, seeded, 4);
    expect(result.map(s => s.speciesCode)).toEqual(['G2a', 'G2b', 'G3a', 'G3b']);
  });

});

// ── buildNoAudioGraduation ────────────────────────────────────────────────────
// When no audio recordings exist for a song question, the bird is immediately
// graduated to mastered with noAudio=true and weight=HISTORY_WEIGHT.  It stays
// in the review pool so the backend can re-check for audio in future rounds.

function makeProgress(overrides: Partial<BirdProgress> = {}): BirdProgress {
  return {
    speciesCode: 'dowwoo', questionType: 'song', comName: 'Downy Woodpecker',
    correct: 3, incorrect: 1, lastAsked: 1000, weight: 20,
    favourited: false, excluded: false,
    masteryLevel: 1, consecutiveCorrect: 2, isMastered: false,
    ...overrides,
  };
}

describe('buildNoAudioGraduation', () => {

  it('sets isMastered=true and noAudio=true on the record', () => {
    const { record } = buildNoAudioGraduation('dowwoo', 'song', 'Downy Woodpecker', null, 9999);
    expect(record.isMastered).toBe(true);
    expect(record.noAudio).toBe(true);
  });

  it('sets weight to HISTORY_WEIGHT so the bird stays in the review pool', () => {
    const { record } = buildNoAudioGraduation('dowwoo', 'song', 'Downy Woodpecker', null, 9999);
    expect(record.weight).toBe(HISTORY_WEIGHT);
  });

  it('preserves existing correct/incorrect counts', () => {
    const existing = makeProgress({ correct: 5, incorrect: 2 });
    const { record } = buildNoAudioGraduation('dowwoo', 'song', 'Downy Woodpecker', existing, 9999);
    expect(record.correct).toBe(5);
    expect(record.incorrect).toBe(2);
  });

  it('preserves existing favourited and excluded flags', () => {
    const existing = makeProgress({ favourited: true, excluded: false });
    const { record } = buildNoAudioGraduation('dowwoo', 'song', 'Downy Woodpecker', existing, 9999);
    expect(record.favourited).toBe(true);
    expect(record.excluded).toBe(false);
  });

  it('uses zero defaults when there is no existing record', () => {
    const { record } = buildNoAudioGraduation('coohaw', 'song', "Cooper's Hawk", null, 9999);
    expect(record.correct).toBe(0);
    expect(record.incorrect).toBe(0);
    expect(record.masteryLevel).toBe(0);
    expect(record.consecutiveCorrect).toBe(0);
    expect(record.favourited).toBe(false);
    expect(record.excluded).toBe(false);
    expect(record.recentAnswers).toEqual([]);
  });

  it('returns a graduated LevelUpEvent', () => {
    const { levelUp } = buildNoAudioGraduation('coohaw', 'song', "Cooper's Hawk", null, 9999);
    expect(levelUp.graduated).toBe(true);
    expect(levelUp.newLevel).toBe(3);
    expect(levelUp.speciesCode).toBe('coohaw');
    expect(levelUp.questionType).toBe('song');
  });

  it('returns updatedMastery with isMastered=true', () => {
    const { updatedMastery } = buildNoAudioGraduation('coohaw', 'song', "Cooper's Hawk", null, 9999);
    expect(updatedMastery.isMastered).toBe(true);
  });

  it('stamps lastAsked with the provided timestamp', () => {
    const now = 1234567890;
    const { record } = buildNoAudioGraduation('dowwoo', 'song', 'Downy Woodpecker', null, now);
    expect(record.lastAsked).toBe(now);
  });

});

// ── typeLevel0MaxSize ─────────────────────────────────────────────────────────
// Each question type has its own independent palette that grows as the user
// graduates more birds of that type.  This function controls how large the
// level-0 palette for a single type should be given the graduate count for
// that type.
//
// The tiers are designed to keep early learners from being overwhelmed:
//   0–1 graduates  → small palette (FIRST)
//   2–6 graduates  → medium palette (SECOND)
//   7–12 graduates → larger palette (THIRD)
//   13+ graduates  → full palette (MAX)

describe('typeLevel0MaxSize', () => {
  it('returns the smallest palette size when no birds have graduated yet', () => {
    expect(typeLevel0MaxSize(0)).toBe(MAX_LEVEL_0_SIZE_FIRST);
  });

  it('returns the smallest palette size with just 1 graduate', () => {
    expect(typeLevel0MaxSize(1)).toBe(MAX_LEVEL_0_SIZE_FIRST);
  });

  it('returns the second tier at 2 graduates', () => {
    expect(typeLevel0MaxSize(2)).toBe(MAX_LEVEL_0_SIZE_SECOND);
  });

  it('returns the second tier at 6 graduates', () => {
    expect(typeLevel0MaxSize(6)).toBe(MAX_LEVEL_0_SIZE_SECOND);
  });

  it('returns the third tier at 7 graduates', () => {
    expect(typeLevel0MaxSize(7)).toBe(MAX_LEVEL_0_SIZE_THIRD);
  });

  it('returns the third tier at 12 graduates', () => {
    expect(typeLevel0MaxSize(12)).toBe(MAX_LEVEL_0_SIZE_THIRD);
  });

  it('returns the full palette size at 13 graduates', () => {
    expect(typeLevel0MaxSize(13)).toBe(MAX_LEVEL_0_SIZE);
  });

  it('returns the full palette size for large graduate counts', () => {
    expect(typeLevel0MaxSize(100)).toBe(MAX_LEVEL_0_SIZE);
  });

  it('all tier sizes are distinct and increasing', () => {
    // Sanity-check the constants are in the right order.
    expect(MAX_LEVEL_0_SIZE_FIRST).toBeLessThan(MAX_LEVEL_0_SIZE_SECOND);
    expect(MAX_LEVEL_0_SIZE_SECOND).toBeLessThan(MAX_LEVEL_0_SIZE_THIRD);
    expect(MAX_LEVEL_0_SIZE_THIRD).toBeLessThan(MAX_LEVEL_0_SIZE);
  });
});
