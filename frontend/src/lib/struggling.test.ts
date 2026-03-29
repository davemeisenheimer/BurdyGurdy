import { describe, it, expect } from 'vitest';
import { computeStrugglingCount, STRUGGLING_WINDOW, STRUGGLING_MIN_CORRECT } from './struggling';
import type { BirdProgress, QuestionType } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRecord(
  speciesCode: string,
  questionType: QuestionType,
  recentAnswers?: boolean[],
  excluded = false,
  isMastered = true,
): BirdProgress {
  return {
    speciesCode,
    questionType,
    comName: speciesCode,
    correct: 0,
    incorrect: 0,
    excluded,
    lastAsked: 1,
    weight: 1,
    favourited: false,
    masteryLevel: 2,
    consecutiveCorrect: 0,
    isMastered,
    recentAnswers,
  };
}

/** A full 10-answer window with the given number of correct answers (Fs first, Ts last). */
function makeWindow(correct: number): boolean[] {
  return [...Array(STRUGGLING_WINDOW - correct).fill(false), ...Array(correct).fill(true)];
}

const SONG: QuestionType[] = ['song'];
const SONG_AND_IMAGE: QuestionType[] = ['song', 'image'];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('computeStrugglingCount', () => {

  it('returns 0 for an empty record list', () => {
    expect(computeStrugglingCount([], SONG)).toBe(0);
  });

  it('returns 0 when all records have no recentAnswers (window not seeded)', () => {
    // A mastered bird with no window yet cannot be considered struggling.
    const records = [makeRecord('amero', 'song', undefined)];
    expect(computeStrugglingCount(records, SONG)).toBe(0);
  });

  it('returns 0 when the window is not yet full', () => {
    // Fewer than STRUGGLING_WINDOW answers — not enough data.
    const records = [makeRecord('amero', 'song', [false, false, false])];
    expect(computeStrugglingCount(records, SONG)).toBe(0);
  });

  it('returns 0 when the window meets the accuracy threshold', () => {
    // 8/10 correct (exactly STRUGGLING_MIN_CORRECT) is NOT struggling (condition is <).
    const records = [makeRecord('amero', 'song', makeWindow(STRUGGLING_MIN_CORRECT))];
    expect(computeStrugglingCount(records, SONG)).toBe(0);
  });

  it('returns 0 for a perfect window', () => {
    const records = [makeRecord('amero', 'song', Array(STRUGGLING_WINDOW).fill(true) as boolean[])];
    expect(computeStrugglingCount(records, SONG)).toBe(0);
  });

  it('counts a single struggling species', () => {
    // 7/10 < 8 → struggling
    const records = [makeRecord('amero', 'song', makeWindow(STRUGGLING_MIN_CORRECT - 1))];
    expect(computeStrugglingCount(records, SONG)).toBe(1);
  });

  it('counts multiple distinct struggling species', () => {
    const records = [
      makeRecord('amero', 'song', makeWindow(4)),
      makeRecord('bluja', 'song', makeWindow(0)),
    ];
    expect(computeStrugglingCount(records, SONG)).toBe(2);
  });

  it('counts a species only once even when it is struggling in multiple question types', () => {
    // The count is per-species, not per (species × type) combination.
    const records = [
      makeRecord('amero', 'song',  makeWindow(4)),
      makeRecord('amero', 'image', makeWindow(4)),
    ];
    expect(computeStrugglingCount(records, SONG_AND_IMAGE)).toBe(1);
  });

  it('ignores records whose question type is not in the active set', () => {
    const records = [makeRecord('amero', 'image', makeWindow(4))]; // image struggling
    expect(computeStrugglingCount(records, SONG)).toBe(0);         // song mode only
  });

  it('ignores excluded species regardless of their window', () => {
    const records = [makeRecord('amero', 'song', makeWindow(0), /* excluded */ true)];
    expect(computeStrugglingCount(records, SONG)).toBe(0);
  });

  it('does not count non-mastered (isMastered=false) birds', () => {
    // Struggling is only defined for mastered birds.
    const records = [makeRecord('amero', 'song', makeWindow(0), false, /* isMastered */ false)];
    expect(computeStrugglingCount(records, SONG)).toBe(0);
  });

  it('does not count a species that is fine in the active type but struggling in an inactive type', () => {
    const records = [
      makeRecord('amero', 'song',  makeWindow(STRUGGLING_MIN_CORRECT)), // 8/10 fine
      makeRecord('amero', 'image', makeWindow(4)),                       // 4/10 struggling, inactive
    ];
    expect(computeStrugglingCount(records, SONG)).toBe(0);
  });

  it('counts a species that is fine in an inactive type but struggling in the active type', () => {
    const records = [
      makeRecord('amero', 'song',  makeWindow(STRUGGLING_MIN_CORRECT - 1)), // 7/10 struggling, active
      makeRecord('amero', 'image', makeWindow(STRUGGLING_MIN_CORRECT)),     // 8/10 fine, inactive
    ];
    expect(computeStrugglingCount(records, SONG)).toBe(1);
  });

});
