/**
 * Pure functions for categorising recent-window birds by mastery status.
 * Extracted for unit testability — no browser or React dependencies.
 */

import type { CachedSpecies, BirdProgress, QuestionType } from '../types';

export type RecentProgressCategory = 'notAsked' | 'easy' | 'medium' | 'hard' | 'mastered';

export interface RecentBirdEntry {
  speciesCode: string;
  comName: string;
  sciName: string;
  category: RecentProgressCategory;
  /**
   * Only meaningful when category === 'notAsked'.
   * true  = the bird has been seeded into the palette (lastAsked=0 record exists)
   *         but has never appeared as a question.
   * false = the bird has never been seeded at all — completely unseen.
   */
  isSeeded: boolean;
  /** Asked progress records for this bird (empty for notAsked birds). */
  records: BirdProgress[];
}

/**
 * Classifies every non-historical species in `recentSpecies` into one of five
 * categories based on the player's progress records and the active question types.
 *
 * Categories:
 *   notAsked — no record exists, or every record has lastAsked=0 (seeded, never asked)
 *   easy     — at least one asked record; highest active mastery level = 0
 *   medium   — highest active mastery level = 1
 *   hard     — highest active mastery level = 2 (not yet graduated)
 *   mastered — every questionType is graduated (inHistory=true) for this species
 */
export function categoriseRecentBirds(
  recentSpecies: CachedSpecies[],
  progressRecords: BirdProgress[],
  questionTypes: QuestionType[],
): RecentBirdEntry[] {
  const progressBySpecies = new Map<string, BirdProgress[]>();
  for (const r of progressRecords) {
    const list = progressBySpecies.get(r.speciesCode) ?? [];
    list.push(r);
    progressBySpecies.set(r.speciesCode, list);
  }

  return recentSpecies
    .filter(s => !s.isHistorical)
    .map(s => {
      const allRecords  = progressBySpecies.get(s.speciesCode) ?? [];
      const askedRecords = allRecords.filter(
        r => r.lastAsked > 0 && questionTypes.includes(r.questionType),
      );

      if (askedRecords.length === 0) {
        return {
          speciesCode: s.speciesCode,
          comName:     s.comName,
          sciName:     s.sciName,
          category:    'notAsked' as const,
          isSeeded:    allRecords.some(r => r.lastAsked === 0),
          records:     [],
        };
      }

      // A bird is fully mastered when every active question type has graduated.
      const allGraduated = questionTypes.every(
        t => allRecords.find(r => r.questionType === t)?.inHistory === true,
      );
      if (allGraduated) {
        return {
          speciesCode: s.speciesCode,
          comName:     s.comName,
          sciName:     s.sciName,
          category:    'mastered' as const,
          isSeeded:    false,
          records:     askedRecords,
        };
      }

      const activeRecords = askedRecords.filter(r => !r.inHistory);
      const maxLevel      = Math.max(...activeRecords.map(r => r.masteryLevel ?? 0));
      const category: RecentProgressCategory =
        maxLevel >= 2 ? 'hard' : maxLevel === 1 ? 'medium' : 'easy';

      return {
        speciesCode: s.speciesCode,
        comName:     s.comName,
        sciName:     s.sciName,
        category,
        isSeeded:    false,
        records:     askedRecords,
      };
    });
}

/** Returns counts per category for a classified list. */
export function summariseCounts(entries: RecentBirdEntry[]): Record<RecentProgressCategory, number> {
  const counts: Record<RecentProgressCategory, number> = {
    notAsked: 0, easy: 0, medium: 0, hard: 0, mastered: 0,
  };
  for (const e of entries) counts[e.category]++;
  return counts;
}
