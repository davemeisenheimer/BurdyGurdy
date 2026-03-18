import { describe, it, expect } from 'vitest';
import { categoriseRecentBirds, summariseCounts } from './recentProgress';
import type { CachedSpecies, BirdProgress } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSpecies(code: string, isHistorical = false): CachedSpecies {
  return { speciesCode: code, comName: code, sciName: code, isHistorical };
}

function makeRecord(
  speciesCode: string,
  questionType = 'image',
  masteryLevel = 0,
  inHistory = false,
  lastAsked = Date.now(),
  consecutiveCorrect = 0,
): BirdProgress {
  return {
    speciesCode,
    questionType: questionType as BirdProgress['questionType'],
    comName: speciesCode,
    correct: 3,
    incorrect: 1,
    lastAsked,
    weight: 20,
    favourited: false,
    excluded: false,
    masteryLevel,
    consecutiveCorrect,
    inHistory,
  };
}

const TYPES = ['image'] as const;

// ── categoriseRecentBirds ─────────────────────────────────────────────────────

describe('categoriseRecentBirds', () => {
  it('historical species are excluded', () => {
    const species  = [makeSpecies('hist', true), makeSpecies('recent', false)];
    const result   = categoriseRecentBirds(species, [], TYPES);
    expect(result).toHaveLength(1);
    expect(result[0].speciesCode).toBe('recent');
  });

  it('bird with no progress record → notAsked, isSeeded=false', () => {
    const result = categoriseRecentBirds([makeSpecies('newbird')], [], TYPES);
    expect(result[0].category).toBe('notAsked');
    expect(result[0].isSeeded).toBe(false);
  });

  it('bird with only seeded record (lastAsked=0) → notAsked, isSeeded=true', () => {
    const seeded = makeRecord('newbird', 'image', 0, false, 0); // lastAsked=0
    const result = categoriseRecentBirds([makeSpecies('newbird')], [seeded], TYPES);
    expect(result[0].category).toBe('notAsked');
    expect(result[0].isSeeded).toBe(true);
  });

  it('asked bird at masteryLevel=0 → easy', () => {
    const result = categoriseRecentBirds(
      [makeSpecies('amero')],
      [makeRecord('amero', 'image', 0, false)],
      TYPES,
    );
    expect(result[0].category).toBe('easy');
  });

  it('asked bird at masteryLevel=1 → medium', () => {
    const result = categoriseRecentBirds(
      [makeSpecies('amero')],
      [makeRecord('amero', 'image', 1, false)],
      TYPES,
    );
    expect(result[0].category).toBe('medium');
  });

  it('asked bird at masteryLevel=2 → hard', () => {
    const result = categoriseRecentBirds(
      [makeSpecies('amero')],
      [makeRecord('amero', 'image', 2, false)],
      TYPES,
    );
    expect(result[0].category).toBe('hard');
  });

  it('graduated bird (inHistory=true) for all question types → mastered', () => {
    const result = categoriseRecentBirds(
      [makeSpecies('amero')],
      [makeRecord('amero', 'image', 2, true)],
      TYPES,
    );
    expect(result[0].category).toBe('mastered');
  });

  it('partial graduation: one type mastered, one not → hard (not mastered)', () => {
    const types = ['image', 'song'] as const;
    const result = categoriseRecentBirds(
      [makeSpecies('amero')],
      [
        makeRecord('amero', 'image', 2, true),  // mastered
        makeRecord('amero', 'song',  2, false), // not mastered
      ],
      types,
    );
    expect(result[0].category).toBe('hard');
  });

  it('category uses highest active mastery level (not the mastered types)', () => {
    const types = ['image', 'song'] as const;
    const result = categoriseRecentBirds(
      [makeSpecies('amero')],
      [
        makeRecord('amero', 'image', 2, true), // mastered — should be ignored for category
        makeRecord('amero', 'song',  1, false), // active, level 1
      ],
      types,
    );
    // Active records only have level 1, so category = medium
    expect(result[0].category).toBe('medium');
  });

  it('bird with progress record for irrelevant question type → notAsked', () => {
    // User has a 'song' record but is playing 'image' only
    const result = categoriseRecentBirds(
      [makeSpecies('amero')],
      [makeRecord('amero', 'song', 1, false)],
      TYPES, // only 'image'
    );
    expect(result[0].category).toBe('notAsked');
  });

  it('returns birds in the same order as recentSpecies input', () => {
    const species = [makeSpecies('a'), makeSpecies('b'), makeSpecies('c')];
    const result  = categoriseRecentBirds(species, [], TYPES);
    expect(result.map(r => r.speciesCode)).toEqual(['a', 'b', 'c']);
  });
});

// ── summariseCounts ───────────────────────────────────────────────────────────

describe('summariseCounts', () => {
  it('correctly counts each category', () => {
    const species = [
      makeSpecies('a'), makeSpecies('b'), makeSpecies('c'),
      makeSpecies('d'), makeSpecies('e'),
    ];
    const records = [
      makeRecord('b', 'image', 0),  // easy
      makeRecord('c', 'image', 1),  // medium
      makeRecord('d', 'image', 2),  // hard
      makeRecord('e', 'image', 2, true), // mastered
    ];
    const entries = categoriseRecentBirds(species, records, TYPES);
    const counts  = summariseCounts(entries);
    expect(counts.notAsked).toBe(1);
    expect(counts.easy).toBe(1);
    expect(counts.medium).toBe(1);
    expect(counts.hard).toBe(1);
    expect(counts.mastered).toBe(1);
  });
});
