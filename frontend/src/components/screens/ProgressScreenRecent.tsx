import { useEffect, useState, Fragment } from 'react';
import { db } from '../../lib/db';
import { categoriseRecentBirds, summariseCounts } from '../../lib/recentProgress';
import { DEV_SHOW_PALETTE_SPLIT } from '../../lib/devFlags';
import { MASTERED_BADGE_COLOR } from '../../lib/mastery';
import { ProgressTypePill, TYPE_LABELS } from '../ui/ProgressTypePill';
import type { QuestionType, CachedSpecies, BirdProgress } from '../../types';
import type { RecentBirdEntry, RecentProgressCategory } from '../../lib/recentProgress';

interface Props {
  regionCode: string;
  recentDays: number;
  questionTypes: QuestionType[];
  onBack: () => void;
  onSelectBird?: (species: { speciesCode: string; comName: string }) => void;
  selectedSpeciesCode?: string;
  overrideRecords?: BirdProgress[];
  friendDisplayName?: string;
}

type TypeFilter = 'all' | QuestionType;

const SECTION_ORDER: RecentProgressCategory[] = ['notAsked', 'easy', 'medium', 'hard', 'mastered'];

const SECTION_LABELS: Record<RecentProgressCategory, string> = {
  notAsked: 'Not asked yet',
  easy:     'Easy',
  medium:   'Medium',
  hard:     'Hard',
  mastered: 'Mastered',
};

const SECTION_COLORS: Record<RecentProgressCategory, string> = {
  notAsked: 'text-slate-400',
  easy:     'text-slate-600',
  medium:   'text-sky-700',
  hard:     'text-purple-700',
  mastered: 'text-emerald-700',
};

export function ProgressScreenRecent({ regionCode, recentDays, questionTypes, onBack, onSelectBird, selectedSpeciesCode, overrideRecords, friendDisplayName }: Props) {
  const [cachedSpecies, setCachedSpecies]       = useState<CachedSpecies[]>([]);
  const [progressRecords, setProgressRecords]   = useState<BirdProgress[]>([]);
  const [loading, setLoading]                   = useState(true);
  const [noCache, setNoCache]                   = useState(false);
  const [typeFilter, setTypeFilter]             = useState<TypeFilter>(() =>
    questionTypes.length === 1 ? questionTypes[0] : 'all',
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      const cacheKey = `${regionCode}:${recentDays}`;
      const [cached, records] = await Promise.all([
        db.regionSpecies.get(cacheKey),
        overrideRecords !== undefined ? Promise.resolve(overrideRecords) : db.progress.toArray(),
      ]);

      if (!cached || cached.species.length === 0) {
        setNoCache(true);
        setLoading(false);
        return;
      }

      setCachedSpecies(cached.species);
      setProgressRecords(records);
      setLoading(false);
    })().catch(() => setLoading(false));
  }, [regionCode, recentDays, overrideRecords]);

  // Types actually present in DB records for species in the recent window
  const recentCodes = new Set(cachedSpecies.map(s => s.speciesCode));
  const availableTypes: QuestionType[] = [...new Set(
    progressRecords
      .filter(r => recentCodes.has(r.speciesCode) && r.lastAsked > 0)
      .map(r => r.questionType),
  )].sort((a, b) => (TYPE_LABELS[a] ?? a).localeCompare(TYPE_LABELS[b] ?? b));

  const activeTypes: QuestionType[] = typeFilter === 'all'
    ? (availableTypes.length > 0 ? availableTypes : questionTypes)
    : [typeFilter as QuestionType];
  const entries = loading || noCache ? [] : categoriseRecentBirds(cachedSpecies, progressRecords, activeTypes);

  const counts = summariseCounts(entries);
  const windowLabel = recentDays === 1 ? '1 day' : `${recentDays} days`;
  const total = entries.length;

  return (
    <div className="h-dvh flex flex-col bg-slate-50">
      <div className="max-w-2xl mx-auto w-full px-4 flex flex-col flex-1 min-h-0">

        {/* Header */}
        <div className="shrink-0 pt-6">
          <div className="flex items-center gap-4 mb-2">
            <button onClick={onBack} className="text-slate-500 hover:text-slate-700 text-5xl">←</button>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">{friendDisplayName ? `${friendDisplayName} in Your Region` : 'Recent Progress'}</h1>
              <p className="text-sm text-slate-500">{regionCode} · past {windowLabel} · {total} birds{friendDisplayName ? ' · your region & window' : ''}</p>
            </div>
          </div>

          {/* Summary pills */}
          {!loading && !noCache && (
            <div className="flex flex-wrap gap-2 mt-4 mb-3">
              {SECTION_ORDER.filter(cat => counts[cat] > 0).map(cat => (
                <span
                  key={cat}
                  className={`text-xs px-2.5 py-1 rounded-full font-medium border ${
                    cat === 'notAsked' ? 'bg-slate-100 border-slate-200 text-slate-500' :
                    cat === 'easy'     ? 'bg-slate-100 border-slate-200 text-slate-600' :
                    cat === 'medium'   ? 'bg-sky-50 border-sky-200 text-sky-700' :
                    cat === 'hard'     ? 'bg-purple-50 border-purple-200 text-purple-700' :
                                         'bg-emerald-50 border-emerald-200 text-emerald-700'
                  }`}
                >
                  {counts[cat]} {SECTION_LABELS[cat]}
                </span>
              ))}
            </div>
          )}

          {/* Type filter dropdown */}
          {!loading && !noCache && availableTypes.length > 1 && (
            <div className="flex items-center gap-2 mb-4">
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
        </div>

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto pb-6">
          {loading && <p className="text-slate-400 text-center py-12">Loading...</p>}

          {!loading && noCache && (
            <div className="text-center py-16">
              <div className="text-5xl mb-4">🐦</div>
              <p className="text-slate-500">
                No data yet for this region and window.<br />
                Play a round first to populate this view.
              </p>
            </div>
          )}

          {!loading && !noCache && total === 0 && (
            <div className="text-center py-16">
              <p className="text-slate-500">No birds found in this window.</p>
            </div>
          )}

          {!loading && !noCache && SECTION_ORDER.map(cat => {
            const section = entries.filter(e => e.category === cat);
            if (section.length === 0) return null;
            return (
              <Fragment key={cat}>
                {/* Section header */}
                <h3 className={`flex items-center gap-3 text-xs font-semibold uppercase tracking-wider pt-4 pb-2 ${SECTION_COLORS[cat]}`}>
                  <span className="flex-1 h-px bg-slate-200" />
                  {SECTION_LABELS[cat]} ({section.length})
                  <span className="flex-1 h-px bg-slate-200" />
                </h3>

                <div className="space-y-2">
                  {section.map(bird => (
                    <BirdCard key={bird.speciesCode} bird={bird} onSelectBird={onSelectBird} isSelected={bird.speciesCode === selectedSpeciesCode} />
                  ))}
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── BirdCard ──────────────────────────────────────────────────────────────────

function BirdCard({ bird, onSelectBird, isSelected }: { bird: RecentBirdEntry; onSelectBird?: (species: { speciesCode: string; comName: string }) => void; isSelected?: boolean }) {
  const baseCard = isSelected ? 'bg-sky-50 border-sky-400 shadow-sm' : 'bg-white border-slate-200';
  const clickProps = onSelectBird ? {
    onClick: () => onSelectBird({ speciesCode: bird.speciesCode, comName: bird.comName }),
    className: 'cursor-pointer hover:border-sky-300 hover:shadow-sm transition-shadow',
  } : { className: '' };

  if (bird.category === 'notAsked') {
    return (
      <div className={`${baseCard} rounded-xl border px-4 py-3 flex items-center justify-between ${clickProps.className}`} onClick={clickProps.onClick}>
        <div>
          <span className="font-medium text-slate-700">{bird.comName}</span>
          <span className="text-xs text-slate-400 ml-2 italic">{bird.sciName}</span>
        </div>
        {DEV_SHOW_PALETTE_SPLIT && (
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            bird.isSeeded
              ? 'bg-amber-100 text-amber-700'
              : 'bg-slate-100 text-slate-500'
          }`}>
            {bird.isSeeded ? 'Seeded' : 'Unseen'}
          </span>
        )}
      </div>
    );
  }

  if (bird.category === 'mastered') {
    const totalCorrect  = bird.records.reduce((s, r) => s + r.correct, 0);
    const totalAttempts = bird.records.reduce((s, r) => s + r.correct + r.incorrect, 0);
    const pct = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : null;
    return (
      <div className={`${baseCard} rounded-xl border px-4 py-3 flex items-center justify-between ${clickProps.className}`} onClick={clickProps.onClick}>
        <div className="flex items-center gap-2">
          <span className="font-medium text-slate-700">{bird.comName}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${MASTERED_BADGE_COLOR}`}>
            Mastered
          </span>
        </div>
        {pct !== null && (
          <span className="text-sm font-semibold text-slate-500">{pct}%</span>
        )}
      </div>
    );
  }

  // easy / medium / hard
  return (
    <div className={`${baseCard} rounded-xl border px-4 py-3 ${clickProps.className}`} onClick={clickProps.onClick}>
      <p className="font-medium text-slate-700 mb-1.5">{bird.comName}</p>
      <div className="flex flex-wrap gap-2">
        {bird.records.filter(r => !r.isMastered).map(r => (
          <ProgressTypePill key={r.questionType} record={r} />
        ))}
{bird.records.filter(r => r.isMastered).map(r => (
          <ProgressTypePill key={r.questionType} record={r} />
        ))}
      </div>
    </div>
  );
}
