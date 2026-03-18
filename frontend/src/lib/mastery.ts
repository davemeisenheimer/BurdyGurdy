/** Consecutive-correct streak needed to advance from level 0→1 and 1→2. */
export const MASTERY_ADVANCE_STREAK = 3;
/** Consecutive-correct streak needed to graduate from level 2 to mastered. */
export const GRADUATION_STREAK = 5;

/** Returns the streak threshold for a given mastery level. */
export function masteryThreshold(level: number): number {
  return level >= 2 ? GRADUATION_STREAK : MASTERY_ADVANCE_STREAK;
}

/** Display labels for mastery levels 0, 1, 2. */
export const MASTERY_LABELS = ['Easy', 'Medium', 'Hard'] as const;

/** Tailwind badge classes for mastery levels 0, 1, 2. */
export const MASTERY_BADGE_COLORS = [
  'bg-slate-100 text-slate-600',   // 0 — Easy
  'bg-sky-100 text-sky-700',       // 1 — Medium
  'bg-purple-100 text-purple-700', // 2 — Hard
] as const;

/** Tailwind badge classes for a fully mastered (graduated) bird. */
export const MASTERED_BADGE_COLOR = 'bg-emerald-100 text-emerald-700';

/** Returns the badge class string for a given level, or the mastered class if graduated. */
export function masteryBadgeClass(level: number, graduated = false): string {
  if (graduated) return MASTERED_BADGE_COLOR;
  return MASTERY_BADGE_COLORS[Math.min(level, MASTERY_BADGE_COLORS.length - 1)];
}

/** Returns the display label for a given level, or 'Mastered' if graduated. */
export function masteryLabel(level: number, graduated = false): string {
  if (graduated) return 'Mastered';
  return MASTERY_LABELS[Math.min(level, MASTERY_LABELS.length - 1)];
}

/** True when accuracy is below the struggling threshold (mirrors adaptive.ts calcWeight logic). */
export function isStruggling(correct: number, incorrect: number): boolean {
  const total = correct + incorrect;
  return total > 0 && correct / total < 0.90;
}
