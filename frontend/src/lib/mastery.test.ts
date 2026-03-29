import { describe, it, expect } from 'vitest';
import {
  masteryThreshold,
  masteryBadgeClass,
  masteryLabel,
  isStruggling,
  MASTERY_ADVANCE_STREAK,
  GRADUATION_STREAK,
  MASTERED_BADGE_COLOR,
  MASTERY_BADGE_COLORS,
} from './mastery';
import { STRUGGLING_WINDOW, STRUGGLING_MIN_CORRECT } from './struggling';

// ── masteryThreshold ──────────────────────────────────────────────────────────
// Controls how many consecutive correct answers are needed to advance levels.

describe('masteryThreshold', () => {
  it('returns the advance streak for level 0', () => {
    expect(masteryThreshold(0)).toBe(MASTERY_ADVANCE_STREAK);
  });

  it('returns the advance streak for level 1', () => {
    expect(masteryThreshold(1)).toBe(MASTERY_ADVANCE_STREAK);
  });

  it('returns the graduation streak for level 2', () => {
    expect(masteryThreshold(2)).toBe(GRADUATION_STREAK);
  });

  it('returns the graduation streak for levels beyond 2', () => {
    expect(masteryThreshold(3)).toBe(GRADUATION_STREAK);
  });
});

// ── masteryBadgeClass ─────────────────────────────────────────────────────────
// Drives the colour of the mastery badge in the UI.

describe('masteryBadgeClass', () => {
  it('returns the mastered colour when graduated, ignoring level', () => {
    expect(masteryBadgeClass(0, true)).toBe(MASTERED_BADGE_COLOR);
    expect(masteryBadgeClass(2, true)).toBe(MASTERED_BADGE_COLOR);
  });

  it('returns the correct badge colour for each active level', () => {
    expect(masteryBadgeClass(0)).toBe(MASTERY_BADGE_COLORS[0]);
    expect(masteryBadgeClass(1)).toBe(MASTERY_BADGE_COLORS[1]);
    expect(masteryBadgeClass(2)).toBe(MASTERY_BADGE_COLORS[2]);
  });

  it('clamps out-of-range levels to the last badge colour', () => {
    expect(masteryBadgeClass(99)).toBe(MASTERY_BADGE_COLORS[MASTERY_BADGE_COLORS.length - 1]);
  });
});

// ── masteryLabel ──────────────────────────────────────────────────────────────

describe('masteryLabel', () => {
  it('returns "Mastered" when graduated', () => {
    expect(masteryLabel(0, true)).toBe('Mastered');
  });

  it('returns the correct label for each active level', () => {
    expect(masteryLabel(0)).toBe('Easy');
    expect(masteryLabel(1)).toBe('Medium');
    expect(masteryLabel(2)).toBe('Hard');
  });

  it('clamps out-of-range levels to the last label', () => {
    expect(masteryLabel(99)).toBe('Hard');
  });
});

// ── isStruggling ──────────────────────────────────────────────────────────────
// Delegates to isStrugglingByWindow — only mastered birds have a recentAnswers window.

describe('isStruggling', () => {
  it('is false when the window is not yet full', () => {
    // Not enough data to make a confident judgment.
    expect(isStruggling([])).toBe(false);
    expect(isStruggling([false, false, false])).toBe(false);
    expect(isStruggling(Array(STRUGGLING_WINDOW - 1).fill(false) as boolean[])).toBe(false);
  });

  it('is false when the window has exactly STRUGGLING_MIN_CORRECT correct answers', () => {
    // At the threshold (8/10) is NOT struggling (condition is <).
    const window = [...Array(STRUGGLING_WINDOW - STRUGGLING_MIN_CORRECT).fill(false), ...Array(STRUGGLING_MIN_CORRECT).fill(true)] as boolean[];
    expect(isStruggling(window)).toBe(false);
  });

  it('is true when the window has fewer than STRUGGLING_MIN_CORRECT correct answers', () => {
    // 7/10 < 8 → struggling
    const window = [...Array(STRUGGLING_WINDOW - (STRUGGLING_MIN_CORRECT - 1)).fill(false), ...Array(STRUGGLING_MIN_CORRECT - 1).fill(true)] as boolean[];
    expect(window).toHaveLength(STRUGGLING_WINDOW);
    expect(isStruggling(window)).toBe(true);
  });

  it('is false with a perfect window', () => {
    expect(isStruggling(Array(STRUGGLING_WINDOW).fill(true) as boolean[])).toBe(false);
  });

  it('is true with an all-wrong full window', () => {
    expect(isStruggling(Array(STRUGGLING_WINDOW).fill(false) as boolean[])).toBe(true);
  });
});
