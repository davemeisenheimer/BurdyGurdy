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

const BADGE: Record<RecentProgressCategory, { label: string; className: string }> = {
  notAsked: { label: 'Not asked',  className: 'text-slate-400 text-xs' },
  easy:     { label: 'Easy',       className: 'text-xs px-1.5 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600' },
  medium:   { label: 'Medium',     className: 'text-xs px-1.5 py-0.5 rounded-full font-medium bg-sky-50 text-sky-700' },
  hard:     { label: 'Hard',       className: 'text-xs px-1.5 py-0.5 rounded-full font-medium bg-purple-50 text-purple-700' },
  mastered: { label: 'Mastered',   className: 'text-xs px-1.5 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-700' },
};

function BirdRow({ entry }: { entry: RecentBirdEntry }) {
  const badge = BADGE[entry.category];
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
      <div>
        <span className="text-sm font-medium text-slate-700">{entry.comName}</span>
        <span className="text-xs text-slate-400 ml-1.5 italic">{entry.sciName}</span>
      </div>
      <span className={badge.className}>{badge.label}</span>
    </div>
  );
}

function toFakeCached(s: SnapshotSpecies): CachedSpecies {
  return { speciesCode: s.speciesCode, comName: s.comName, sciName: s.sciName };
}

export function RegionUpdateDialog({ info, progressRecords, questionTypes, onDismiss }: Props) {
  const addedEntries   = categoriseRecentBirds(info.added, progressRecords, questionTypes);
  const droppedEntries = categoriseRecentBirds(info.dropped.map(toFakeCached), progressRecords, questionTypes);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col">

        {/* Header */}
        <div className="px-5 pt-5 pb-3 shrink-0">
          <h2 className="text-lg font-bold text-slate-800">Sightings Window Updated</h2>
          <p className="text-sm text-slate-500 mt-1">
            {[
              info.added.length   > 0 && `${info.added.length} new`,
              info.dropped.length > 0 && `${info.dropped.length} dropped`,
            ].filter(Boolean).join(' · ')}
          </p>
        </div>

        {/* Scrollable bird lists */}
        <div className="flex-1 overflow-y-auto px-5 pb-2">
          {addedEntries.length > 0 && (
            <section className="mb-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-700 mb-1 pt-1">
                New in today's window ({addedEntries.length})
              </h3>
              {addedEntries.map(e => <BirdRow key={e.speciesCode} entry={e} />)}
            </section>
          )}
          {droppedEntries.length > 0 && (
            <section className="mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1 pt-1">
                No longer in today's window ({droppedEntries.length})
              </h3>
              {droppedEntries.map(e => <BirdRow key={e.speciesCode} entry={e} />)}
            </section>
          )}
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
