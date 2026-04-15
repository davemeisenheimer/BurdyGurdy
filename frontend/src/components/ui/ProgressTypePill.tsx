import { isStrugglingByWindow } from '../../lib/struggling';
import type { BirdProgress, QuestionType } from '../../types';

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

/** Returns the label, background, and text colour for the mastery-level badge. */
function masteryBadge(r: BirdProgress, struggling: boolean): { label: string; bg: string; text: string } {
  if (struggling)   return { label: '!', bg: 'bg-red-500',   text: 'text-white'       };
  if (r.isMastered) return { label: '★', bg: 'bg-green-600', text: 'text-yellow-300'  };
  const level = r.masteryLevel ?? 0;
  if (level >= 2)   return { label: 'H', bg: 'bg-sky-600',   text: 'text-white'       };
  if (level === 1)  return { label: 'M', bg: 'bg-amber-500', text: 'text-white'       };
  return                   { label: 'E', bg: 'bg-slate-400', text: 'text-white'       };
}

interface Props {
  record: BirdProgress;
  /**
   * When true, prefers the rolling-window accuracy for mastered birds
   * (the "last 10" mode used in the life list).
   * When false (default), always uses lifetime accuracy.
   */
  useRecentAccuracy?: boolean;
}

export function ProgressTypePill({ record: r, useRecentAccuracy = false }: Props) {
  const total       = r.correct + r.incorrect;
  const lifetimePct = total > 0 ? Math.round((r.correct / total) * 100) : null;

  const recentPct = (() => {
    if (!useRecentAccuracy || !(r.isMastered ?? false) || !r.recentAnswers?.length) return null;
    return Math.round(r.recentAnswers.filter(Boolean).length / r.recentAnswers.length * 100);
  })();

  const pct        = useRecentAccuracy ? (recentPct ?? lifetimePct) : lifetimePct;
  const struggling = (r.isMastered ?? false) && isStrugglingByWindow(r.recentAnswers ?? []);
  const badge      = masteryBadge(r, struggling);

  const pillColor =
    pct === null  ? 'bg-slate-100 text-slate-400'
    : pct >= 85   ? 'bg-green-100 text-green-700'
    : pct >= 60   ? 'bg-amber-100 text-amber-700'
    :               'bg-red-100 text-red-700';

  return (
    <span
      className={`relative text-xs px-2 py-0.5 rounded-full ${pillColor} ${r.favourited ? 'ring-1 ring-amber-400' : ''}`}
    >
      {TYPE_LABELS[r.questionType]}: {pct !== null ? `${pct}%` : '-'}
      {/* Mastery-level badge — half in / half out of the pill at the top-right corner */}
      <span
        className={`absolute -top-1.5 -right-1.5 w-4 h-4 ${badge.bg} ${badge.text} text-[8px] leading-none rounded-full flex items-center justify-center font-bold border border-white pointer-events-none select-none`}
        aria-hidden
      >
        {badge.label}
      </span>
    </span>
  );
}
