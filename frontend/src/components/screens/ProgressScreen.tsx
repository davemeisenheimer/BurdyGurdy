import { useEffect, useState, useCallback, Fragment } from 'react';
import { db } from '../../lib/db';
import { setExcluded, STRUGGLING_THRESHOLD } from '../../lib/adaptive';
import { MASTERY_LABELS, masteryBadgeClass, isStruggling } from '../../lib/mastery';
import { MasteryBadge } from '../ui/MasteryBadge';
import { deleteCloudProgress } from '../../lib/sync';
import type { BirdProgress, QuestionType } from '../../types';

interface Props {
  onBack: () => void;
  userId?: string | null;
  questionTypes?: QuestionType[];
  onSelectBird?: (species: { speciesCode: string; comName: string }) => void;
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
  isInProgress: boolean;
}

type Filter = 'learning' | 'favourites' | 'struggling' | 'mastered' | 'excluded';
type TypeFilter = 'all' | QuestionType;

function getViewRecord(bird: BirdSummary, typeFilter: TypeFilter): BirdProgress | null {
  if (typeFilter === 'all') {
    return bird.records
      .filter(r => !(r.inHistory ?? false))
      .reduce<BirdProgress | null>((best, r) =>
        (r.masteryLevel ?? 0) >= (best?.masteryLevel ?? -1) ? r : best, null);
  }
  return bird.records.find(r => r.questionType === typeFilter) ?? null;
}

function getGroupLabel(bird: BirdSummary, viewRecord: BirdProgress | null, typeFilter: TypeFilter): string {
  if (typeFilter !== 'all') {
    if (!viewRecord || viewRecord.inHistory) return 'Mastered';
    return MASTERY_LABELS[viewRecord.masteryLevel ?? 0] ?? 'Hard';
  }
  if (bird.records.filter(r => r.inHistory).length > 0) return 'Partially Mastered';
  const maxMastery = Math.max(0, ...bird.records.filter(r => !r.inHistory).map(r => r.masteryLevel || 0));
  return MASTERY_LABELS[maxMastery] ?? 'Hard';
}

export function ProgressScreen({ onBack, userId, questionTypes, onSelectBird }: Props) {
  const [birds, setBirds]               = useState<BirdSummary[]>([]);
  const [filter, setFilter]             = useState<Filter>('learning');
  const [typeFilter, setTypeFilter]     = useState<TypeFilter>(() =>
    questionTypes?.length === 1 ? questionTypes[0] : 'all',
  );
  const [loading, setLoading]           = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);

  const sortForMasteredTab = (summaries: BirdSummary[]): BirdSummary[] =>
    [...summaries].sort((a, b) => a.comName.localeCompare(b.comName));

  const sortForOtherTab = (summaries: BirdSummary[], tf: TypeFilter): BirdSummary[] =>
    [...summaries].sort((a, b) => {
      const aView = getViewRecord(a, tf);
      const bView = getViewRecord(b, tf);

      if (tf === 'all') {
        const aMasteryGroup = a.records.filter(r => r.inHistory).length;
        const bMasteryGroup = b.records.filter(r => r.inHistory).length;
        if (aMasteryGroup !== bMasteryGroup) return aMasteryGroup - bMasteryGroup;
      }

      const aLvl = aView && !aView.inHistory ? (aView.masteryLevel ?? 0) : 999;
      const bLvl = bView && !bView.inHistory ? (bView.masteryLevel ?? 0) : 999;
      if (aLvl !== bLvl) return aLvl - bLvl;

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

  const handleClearHistory = async (clearCloud: boolean) => {
    await db.progress.clear();
    await db.regionSpecies.toCollection().modify({ promotionIndex: 0 });
    if (clearCloud && userId) await deleteCloudProgress(userId);
    setBirds([]);
    setConfirmClear(false);
  };

  const handleUnexclude = async (speciesCode: string) => {
    await setExcluded(speciesCode, false);
    load();
  };

  // Available question types present in the data
  const availableTypes: QuestionType[] = [...new Set(
    birds.flatMap(b => b.records.map(r => r.questionType))
  )].sort((a, b) => (TYPE_LABELS[a] ?? a).localeCompare(TYPE_LABELS[b] ?? b));

  const nonExcluded = birds.filter(b => !b.excluded);

  // Apply type filter first, then status filter
  const typeFiltered = typeFilter === 'all'
    ? birds
    : birds.filter(b => b.records.some(r => r.questionType === typeFilter));

  // Tab counts mirror the card filter logic so numbers always match visible cards
  const typeFilteredNonExcluded = typeFiltered.filter(b => !b.excluded);
  const excludedCount   = typeFiltered.filter(b => b.excluded).length;
  const masteredCount   = typeFilteredNonExcluded.filter(b => {
    const vr = getViewRecord(b, typeFilter);
    return vr ? (vr.inHistory ?? false) : b.isInHistory;
  }).length;
  const strugglingCount = typeFilteredNonExcluded.filter(b => {
    const vr = getViewRecord(b, typeFilter);
    if (typeFilter !== 'all' && vr) {
      const total = vr.correct + vr.incorrect;
      return total >= 3 && (total > 0 ? vr.correct / total : 0) < STRUGGLING_THRESHOLD;
    }
    return b.totalAttempts >= 3 && b.overallAccuracy < STRUGGLING_THRESHOLD;
  }).length;
  const learningCount   = typeFilteredNonExcluded.filter(b => {
    const vr = getViewRecord(b, typeFilter);
    return vr ? !(vr.inHistory ?? false) : b.isInProgress;
  }).length;
  const favouritedCount = typeFilteredNonExcluded.filter(b => b.favourited).length;

  const filteredUnsorted = typeFiltered.filter(b => {
    if (b.excluded && filter !== 'excluded') return false;
    if (filter === 'excluded') return b.excluded;
    if (filter === 'favourites') return b.favourited;

    const vr = getViewRecord(b, typeFilter);
    if (filter === 'learning')   return vr ? !(vr.inHistory ?? false) : b.isInProgress;
    if (filter === 'mastered')   return vr ? (vr.inHistory ?? false) : b.isInHistory;
    if (filter === 'struggling') {
      if (typeFilter !== 'all' && vr) {
        const total = vr.correct + vr.incorrect;
        return total >= 3 && (total > 0 ? vr.correct / total : 0) < STRUGGLING_THRESHOLD;
      }
      return b.totalAttempts >= 3 && b.overallAccuracy < STRUGGLING_THRESHOLD;
    }
    return true;
  });

  const filtered = filter === 'mastered'
    ? sortForMasteredTab(filteredUnsorted)
    : sortForOtherTab(filteredUnsorted, typeFilter);

  // Pre-compute group label counts for headers
  const groupCounts = new Map<string, number>();
  if (filter === 'learning') {
    for (const bird of filtered) {
      const vr = getViewRecord(bird, typeFilter);
      const label = getGroupLabel(bird, vr, typeFilter);
      groupCounts.set(label, (groupCounts.get(label) ?? 0) + 1);
    }
  }

  const filterTabs: { key: Filter; count: number; label: string; color: string; border: string }[] = [
    { key: 'learning',   count: learningCount,   label: 'Learning',   color: 'text-forest-700', border: 'border-forest-700' },
    { key: 'favourites', count: favouritedCount, label: 'Fav',        color: 'text-amber-500',  border: 'border-amber-500'  },
    { key: 'struggling', count: strugglingCount, label: 'Struggling', color: 'text-red-500',    border: 'border-red-500'    },
    { key: 'mastered',   count: masteredCount,   label: 'Mastered',   color: 'text-green-600',  border: 'border-green-600'  },
  ];
  if (excludedCount > 0) filterTabs.push({ key: 'excluded', count: excludedCount, label: 'Hidden', color: 'text-slate-500', border: 'border-slate-400' });

  const masteryColor = (accuracy: number) => {
    if (accuracy >= 0.85) return 'bg-green-500';
    if (accuracy >= 0.6)  return 'bg-amber-400';
    return 'bg-red-400';
  };

  const progressBadge = (r: BirdProgress) => {
    const total = r.correct + r.incorrect;
    const pct   = total > 0 ? Math.round((r.correct / total) * 100) : null;
    const struggling = total > 0 && (r.correct / total) < STRUGGLING_THRESHOLD;
    return (
      <span
        key={r.questionType}
        className={`relative text-xs px-2 py-0.5 rounded-full ${r.favourited ? 'ring-1 ring-amber-400' : ''} ${
          pct === null ? 'bg-slate-100 text-slate-400'
          : pct >= 85  ? 'bg-green-100 text-green-700'
          : pct >= 60  ? 'bg-amber-100 text-amber-700'
          : 'bg-red-100 text-red-700'
        }`}
      >
        {TYPE_LABELS[r.questionType]}: {pct !== null ? `${pct}%` : '—'}
        {struggling && (
          <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 text-white text-[9px] leading-none rounded-full flex items-center justify-center font-bold pointer-events-none select-none">
            !
          </span>
        )}
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
            <div>
              <h1 className="text-2xl font-bold text-slate-800 text-nowrap">Life List</h1>
              {nonExcluded.length > 0 && (
                <p className="text-xs text-slate-400">{nonExcluded.length} birds seen</p>
              )}
            </div>
          </div>
          {!confirmClear ? (
            <button
              onClick={() => setConfirmClear(true)}
              className="text-xs text-slate-400 hover:text-red-500 transition-colors"
            >
              Clear history
            </button>
          ) : (
            <div className="flex flex-col items-end gap-1.5 ml-4">
              {userId ? (
                <>
                  <span className="text-xs text-slate-500 text-right">Cloud data will resync on next sign-in unless you clear both.</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleClearHistory(false)}
                      className="text-xs px-2 py-1 bg-red-500 text-white rounded-lg hover:bg-red-600"
                    >
                      Local only
                    </button>
                    <button
                      onClick={() => handleClearHistory(true)}
                      className="text-xs px-2 py-1 bg-red-700 text-white rounded-lg hover:bg-red-800"
                    >
                      Local + cloud
                    </button>
                    <button
                      onClick={() => setConfirmClear(false)}
                      className="text-xs px-2 py-1 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-100"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Are you sure you want to start over?</span>
                  <button
                    onClick={() => handleClearHistory(false)}
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
          )}
        </div>


        {/* Type filter dropdown */}
        {availableTypes.length > 1 && (
          <div className="flex items-center gap-2 mb-3">
            <label className="text-xs text-slate-500 font-medium shrink-0">Question type:</label>
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value as TypeFilter)}
              className="text-xs border border-slate-300 rounded-lg px-2 py-1 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-forest-500"
            >
              <option value="all">All</option>
              {availableTypes.map(t => (
                <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>
              ))}
            </select>
          </div>
        )}
        
        {/* Tab strip — combines stats summary and filter selection */}
        {birds.length > 0 && (
          <div className="flex border-b border-slate-200 mb-4">
            {filterTabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={`flex-1 flex flex-col items-center pt-1 pb-2 border-b-2 transition-colors ${
                  filter === tab.key ? tab.border : 'border-transparent'
                }`}
              >
                <span className={`text-xl font-bold leading-tight ${tab.color}`}>{tab.count}</span>
                <span className={`text-[11px] leading-tight mt-0.5 ${filter === tab.key ? 'text-slate-700' : 'text-slate-400'}`}>
                  {tab.label}
                </span>
              </button>
            ))}
          </div>
        )}

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
            const viewRecord = getViewRecord(bird, typeFilter);
            const groupLabel = getGroupLabel(bird, viewRecord, typeFilter);
            const prevGroupLabel = i > 0 ? getGroupLabel(filtered[i - 1], getViewRecord(filtered[i - 1], typeFilter), typeFilter) : null;
            const groupHeader = filter === 'learning' && (i === 0 || groupLabel !== prevGroupLabel)
              ? <h3 key={`hdr-${i}`} className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-slate-800 pt-2">
                  <span className="flex-1 h-px bg-slate-200" />
                  {groupLabel} ({groupCounts.get(groupLabel) ?? 0})
                  <span className="flex-1 h-px bg-slate-200" />
                </h3>
              : null;

            // Display accuracy: per-type record when filtered, overall when All
            const displayAccuracy = typeFilter !== 'all' && viewRecord
              ? (viewRecord.correct + viewRecord.incorrect > 0
                  ? viewRecord.correct / (viewRecord.correct + viewRecord.incorrect)
                  : 0)
              : bird.overallAccuracy;

            return (<Fragment key={bird.speciesCode}>
              {groupHeader}
              <div
                className={`bg-white rounded-xl border p-4 ${
                  bird.excluded ? 'border-red-200 opacity-75' : 'border-slate-200'
                } ${onSelectBird ? 'cursor-pointer hover:border-sky-300 hover:shadow-sm transition-shadow' : ''}`}
                onClick={onSelectBird ? () => onSelectBird({ speciesCode: bird.speciesCode, comName: bird.comName }) : undefined}
              >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-800">{bird.comName}</span>
                  {bird.favourited && <span className="text-amber-500 text-sm">★</span>}
                  {!bird.excluded && (() => {
                    const leading = viewRecord && !(viewRecord.inHistory ?? false) ? viewRecord : null;
                    if (!leading || (filter === 'mastered' && (viewRecord?.inHistory ?? bird.isInHistory))) {
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
                      <MasteryBadge
                        className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${masteryBadgeClass(lvl)}`}
                        isStruggling={isStruggling(leading.correct, leading.incorrect)}
                      >
                        {streak}/{threshold} {MASTERY_LABELS[lvl] ?? 'Hard'} distractors
                      </MasteryBadge>
                    );
                  })()}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <span className="text-sm font-semibold text-slate-700">
                      {Math.round(displayAccuracy * 100)}%
                    </span>
                    <span className="text-xs text-slate-400 ml-1">
                      {typeFilter !== 'all' ? TYPE_LABELS[typeFilter] ?? typeFilter : 'overall'}
                    </span>
                  </div>
                  {bird.excluded && (
                    <button
                      onClick={() => handleUnexclude(bird.speciesCode)}
                      className="text-xs px-2 py-1 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors shrink-0"
                    >
                      Show again
                    </button>
                  )}
                </div>
              </div>

              <div className="w-full bg-slate-100 rounded-full h-1.5 mb-3">
                <div
                  className={`h-1.5 rounded-full transition-all ${masteryColor(displayAccuracy)}`}
                  style={{ width: `${Math.round(displayAccuracy * 100)}%` }}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {bird.records.filter(r => (filter !== 'mastered' && !r.inHistory) || (filter === 'mastered' && r.inHistory)).map(r => progressBadge(r))}
                {filter !== 'mastered' && bird.records.some(r => r.inHistory) && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full font-medium">Mastered:</span>
                )}
                {bird.records.filter(r => r.inHistory && filter !== 'mastered').map(r => progressBadge(r))}
              </div>
            </div>
            </Fragment>);
          })}
        </div>
        </div>{/* end scrollable list */}
      </div>
    </div>
  );
}
