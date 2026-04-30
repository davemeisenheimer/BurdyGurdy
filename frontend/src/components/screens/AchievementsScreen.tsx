import { AWARD_NAMES } from '../../lib/victory';
import { describeMastery } from '../../lib/victory';
import type { VictoryLogEntry } from '../../lib/victory';

const TIER_EMOJI: Record<string, string> = {
  firstStep:        '🐣',
  backyardBirder:   '🏡',
  patchRegular:     '🌿',
  localLegend:      '🏆',
  regionalChampion: '👑',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

interface Props {
  log: VictoryLogEntry[];
  onBack: () => void;
  friendDisplayName?: string;
}

export function AchievementsScreen({ log, onBack, friendDisplayName }: Props) {
  const sorted = [...log].sort((a, b) => b.earnedAt.localeCompare(a.earnedAt));

  return (
    <div className="h-dvh flex flex-col bg-slate-50">

      <div className="shrink-0 flex items-center gap-3 px-4 py-4 bg-sky-700">
        <button onClick={onBack} className="text-white/80 hover:text-white text-4xl leading-none">←</button>
        <h1 className="font-semibold text-white">
          {friendDisplayName ? `${friendDisplayName}'s Achievements` : 'Achievements'}
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
            <span className="text-4xl">🏅</span>
            <p className="text-sm">No achievements yet — keep playing!</p>
          </div>
        ) : (
          <ul className="max-w-2xl mx-auto w-full divide-y divide-slate-100 px-4 py-2">
            {sorted.map((entry, i) => (
              <li key={i} className="flex items-start gap-3 py-3">
                <span className="text-2xl mt-0.5 shrink-0">{TIER_EMOJI[entry.tier] ?? '🏅'}</span>
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 text-sm">{AWARD_NAMES[entry.tier]}</p>
                  <p className="text-xs text-slate-500">{describeMastery(entry.questionTypes)}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{formatDate(entry.earnedAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

    </div>
  );
}
