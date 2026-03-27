import { useState, useEffect } from 'react';
import type { QuizConfig, QuestionType, LevelUpEvent } from '../../types';
import { db } from '../../lib/db';
import { masteryBadgeClass, masteryLabel } from '../../lib/mastery';
import { FocusModeToggle } from '../ui/FocusModeToggle';

const SHORT_TYPE_LABELS: Record<string, string> = {
  image: 'photo', song: 'song', sono: 'spectrogram',
  family: 'family', latin: 'latin', order: 'order',
  'image-latin': 'photo→latin', 'song-latin': 'song→latin', 'family-latin': 'family→latin',
  'image-song': 'photo→song', 'sono-song': 'spectro→song', 'latin-song': 'latin→song',
};

interface Props {
  score: { correct: number; total: number };
  config: QuizConfig;
  questionTypes: QuestionType[];
  levelUps: LevelUpEvent[];
  focusStruggling?: boolean;
  showFocusModeToggle?: boolean;
  strugglingCount?: number;
  onToggleFocusStruggling?: () => void;
  onRestart: () => void;
  onHome: () => void;
  onRecentProgress: () => void;
}

interface MasteryStats {
  mastered: number;
  total: number;
}

function groupBySpecies(events: LevelUpEvent[]) {
  const bySpecies = new Map<string, { comName: string; events: LevelUpEvent[] }>();
  for (const ev of events) {
    const entry = bySpecies.get(ev.speciesCode) ?? { comName: ev.comName, events: [] };
    entry.events.push(ev);
    bySpecies.set(ev.speciesCode, entry);
  }
  return [...bySpecies.values()];
}

function BirdList({ birds, cutoff }: { birds: { comName: string; events: LevelUpEvent[] }[]; cutoff: number }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? birds : birds.slice(0, cutoff);
  return (
    <>
      <div className="space-y-2">
        {visible.map(({ comName, events }) => (
          <div key={comName} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-sm text-slate-700 font-medium">{comName}</span>
            <span className="flex flex-wrap gap-1">
              {events.map(ev => (
                <span
                  key={ev.questionType}
                  className={`text-xs px-1.5 py-0.5 rounded font-medium ${masteryBadgeClass(ev.newLevel, ev.graduated)}`}
                >
                  {SHORT_TYPE_LABELS[ev.questionType] ?? ev.questionType}
                  {' → '}
                  {masteryLabel(ev.newLevel, ev.graduated).toLowerCase()}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
      {birds.length > cutoff && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="mt-2 text-xs text-sky-600 hover:underline"
        >
          {expanded ? 'Show less' : `and ${birds.length - cutoff} more…`}
        </button>
      )}
    </>
  );
}

function LevelUpSummary({ levelUps }: { levelUps: LevelUpEvent[] }) {
  const CUTOFF = 4;
  const harder    = groupBySpecies(levelUps.filter(ev => !ev.graduated));
  const graduated = groupBySpecies(levelUps.filter(ev => ev.graduated));

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 mb-6 text-left space-y-4">
      {harder.length > 0 && (
        <div>
          <p className="text-sm font-semibold text-slate-700 mb-3">
            ↑ {harder.length} {harder.length === 1 ? 'bird' : 'birds'} will get harder next time
          </p>
          <BirdList birds={harder} cutoff={CUTOFF} />
        </div>
      )}
      {graduated.length > 0 && (
        <div className={harder.length > 0 ? 'border-t border-slate-100 pt-4' : ''}>
          <p className="text-sm font-semibold text-green-700 mb-3">
            🎓 {graduated.length} {graduated.length === 1 ? 'bird' : 'birds'} graduated to Mastered
          </p>
          <BirdList birds={graduated} cutoff={CUTOFF} />
        </div>
      )}
    </div>
  );
}

export function ResultScreen({ score, config, questionTypes, levelUps, focusStruggling, showFocusModeToggle, strugglingCount, onToggleFocusStruggling, onRestart, onHome, onRecentProgress }: Props) {
  const pct = Math.round((score.correct / score.total) * 100);
  const emoji = pct >= 80 ? '🎉' : pct >= 60 ? '🙂' : '💪';
  const [masteryStats, setMasteryStats] = useState<MasteryStats | null>(null);

  useEffect(() => {
    const back = config.recentDays ?? 30;
    const cacheKey = `${config.regionCode}:${back}`;
    (async () => {
      const cached = await db.regionSpecies.get(cacheKey);
      if (!cached) return;
      const recentSpecies = cached.species.filter(s => !s.isHistorical);
      if (recentSpecies.length === 0) return;

      const speciesCodes = recentSpecies.map(s => s.speciesCode);
      const records = await db.progress
        .where('[speciesCode+questionType]')
        .anyOf(speciesCodes.flatMap(code => questionTypes.map(t => [code, t])))
        .toArray();

      const progressMap = new Map(records.map(r => [`${r.speciesCode}:${r.questionType}`, r]));

      let mastered = 0;
      for (const { speciesCode } of recentSpecies) {
        const allGraduated = questionTypes.every(t => progressMap.get(`${speciesCode}:${t}`)?.inHistory === true);
        if (allGraduated) mastered++;
      }

      setMasteryStats({ mastered, total: recentSpecies.length });
    })().catch(() => {});
  }, []);

  const windowLabel = config.recentDays === 1 ? '1 day' : `${config.recentDays ?? 30} days`;

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md text-center">
        <div className="text-6xl mb-4">{emoji}</div>
        <h2 className="text-3xl font-bold text-slate-800 mb-2">Round Complete</h2>
        <p className="text-slate-500 mb-8">
          Region: <span className="font-medium">{config.regionCode}</span>
        </p>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 mb-6">
          <div className="text-6xl font-bold text-forest-700 mb-2">{pct}%</div>
          <div className="text-slate-500 text-lg mb-4">
            {score.correct} correct out of {score.total}
          </div>
          {masteryStats !== null && (
            <div className="text-sm text-slate-500 border-t border-slate-100 pt-4">
              You have mastered{' '}
              <span className="font-semibold text-slate-700">{masteryStats.mastered}</span>
              {' '}out of{' '}
              <span className="font-semibold text-slate-700">{masteryStats.total}</span>
              {' '}birds seen in your region in the past {windowLabel}.{' '}
              <button
                onClick={onRecentProgress}
                className="text-forest-600 hover:text-forest-700 hover:underline font-medium"
              >
                View recent progress →
              </button>
            </div>
          )}
        </div>

        {showFocusModeToggle && onToggleFocusStruggling && (
          <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-6">
            <FocusModeToggle enabled={focusStruggling ?? false} onToggle={onToggleFocusStruggling} strugglingCount={strugglingCount ?? 0} />
          </div>
        )}

        {levelUps.length > 0 && <LevelUpSummary levelUps={levelUps} />}

        <div className="space-y-3">
          <button
            onClick={onRestart}
            className="w-full py-3 rounded-xl bg-forest-600 hover:bg-forest-700 text-white font-semibold text-lg transition-colors"
          >
            Play Again
          </button>
          <button
            onClick={onHome}
            className="w-full py-3 rounded-xl border-2 border-slate-300 hover:border-slate-400 text-slate-700 font-semibold text-lg transition-colors"
          >
            Change Settings
          </button>
        </div>
      </div>
    </div>
  );
}
