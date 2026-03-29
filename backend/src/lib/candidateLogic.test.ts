import { describe, it, expect } from 'vitest';
import { buildCandidates, applyRecentUnmasteredGuarantee } from './candidateLogic';
import type { PoolSpecies } from './candidateLogic';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSpecies(code: string): PoolSpecies {
  return {
    speciesCode: code,
    comName: code,
    sciName: code,
    tax: { familySciName: 'Fam', familyComName: 'Family', order: 'Order' },
  };
}

// Minimal question stub — only fields used by the guarantee logic
function makeQ(code: string, type = 'image') {
  return { speciesCode: code, type };
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

  it('adaptive: new encounter (not in weightsMap) gets weight 20', () => {
    const pool = [makeSpecies('newbird')];
    const candidates = buildCandidates(pool, pool, new Set(['newbird']), {}, TYPES, true);
    expect(candidates[0].weight).toBe(20);
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

  it('adaptive: struggling mastered non-recent bird (w=20) is still discounted', () => {
    // A non-recent bird that is "struggling" (high weight) still appears rarely
    const recentPool  = [];
    const allPool     = [makeSpecies('oldbird')];
    const recentCodes = new Set<string>();
    const candidates  = buildCandidates(recentPool, allPool, recentCodes, { 'oldbird:image': 20 }, TYPES, true);
    const old = candidates.find(c => c.species.speciesCode === 'oldbird');
    expect(old!.weight).toBeCloseTo(1); // 20 * 0.05 = 1
  });

  it('adaptive: multiple question types produce one candidate entry per type', () => {
    const pool = [makeSpecies('amero')];
    const types = ['image', 'song'] as const;
    const candidates = buildCandidates(pool, pool, new Set(['amero']), {}, types, true);
    expect(candidates).toHaveLength(2);
    expect(candidates.map(c => c.type).sort()).toEqual(['image', 'song'].sort());
  });
});

// ── buildCandidates: level 0 behaviour ───────────────────────────────────────

describe('buildCandidates — level 0 birds', () => {
  it('level 0 non-recent bird keeps full palette weight (not discounted)', () => {
    const recentPool  = [];
    const allPool     = [makeSpecies('lv0bird')];
    const recentCodes = new Set<string>();
    const level0Keys  = new Set(['lv0bird:image']);
    const candidates  = buildCandidates(recentPool, allPool, recentCodes, { 'lv0bird:image': 20 }, TYPES, true, level0Keys);
    const c = candidates.find(c => c.species.speciesCode === 'lv0bird');
    expect(c).toBeDefined();
    expect(c!.weight).toBe(20); // not discounted
  });

  it('non-level-0 non-recent bird is still discounted', () => {
    const recentPool  = [];
    const allPool     = [makeSpecies('oldbird')];
    const recentCodes = new Set<string>();
    const level0Keys  = new Set<string>(); // oldbird is NOT level 0
    const candidates  = buildCandidates(recentPool, allPool, recentCodes, { 'oldbird:image': 20 }, TYPES, true, level0Keys);
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

  it('all 26 level-0 birds appear as full-weight (20) candidates — cap is not enforced', () => {
    const pool = make26Level0Birds();
    const recentCodes = new Set(pool.map(s => s.speciesCode));
    const weightsMap  = Object.fromEntries(pool.map(s => [`${s.speciesCode}:song`, 20]));
    const level0Keys  = new Set(pool.map(s => `${s.speciesCode}:song`));

    const candidates = buildCandidates(pool, pool, recentCodes, weightsMap, SONG, true, level0Keys);

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
      'gradbird:song': 1, // HISTORY_WEIGHT — now mastered
    };

    const candidates = buildCandidates(allPool, allPool, recentCodes, weightsMap, SONG, true);

    const level0Candidates = candidates.filter(c => c.species.speciesCode !== 'gradbird');
    expect(level0Candidates).toHaveLength(26);                          // 26 still in pool
    expect(level0Candidates.every(c => c.weight === 20)).toBe(true);   // still at full weight
  });

  it('setting a level-0 bird weight to 0 still lands it at floor weight 3 — cannot suppress via weights alone', () => {
    const bird        = makeSpecies('excess');
    const recentCodes = new Set(['excess']);
    const weightsMap  = { 'excess:song': 0 }; // attempted suppression

    const candidates = buildCandidates([bird], [bird], recentCodes, weightsMap, SONG, true);

    expect(candidates[0].weight).toBe(3); // floored — not actually suppressed
  });
});

// ── applyRecentUnmasteredGuarantee ────────────────────────────────────────────

describe('applyRecentUnmasteredGuarantee', () => {
  it('guarantees at least recentUnmasteredMin questions from recent-unmastered pool', () => {
    const recentCodes = new Set(['a', 'b', 'c', 'd', 'e']);
    // a–e are recent unmastered (no weight = default 20)
    // f–j are recent mastered (weight = 1, boosted to 3, still < 5)
    const weightsMap: Record<string, number> = {
      'f:image': 1, 'g:image': 1, 'h:image': 1, 'i:image': 1, 'j:image': 1,
    };
    const allValid = [
      ...['a','b','c','d','e'].map(c => makeQ(c)),   // recent unmastered (not in weightsMap → default 20)
      ...['f','g','h','i','j'].map(c => makeQ(c)),   // recent mastered (w=1 < 5)
      makeQ('old1'), makeQ('old2'),                   // non-recent (not in recentCodes)
    ];
    const result = applyRecentUnmasteredGuarantee(allValid, recentCodes, weightsMap, 10, 5);
    const ruCount = result.filter(q => !weightsMap[`${q.speciesCode}:${q.type}`] && recentCodes.has(q.speciesCode)).length;
    expect(ruCount).toBeGreaterThanOrEqual(5);
    expect(result).toHaveLength(10);
  });

  it('returns all from other pool when no recent-unmastered birds exist', () => {
    const recentCodes = new Set(['a', 'b']);
    const weightsMap = { 'a:image': 1, 'b:image': 1 }; // both mastered (w < 5)
    const allValid = [makeQ('a'), makeQ('b'), makeQ('old1'), makeQ('old2')];
    const result = applyRecentUnmasteredGuarantee(allValid, recentCodes, weightsMap, 4, 2);
    // ruValid is empty (all have w=1 < 5), so result comes entirely from otherValid
    expect(result).toHaveLength(4);
  });

  it('backfills from RU surplus when other pool is short', () => {
    const recentCodes = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    const weightsMap: Record<string, number> = {}; // all unmastered
    const allValid = ['a','b','c','d','e','f','g','h'].map(c => makeQ(c)); // 8 RU, 0 others
    // count=10, recentUnmasteredMin=5, but otherValid is empty so backfill from RU
    const result = applyRecentUnmasteredGuarantee(allValid, recentCodes, weightsMap, 8, 5);
    expect(result).toHaveLength(8); // can't exceed allValid.length
  });

  it('result length does not exceed count', () => {
    const recentCodes = new Set(['a', 'b', 'c']);
    const weightsMap: Record<string, number> = {};
    const allValid = ['a','b','c','d','e','f','g','h','i','j','k','l'].map(c => makeQ(c));
    const result = applyRecentUnmasteredGuarantee(allValid, recentCodes, weightsMap, 10, 5);
    expect(result).toHaveLength(10);
  });

  it('level 0 bird outside recent window is included in the guaranteed bucket', () => {
    const recentCodes = new Set<string>(); // bird is NOT in recent window
    const level0Keys  = new Set(['lv0bird:image']);
    const weightsMap  = { 'lv0bird:image': 20 };
    const allValid    = [makeQ('lv0bird'), makeQ('other1'), makeQ('other2')];
    const result = applyRecentUnmasteredGuarantee(allValid, recentCodes, weightsMap, 3, 1, level0Keys);
    expect(result.some(q => q.speciesCode === 'lv0bird')).toBe(true);
  });

  it('level 0 bird guarantee fires even when recent-window is empty', () => {
    const recentCodes = new Set<string>();
    const level0Keys  = new Set(['a:image', 'b:image', 'c:image', 'd:image', 'e:image']);
    const weightsMap: Record<string, number> = {};
    // 5 level 0 birds, no other birds
    const allValid = ['a','b','c','d','e'].map(c => makeQ(c));
    const result = applyRecentUnmasteredGuarantee(allValid, recentCodes, weightsMap, 5, 3, level0Keys);
    const lv0Count = result.filter(q => level0Keys.has(`${q.speciesCode}:${q.type}`)).length;
    expect(lv0Count).toBeGreaterThanOrEqual(3);
  });

  it('treats questions with weight ≥ 5 as unmastered, < 5 as mastered', () => {
    const recentCodes = new Set(['struggling', 'mastered']);
    // struggling mastered bird with high weight (still active)
    const weightsMap = { 'struggling:image': 20, 'mastered:image': 1 };
    const allValid = [makeQ('struggling'), makeQ('mastered')];
    const result = applyRecentUnmasteredGuarantee(allValid, recentCodes, weightsMap, 2, 1);
    // 'struggling' has w=20 ≥ 5 → counts as unmastered → should be in guaranteed slot
    expect(result).toHaveLength(2);
    expect(result.some(q => q.speciesCode === 'struggling')).toBe(true);
  });
});
