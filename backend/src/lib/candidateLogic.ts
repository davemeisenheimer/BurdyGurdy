/**
 * Pure functions for building quiz candidate pools and guaranteeing
 * the minimum ratio of recent-unmastered questions.
 *
 * Extracted from routes/quiz.ts so they can be unit-tested independently.
 */

import type { QuestionType } from '../routes/quiz';
import {
  NON_RECENT_MASTERED_DISCOUNT, NON_RECENT_PALETTE_DISCOUNT,
  NEW_ENCOUNTER_WEIGHT, MASTERED_FLOOR_WEIGHT,
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

/**
 * Builds the weighted candidate list for question selection.
 *
 * Three tiers (adaptive mode only):
 *  1. Recent window birds - always candidates.
 *     - New encounters (not in weightsMap): weight = NEW_ENCOUNTER_WEIGHT
 *     - Any bird with a weight: weight = max(w, MASTERED_FLOOR_WEIGHT)
 *  2. Non-recent birds in weightsMap - discounted by category:
 *     - Unmastered palette birds (paletteKeys): × NON_RECENT_PALETTE_DISCOUNT, floored at ACTIVE_PALETTE_MIN_WEIGHT
 *     - Struggling mastered birds (strugglingKeys): × NON_RECENT_PALETTE_DISCOUNT
 *     - Non-struggling mastered birds: × NON_RECENT_MASTERED_DISCOUNT (heavy)
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
  paletteKeys: Set<string> = new Set(),
  paletteCodes: Set<string> = new Set(),
  speciesFilterSet: Set<string> = new Set(),
  strugglingKeys: Set<string> = new Set(),
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
        // paletteKeys). The old paletteCodes check was too broad - a bird with
        // an active family/song record could bypass palette ordering and be
        // introduced as a new image question before the queue reached it.
        if (!paletteKeys.has(key)) continue;
        weight = NEW_ENCOUNTER_WEIGHT;
      } else {
        weight = Math.max(w, MASTERED_FLOOR_WEIGHT);
      }
      candidates.push({ species, type: t, weight });
    }
  }

  // Pass 2: Non-recent birds (long-term retention, discounted by category)
  if (adaptiveMode) {
    for (const species of filteredPool) {
      if (recentCodes.has(species.speciesCode)) continue;
      if (speciesFilterSet.size > 0 && !speciesFilterSet.has(species.speciesCode)) continue;
      for (const t of types) {
        const key = `${species.speciesCode}:${t}`;
        const w = weightsMap[key];
        if (w === undefined) continue;
        let weight: number;
        if (paletteKeys.has(key)) {
          // Unmastered palette: light discount, stay above active floor
          weight = Math.max(w * NON_RECENT_PALETTE_DISCOUNT, ACTIVE_PALETTE_MIN_WEIGHT);
        } else if (strugglingKeys.has(key)) {
          // Struggling mastered: same light discount as palette — still needs active practice
          weight = w * NON_RECENT_PALETTE_DISCOUNT;
        } else {
          // Non-struggling mastered: heavy discount, occasional review only
          weight = Math.max(w * NON_RECENT_MASTERED_DISCOUNT, 0.001);
        }
        candidates.push({ species, type: t, weight });
      }
    }
  }

  return candidates;
}

/**
 * Guarantees a minimum ratio of "needs practice" questions, split evenly between:
 *   - Truly unmastered (active palette, identified by paletteKeySet membership)
 *   - Struggling mastered (graduated but accuracy below threshold, identified by strugglingKeySet)
 *
 * total    = palettePlusStrugglingMin  (≈ 67% of count)
 * ruFloor  = ceil(total × UNMASTERED_FLOOR_RATIO) - minimum unmastered
 * smFloor  = total − ruFloor           - minimum struggling-mastered
 *
 * Within each bucket, window birds are sorted first (then by weight descending),
 * so window-unmastered birds naturally fill the first RU slots — acting as a
 * window guarantee without a hard-coded reservation.
 *
 * Each bucket backfills for the other's shortfall, then regular mastered
 * birds fill any remaining slots. Shuffles the final result.
 */
export function applyPaletteSMGuarantee<T extends { speciesCode: string; type: string }>(
  allValid: T[],
  recentCodes: Set<string>,
  weightsMap: Record<string, number>,
  count: number,
  palettePlusStrugglingMin: number,
  paletteKeySet: Set<string> = new Set(),
  strugglingKeySet: Set<string> = new Set(),
): T[] {
  const key = (q: T) => `${q.speciesCode}:${q.type}`;
  const w   = (q: T) => weightsMap[key(q)] ?? NEW_ENCOUNTER_WEIGHT;

  const isUnmastered = (q: T) => paletteKeySet.has(key(q));
  const isStruggling = (q: T) => strugglingKeySet.has(key(q));

  // Sort: window birds first, then by weight descending within each group.
  // Window-unmastered birds will naturally be picked before non-window ones.
  const sortByWindowThenWeight = (a: T, b: T): number => {
    const aRecent = recentCodes.has(a.speciesCode) ? 1 : 0;
    const bRecent = recentCodes.has(b.speciesCode) ? 1 : 0;
    if (aRecent !== bRecent) return bRecent - aRecent;
    return w(b) - w(a);
  };

  const ruValid    = allValid.filter(isUnmastered).sort(sortByWindowThenWeight);
  const smValid    = allValid.filter(isStruggling).sort(sortByWindowThenWeight);
  const otherValid = allValid.filter(q => !isUnmastered(q) && !isStruggling(q));

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
 *   ruCandidates    – unmastered palette birds (membership in paletteKeySet)
 *   smCandidates    – struggling mastered birds (membership in strugglingKeySet)
 *   otherCandidates – everything else (review-only mastered birds)
 *
 * Classification is explicit: paletteKeySet / strugglingKeySet are computed on
 * the frontend from actual progress records, not inferred from weight or recency.
 */
export function splitCandidates(
  candidates: Candidate[],
  paletteKeySet: Set<string>,
  strugglingKeySet: Set<string>,
): { ruCandidates: Candidate[]; smCandidates: Candidate[]; otherCandidates: Candidate[] } {
  const isUnmastered = (c: Candidate) => paletteKeySet.has(`${c.species.speciesCode}:${c.type}`);
  const isStruggling = (c: Candidate) => strugglingKeySet.has(`${c.species.speciesCode}:${c.type}`);
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
