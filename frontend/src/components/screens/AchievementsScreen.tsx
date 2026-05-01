import { AWARD_NAMES, BACKYARD_BIRDER_COUNT, describeMastery } from '../../lib/victory';
import type { AwardTier, VictoryLogEntry } from '../../lib/victory';

const TIER_EMOJI: Record<string, string> = {
  firstStep:        '🐣',
  backyardBirder:   '🏡',
  patchRegular:     '🌿',
  localLegend:      '🏆',
  regionalChampion: '👑',
};

const POOL_LABEL: Partial<Record<AwardTier, string>> = {
  patchRegular:     'common patch birds',
  localLegend:      'birds in your window',
  regionalChampion: 'birds in your region',
};

function describeAward(entry: VictoryLogEntry, isFirst: boolean): string {
  const { tier, count } = entry;

  if (tier === 'firstStep')      return 'Mastered your first bird!';
  if (tier === 'backyardBirder') return `Mastered ${BACKYARD_BIRDER_COUNT} birds in total!`;

  const pool = POOL_LABEL[tier] ?? 'birds';

  if (isFirst) {
    return count !== undefined
      ? `Identified all ${count} ${pool}`
      : `Mastered all ${pool}`;
  }
  return count !== undefined
    ? `Mastered ${count} new ${pool}`
    : `Mastered all ${pool} again`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

interface Props {
  log: VictoryLogEntry[];
  onBack: () => void;
  friendDisplayName?: string;
}

export function AchievementsScreen({ log, onBack, friendDisplayName }: Props) {
  // Group entries by their sorted question-type combo key.
  // Within each group track which entry is first-ever for that tier.
  const groupMap = new Map<string, { label: string; entries: VictoryLogEntry[] }>();
  for (const entry of log) {
    const key = [...entry.questionTypes].sort().join(',');
    if (!groupMap.has(key)) {
      groupMap.set(key, { label: describeMastery(entry.questionTypes), entries: [] });
    }
    groupMap.get(key)!.entries.push(entry);
  }

  // Sort entries within each group newest-first; sort groups by most-recent entry.
  const groups = [...groupMap.values()].map(g => ({
    ...g,
    entries: [...g.entries].sort((a, b) => b.earnedAt.localeCompare(a.earnedAt)),
  })).sort((a, b) => b.entries[0].earnedAt.localeCompare(a.entries[0].earnedAt));

  // Within each group, mark the oldest entry for each tier as first-ever.
  function isFirstInGroup(group: typeof groups[0], entry: VictoryLogEntry): boolean {
    const oldest = [...group.entries]
      .filter(e => e.tier === entry.tier)
      .sort((a, b) => a.earnedAt.localeCompare(b.earnedAt))[0];
    return oldest === entry;
  }

  return (
    <div className="h-dvh flex flex-col bg-slate-50">

      <div className="shrink-0 flex items-center gap-3 px-4 py-4 bg-sky-700">
        <button onClick={onBack} className="text-white/80 hover:text-white text-4xl leading-none">←</button>
        <h1 className="font-semibold text-white">
          {friendDisplayName ? `${friendDisplayName}'s Achievements` : 'Achievements'}
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto">
        {log.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
            <span className="text-4xl">🏅</span>
            <p className="text-sm">No achievements yet — keep playing!</p>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto w-full px-4 py-4 space-y-6">
            {groups.map(group => (
              <div key={group.label}>
                <h2 className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                  <span className="flex-1 h-px bg-slate-200" />
                  {group.label}
                  <span className="flex-1 h-px bg-slate-200" />
                </h2>
                <ul className="divide-y divide-slate-100">
                  {group.entries.map((entry, i) => (
                    <li key={i} className="flex items-start gap-3 py-3">
                      <span className="text-2xl mt-0.5 shrink-0">{TIER_EMOJI[entry.tier] ?? '🏅'}</span>
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-800 text-sm">{AWARD_NAMES[entry.tier]}</p>
                        <p className="text-xs text-slate-500">{describeAward(entry, isFirstInGroup(group, entry))}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{formatDate(entry.earnedAt)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
