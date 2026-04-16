interface Props {
  isMastered:   boolean;
  masteryLevel: number;
  isStruggling: boolean;
}

function badgeStyle(isMastered: boolean, isStruggling: boolean): { label: string; color: string } | null {
  if (isStruggling) return { label: '!', color: 'text-red-500'    };
  if (isMastered)   return { label: '★', color: 'text-yellow-500' };
  return null;
}

/** Background + text colour classes for a pill whose colour reflects mastery level. */
export function masteryBgColor(isMastered: boolean, masteryLevel: number, isStruggling: boolean): string {
  if (isStruggling)       return 'bg-red-100 text-red-700';
  if (isMastered)         return 'bg-emerald-100 text-emerald-700';
  if (masteryLevel >= 2)  return 'bg-sky-100 text-sky-700';
  if (masteryLevel === 1) return 'bg-amber-100 text-amber-700';
  return                         'bg-slate-100 text-slate-600';
}

/**
 * Small mastery-level indicator (E / M / H / ★ / !) rendered as a coloured
 * character with no background.  Designed to sit at the top-right corner of a
 * pill via `absolute -top-2 -right-1` on a `relative` parent.
 */
export function MasteryLevelBadge({ isMastered, masteryLevel: _masteryLevel, isStruggling }: Props) {
  const badge = badgeStyle(isMastered, isStruggling);
  if (!badge) return null;
  return (
    <span
      className={`absolute -top-2 -right-1 ${badge.color} text-xs font-bold leading-none pointer-events-none select-none`}
      aria-hidden
    >
      {badge.label}
    </span>
  );
}
