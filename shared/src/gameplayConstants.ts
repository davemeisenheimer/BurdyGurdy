/**
 * BirdyGurdy Gameplay Constants
 * ==============================
 * Single source of truth for every numeric value that shapes quiz behaviour.
 * Changing a value here affects both the frontend (adaptive.ts, mastery.ts,
 * struggling.ts, progress.ts) and the backend (candidateLogic.ts, quiz.ts).
 *
 * Constants are grouped by the subsystem they govern.  Read the sections in
 * order for a top-to-bottom understanding of the algorithm.
 */

// ─────────────────────────────────────────────────────────────────────────────
// LEARNING PALETTE - how many birds are in active rotation at once
// ─────────────────────────────────────────────────────────────────────────────
//
// The "palette" is the set of unmastered birds the quiz is currently teaching.
// New birds are added gradually so the user isn't overwhelmed.  The target
// palette size grows as the user masters more birds, rewarding progress with
// broader variety.
//
// Tier breakpoints (number of birds the user has fully mastered):
//   0 mastered  → target palette size MAX_LEVEL_0_SIZE_FIRST
//   1–6         → MAX_LEVEL_0_SIZE_SECOND
//   7–12        → MAX_LEVEL_0_SIZE_THIRD
//   13+         → MAX_LEVEL_0_SIZE  (the ceiling)

/** Target palette size when the user has mastered 0 birds. */
export const MAX_LEVEL_0_SIZE_FIRST  = 8;
/** Target palette size when the user has mastered 1–6 birds. */
export const MAX_LEVEL_0_SIZE_SECOND = 10;
/** Target palette size when the user has mastered 7–12 birds. */
export const MAX_LEVEL_0_SIZE_THIRD  = 11;
/** Maximum palette size (reached after mastering 13+ birds). */
export const MAX_LEVEL_0_SIZE        = 12;

// ─────────────────────────────────────────────────────────────────────────────
// MASTERY PROGRESSION - streaks required to advance through levels
// ─────────────────────────────────────────────────────────────────────────────
//
// Each bird×questionType combination progresses through three levels (Easy →
// Medium → Hard) before graduating to "Mastered".  Advancing a level requires
// a streak of consecutive correct answers; wrong answers reset the streak to 0.
//
//   Level 0 (Easy)   --[MASTERY_ADVANCE_STREAK correct]--> Level 1 (Medium)
//   Level 1 (Medium) --[MASTERY_ADVANCE_STREAK correct]--> Level 2 (Hard)
//   Level 2 (Hard)   --[GRADUATION_STREAK correct]-------> Mastered ✓
//
// Lower values make progression faster and may feel rewarding but risk false
// confidence.  Higher values enforce more practice per level.

/** Consecutive-correct streak required to advance from Level 0→1 or Level 1→2. */
export const MASTERY_ADVANCE_STREAK = 3;

/**
 * Consecutive-correct streak required to graduate from Level 2 to Mastered.
 * Intentionally higher than MASTERY_ADVANCE_STREAK - the final step demands
 * more sustained accuracy before a bird is considered learned.
 */
export const GRADUATION_STREAK = 5;

// ─────────────────────────────────────────────────────────────────────────────
// STRUGGLING DETECTION - identifying birds that need extra attention
// ─────────────────────────────────────────────────────────────────────────────
//
// Two independent "struggling" concepts are in play:
//
//   1. MASTERED birds (isStrugglingByWindow):
//      Tracks a rolling window of the most recent STRUGGLING_WINDOW answers.
//      A mastered bird is "struggling" when fewer than STRUGGLING_MIN_CORRECT
//      of those answers were correct.  The window is only evaluated once full,
//      so a recently-mastered bird is never immediately flagged.
//
//   2. ACTIVE-PALETTE birds (isNonMasteredStruggling):
//      Uses all-time accuracy (correct / total) against the same threshold.
//      No window needed because these birds have not yet graduated.
//
// Both use the same 80% accuracy threshold so the user experience is consistent.

/** Number of recent answers tracked in the rolling accuracy window for mastered birds. */
export const STRUGGLING_WINDOW = 10;

/**
 * Minimum correct answers required within the window to be "not struggling".
 * Fewer than this many correct → the bird is flagged as struggling.
 * Derived threshold: STRUGGLING_MIN_CORRECT / STRUGGLING_WINDOW = 0.80 (80%).
 */
export const STRUGGLING_MIN_CORRECT = 8;

// ─────────────────────────────────────────────────────────────────────────────
// QUIZ SELECTION WEIGHTS - how likely each bird is to appear as a question
// ─────────────────────────────────────────────────────────────────────────────
//
// Every bird×questionType pair carries a numeric weight.  At question-pick
// time, weighted random sampling is used so birds with higher weights appear
// more often.
//
// Weight hierarchy (highest → rarest):
//
//   Struggling non-mastered (palette × boost)      30.0   ← most urgent
//   Active palette (unmastered, levels 0/1/2)       20.0
//   Mastered-but-struggling (window accuracy < 80%)  20.0  ← back to palette
//   Mastered non-struggling - recent sighting floor   3.0
//   Mastered non-struggling - no recent sighting       1.0  ← rare review
//
// Birds with no weight record (first encounter) are treated as NEW_ENCOUNTER_WEIGHT.

/** Base weight for active-palette (unmastered) birds. */
export const PALETTE_WEIGHT = 20.0;

/** Weight for mastered birds not currently struggling.  Low so they appear only
 *  occasionally for review rather than dominating the quiz. */
export const HISTORY_WEIGHT = 1.0;

/**
 * Multiplier applied on top of PALETTE_WEIGHT for non-mastered birds whose
 * all-time accuracy falls below the struggling threshold.
 * Effective weight: PALETTE_WEIGHT × NON_MASTERED_STRUGGLE_BOOST = 30.
 */
export const NON_MASTERED_STRUGGLE_BOOST = 1.5;

/**
 * Weight assigned to a bird the user has never seen before (no progress record).
 * Intentionally equal to PALETTE_WEIGHT so new birds compete fairly with other
 * active-palette birds on their first appearance.
 */
export const NEW_ENCOUNTER_WEIGHT = 20;

/**
 * Discount multiplier applied to non-recent birds in the weightsMap.
 * A bird outside the current sightings window gets weight × 0.05, keeping it
 * accessible (it won't vanish completely) while strongly preferring birds the
 * user might actually encounter in the field.
 */
export const NON_RECENT_MULTIPLIER = 0.05;

/**
 * Minimum weight floor applied to mastered birds that ARE in the recent window.
 * Prevents a mastered bird with a very low stored weight from becoming invisible
 * even when it has been recently sighted.
 */
export const MASTERED_FLOOR_WEIGHT = 3;

/**
 * Weight boundary that separates "active palette" from "history-only" when
 * classifying candidates for the question-mix guarantee.
 * weight ≥ ACTIVE_PALETTE_MIN_WEIGHT → bird is being actively learned.
 * weight <  ACTIVE_PALETTE_MIN_WEIGHT → bird is mastered and in review-only mode.
 */
export const ACTIVE_PALETTE_MIN_WEIGHT = 5;

// ─────────────────────────────────────────────────────────────────────────────
// QUESTION MIX GUARANTEE - ensuring enough "needs practice" questions per round
// ─────────────────────────────────────────────────────────────────────────────
//
// Without a guarantee, a user who has mastered many birds could get a round
// dominated by easy review questions.  The guarantee reserves a minimum
// fraction of each round for birds that genuinely need practice.
//
// "Needs practice" = unmastered active-palette birds + mastered-but-struggling.
// These are split roughly evenly to prevent one group from crowding out the other.
//
// Example with 10 questions:
//   recentUnmasteredMin = ceil(10 × 0.67) = 7
//   ruFloor (unmastered) = ceil(7 / 2)    = 4
//   smFloor (struggling)  = 7 − 4          = 3
//   Remaining 3 slots → any valid candidate (often mastered review)

/**
 * Minimum fraction of each round reserved for "needs practice" candidates.
 * Applied as: Math.ceil(questionsPerRound × RECENT_UNMASTERED_RATIO).
 */
export const RECENT_UNMASTERED_RATIO = 0.67;

/**
 * Within the guaranteed "needs practice" block, how the slots are split between
 * truly-unmastered and struggling-mastered candidates.
 * 0.5 = equal split (each group gets half, with unmastered rounding up on odd).
 * Adjust toward 0 to favour review of struggling-mastered birds;
 * toward 1 to prioritise birds not yet learned at all.
 */
export const UNMASTERED_FLOOR_RATIO = 0.5;

// ─────────────────────────────────────────────────────────────────────────────
// DISTRACTOR SELECTION - choosing wrong-answer options
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How many wrong options to show alongside the correct answer.
 * Total choices per question = DISTRACTOR_COUNT + 1.
 */
export const DISTRACTOR_COUNT = 3;

/**
 * Multiplier making palette (actively-learned) birds more likely to appear as
 * distractors.  This keeps wrong options familiar and reinforces discrimination
 * between birds the user is currently learning.
 * Value of 10 means a palette bird is 10× more likely to be chosen as a
 * distractor than a non-palette bird of equal weight.
 */
export const PALETTE_DISTRACTOR_WEIGHT = 10;

/**
 * Maximum allowed difference in taxonomic size class between the correct bird
 * and any distractor for photo questions.  Size classes run 1 (tiny) → 5
 * (very large).  A tolerance of 1 means distractors must be within one size
 * class of the target, preventing obviously mismatched pairings (e.g. a
 * hummingbird as a wrong answer for an eagle).
 */
export const DISTRACTOR_SIZE_CLASS_TOLERANCE = 1;

// ─────────────────────────────────────────────────────────────────────────────
// MASTERY EXPIRY - resetting mastered birds after prolonged inactivity
// ─────────────────────────────────────────────────────────────────────────────
//
// A bird mastered long ago and never encountered again may be forgotten.
// When the user hasn't played a particular bird for EXPIRY_DAYS, its mastered
// status resets to Level 2 (Hard) so it re-enters the active learning loop.
// This is opt-in and controlled by the "Expire mastered birds" setting.

/** Days of inactivity before a mastered bird's status resets to Level 2. */
export const EXPIRY_DAYS = 90;

// ─────────────────────────────────────────────────────────────────────────────
// INFRASTRUCTURE CONSTANTS - not gameplay tuning but documented here for
// completeness
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Xeno-canto audio-fetch batch size.  When pre-loading recordings for a quiz
 * round, requests are issued in groups of this size to avoid hammering the
 * xeno-canto API with 40+ simultaneous requests.
 * Not a gameplay tuning knob - change only if xeno-canto rate-limits the app.
 */
export const XC_FETCH_BATCH_SIZE = 6;
