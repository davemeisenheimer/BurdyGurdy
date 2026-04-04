import type { BirdProgress, QuestionType } from '../types';
import { STRUGGLING_WINDOW, STRUGGLING_MIN_CORRECT } from '@birdygurdy/shared';

export { STRUGGLING_WINDOW, STRUGGLING_MIN_CORRECT };

/** Derived accuracy threshold (80%) — for use in non-mastered struggling check. */
export const STRUGGLING_THRESHOLD = STRUGGLING_MIN_CORRECT / STRUGGLING_WINDOW;

/**
 * Returns true when a mastered bird's rolling recent-answers window shows
 * fewer than STRUGGLING_MIN_CORRECT correct answers.
 * Returns false when the window is not yet full (bird hasn't been asked
 * enough times at the mastered level to make a confident judgment).
 */
export function isStrugglingByWindow(recentAnswers: boolean[]): boolean {
  if (recentAnswers.length < STRUGGLING_WINDOW) return false;
  return recentAnswers.filter(Boolean).length < STRUGGLING_MIN_CORRECT;
}

/**
 * Returns true when an active-palette (non-mastered) bird's all-time accuracy
 * falls below the struggling threshold.
 *
 * This is the non-mastered counterpart to isStrugglingByWindow(). It uses the
 * same 80% threshold but operates on all-time correct/incorrect counts rather
 * than a rolling window, because non-mastered birds have not yet accumulated
 * a recentAnswers window.
 *
 * Used to apply a 1.5× weight boost so the user sees the bird more often while
 * they are still learning it.
 */
export function isNonMasteredStruggling(correct: number, incorrect: number): boolean {
  const total = correct + incorrect;
  return total > 0 && correct / total < STRUGGLING_THRESHOLD;
}

/**
 * Given a flat list of all progress records and the currently active question
 * types, returns the number of distinct species the user is struggling with.
 *
 * Only mastered (isMastered=true) birds with a full recent-answers window
 * and fewer than STRUGGLING_MIN_CORRECT correct answers are counted.
 * Excluded species are never counted.
 */
export function computeStrugglingCount(
  records: BirdProgress[],
  expandedTypes: QuestionType[],
): number {
  const struggling = new Set<string>();
  for (const r of records) {
    if (!expandedTypes.includes(r.questionType) || r.excluded) continue;
    if (!(r.isMastered ?? false)) continue;
    if (isStrugglingByWindow(r.recentAnswers ?? [])) struggling.add(r.speciesCode);
  }
  return struggling.size;
}
