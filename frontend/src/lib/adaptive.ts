import { MASTERY_ADVANCE_STREAK, GRADUATION_STREAK } from './mastery';
import type { QuestionType, LevelUpEvent, NoLongerStrugglingEvent } from '../types';
import { isStrugglingByWindow, isNonMasteredStruggling, STRUGGLING_WINDOW } from './struggling';

// ── Learning palette size limits ──────────────────────────────────────────────

export const MAX_LEVEL_0_SIZE_FIRST  = 6;
export const MAX_LEVEL_0_SIZE_SECOND = 8;
export const MAX_LEVEL_0_SIZE_THIRD  = 10;
export const MAX_LEVEL_0_SIZE        = 12;

// ── Internal weight constants ─────────────────────────────────────────────────

/** Weight for birds actively in the learning palette (levels 0, 1, 2). */
export const PALETTE_WEIGHT = 20.0;
/** Weight for mastered birds that are no longer in the learning palette. */
export const HISTORY_WEIGHT = 1.0;

// ── Weight calculation ────────────────────────────────────────────────────────

/** Weight multiplier applied to non-mastered birds that are struggling by all-time accuracy. */
export const NON_MASTERED_STRUGGLE_BOOST = 1.5;

/**
 * Returns the quiz selection weight for a bird based on its current state.
 * Higher weight = more likely to appear as a question.
 *
 * Rules:
 *   - Favourited birds always get full palette weight regardless of history status.
 *   - Mastered (history) birds struggling by rolling window get pulled back to palette weight.
 *   - Mastered birds that are fine get low history weight (rare review appearances).
 *   - Non-mastered birds struggling by all-time accuracy get a 1.5× palette weight boost.
 *   - Non-mastered birds that are fine get standard palette weight.
 *
 * Two distinct "struggling" concepts are in play here — see struggling.ts for details:
 *   - isStrugglingByWindow()     — mastered birds, rolling recent-answers window
 *   - isNonMasteredStruggling()  — active-palette birds, all-time accuracy
 */
export function calcWeight(
  isMastered: boolean,
  favourited: boolean,
  recentAnswers?: boolean[],
  correct = 0,
  incorrect = 0,
): number {
  if (favourited) return PALETTE_WEIGHT;
  if (isMastered) {
    return isStrugglingByWindow(recentAnswers ?? []) ? PALETTE_WEIGHT : HISTORY_WEIGHT;
  }
  // Active palette (non-mastered): boost weight if struggling by all-time accuracy.
  return isNonMasteredStruggling(correct, incorrect)
    ? PALETTE_WEIGHT * NON_MASTERED_STRUGGLE_BOOST
    : PALETTE_WEIGHT;
}

// ── Interfaces ────────────────────────────────────────────────────────────────

/** The fields from an existing progress record needed to compute the next state. */
export interface ExistingProgressState {
  correct: number;
  incorrect: number;
  masteryLevel: number;
  consecutiveCorrect: number;
  isMastered?: boolean;      // optional to match BirdProgress — treated as false when absent
  favourited: boolean;
  recentAnswers?: boolean[]; // rolling window for mastered birds
}

export interface RecordAnswerResult {
  advancedFromLevel0: boolean;
  levelUp: LevelUpEvent | null;
  /** Set when a mastered bird's rolling window crosses back to ≥ 80% correct. */
  noLongerStruggling: NoLongerStrugglingEvent | null;
  updatedMastery: {
    masteryLevel: number;
    consecutiveCorrect: number;
    isMastered: boolean;
    correct: number;
    incorrect: number;
  };
}

export interface AdaptiveParams {
  weights: Record<string, number>;
  masteryLevels: Record<string, number>;
  banned: string[];
  paletteSpeciesCodes: string[];
  level0Keys: string[];    // "speciesCode:questionType" keys where masteryLevel===0 and !isMastered
  historyKeys: string[];   // "speciesCode:questionType" keys where isMastered===true
}

// ── Pure mastery progression ──────────────────────────────────────────────────

/**
 * Given the current progress state for a species+questionType (or null for a
 * first encounter) and whether the answer was correct, returns the new state
 * that should be persisted, along with any level-up events.
 *
 * This is a pure function — it reads no database and has no side effects.
 * The caller is responsible for writing the returned newState to the DB.
 */
export function applyAnswer(
  existing: ExistingProgressState | null,
  answeredCorrect: boolean,
  speciesCode: string,
  comName: string,
  questionType: QuestionType,
): RecordAnswerResult & { newState: ExistingProgressState & { weight: number } } {
  // ── First encounter ───────────────────────────────────────────────────────
  if (!existing) {
    const correct   = answeredCorrect ? 1 : 0;
    const incorrect = answeredCorrect ? 0 : 1;
    const streak    = answeredCorrect ? 1 : 0;
    return {
      newState:           { correct, incorrect, masteryLevel: 0, consecutiveCorrect: streak, isMastered: false, weight: PALETTE_WEIGHT, favourited: false },
      advancedFromLevel0: false,
      levelUp:            null,
      noLongerStruggling: null,
      updatedMastery:     { masteryLevel: 0, consecutiveCorrect: streak, isMastered: false, correct, incorrect },
    };
  }

  // ── Subsequent encounter ──────────────────────────────────────────────────
  const newCorrect   = existing.correct   + (answeredCorrect ? 1 : 0);
  const newIncorrect = existing.incorrect + (answeredCorrect ? 0 : 1);
  const prevMastery  = existing.masteryLevel   ?? 0;
  let   newMastery   = prevMastery;
  let   newStreak    = existing.consecutiveCorrect ?? 0;
  let   newInHistory = existing.isMastered ?? false;
  let   advancedFromLevel0            = false;
  let   levelUp: LevelUpEvent | null  = null;
  let   noLongerStruggling: NoLongerStrugglingEvent | null = null;

  // ── Rolling window (mastered birds only) ──────────────────────────────────
  // Maintained before graduation check so it reflects the current answer.
  let newRecentAnswers: boolean[] | undefined = existing.recentAnswers;
  if (newInHistory) {
    const updated = [...(existing.recentAnswers ?? []), answeredCorrect];
    newRecentAnswers = updated.length > STRUGGLING_WINDOW ? updated.slice(-STRUGGLING_WINDOW) : updated;
  }

  // Capture struggling state BEFORE this answer to detect a recovery crossing.
  const wasStruggling = newInHistory && isStrugglingByWindow(existing.recentAnswers ?? []);

  if (answeredCorrect) {
    newStreak++;
    if (newMastery < 2 && newStreak >= MASTERY_ADVANCE_STREAK) {
      newMastery++;
      newStreak = 0;
      if (prevMastery === 0 && newMastery === 1) advancedFromLevel0 = true;
      levelUp = { speciesCode, comName, questionType, newLevel: newMastery, graduated: false };
    } else if (newMastery >= 2 && newStreak >= GRADUATION_STREAK && !newInHistory) {
      // Graduation: seed recentAnswers with 10/10 (clean slate — not yet struggling).
      newInHistory     = true;
      newRecentAnswers = Array(STRUGGLING_WINDOW).fill(true) as boolean[];
      levelUp = { speciesCode, comName, questionType, newLevel: 3, graduated: true };
    }
  } else {
    newStreak = 0;
  }

  // noLongerStruggling fires when the window crosses from struggling to not struggling.
  // Not fired at graduation (graduation always seeds a clean window).
  if (newInHistory && !(levelUp?.graduated) && wasStruggling && !isStrugglingByWindow(newRecentAnswers ?? [])) {
    const recentCorrect = (newRecentAnswers ?? []).filter(Boolean).length;
    noLongerStruggling = { speciesCode, comName, questionType, recentCorrect };
  }

  const weight = calcWeight(newInHistory, existing.favourited ?? false, newRecentAnswers, newCorrect, newIncorrect);

  // When a level just advanced (but not graduated), show the completed level at
  // its threshold rather than the new level at 0 — e.g. "3/3 Easy" not "0/3 Medium".
  const updatedMastery = (levelUp && !levelUp.graduated)
    ? { masteryLevel: prevMastery, consecutiveCorrect: MASTERY_ADVANCE_STREAK, isMastered: false,        correct: newCorrect, incorrect: newIncorrect }
    : { masteryLevel: newMastery,  consecutiveCorrect: newStreak,              isMastered: newInHistory,  correct: newCorrect, incorrect: newIncorrect };

  return {
    newState: { correct: newCorrect, incorrect: newIncorrect, masteryLevel: newMastery, consecutiveCorrect: newStreak, isMastered: newInHistory, weight, favourited: existing.favourited ?? false, recentAnswers: newRecentAnswers },
    advancedFromLevel0,
    levelUp,
    noLongerStruggling,
    updatedMastery,
  };
}
