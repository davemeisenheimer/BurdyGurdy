import { describe, it, expect } from 'vitest';
import { calcWeight, applyAnswer, PALETTE_WEIGHT, HISTORY_WEIGHT, NON_MASTERED_STRUGGLE_BOOST } from './adaptive';
import { STRUGGLING_WINDOW, STRUGGLING_MIN_CORRECT } from './struggling';
import type { ExistingProgressState } from './adaptive';

// ── Helpers ───────────────────────────────────────────────────────────────────

// Builds a minimal existing progress record.  Defaults represent a bird that
// has been seen a few times with decent accuracy and is not special in any way.
function makeExisting(overrides: Partial<ExistingProgressState> = {}): ExistingProgressState {
  return {
    correct:            5,
    incorrect:          0,
    masteryLevel:       0,
    consecutiveCorrect: 2,
    isMastered:          false,
    favourited:         false,
    ...overrides,
  };
}

/** A full 10-answer window with the given number of correct answers (Fs first, Ts last). */
function makeWindow(correct: number): boolean[] {
  return [...Array(STRUGGLING_WINDOW - correct).fill(false), ...Array(correct).fill(true)];
}

// ── calcWeight ────────────────────────────────────────────────────────────────

describe('calcWeight', () => {

  it('returns palette weight for a favourited bird regardless of any other state', () => {
    // Favourited birds should always be included at full palette weight so the
    // user is guaranteed to keep seeing them, no matter how well they know them.
    expect(calcWeight(false, true, undefined)).toBe(PALETTE_WEIGHT);
    expect(calcWeight(true,  true, Array(10).fill(true) as boolean[])).toBe(PALETTE_WEIGHT);
    expect(calcWeight(true,  true, makeWindow(6))).toBe(PALETTE_WEIGHT); // struggling too
  });

  it('returns palette weight for a non-mastered bird with good all-time accuracy', () => {
    expect(calcWeight(false, false, undefined, 10, 0)).toBe(PALETTE_WEIGHT);  // 100%
    expect(calcWeight(false, false, undefined, 0, 0)).toBe(PALETTE_WEIGHT);   // no attempts yet
  });

  it('returns 1.5× palette weight for a non-mastered bird struggling by all-time accuracy', () => {
    // Below 80% all-time → non-mastered struggle boost so the bird appears more often.
    const expected = PALETTE_WEIGHT * NON_MASTERED_STRUGGLE_BOOST;
    expect(calcWeight(false, false, undefined, 0, 10)).toBe(expected); // 0% accuracy
    expect(calcWeight(false, false, undefined, 7, 3)).toBe(expected);  // 70% accuracy
  });

  it('does not apply the non-mastered boost to mastered birds (they use the rolling window instead)', () => {
    // Even if a mastered bird had terrible all-time accuracy, the boost path is
    // not taken — the rolling window drives mastered weight.
    expect(calcWeight(true, false, Array(10).fill(true) as boolean[], 0, 100)).toBe(HISTORY_WEIGHT);
  });

  it('returns low history weight for a mastered bird with a good recent window', () => {
    // Mastered birds (isMastered) appear only occasionally for review.  Good
    // accuracy means no reason to pull them back into active learning.
    expect(calcWeight(true, false, makeWindow(STRUGGLING_MIN_CORRECT))).toBe(HISTORY_WEIGHT); // exactly at threshold
    expect(calcWeight(true, false, Array(10).fill(true) as boolean[])).toBe(HISTORY_WEIGHT);  // perfect
  });

  it('returns full palette weight for a mastered bird that is struggling', () => {
    // A mastered bird with fewer than STRUGGLING_MIN_CORRECT in the window gets
    // pulled back to palette weight so it re-enters active rotation.
    expect(calcWeight(true, false, makeWindow(STRUGGLING_MIN_CORRECT - 1))).toBe(PALETTE_WEIGHT); // 7/10
    expect(calcWeight(true, false, makeWindow(0))).toBe(PALETTE_WEIGHT);  // all wrong
  });

  it('returns low history weight when the window is not yet full (not enough data to call struggling)', () => {
    // A mastered bird with a short window (< STRUGGLING_WINDOW) is not considered
    // struggling — not enough data — so it stays at history weight.
    expect(calcWeight(true, false, [true, false, false])).toBe(HISTORY_WEIGHT);
    expect(calcWeight(true, false, [])).toBe(HISTORY_WEIGHT);
    expect(calcWeight(true, false, undefined)).toBe(HISTORY_WEIGHT);
  });

});

// ── applyAnswer ───────────────────────────────────────────────────────────────

describe('applyAnswer', () => {

  // ── First encounter ─────────────────────────────────────────────────────────

  it('creates correct initial state for a first correct answer', () => {
    // A brand-new bird answered correctly starts with 1 correct, 0 incorrect,
    // streak of 1, mastery level 0, and standard palette weight.
    const result = applyAnswer(null, true, 'amero', 'American Robin', 'song');
    expect(result.newState.correct).toBe(1);
    expect(result.newState.incorrect).toBe(0);
    expect(result.newState.consecutiveCorrect).toBe(1);
    expect(result.newState.masteryLevel).toBe(0);
    expect(result.newState.weight).toBe(PALETTE_WEIGHT);
    expect(result.advancedFromLevel0).toBe(false);
    expect(result.levelUp).toBeNull();
  });

  it('creates correct initial state for a first wrong answer', () => {
    // A brand-new bird answered incorrectly starts with 0 correct, 1 incorrect,
    // streak of 0, and still gets palette weight.
    const result = applyAnswer(null, false, 'amero', 'American Robin', 'song');
    expect(result.newState.correct).toBe(0);
    expect(result.newState.incorrect).toBe(1);
    expect(result.newState.consecutiveCorrect).toBe(0);
    expect(result.newState.weight).toBe(PALETTE_WEIGHT);
    expect(result.advancedFromLevel0).toBe(false);
    expect(result.levelUp).toBeNull();
  });

  // ── Streak and wrong-answer reset ────────────────────────────────────────────

  it('increments the streak on a correct answer', () => {
    // Each correct answer in a row should add 1 to consecutiveCorrect.
    const result = applyAnswer(makeExisting({ consecutiveCorrect: 1 }), true, 'amero', 'American Robin', 'song');
    expect(result.newState.consecutiveCorrect).toBe(2);
  });

  it('resets the streak to 0 on a wrong answer', () => {
    // Any incorrect answer breaks the streak back to zero regardless of how
    // long it was — the user must rebuild from scratch.
    const result = applyAnswer(makeExisting({ consecutiveCorrect: 2 }), false, 'amero', 'American Robin', 'song');
    expect(result.newState.consecutiveCorrect).toBe(0);
  });

  // ── Level advancement ────────────────────────────────────────────────────────

  it('advances from level 0 to level 1 after MASTERY_ADVANCE_STREAK correct answers in a row', () => {
    // Reaching the streak threshold at level 0 should push the bird to level 1
    // and set advancedFromLevel0 = true so the caller can promote a new bird.
    const existing = makeExisting({ masteryLevel: 0, consecutiveCorrect: 2 }); // one away from threshold
    const result   = applyAnswer(existing, true, 'amero', 'American Robin', 'song');
    expect(result.newState.masteryLevel).toBe(1);
    expect(result.newState.consecutiveCorrect).toBe(0); // streak resets after advancing
    expect(result.advancedFromLevel0).toBe(true);
    expect(result.levelUp).not.toBeNull();
    expect(result.levelUp?.graduated).toBe(false);
  });

  it('advances from level 1 to level 2 without setting advancedFromLevel0', () => {
    // Level 1 → 2 advancement works the same as 0 → 1 but does NOT trigger
    // a new-bird promotion (advancedFromLevel0 stays false).
    const existing = makeExisting({ masteryLevel: 1, consecutiveCorrect: 2 });
    const result   = applyAnswer(existing, true, 'amero', 'American Robin', 'song');
    expect(result.newState.masteryLevel).toBe(2);
    expect(result.advancedFromLevel0).toBe(false);
    expect(result.levelUp?.graduated).toBe(false);
  });

  it('does not advance level if the streak threshold has not been reached', () => {
    // A correct answer that brings the streak to 1 (below the 3-answer threshold)
    // should not advance the level.
    const existing = makeExisting({ masteryLevel: 0, consecutiveCorrect: 0 });
    const result   = applyAnswer(existing, true, 'amero', 'American Robin', 'song');
    expect(result.newState.masteryLevel).toBe(0);
    expect(result.levelUp).toBeNull();
  });

  // ── Graduation ───────────────────────────────────────────────────────────────

  it('graduates a level-2 bird to mastered (isMastered) after the graduation streak', () => {
    // After GRADUATION_STREAK (5) consecutive correct answers at level 2, the bird
    // moves to isMastered = true and a "graduated" levelUp event is emitted.
    const existing = makeExisting({ masteryLevel: 2, consecutiveCorrect: 4 }); // one away
    const result   = applyAnswer(existing, true, 'amero', 'American Robin', 'song');
    expect(result.newState.isMastered).toBe(true);
    expect(result.levelUp?.graduated).toBe(true);
    expect(result.levelUp?.newLevel).toBe(3);
  });

  it('seeds recentAnswers with 10/10 at graduation', () => {
    // Graduation seeds a perfect rolling window so the bird cannot immediately
    // be considered struggling — 3 wrong answers at mastered level are needed first.
    const existing = makeExisting({ masteryLevel: 2, consecutiveCorrect: 4 });
    const result   = applyAnswer(existing, true, 'amero', 'American Robin', 'song');
    expect(result.newState.recentAnswers).toEqual(Array(STRUGGLING_WINDOW).fill(true));
  });

  it('does not fire noLongerStruggling at graduation (clean-slate window takes effect instead)', () => {
    // The pre-graduation window doesn't matter — graduation always seeds 10/10.
    const existing = makeExisting({ masteryLevel: 2, consecutiveCorrect: 4, correct: 2, incorrect: 10 });
    const result   = applyAnswer(existing, true, 'amero', 'American Robin', 'song');
    expect(result.levelUp?.graduated).toBe(true);
    expect(result.noLongerStruggling).toBeNull();
  });

  it('does not graduate a level-2 bird before the graduation streak is complete', () => {
    // At streak 3 out of 5, no graduation should happen yet.
    const existing = makeExisting({ masteryLevel: 2, consecutiveCorrect: 3 });
    const result   = applyAnswer(existing, true, 'amero', 'American Robin', 'song');
    expect(result.newState.isMastered).toBe(false);
    expect(result.levelUp).toBeNull();
  });

  // ── Display mastery (updatedMastery) ─────────────────────────────────────────

  it('shows the completed level at threshold when a level-up just occurred', () => {
    // When a bird just advanced from level 0 to 1, the UI should show "3/3 Easy"
    // (the completed threshold) rather than "0/3 Medium" (the new level at zero).
    // This is a display-only adjustment — newState still has the real values.
    const existing = makeExisting({ masteryLevel: 0, consecutiveCorrect: 2 });
    const result   = applyAnswer(existing, true, 'amero', 'American Robin', 'song');
    expect(result.updatedMastery.masteryLevel).toBe(0);          // old level shown
    expect(result.updatedMastery.consecutiveCorrect).toBe(3);    // at-threshold value
    expect(result.newState.masteryLevel).toBe(1);                // real new level
    expect(result.newState.consecutiveCorrect).toBe(0);          // real reset streak
  });

  it('shows the real new state when no level-up occurred', () => {
    // Without a level-up, updatedMastery should simply reflect the real newState.
    const existing = makeExisting({ masteryLevel: 0, consecutiveCorrect: 1 });
    const result   = applyAnswer(existing, true, 'amero', 'American Robin', 'song');
    expect(result.updatedMastery.masteryLevel).toBe(result.newState.masteryLevel);
    expect(result.updatedMastery.consecutiveCorrect).toBe(result.newState.consecutiveCorrect);
  });

  // ── Rolling window (mastered birds) ──────────────────────────────────────────

  it('appends answer to recentAnswers for mastered birds', () => {
    const window   = [...Array(9).fill(true)] as boolean[]; // 9 answers so far
    const existing = makeExisting({ isMastered: true, recentAnswers: window });
    const result   = applyAnswer(existing, false, 'amero', 'American Robin', 'song');
    expect(result.newState.recentAnswers).toHaveLength(10);
    expect(result.newState.recentAnswers![9]).toBe(false); // latest answer appended
  });

  it('caps recentAnswers at STRUGGLING_WINDOW by dropping the oldest entry', () => {
    const window   = Array(STRUGGLING_WINDOW).fill(true) as boolean[];
    const existing = makeExisting({ isMastered: true, recentAnswers: window });
    const result   = applyAnswer(existing, false, 'amero', 'American Robin', 'song');
    expect(result.newState.recentAnswers).toHaveLength(STRUGGLING_WINDOW);
    expect(result.newState.recentAnswers![STRUGGLING_WINDOW - 1]).toBe(false);
  });

  it('does not populate recentAnswers for non-mastered birds', () => {
    const existing = makeExisting({ isMastered: false });
    const result   = applyAnswer(existing, true, 'amero', 'American Robin', 'song');
    expect(result.newState.recentAnswers).toBeUndefined();
  });

  // ── noLongerStruggling (rolling window crossing) ─────────────────────────────

  it('fires noLongerStruggling when a mastered bird crosses from < STRUGGLING_MIN_CORRECT to ≥', () => {
    // Window was 7/10 (struggling).  One more correct makes it 8/10 (not struggling).
    const window   = makeWindow(STRUGGLING_MIN_CORRECT - 1); // 7/10, full window
    const existing = makeExisting({ isMastered: true, recentAnswers: window });
    const result   = applyAnswer(existing, true, 'amero', 'American Robin', 'song');
    expect(result.noLongerStruggling).not.toBeNull();
    expect(result.noLongerStruggling?.recentCorrect).toBe(STRUGGLING_MIN_CORRECT); // 8/10
  });

  it('reports correct recentCorrect count in noLongerStruggling event', () => {
    const window   = makeWindow(STRUGGLING_MIN_CORRECT - 1);
    const existing = makeExisting({ isMastered: true, recentAnswers: window });
    const result   = applyAnswer(existing, true, 'amero', 'American Robin', 'song');
    expect(result.noLongerStruggling?.recentCorrect).toBe(STRUGGLING_MIN_CORRECT);
  });

  it('does NOT fire noLongerStruggling when still struggling after answer', () => {
    // 6/10 → after wrong answer → 6/10 (oldest entry was true, new is false) — still struggling.
    // Simplest: bird has been struggling for many answers; one wrong doesn't help.
    const window   = makeWindow(STRUGGLING_MIN_CORRECT - 2); // 6/10, struggling
    const existing = makeExisting({ isMastered: true, recentAnswers: window });
    const result   = applyAnswer(existing, true, 'amero', 'American Robin', 'song');
    // 7/10 still < 8 → still struggling, no event
    expect(result.noLongerStruggling).toBeNull();
  });

  it('does NOT fire noLongerStruggling when window was not yet full before the answer', () => {
    // A partial window cannot be struggling (isStrugglingByWindow returns false) so
    // wasStruggling=false → no event even if the new window looks bad.
    const existing = makeExisting({ isMastered: true, recentAnswers: [false, false, false] }); // partial
    const result   = applyAnswer(existing, true, 'amero', 'American Robin', 'song');
    expect(result.noLongerStruggling).toBeNull();
  });

  it('does NOT fire noLongerStruggling for non-mastered birds', () => {
    const existing = makeExisting({ isMastered: false, correct: 1, incorrect: 9 });
    const result   = applyAnswer(existing, true, 'amero', 'American Robin', 'song');
    expect(result.noLongerStruggling).toBeNull();
  });

  it('first encounter never fires noLongerStruggling', () => {
    expect(applyAnswer(null, true,  'amero', 'American Robin', 'song').noLongerStruggling).toBeNull();
    expect(applyAnswer(null, false, 'amero', 'American Robin', 'song').noLongerStruggling).toBeNull();
  });

  // ── Counts still accumulate normally (no accuracy reset) ─────────────────────

  it('accumulated correct/incorrect counts are never reset', () => {
    // The old accuracy-reset behaviour is gone. Counts only go up.
    const existing = makeExisting({ isMastered: true, correct: 8, incorrect: 12, recentAnswers: makeWindow(4) });
    const result   = applyAnswer(existing, true, 'amero', 'American Robin', 'song');
    expect(result.newState.correct).toBe(9);
    expect(result.newState.incorrect).toBe(12);
  });

});
