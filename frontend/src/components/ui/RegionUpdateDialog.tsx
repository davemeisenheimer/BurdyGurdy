import { Fragment } from 'react';
import { categoriseRecentBirds } from '../../lib/recentProgress';
import type { RecentBirdEntry, RecentProgressCategory } from '../../lib/recentProgress';
import type { BirdProgress, CachedSpecies, QuestionType } from '../../types';
import type { RegionUpdateInfo, SnapshotSpecies } from '../../services/local/regionSnapshot';

interface Props {
  info: RegionUpdateInfo;
  progressRecords: BirdProgress[];
  questionTypes: QuestionType[];
  onDismiss: () => void;
}

const CATEGORY_ORDER: RecentProgressCategory[] = ['notAsked', 'easy', 'medium', 'hard', 'mastered'];

const CATEGORY_LABEL: Record<RecentProgressCategory, string> = {
  notAsked: 'Not asked yet',
  easy:     'Easy',
  medium:   'Medium',
  hard:     'Hard',
  mastered: 'Mastered',
};

const BADGE: Record<RecentProgressCategory, string> = {
  notAsked: 'text-slate-400 text-xs',
  easy:     'text-xs px-1.5 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600',
  medium:   'text-xs px-1.5 py-0.5 rounded-full font-medium bg-sky-50 text-sky-700',
  hard:     'text-xs px-1.5 py-0.5 rounded-full font-medium bg-purple-50 text-purple-700',
  mastered: 'text-xs px-1.5 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-700',
};

function BirdRow({ entry }: { entry: RecentBirdEntry }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
      <div>
        <span className="text-sm font-medium text-slate-700">{entry.comName}</span>
        <span className="text-xs text-slate-400 ml-1.5 italic">{entry.sciName}</span>
      </div>
      <span className={BADGE[entry.category]}>{CATEGORY_LABEL[entry.category]}</span>
    </div>
  );
}

function BirdSection({ title, titleColor, entries }: {
  title: string;
  titleColor: string;
  entries: RecentBirdEntry[];
}) {
  if (entries.length === 0) return null;
  const byCategory = CATEGORY_ORDER.map(cat => ({
    cat,
    birds: entries.filter(e => e.category === cat),
  })).filter(g => g.birds.length > 0);

  return (
    <section className="mb-4 bg-sky-50 rounded-xl p-3">
      <h3 className={`text-xs font-semibold uppercase tracking-wider mb-1 pt-1 ${titleColor}`}>
        {title} ({entries.length})
      </h3>
      {byCategory.map(({ cat, birds }) => (
        <Fragment key={cat}>
          {byCategory.length > 1 && (
            <p className="text-xs text-slate-400 font-medium mt-2 mb-0.5">{CATEGORY_LABEL[cat]}</p>
          )}
          {birds.map(e => <BirdRow key={e.speciesCode} entry={e} />)}
        </Fragment>
      ))}
    </section>
  );
}

function toFakeCached(s: SnapshotSpecies): CachedSpecies {
  return { speciesCode: s.speciesCode, comName: s.comName, sciName: s.sciName };
}

const QUESTION_TYPE_LABEL: Partial<Record<QuestionType, string>> = {
  image:        'Photo',
  song:         'Song',
  latin:        'Scientific name',
  family:       'Family',
  order:        'Order',
  sono:         'Spectrogram',
  'image-latin':  'Photo → Latin',
  'song-latin':   'Song → Latin',
  'family-latin': 'Family → Latin',
  'image-song':   'Photo + Song',
  'sono-song':    'Spectrogram + Song',
  'latin-song':   'Latin + Song',
};

function formatQuestionTypes(types: QuestionType[]): string {
  return types.map(t => QUESTION_TYPE_LABEL[t] ?? t).join(', ');
}

function formatWindowDate(date: Date): string {
  return date.toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });
}

export function RegionUpdateDialog({ info, progressRecords, questionTypes, onDismiss }: Props) {
  const addedEntries     = categoriseRecentBirds(info.added, progressRecords, questionTypes);
  const unchangedEntries = categoriseRecentBirds(info.unchanged, progressRecords, questionTypes);
  const droppedEntries   = categoriseRecentBirds(info.dropped.map(toFakeCached), progressRecords, questionTypes);

  const backMs       = info.back * 24 * 60 * 60 * 1000;
  const oldEnd       = info.savedAt ? new Date(info.savedAt) : null;
  const oldStart     = oldEnd ? new Date(oldEnd.getTime() - backMs) : null;
  const newEnd       = new Date();
  const newStart     = new Date(newEnd.getTime() - backMs);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-sky-50 rounded-2xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col">

        {/* Header */}
        <div className="px-5 pt-5 pb-3 shrink-0">
          <h2 className="text-lg font-bold text-slate-800">Sightings Window Updated</h2>
          <div className="mt-1.5 text-xs text-slate-500 space-y-0.5">
            {oldStart && oldEnd && (
              <p><span className="text-slate-400">Was:</span> {formatWindowDate(oldStart)} – {formatWindowDate(oldEnd)}</p>
            )}
            <p><span className="text-slate-400">Now:</span> {formatWindowDate(newStart)} – {formatWindowDate(newEnd)}</p>
          </div>
          <p className="text-sm text-slate-500 mt-1.5">
            {[
              info.added.length   > 0 && `${info.added.length} new`,
              info.dropped.length > 0 && `${info.dropped.length} dropped`,
            ].filter(Boolean).join(' · ')}
          </p>
          <p className="mt-1 text-xs font-semibold tracking-wide text-sky-700">
            Question types: <span className="uppercase">{formatQuestionTypes(questionTypes)}</span>
          </p>
        </div>

        {/* Scrollable bird lists */}
        <div className="flex-1 overflow-y-auto px-5 pb-2">
          <BirdSection
            title="New in today's window"
            titleColor="text-emerald-700"
            entries={addedEntries}
          />
          <BirdSection
            title="No longer in today's window"
            titleColor="text-red-700"
            entries={droppedEntries}
          />
          <BirdSection
            title="Still in the window"
            titleColor="text-sky-700"
            entries={unchangedEntries}
          />
        </div>

        {/* Footer */}
        <div className="px-5 py-4 shrink-0 border-t border-slate-100">
          <button
            onClick={onDismiss}
            className="w-full bg-forest-600 hover:bg-forest-700 active:bg-forest-800 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
