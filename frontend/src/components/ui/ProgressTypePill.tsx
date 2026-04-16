import { isStrugglingByWindow } from '../../lib/struggling';
import type { BirdProgress, QuestionType } from '../../types';
import { MasteryLevelBadge, masteryBgColor } from './MasteryLevelBadge';

export const TYPE_LABELS: Record<QuestionType, string> = {
  song:           'Song',
  image:          'Photo',
  latin:          'Latin',
  family:         'Family',
  order:          'Order',
  sono:           'Sono',
  'image-latin':  'PhotoL',
  'song-latin':   'SongL',
  'family-latin': 'FamilyL',
  'image-song':   'PhotoS',
  'sono-song':    'SpectroS',
  'latin-song':   'LatinS',
};


interface Props {
  record: BirdProgress;
  /**
   * When true, prefers the rolling-window accuracy for mastered birds
   * (the "last 10" mode used in the life list).
   * When false (default), always uses lifetime accuracy.
   */
  useRecentAccuracy?: boolean;
  /** Highlights this pill as the currently selected question type. */
  selected?: boolean;
  /** If provided the pill is interactive; stops propagation before calling. */
  onClick?: () => void;
}

export function ProgressTypePill({ record: r, useRecentAccuracy = false, selected = false, onClick }: Props) {
  const total       = r.correct + r.incorrect;
  const lifetimePct = total > 0 ? Math.round((r.correct / total) * 100) : null;

  const recentPct = (() => {
    if (!useRecentAccuracy || !(r.isMastered ?? false) || !r.recentAnswers?.length) return null;
    return Math.round(r.recentAnswers.filter(Boolean).length / r.recentAnswers.length * 100);
  })();

  const pct        = useRecentAccuracy ? (recentPct ?? lifetimePct) : lifetimePct;
  const struggling = (r.isMastered ?? false) && isStrugglingByWindow(r.recentAnswers ?? []);

  const accuracyBorder =
    pct === null  ? 'border-slate-300'
    : pct >= 85   ? 'border-green-500'
    : pct >= 60   ? 'border-amber-400'
    :               'border-red-500';

  return (
    <span
      className={`relative text-xs px-2 py-0.5 rounded-full border-2 ${masteryBgColor(r.isMastered ?? false, r.masteryLevel ?? 0, struggling)} ${accuracyBorder} ${selected ? 'ring-2 ring-offset-1 ring-slate-600' : r.favourited ? 'ring-1 ring-amber-400' : ''} ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick ? e => { e.stopPropagation(); onClick(); } : undefined}
    >
      {TYPE_LABELS[r.questionType]}: {pct !== null ? `${pct}%` : '-'}
      <MasteryLevelBadge
        isMastered={r.isMastered ?? false}
        masteryLevel={r.masteryLevel ?? 0}
        isStruggling={struggling}
      />
    </span>
  );
}
