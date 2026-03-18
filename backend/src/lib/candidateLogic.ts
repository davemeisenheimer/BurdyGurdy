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
  level0Codes: Set<string> = new Set(),
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
  // Exception: level 0 birds keep their full learning weight even outside the
  // recent window — active learning trumps the observation window.
  if (adaptiveMode) {
    for (const species of filteredPool) {
      if (recentCodes.has(species.speciesCode)) continue;
      for (const t of types) {
        const key = `${species.speciesCode}:${t}`;
        const w = weightsMap[key];
        if (w === undefined) continue;
        const weight = level0Codes.has(species.speciesCode)
          ? Math.max(w, NEW_ENCOUNTER_WEIGHT)          // level 0: keep full palette weight
          : Math.max(w * NON_RECENT_MULTIPLIER, 0.001); // others: heavy discount
        candidates.push({ species, type: t, weight });
      }
    }
  }

  return candidates;
}

/**
 * Splits validated questions into recent-unmastered and other buckets,
 * guaranteeing at least `recentUnmasteredMin` questions from the first bucket.
 * Shuffles the final result.
 */
export function applyRecentUnmasteredGuarantee<T extends { speciesCode: string; type: string }>(
  allValid: T[],
  recentCodes: Set<string>,
  weightsMap: Record<string, number>,
  count: number,
  recentUnmasteredMin: number,
  level0Codes: Set<string> = new Set(),
): T[] {
  // Guaranteed bucket: recent-window unmastered birds OR level-0 birds from anywhere.
  // Level 0 birds are actively being learned and must appear regardless of the
  // observation window, preserving the learning progression guarantee.
  const isRecentUnmastered = (q: T) =>
    (recentCodes.has(q.speciesCode) && (weightsMap[`${q.speciesCode}:${q.type}`] ?? NEW_ENCOUNTER_WEIGHT) >= 5) ||
    level0Codes.has(q.speciesCode);

  const ruValid    = allValid.filter(q => isRecentUnmastered(q));
  const otherValid = allValid.filter(q => !isRecentUnmastered(q));

  const ruTake    = Math.min(ruValid.length, recentUnmasteredMin);
  const otherTake = count - ruTake;

  const result = [
    ...ruValid.slice(0, ruTake),
    ...otherValid.slice(0, otherTake),
  ];

  // Backfill from RU surplus if the other pool was short
  if (result.length < count) {
    result.push(...ruValid.slice(ruTake, ruTake + (count - result.length)));
  }

  return result.sort(() => Math.random() - 0.5).slice(0, count);
}
