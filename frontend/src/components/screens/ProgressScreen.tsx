import { useEffect, useState, useCallback, Fragment } from 'react';
import { db } from '../../lib/db';
import { setExcluded, STRUGGLING_THRESHOLD } from '../../lib/adaptive';
import { MASTERY_LABELS, masteryBadgeClass } from '../../lib/mastery';
import type { BirdProgress, QuestionType } from '../../types';

interface Props {
  onBack: () => void;
}

const TYPE_LABELS: Record<QuestionType, string> = {
  song: 'Song', image: 'Photo', latin: 'Latin', family: 'Family', order: 'Order', sono: 'Sono',
  'image-latin': 'PhotoL', 'song-latin': 'SongL', 'family-latin': 'FamilyL',
  'image-song': 'PhotoS', 'sono-song': 'SpectroS', 'latin-song': 'LatinS',
};

interface BirdSummary {
  speciesCode: string;
  comName: string;
  records: BirdProgress[];
  overallAccuracy: number;
  totalAttempts: number;
  favourited: boolean;
  excluded: boolean;
  maxMastery: number;
  isInHistory: boolean;
  isInProgress: boolean; // Are there any unmastered question types
}

type Filter = 'learning' | 'favourites' | 'struggling' | 'mastered' | 'excluded';


export function ProgressScreen({ onBack }: Props) {
  const [birds, setBirds]               = useState<BirdSummary[]>([]);
  const [filter, setFilter]             = useState<Filter>('learning');
  const [loading, setLoading]           = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);

  const sortForMasteredTab = (summaries: BirdSummary[]): BirdSummary[] =>
    [...summaries].sort((a, b) => a.comName.localeCompare(b.comName));

  const sortForOtherTab = (summaries: BirdSummary[]): BirdSummary[] =>
    [...summaries].sort((a, b) => {
      // Primary: fewest mastered types first (unmastered birds surface at top)
      const aMasteryGroup = a.records.filter(r => r.inHistory).length;
      const bMasteryGroup = b.records.filter(r => r.inHistory).length;
      if (aMasteryGroup !== bMasteryGroup) return aMasteryGroup - bMasteryGroup;

      // Secondary: lowest max mastery level among active (unmastered) types
      const aMaxMastery = Math.max(0, ...a.records.filter(r => !r.inHistory).map(r => r.masteryLevel || 0));
      const bMaxMastery = Math.max(0, ...b.records.filter(r => !r.inHistory).map(r => r.masteryLevel || 0));
      if (aMaxMastery !== bMaxMastery) return aMaxMastery - bMaxMastery;

      // Tertiary: alphabetical by common name
      return a.comName.localeCompare(b.comName);
    });

  const load = useCallback(() => {
    setLoading(true);
    db.progress.toArray().then(records => {
      const bySpecies = new Map<string, BirdProgress[]>();
      for (const r of records) {
        const list = bySpecies.get(r.speciesCode) ?? [];
        list.push(r);
        bySpecies.set(r.speciesCode, list);
      }

      const summaries: BirdSummary[] = [];
      for (const [speciesCode, recs] of bySpecies) {
        // Skip species that have only been seeded (never actually asked)
        const askedRecs = recs.filter(r => r.lastAsked > 0);
        if (askedRecs.length === 0) continue;

        const totalCorrect  = askedRecs.reduce((s, r) => s + r.correct, 0);
        const totalAttempts = askedRecs.reduce((s, r) => s + r.correct + r.incorrect, 0);
        summaries.push({
          speciesCode,
          comName: askedRecs[0].comName ?? speciesCode,
          records: askedRecs,
          overallAccuracy: totalAttempts > 0 ? totalCorrect / totalAttempts : 0,
          totalAttempts,
          favourited: askedRecs.some(r => r.favourited),
          excluded:   recs.some(r => r.excluded),
          maxMastery: Math.max(...askedRecs.map(r => r.masteryLevel ?? 0)),
          isInHistory: askedRecs.some(r => r.inHistory ?? false),
          isInProgress: askedRecs.some(r => !r.inHistory),
        });
      }

      setBirds(summaries);
      setLoading(false);
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleClearHistory = async () => {
    await db.progress.clear();
    // Reset promotion queue so the next adaptive session starts from the beginning
    await db.regionSpecies.toCollection().modify({ promotionIndex: 0 });
    setBirds([]);
    setConfirmClear(false);
  };

  const handleUnexclude = async (speciesCode: string) => {
    await setExcluded(speciesCode, false);
    load();
  };

  const nonExcluded   = birds.filter(b => !b.excluded);
  const excludedCount = birds.filter(b => b.excluded).length;

  const masteredCount = birds.filter(b => !b.excluded && b.isInHistory).length;

  const filteredUnsorted = birds.filter(b => {
    if (filter === 'learning')        return b.isInProgress;
    if (filter === 'favourites') return b.favourited && !b.excluded;
    if (filter === 'struggling') return !b.excluded && b.totalAttempts >= 3 && b.overallAccuracy < STRUGGLING_THRESHOLD;
    if (filter === 'mastered')   return !b.excluded && b.isInHistory;
    if (filter === 'excluded')   return b.excluded;
    return !b.excluded;
  });

  const filtered = filter === 'mastered'
    ? sortForMasteredTab(filteredUnsorted)
    : sortForOtherTab(filteredUnsorted);

  const getGroupLabel = (bird: BirdSummary): string => {
    if (bird.records.filter(r => r.inHistory).length > 0) return 'Partially Mastered';
    const maxMastery = Math.max(0, ...bird.records.filter(r => !r.inHistory).map(r => r.masteryLevel || 0));
    return MASTERY_LABELS[maxMastery] ?? 'Hard';
  };

  const masteryColor = (accuracy: number) => {
    if (accuracy >= 0.85) return 'bg-green-500';
    if (accuracy >= 0.6)  return 'bg-amber-400';
    return 'bg-red-400';
  };


  const progressBadge = (r: BirdProgress) => {
      const total = r.correct + r.incorrect;
      const pct   = total > 0 ? Math.round((r.correct / total) * 100) : null;
      return (
        <span
          key={r.questionType}
          className={`text-xs px-2 py-0.5 rounded-full ${r.favourited ? 'ring-1 ring-amber-400' : ''} ${
            pct === null ? 'bg-slate-100 text-slate-400'
            : pct >= 85  ? 'bg-green-100 text-green-700'
            : pct >= 60  ? 'bg-amber-100 text-amber-700'
            : 'bg-red-100 text-red-700'
          }`}
        >
          {TYPE_LABELS[r.questionType]}: {pct !== null ? `${pct}%` : '—'}
        </span>
      );
  };

  return (
    <div className="h-dvh flex flex-col bg-slate-50">
      <div className="max-w-2xl mx-auto w-full px-4 flex flex-col flex-1 min-h-0">

        {/* Fixed: header, stats, tabs */}
        <div className="shrink-0 pt-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="text-slate-500 hover:text-slate-700 text-5xl">←</button>
            <h1 className="text-2xl font-bold text-slate-800 text-nowrap">Life List</h1>
          </div>
          {!confirmClear ? (
            <button
              onClick={() => setConfirmClear(true)}
              className="text-xs text-slate-400 hover:text-red-500 transition-colors"
            >
              Clear history
            </button>
          ) : (
            <div className="flex items-center gap-2 ml-4">
              <span className="text-xs text-slate-500">Are you sure you want to start over?</span>
              <button
                onClick={handleClearHistory}
                className="text-xs px-2 py-1 bg-red-500 text-white rounded-lg hover:bg-red-600"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmClear(false)}
                className="text-xs px-2 py-1 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Stats */}
        {nonExcluded.length > 0 && (
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="bg-white rounded-xl p-4 text-center border border-slate-200">
              <div className="text-2xl font-bold text-forest-700">{nonExcluded.length}</div>
              <div className="text-xs text-slate-500 mt-0.5">Birds Seen</div>
            </div>
            <div className="bg-white rounded-xl p-4 text-center border border-slate-200">
              <div className="text-2xl font-bold text-green-600">
                {masteredCount}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">Mastered</div>
            </div>
            <div className="bg-white rounded-xl p-4 text-center border border-slate-200">
              <div className="text-2xl font-bold text-amber-500">
                {nonExcluded.filter(b => b.favourited).length}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">Favourited</div>
            </div>
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex justify-between mb-4">
          {(['learning', 'favourites', 'struggling'] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors capitalize ${
                filter === f
                  ? 'bg-forest-600 border-forest-600 text-white'
                  : 'bg-white border-slate-300 text-slate-600'
              }`}
            >
              {f}
            </button>
          ))}
          {masteredCount > 0 && (
            <button
              onClick={() => setFilter('mastered')}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                filter === 'mastered'
                  ? 'bg-emerald-600 border-emerald-600 text-white'
                  : 'bg-white border-slate-300 text-slate-600'
              }`}
            >
              Mastered ({masteredCount})
            </button>
          )}
          {excludedCount > 0 && (
            <button
              onClick={() => setFilter('excluded')}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                filter === 'excluded'
                  ? 'bg-red-500 border-red-500 text-white'
                  : 'bg-white border-slate-300 text-slate-600'
              }`}
            >
              Hidden ({excludedCount})
            </button>
          )}
        </div>

        </div>{/* end fixed section */}

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto pb-6 scrollbar-overlay">

        {loading && <p className="text-slate-400 text-center py-12">Loading...</p>}

        {!loading && birds.length === 0 && (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">🐦</div>
            <p className="text-slate-500">No progress yet — play a round to get started!</p>
          </div>
        )}

        {!loading && filtered.length === 0 && birds.length > 0 && (
          <p className="text-slate-400 text-center py-8">No birds match this filter.</p>
        )}

        {/* Bird list */}
        <div className="space-y-3">
          {filtered.map((bird, i) => {
            const groupHeader = filter === 'learning' && (i === 0 || getGroupLabel(bird) !== getGroupLabel(filtered[i - 1]))
              ? <h3 key={`hdr-${i}`} className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-slate-800 pt-2"><span className="flex-1 h-px bg-slate-200" />{getGroupLabel(bird)}<span className="flex-1 h-px bg-slate-200" /></h3>
              : null;
            return (<Fragment key={bird.speciesCode}>
              {groupHeader}
              <div className={`bg-white rounded-xl border p-4 ${
                bird.excluded ? 'border-red-200 opacity-75' : 'border-slate-200'
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-800">{bird.comName}</span>
                  {bird.favourited && <span className="text-amber-500 text-sm">★</span>}
                  {!bird.excluded && (() => {
                    // Find the highest-mastery record not yet in history
                    const leading = bird.records
                      .filter(r => !(r.inHistory ?? false))
                      .reduce<BirdProgress | null>((best, r) =>
                        (r.masteryLevel ?? 0) >= (best?.masteryLevel ?? -1) ? r : best, null);
                    if (!leading || (filter === "mastered" && bird.records.some(r => r.inHistory ?? false))) {
                      return (
                        <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700">
                          Mastered
                        </span>
                      );
                    }
                    const lvl = leading.masteryLevel ?? 0;
                    const threshold = lvl >= 2 ? 5 : 3;
                    const streak = leading.consecutiveCorrect ?? 0;
                    return (
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${masteryBadgeClass(lvl)}`}>
                        {streak}/{threshold} {MASTERY_LABELS[lvl] ?? 'Hard'} distractors
                      </span>
                    );
                  })()}
                </div>
                {bird.excluded ? (
                  <button
                    onClick={() => handleUnexclude(bird.speciesCode)}
                    className="text-xs px-2 py-1 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors shrink-0"
                  >
                    Show again
                  </button>
                ) : (
                  <div className="text-right shrink-0">
                    <span className="text-sm font-semibold text-slate-700">
                      {Math.round(bird.overallAccuracy * 100)}%
                    </span>
                    <span className="text-xs text-slate-400 ml-1">overall</span>
                  </div>
                )}
              </div>

              {!bird.excluded && (
                <>
                  <div className="w-full bg-slate-100 rounded-full h-1.5 mb-3">
                    <div
                      className={`h-1.5 rounded-full transition-all ${masteryColor(bird.overallAccuracy)}`}
                      style={{ width: `${Math.round(bird.overallAccuracy * 100)}%` }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {bird.records.filter(r => (filter !== "mastered" && !r.inHistory) || (filter === "mastered" && r.inHistory)).map(r => {
                      return progressBadge(r);
                    })}
                    {filter !== 'mastered' && bird.records.some(r => r.inHistory) && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full font-medium">Mastered:</span>
                    )}
                    {bird.records.filter(r => r.inHistory && filter !== "mastered").map(r => progressBadge(r))}
                  </div>
                </>
              )}
            </div>
            </Fragment>);
          })}
        </div>
        </div>{/* end scrollable list */}
      </div>
    </div>
  );
}
