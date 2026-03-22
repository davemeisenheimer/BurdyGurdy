/**
 * Pure functions for building quiz candidate pools and guaranteeing
 * the minimum ratio of recent-unmastered questions.
 *
 * Extracted from routes/quiz.ts so they can be unit-tested independently.
 */

import type { QuestionType } from '../routes/quiz';

export interface PoolSpecies {
  speciesCode: string;
  comName: string;
  sciName: string;
  tax: { familySciName: string; familyComName: string; order: string } | undefined;
}

export interface Candidate {
  species: PoolSpecies;
  type: QuestionType;
  weight: number;
}

const NON_RECENT_MULTIPLIER = 0.05;
const NEW_ENCOUNTER_WEIGHT  = 20;
const MASTERED_FLOOR_WEIGHT = 3;

/**
 * Builds the weighted candidate list for question selection.
 *
 * Three tiers (adaptive mode only):
 *  1. Recent window birds — always candidates.
 *     - New encounters (not in weightsMap): weight = NEW_ENCOUNTER_WEIGHT
 *     - Unmastered (w ≥ 5): weight = w
 *     - Mastered (w < 5): weight = max(w, MASTERED_FLOOR_WEIGHT)
 *  2. Non-recent birds in weightsMap — heavily discounted (× NON_RECENT_MULTIPLIER).
 *  3. Non-recent birds not in weightsMap — excluded.
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
        weight = NEW_ENCOUNTER_WEIGHT;
      } else {
        weight = Math.max(w, MASTERED_FLOOR_WEIGHT);
      }
      candidates.push({ species, type: t, weight });
    }
  }

  // Pass 2: Non-recent palette birds (long-term retention, rarely asked)
  // Exception: level-0 question-type keys keep their full learning weight even
  // outside the recent window — active learning trumps the observation window.
  if (adaptiveMode) {
    for (const species of filteredPool) {
      if (recentCodes.has(species.speciesCode)) continue;
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
 * total    = recentUnmasteredMin  (≈ 67% of count)
 * ruFloor  = ceil(total / 2)      — minimum unmastered
 * smFloor  = total − ruFloor      — minimum struggling-mastered
 *
 * Each bucket backfills for the other's shortfall, then regular mastered
 * birds fill any remaining slots. Shuffles the final result.
 */
export function applyRecentUnmasteredGuarantee<T extends { speciesCode: string; type: string }>(
  allValid: T[],
  recentCodes: Set<string>,
  weightsMap: Record<string, number>,
  count: number,
  recentUnmasteredMin: number,
  level0Keys: Set<string> = new Set(),
  historyKeySet: Set<string> = new Set(),
): T[] {
  const key = (q: T) => `${q.speciesCode}:${q.type}`;
  const w   = (q: T) => weightsMap[key(q)] ?? NEW_ENCOUNTER_WEIGHT;

  const needsPractice = (q: T) =>
    (recentCodes.has(q.speciesCode) && w(q) >= 5) || level0Keys.has(key(q));

  // Unmastered: needs practice AND not yet graduated
  const isUnmastered = (q: T) => needsPractice(q) && !historyKeySet.has(key(q));
  // Struggling mastered: needs practice AND already graduated
  const isStruggling = (q: T) => needsPractice(q) &&  historyKeySet.has(key(q));

  const ruValid    = allValid.filter(isUnmastered);
  const smValid    = allValid.filter(isStruggling);
  const otherValid = allValid.filter(q => !needsPractice(q));

  const total   = recentUnmasteredMin;
  const ruFloor = Math.ceil(total / 2);
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
