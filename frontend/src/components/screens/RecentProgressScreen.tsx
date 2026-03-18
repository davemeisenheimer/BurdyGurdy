import { useEffect, useState, Fragment } from 'react';
import { db } from '../../lib/db';
import { categoriseRecentBirds, summariseCounts } from '../../lib/recentProgress';
import { DEV_SHOW_PALETTE_SPLIT } from '../../lib/devFlags';
import { MASTERY_LABELS, MASTERY_BADGE_COLORS, MASTERED_BADGE_COLOR, masteryThreshold, isStruggling } from '../../lib/mastery';
import { MasteryBadge } from '../ui/MasteryBadge';
import type { QuestionType } from '../../types';
import type { RecentBirdEntry, RecentProgressCategory } from '../../lib/recentProgress';

interface Props {
  regionCode: string;
  recentDays: number;
  questionTypes: QuestionType[];
  onBack: () => void;
}

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

export function RecentProgressScreen({ regionCode, recentDays, questionTypes, onBack }: Props) {
  const [entries, setEntries] = useState<RecentBirdEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [noCache, setNoCache] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const cacheKey = `${regionCode}:${recentDays}`;
      const [cached, progressRecords] = await Promise.all([
        db.regionSpecies.get(cacheKey),
        db.progress.toArray(),
      ]);

      if (!cached || cached.species.length === 0) {
        setNoCache(true);
        setLoading(false);
        return;
      }

      setEntries(categoriseRecentBirds(cached.species, progressRecords, questionTypes));
      setLoading(false);
    })().catch(() => setLoading(false));
  }, [regionCode, recentDays]);

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
              <h1 className="text-2xl font-bold text-slate-800">Recent Progress</h1>
              <p className="text-sm text-slate-500">{regionCode} · past {windowLabel} · {total} birds</p>
            </div>
          </div>

          {/* Summary pills */}
          {!loading && !noCache && (
            <div className="flex flex-wrap gap-2 mt-4 mb-4">
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
                    <BirdCard key={bird.speciesCode} bird={bird} questionTypes={questionTypes} />
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

function BirdCard({ bird, questionTypes }: { bird: RecentBirdEntry; questionTypes: QuestionType[] }) {
  if (bird.category === 'notAsked') {
    return (
      <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center justify-between">
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
      <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center justify-between">
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
  const activeRecords = bird.records.filter(r => !r.inHistory);
  const leading = activeRecords.reduce<(typeof activeRecords)[0] | null>((best, r) =>
    (r.masteryLevel ?? 0) >= (best?.masteryLevel ?? -1) ? r : best, null,
  );
  const lvl       = leading?.masteryLevel ?? 0;
  const streak    = leading?.consecutiveCorrect ?? 0;
  const threshold = masteryThreshold(lvl);
  const totalCorrect  = bird.records.reduce((s, r) => s + r.correct, 0);
  const totalAttempts = bird.records.reduce((s, r) => s + r.correct + r.incorrect, 0);
  const pct = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : null;

  const typeCount = questionTypes.length;

  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-slate-700">{bird.comName}</span>
          <MasteryBadge
            className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${MASTERY_BADGE_COLORS[Math.min(lvl, 2)]}`}
            isStruggling={leading !== null && isStruggling(leading.correct, leading.incorrect)}
          >
            {streak}/{threshold} {MASTERY_LABELS[Math.min(lvl, 2)]}
          </MasteryBadge>
          {typeCount > 1 && bird.records.some(r => r.inHistory) && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${MASTERED_BADGE_COLOR}`}>
              {bird.records.filter(r => r.inHistory).length}/{typeCount} mastered
            </span>
          )}
        </div>
        {pct !== null && (
          <span className="text-sm font-semibold text-slate-500">{pct}%</span>
        )}
      </div>
    </div>
  );
}
