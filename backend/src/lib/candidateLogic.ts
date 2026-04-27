/**
 * Pure functions for building quiz candidate pools and guaranteeing
 * the minimum ratio of recent-unmastered questions.
 *
 * Extracted from routes/quiz.ts so they can be unit-tested independently.
 */

import type { QuestionType } from '../routes/quiz';
import {
  NON_RECENT_MULTIPLIER, NEW_ENCOUNTER_WEIGHT, MASTERED_FLOOR_WEIGHT,
  ACTIVE_PALETTE_MIN_WEIGHT, UNMASTERED_FLOOR_RATIO,
  AFFINITY_GENUS_BOOST, AFFINITY_FAMILY_BOOST,
} from '@birdygurdy/shared';

export interface PoolSpecies {
  speciesCode: string;
  comName: string;
  sciName: string;
  tax: { familySciName: string; familyComName: string; order: string; orderComName?: string } | undefined;
}

export interface Candidate {
  species: PoolSpecies;
  type: QuestionType;
  weight: number;
}

// NON_RECENT_MULTIPLIER, NEW_ENCOUNTER_WEIGHT, MASTERED_FLOOR_WEIGHT,
// ACTIVE_PALETTE_MIN_WEIGHT imported from @birdygurdy/shared above.

/**
 * Builds the weighted candidate list for question selection.
 *
 * Three tiers (adaptive mode only):
 *  1. Recent window birds - always candidates.
 *     - New encounters (not in weightsMap): weight = NEW_ENCOUNTER_WEIGHT
 *     - Unmastered (w ≥ 5): weight = w
 *     - Mastered (w < 5): weight = max(w, MASTERED_FLOOR_WEIGHT)
 *  2. Non-recent birds in weightsMap - heavily discounted (× NON_RECENT_MULTIPLIER).
 *  3. Non-recent birds not in weightsMap - excluded.
 *
 * Non-adaptive mode: all questionPool birds at weight = 1, no non-recent birds.
 */
export function buildCandidates(
  questionPool: PoolSpecies[],
  filteredPool: PoolSpecies[],   // questionPool + historicalExtras
  recentCodes: Set<string>,
  weightsMap: Record<string, number>,
  types: QuestionType[],
  adaptiveMode: boolean,
  level0Keys: Set<string> = new Set(),
  paletteCodes: Set<string> = new Set(),
  speciesFilterSet: Set<string> = new Set(),
): Candidate[] {
  const candidates: Candidate[] = [];

  // Pass 1: Recent window birds (always candidates)
  for (const species of questionPool) {
    for (const t of types) {
      const key = `${species.speciesCode}:${t}`;
      const w = weightsMap[key];
      let weight: number;
      if (!adaptiveMode) {
        weight = 1;
      } else if (w === undefined) {
        // Only introduce a new encounter for this specific type if
        // maintainLevel0Palette has explicitly seeded it (putting its key in
        // level0Keys). The old paletteCodes check was too broad - a bird with
        // an active family/song record could bypass palette ordering and be
        // introduced as a new image question before the queue reached it.
        if (!level0Keys.has(key)) continue;
        weight = NEW_ENCOUNTER_WEIGHT;
      } else {
        weight = Math.max(w, MASTERED_FLOOR_WEIGHT);
      }
      candidates.push({ species, type: t, weight });
    }
  }

  // Pass 2: Non-recent palette birds (long-term retention, rarely asked)
  // Exception: level-0 question-type keys keep their full learning weight even
  // outside the recent window - active learning trumps the observation window.
  if (adaptiveMode) {
    for (const species of filteredPool) {
      if (recentCodes.has(species.speciesCode)) continue;
      if (speciesFilterSet.size > 0 && !speciesFilterSet.has(species.speciesCode)) continue;
      for (const t of types) {
        const key = `${species.speciesCode}:${t}`;
        const w = weightsMap[key];
        if (w === undefined) continue;
        const weight = level0Keys.has(key)
          ? Math.max(w, NEW_ENCOUNTER_WEIGHT)          // level 0 for this type: keep full palette weight
          : Math.max(w * NON_RECENT_MULTIPLIER, 0.001); // others: heavy discount
        candidates.push({ species, type: t, weight });
      }
    }
  }

  return candidates;
}

/**
 * Guarantees a minimum ratio of "needs practice" questions, split evenly between:
 *   - Truly unmastered (active palette, not yet graduated)
 *   - Struggling mastered (graduated but accuracy below threshold)
 *
 * total    = palettePlusStrugglingMin  (≈ 67% of count)
 * ruFloor  = ceil(total / 2)      - minimum unmastered
 * smFloor  = total − ruFloor      - minimum struggling-mastered
 *
 * Each bucket backfills for the other's shortfall, then regular mastered
 * birds fill any remaining slots. Shuffles the final result.
 */
export function applyRecentUnmasteredGuarantee<T extends { speciesCode: string; type: string }>(
  allValid: T[],
  recentCodes: Set<string>,
  weightsMap: Record<string, number>,
  count: number,
  palettePlusStrugglingMin: number,
  level0Keys: Set<string> = new Set(),
  historyKeySet: Set<string> = new Set(),
): T[] {
  const key = (q: T) => `${q.speciesCode}:${q.type}`;
  const w   = (q: T) => weightsMap[key(q)] ?? NEW_ENCOUNTER_WEIGHT;

  const needsPractice = (q: T) =>
    (recentCodes.has(q.speciesCode) && w(q) >= ACTIVE_PALETTE_MIN_WEIGHT) || level0Keys.has(key(q));

  // Unmastered: needs practice AND not yet graduated
  const isUnmastered = (q: T) => needsPractice(q) && !historyKeySet.has(key(q));
  // Struggling mastered: needs practice AND already graduated
  const isStruggling = (q: T) => needsPractice(q) &&  historyKeySet.has(key(q));

  const ruValid    = allValid.filter(isUnmastered);
  const smValid    = allValid.filter(isStruggling);
  const otherValid = allValid.filter(q => !needsPractice(q));

  const total   = palettePlusStrugglingMin;
  const ruFloor = Math.ceil(total * UNMASTERED_FLOOR_RATIO);
  const smFloor = total - ruFloor;

  let ruTake = Math.min(ruValid.length, ruFloor);
  let smTake = Math.min(smValid.length, smFloor);

  // Each pool backfills for the other's shortfall
  smTake += Math.min(smValid.length - smTake, ruFloor - ruTake);
  ruTake += Math.min(ruValid.length - ruTake, smFloor - smTake);

  const otherTake = count - ruTake - smTake;

  const result = [
    ...ruValid.slice(0, ruTake),
    ...smValid.slice(0, smTake),
    ...otherValid.slice(0, Math.max(0, otherTake)),
  ];

  // Final backfill if any pool was short
  if (result.length < count) {
    const surplus = [
      ...ruValid.slice(ruTake),
      ...smValid.slice(smTake),
      ...otherValid.slice(Math.max(0, otherTake)),
    ];
    result.push(...surplus.slice(0, count - result.length));
  }

  return result.sort(() => Math.random() - 0.5).slice(0, count);
}

/**
 * Weighted sampling without replacement up to `target`.
 * If the pool is smaller than target, round-robin replacement fill is used so
 * every bird appears floor(target/pool.size) or ceil(...) times — weighted
 * within each pass via Efraimidis-Spirakis reservoir sampling so higher-weight
 * birds get the extra slot on uneven cycles.
 *
 * When target ≤ pool.length no fill fires and every picked bird is unique.
 * When target > pool.length fill fires and some birds will repeat — this is the
 * intended behaviour for a learning palette smaller than the round size.
 */
export function pickFromPool(pool: Candidate[], target: number): Candidate[] {
  const picked: Candidate[] = [];
  const remaining = [...pool];
  while (picked.length < target && remaining.length > 0) {
    const total = remaining.reduce((s, c) => s + c.weight, 0);
    let rand = Math.random() * total;
    let idx  = 0;
    for (let i = 0; i < remaining.length; i++) {
      rand -= remaining[i].weight;
      if (rand <= 0) { idx = i; break; }
    }
    picked.push(remaining.splice(idx, 1)[0]);
  }
  if (picked.length < target && pool.length > 0) {
    while (picked.length < target) {
      const pass = [...pool]
        .map(c => ({ c, key: Math.random() ** (1 / c.weight) }))
        .sort((a, b) => b.key - a.key)
        .map(({ c }) => c);
      for (const item of pass) {
        if (picked.length >= target) break;
        picked.push(item);
      }
    }
  }
  return picked;
}

/**
 * Splits a flat candidate list into the three buckets used by the quiz engine:
 *   ruCandidates    – unmastered palette birds (weight ≥ 5, not yet graduated)
 *   smCandidates    – struggling-mastered birds (weight ≥ 5, already graduated)
 *   otherCandidates – everything else (review-only mastered birds)
 *
 * A bird qualifies for ru/sm when it is either in the recent eBird sighting
 * window OR in level0Keys (palette birds that happen to be outside the current
 * observation window still need practice).
 */
export function splitCandidates(
  candidates: Candidate[],
  recentCodes: Set<string>,
  level0KeySet: Set<string>,
  historyKeySet: Set<string>,
): { ruCandidates: Candidate[]; smCandidates: Candidate[]; otherCandidates: Candidate[] } {
  const isUnmastered = (c: Candidate) => {
    const key = `${c.species.speciesCode}:${c.type}`;
    return (recentCodes.has(c.species.speciesCode) || level0KeySet.has(key)) &&
      c.weight >= ACTIVE_PALETTE_MIN_WEIGHT && !historyKeySet.has(key);
  };
  const isStruggling = (c: Candidate) => {
    const key = `${c.species.speciesCode}:${c.type}`;
    return (recentCodes.has(c.species.speciesCode) || level0KeySet.has(key)) &&
      c.weight >= ACTIVE_PALETTE_MIN_WEIGHT && historyKeySet.has(key);
  };
  return {
    ruCandidates:    candidates.filter(isUnmastered),
    smCandidates:    candidates.filter(isStruggling),
    otherCandidates: candidates.filter(c => !isUnmastered(c) && !isStruggling(c)),
  };
}

/**
 * Returns a new array of candidates with weights boosted for birds that are
 * taxonomically related to the anchor species (ru/sm birds already in the quiz).
 * Only applied in advanced (hard) mode.
 *
 *   Shares genus with any anchor  → weight × AFFINITY_GENUS_BOOST
 *   Shares family (not genus)     → weight × AFFINITY_FAMILY_BOOST
 *   No relation                   → weight unchanged
 */
export function applyAffinityBoosts(
  candidates: Candidate[],
  anchors: PoolSpecies[],
): Candidate[] {
  if (anchors.length === 0) return candidates;

  const anchorGenera   = new Set(anchors.map(a => a.sciName.split(' ')[0]));
  const anchorFamilies = new Set(
    anchors.map(a => a.tax?.familySciName).filter((f): f is string => Boolean(f)),
  );

  return candidates.map(c => {
    const genus  = c.species.sciName.split(' ')[0];
    const family = c.species.tax?.familySciName;

    if (anchorGenera.has(genus)) {
      return { ...c, weight: c.weight * AFFINITY_GENUS_BOOST };
    }
    if (family && anchorFamilies.has(family)) {
      return { ...c, weight: c.weight * AFFINITY_FAMILY_BOOST };
    }
    return c;
  });
}
