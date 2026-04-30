import { describe, it, expect } from 'vitest';
import { buildCandidates, applyPaletteSMGuarantee, pickFromPool, splitCandidates } from './candidateLogic';
import type { PoolSpecies, Candidate } from './candidateLogic';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSpecies(code: string): PoolSpecies {
  return {
    speciesCode: code,
    comName: code,
    sciName: code,
    tax: { familySciName: 'Fam', familyComName: 'Family', order: 'Order' },
  };
}

// Minimal question stub - only fields used by the guarantee logic
function makeQ(code: string, type = 'image') {
  return { speciesCode: code, type };
}

function makeCandidate(code: string, weight: number, type = 'song'): Candidate {
  return { species: makeSpecies(code), type: type as Candidate['type'], weight };
}

const TYPES = ['image'] as const;

// ── buildCandidates ───────────────────────────────────────────────────────────

describe('buildCandidates', () => {
  it('non-adaptive: all recent birds included at weight 1', () => {
    const pool = [makeSpecies('amero'), makeSpecies('bluja')];
    const candidates = buildCandidates(pool, pool, new Set(['amero', 'bluja']), {}, TYPES, false);
    expect(candidates).toHaveLength(2);
    expect(candidates.every(c => c.weight === 1)).toBe(true);
  });

  it('non-adaptive: non-recent birds in filteredPool are not added', () => {
    const recent = [makeSpecies('amero')];
    const allPool = [makeSpecies('amero'), makeSpecies('oldbird')];
    const recentCodes = new Set(['amero']);
    // oldbird has a weight entry but should be excluded in non-adaptive mode
    const candidates = buildCandidates(recent, allPool, recentCodes, { 'oldbird:image': 20 }, TYPES, false);
    expect(candidates.every(c => c.species.speciesCode === 'amero')).toBe(true);
  });

  it('adaptive: palette bird not yet in weightsMap gets weight 20', () => {
    const pool = [makeSpecies('newbird')];
    const paletteKeys = new Set(['newbird:image']);
    const candidates = buildCandidates(pool, pool, new Set(['newbird']), {}, TYPES, true, paletteKeys);
    expect(candidates[0].weight).toBe(20);
  });

  it('adaptive: non-palette bird not in weightsMap is excluded as a question subject', () => {
    const pool = [makeSpecies('newbird')];
    // newbird is in the eBird recent window but NOT in the learning palette
    const candidates = buildCandidates(pool, pool, new Set(['newbird']), {}, TYPES, true);
    expect(candidates).toHaveLength(0);
  });

  it('adaptive: unmastered bird (w=20) keeps its weight', () => {
    const pool = [makeSpecies('amero')];
    const candidates = buildCandidates(pool, pool, new Set(['amero']), { 'amero:image': 20 }, TYPES, true);
    expect(candidates[0].weight).toBe(20);
  });

  it('adaptive: struggling unmastered bird (w=30) keeps its weight', () => {
    const pool = [makeSpecies('amero')];
    const candidates = buildCandidates(pool, pool, new Set(['amero']), { 'amero:image': 30 }, TYPES, true);
    expect(candidates[0].weight).toBe(30);
  });

  it('adaptive: mastered bird (w=1) is boosted to floor weight of 3', () => {
    const pool = [makeSpecies('amero')];
    const candidates = buildCandidates(pool, pool, new Set(['amero']), { 'amero:image': 1 }, TYPES, true);
    expect(candidates[0].weight).toBe(3);
  });

  it('adaptive: non-recent bird in weightsMap is discounted by 0.05', () => {
    const recentPool = [makeSpecies('recent')];
    const allPool    = [makeSpecies('recent'), makeSpecies('oldbird')];
    const recentCodes = new Set(['recent']);
    const weightsMap = { 'recent:image': 20, 'oldbird:image': 20 };
    const candidates = buildCandidates(recentPool, allPool, recentCodes, weightsMap, TYPES, true);
    const old = candidates.find(c => c.species.speciesCode === 'oldbird');
    expect(old).toBeDefined();
    expect(old!.weight).toBeCloseTo(20 * 0.05);
  });

  it('adaptive: non-recent bird NOT in weightsMap is excluded', () => {
    const recentPool = [makeSpecies('recent')];
    const allPool    = [makeSpecies('recent'), makeSpecies('unseenold')];
    const recentCodes = new Set(['recent']);
    const candidates = buildCandidates(recentPool, allPool, recentCodes, { 'recent:image': 20 }, TYPES, true);
    expect(candidates.find(c => c.species.speciesCode === 'unseenold')).toBeUndefined();
  });

  it('adaptive: non-struggling mastered non-recent bird gets heavy discount (0.05x)', () => {
    const recentPool  = [];
    const allPool     = [makeSpecies('oldbird')];
    const recentCodes = new Set<string>();
    // Not in strugglingKeys → NON_RECENT_MASTERED_DISCOUNT applies
    const candidates  = buildCandidates(recentPool, allPool, recentCodes, { 'oldbird:image': 20 }, TYPES, true);
    const old = candidates.find(c => c.species.speciesCode === 'oldbird');
    expect(old!.weight).toBeCloseTo(1); // 20 * 0.05 = 1
  });

  it('adaptive: struggling mastered non-recent bird gets palette-level discount (0.5x)', () => {
    const recentPool     = [];
    const allPool        = [makeSpecies('oldbird')];
    const recentCodes    = new Set<string>();
    const strugglingKeys = new Set(['oldbird:image']);
    const candidates = buildCandidates(recentPool, allPool, recentCodes, { 'oldbird:image': 20 }, TYPES, true, new Set(), new Set(), new Set(), strugglingKeys);
    const old = candidates.find(c => c.species.speciesCode === 'oldbird');
    expect(old).toBeDefined();
    expect(old!.weight).toBeCloseTo(10); // 20 * 0.5 = 10
  });

  it('adaptive: multiple question types produce one candidate entry per type', () => {
    const pool = [makeSpecies('amero')];
    const types = ['image', 'song'] as const;
    const paletteKeys = new Set(['amero:image', 'amero:song']);
    const candidates = buildCandidates(pool, pool, new Set(['amero']), {}, types, true, paletteKeys);
    expect(candidates).toHaveLength(2);
    expect(candidates.map(c => c.type).sort()).toEqual(['image', 'song'].sort());
  });
});

// ── buildCandidates: speciesFilterSet ─────────────────────────────────────────

describe('buildCandidates - speciesFilterSet', () => {
  it('non-recent bird outside the filter is excluded from candidates', () => {
    const recentPool  = [];
    const allPool     = [makeSpecies('inFilter'), makeSpecies('outFilter')];
    const recentCodes = new Set<string>();
    const weightsMap  = { 'inFilter:image': 20, 'outFilter:image': 20 };
    const speciesFilterSet = new Set(['inFilter']);
    const candidates = buildCandidates(recentPool, allPool, recentCodes, weightsMap, TYPES, true, new Set(), new Set(), speciesFilterSet);
    expect(candidates.find(c => c.species.speciesCode === 'outFilter')).toBeUndefined();
    expect(candidates.find(c => c.species.speciesCode === 'inFilter')).toBeDefined();
  });

  it('non-recent bird inside the filter is still included (with NON_RECENT discount)', () => {
    const recentPool  = [];
    const allPool     = [makeSpecies('inFilter')];
    const recentCodes = new Set<string>();
    const weightsMap  = { 'inFilter:image': 20 };
    const speciesFilterSet = new Set(['inFilter']);
    const candidates = buildCandidates(recentPool, allPool, recentCodes, weightsMap, TYPES, true, new Set(), new Set(), speciesFilterSet);
    const c = candidates.find(c => c.species.speciesCode === 'inFilter');
    expect(c).toBeDefined();
    expect(c!.weight).toBeCloseTo(20 * 0.05);
  });

  it('empty speciesFilterSet (no selection) includes all non-recent birds — no regression', () => {
    const recentPool  = [];
    const allPool     = [makeSpecies('bird1'), makeSpecies('bird2')];
    const recentCodes = new Set<string>();
    const weightsMap  = { 'bird1:image': 20, 'bird2:image': 20 };
    const candidates = buildCandidates(recentPool, allPool, recentCodes, weightsMap, TYPES, true);
    expect(candidates).toHaveLength(2);
  });

  it('palette bird outside the species filter is still excluded', () => {
    const recentPool  = [];
    const allPool     = [makeSpecies('palettebird'), makeSpecies('filtered')];
    const recentCodes = new Set<string>();
    const weightsMap  = { 'palettebird:image': 20, 'filtered:image': 20 };
    const paletteKeys = new Set(['palettebird:image']);
    const speciesFilterSet = new Set(['filtered']); // palettebird is NOT in the user's selection
    const candidates = buildCandidates(recentPool, allPool, recentCodes, weightsMap, TYPES, true, paletteKeys, new Set(), speciesFilterSet);
    // palettebird should be excluded because the user's selection doesn't include it
    expect(candidates.find(c => c.species.speciesCode === 'palettebird')).toBeUndefined();
    expect(candidates.find(c => c.species.speciesCode === 'filtered')).toBeDefined();
  });
});

// ── buildCandidates: level 0 behaviour ───────────────────────────────────────

describe('buildCandidates - palette and non-recent discounts', () => {
  it('non-recent palette bird is discounted to half weight, floored at ACTIVE_PALETTE_MIN_WEIGHT', () => {
    const recentPool  = [];
    const allPool     = [makeSpecies('palettebird')];
    const recentCodes = new Set<string>();
    const paletteKeys = new Set(['palettebird:image']);
    const candidates  = buildCandidates(recentPool, allPool, recentCodes, { 'palettebird:image': 20 }, TYPES, true, paletteKeys);
    const c = candidates.find(c => c.species.speciesCode === 'palettebird');
    expect(c).toBeDefined();
    expect(c!.weight).toBe(10); // Math.max(20 × NON_RECENT_PALETTE_DISCOUNT, ACTIVE_PALETTE_MIN_WEIGHT) = Math.max(10, 5) = 10
  });

  it('non-recent non-palette non-struggling mastered bird gets heavy discount', () => {
    const recentPool  = [];
    const allPool     = [makeSpecies('oldbird')];
    const recentCodes = new Set<string>();
    const candidates  = buildCandidates(recentPool, allPool, recentCodes, { 'oldbird:image': 20 }, TYPES, true);
    const c = candidates.find(c => c.species.speciesCode === 'oldbird');
    expect(c!.weight).toBeCloseTo(20 * 0.05);
  });
});

// ── Palette cap enforcement ───────────────────────────────────────────────────
// Demonstrates that buildCandidates does NOT enforce the 12-bird palette cap:
// all 26 over-seeded birds land in the pool at full weight, including ones that
// have never been asked (lastAsked=0).  Graduating a level-2 bird to mastered
// changes nothing about the 26-bird level-0 pool.

describe('palette cap enforcement (26 over-seeded level-0 birds)', () => {
  const SONG = ['song'] as const;

  function make26Level0Birds() {
    return Array.from({ length: 26 }, (_, i) => makeSpecies(`bird${i}`));
  }

  it('all 26 palette birds appear as full-weight (20) candidates - cap is not enforced', () => {
    const pool = make26Level0Birds();
    const recentCodes = new Set(pool.map(s => s.speciesCode));
    const weightsMap  = Object.fromEntries(pool.map(s => [`${s.speciesCode}:song`, 20]));
    const paletteKeys = new Set(pool.map(s => `${s.speciesCode}:song`));

    const candidates = buildCandidates(pool, pool, recentCodes, weightsMap, SONG, true, paletteKeys);

    expect(candidates).toHaveLength(26);                         // all 26 in pool
    expect(candidates.every(c => c.weight === 20)).toBe(true);  // all at full palette weight
  });

  it('graduating a level-2 bird to mastered does not remove any level-0 birds from the pool', () => {
    const level0Pool  = make26Level0Birds();
    const level2Bird  = makeSpecies('gradbird');
    const allPool     = [...level0Pool, level2Bird];
    const recentCodes = new Set(allPool.map(s => s.speciesCode));

    // After graduation, the level-2 bird drops from PALETTE_WEIGHT to HISTORY_WEIGHT (1).
    const weightsMap = {
      ...Object.fromEntries(level0Pool.map(s => [`${s.speciesCode}:song`, 20])),
      'gradbird:song': 1, // HISTORY_WEIGHT - now mastered
    };

    const candidates = buildCandidates(allPool, allPool, recentCodes, weightsMap, SONG, true);

    const level0Candidates = candidates.filter(c => c.species.speciesCode !== 'gradbird');
    expect(level0Candidates).toHaveLength(26);                          // 26 still in pool
    expect(level0Candidates.every(c => c.weight === 20)).toBe(true);   // still at full weight
  });

  it('setting a level-0 bird weight to 0 still lands it at floor weight 3 - cannot suppress via weights alone', () => {
    const bird        = makeSpecies('excess');
    const recentCodes = new Set(['excess']);
    const weightsMap  = { 'excess:song': 0 }; // attempted suppression

    const candidates = buildCandidates([bird], [bird], recentCodes, weightsMap, SONG, true);

    expect(candidates[0].weight).toBe(3); // floored - not actually suppressed
  });
});

// ── applyPaletteSMGuarantee ───────────────────────────────────────────────────

describe('applyPaletteSMGuarantee', () => {
  it('guarantees at least palettePlusStrugglingMin questions from palette pool', () => {
    const recentCodes  = new Set(['a', 'b', 'c', 'd', 'e']);
    const paletteKeySet = new Set(['a:image', 'b:image', 'c:image', 'd:image', 'e:image']);
    // f–j are mastered non-struggling (not in paletteKeySet or strugglingKeySet)
    const weightsMap: Record<string, number> = {
      'f:image': 1, 'g:image': 1, 'h:image': 1, 'i:image': 1, 'j:image': 1,
    };
    const allValid = [
      ...['a','b','c','d','e'].map(c => makeQ(c)),
      ...['f','g','h','i','j'].map(c => makeQ(c)),
      makeQ('old1'), makeQ('old2'),
    ];
    const result = applyPaletteSMGuarantee(allValid, recentCodes, weightsMap, 10, 5, paletteKeySet);
    const ruCount = result.filter(q => paletteKeySet.has(`${q.speciesCode}:${q.type}`)).length;
    expect(ruCount).toBeGreaterThanOrEqual(5);
    expect(result).toHaveLength(10);
  });

  it('returns all from other pool when no palette or struggling birds exist', () => {
    const recentCodes = new Set(['a', 'b']);
    const weightsMap = { 'a:image': 1, 'b:image': 1 };
    const allValid = [makeQ('a'), makeQ('b'), makeQ('old1'), makeQ('old2')];
    // No paletteKeySet or strugglingKeySet — all go to otherValid
    const result = applyPaletteSMGuarantee(allValid, recentCodes, weightsMap, 4, 2);
    expect(result).toHaveLength(4);
  });

  it('backfills from RU surplus when other pool is short', () => {
    const recentCodes   = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    const paletteKeySet = new Set(['a:image', 'b:image', 'c:image', 'd:image', 'e:image', 'f:image', 'g:image', 'h:image']);
    const weightsMap: Record<string, number> = {};
    const allValid = ['a','b','c','d','e','f','g','h'].map(c => makeQ(c));
    const result = applyPaletteSMGuarantee(allValid, recentCodes, weightsMap, 8, 5, paletteKeySet);
    expect(result).toHaveLength(8);
  });

  it('result length does not exceed count', () => {
    const recentCodes   = new Set(['a', 'b', 'c']);
    const paletteKeySet = new Set(['a:image', 'b:image', 'c:image']);
    const weightsMap: Record<string, number> = {};
    const allValid = ['a','b','c','d','e','f','g','h','i','j','k','l'].map(c => makeQ(c));
    const result = applyPaletteSMGuarantee(allValid, recentCodes, weightsMap, 10, 5, paletteKeySet);
    expect(result).toHaveLength(10);
  });

  it('non-recent palette bird is included in the guaranteed RU bucket', () => {
    const recentCodes   = new Set<string>(); // bird is NOT in recent window
    const paletteKeySet = new Set(['palettebird:image']);
    const weightsMap    = { 'palettebird:image': 20 };
    const allValid      = [makeQ('palettebird'), makeQ('other1'), makeQ('other2')];
    const result = applyPaletteSMGuarantee(allValid, recentCodes, weightsMap, 3, 1, paletteKeySet);
    expect(result.some(q => q.speciesCode === 'palettebird')).toBe(true);
  });

  it('palette guarantee fires even when recent window is empty', () => {
    const recentCodes   = new Set<string>();
    const paletteKeySet = new Set(['a:image', 'b:image', 'c:image', 'd:image', 'e:image']);
    const weightsMap: Record<string, number> = {};
    const allValid = ['a','b','c','d','e'].map(c => makeQ(c));
    const result = applyPaletteSMGuarantee(allValid, recentCodes, weightsMap, 5, 3, paletteKeySet);
    const paletteCount = result.filter(q => paletteKeySet.has(`${q.speciesCode}:${q.type}`)).length;
    expect(paletteCount).toBeGreaterThanOrEqual(3);
  });

  it('struggling mastered bird (in strugglingKeySet) is guaranteed a slot', () => {
    const recentCodes    = new Set(['struggling']);
    const weightsMap     = { 'struggling:image': 20, 'mastered:image': 1 };
    const paletteKeySet  = new Set<string>();
    const strugglingKeySet = new Set(['struggling:image']);
    const allValid = [makeQ('struggling'), makeQ('mastered')];
    const result = applyPaletteSMGuarantee(allValid, recentCodes, weightsMap, 2, 1, paletteKeySet, strugglingKeySet);
    expect(result).toHaveLength(2);
    expect(result.some(q => q.speciesCode === 'struggling')).toBe(true);
  });

  it('non-recent struggling bird (in strugglingKeySet) is included in SM slots', () => {
    const recentCodes    = new Set<string>(); // not in window
    const weightsMap     = { 'nonWindowSM:image': 20 };
    const strugglingKeySet = new Set(['nonWindowSM:image']);
    const allValid = [makeQ('nonWindowSM'), makeQ('other1'), makeQ('other2')];
    const result = applyPaletteSMGuarantee(allValid, recentCodes, weightsMap, 3, 2, new Set(), strugglingKeySet);
    expect(result.some(q => q.speciesCode === 'nonWindowSM')).toBe(true);
  });

  it('window palette birds are sorted before non-window palette birds in RU slots', () => {
    const recentCodes   = new Set(['windowRU']); // windowRU is recent; nonWindowRU is not
    const paletteKeySet = new Set(['windowRU:image', 'nonWindowRU:image']);
    const weightsMap    = { 'windowRU:image': 20, 'nonWindowRU:image': 20 };
    // Put nonWindowRU first in allValid to confirm sorting is applied
    const allValid = [makeQ('nonWindowRU'), makeQ('windowRU')];
    // palettePlusStrugglingMin=2, ruFloor=ceil(2*0.5)=1. With no SM, backfill gives ruTake=2.
    const result = applyPaletteSMGuarantee(allValid, recentCodes, weightsMap, 2, 2, paletteKeySet);
    // windowRU should appear in result (was sorted first)
    expect(result.some(q => q.speciesCode === 'windowRU')).toBe(true);
  });
});

// ── splitCandidates ───────────────────────────────────────────────────────────

describe('splitCandidates', () => {
  it('REGRESSION: non-recent palette bird in paletteKeySet goes to ruCandidates, not otherCandidates', () => {
    // Reproduces the advanced-birder bug where palette birds outside the
    // eBird window were silently dropped from ruCandidates.
    const candidates    = [makeCandidate('palettebird', 20)];
    const paletteKeySet = new Set(['palettebird:song']); // IS in learning palette
    const { ruCandidates, otherCandidates } = splitCandidates(candidates, paletteKeySet, new Set());
    expect(ruCandidates).toHaveLength(1);
    expect(otherCandidates).toHaveLength(0);
  });

  it('bird not in paletteKeySet or strugglingKeySet goes to otherCandidates', () => {
    const candidates = [makeCandidate('oldbird', 20)];
    const { ruCandidates, otherCandidates } = splitCandidates(candidates, new Set(), new Set());
    expect(ruCandidates).toHaveLength(0);
    expect(otherCandidates).toHaveLength(1);
  });

  it('bird in paletteKeySet goes to ruCandidates regardless of recency or weight', () => {
    const candidates    = [makeCandidate('palettebird', 20)];
    const paletteKeySet = new Set(['palettebird:song']);
    const { ruCandidates } = splitCandidates(candidates, paletteKeySet, new Set());
    expect(ruCandidates).toHaveLength(1);
  });

  it('bird in strugglingKeySet goes to smCandidates regardless of recency or weight', () => {
    const candidates     = [makeCandidate('strugglingbird', 20)];
    const strugglingKeySet = new Set(['strugglingbird:song']);
    const { smCandidates, ruCandidates } = splitCandidates(candidates, new Set(), strugglingKeySet);
    expect(smCandidates).toHaveLength(1);
    expect(ruCandidates).toHaveLength(0);
  });

  it('non-recent struggling mastered bird (in strugglingKeySet) goes to smCandidates', () => {
    const candidates     = [makeCandidate('nonRecentSM', 20)];
    const strugglingKeySet = new Set(['nonRecentSM:song']);
    const { smCandidates, ruCandidates, otherCandidates } = splitCandidates(candidates, new Set(), strugglingKeySet);
    expect(smCandidates).toHaveLength(1);
    expect(ruCandidates).toHaveLength(0);
    expect(otherCandidates).toHaveLength(0);
  });

  it('mastered review bird (not in any key set) goes to otherCandidates regardless of weight', () => {
    const candidates = [makeCandidate('masteredbird', 1)]; // HISTORY_WEIGHT
    const { otherCandidates } = splitCandidates(candidates, new Set(), new Set());
    expect(otherCandidates).toHaveLength(1);
  });
});

// ── pickFromPool ──────────────────────────────────────────────────────────────

describe('pickFromPool', () => {
  it('REGRESSION (Redwing): target = pool.length returns each bird exactly once, no replacement fill', () => {
    // Reproduces the bug where pickedOther used target=count+5, causing a single
    // recently-mastered bird (Redwing) to fill up to 9/25 question slots via
    // replacement fill.  Fix: use target=pool.length for mastered birds.
    const pool = Array.from({ length: 10 }, (_, i) => makeCandidate(`bird${i}`, 1));
    const result = pickFromPool(pool, pool.length);
    expect(result).toHaveLength(10);
    expect(new Set(result.map(c => c.species.speciesCode)).size).toBe(10);
  });

  it('target < pool.length returns the requested count with no duplicates', () => {
    const pool = Array.from({ length: 15 }, (_, i) => makeCandidate(`bird${i}`, 20));
    const result = pickFromPool(pool, 10);
    expect(result).toHaveLength(10);
    expect(new Set(result.map(c => c.species.speciesCode)).size).toBe(10);
  });

  it('target > pool.length triggers replacement fill so palette birds repeat (small palette)', () => {
    // For a new user with only 2 palette birds and a 5-question round,
    // birds must repeat - that is the intended behaviour.
    const pool = [makeCandidate('bird0', 20), makeCandidate('bird1', 20)];
    const result = pickFromPool(pool, 10);
    expect(result).toHaveLength(10);
    expect(new Set(result.map(c => c.species.speciesCode)).size).toBe(2);
    // Each bird should appear multiple times
    expect(result.filter(c => c.species.speciesCode === 'bird0').length).toBeGreaterThan(1);
  });

  it('replacement fill: first pool.length entries are always the unique first-pass picks', () => {
    // The first pass picks all pool birds exactly once (weighted sampling w/o replacement).
    // Repeats are appended after.  This ensures the guarantee's .slice(0, ruTake) draws
    // unique birds first when the palette is large enough to satisfy ruTake.
    const pool = Array.from({ length: 5 }, (_, i) => makeCandidate(`bird${i}`, 20));
    const result = pickFromPool(pool, 10);
    const firstFive = result.slice(0, 5).map(c => c.species.speciesCode);
    expect(new Set(firstFive).size).toBe(5); // all unique in first pass
  });
});
