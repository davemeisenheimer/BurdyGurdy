import { useEffect, useState } from 'react';
import { db } from '../../lib/db';
import type { BirdProgress, QuestionType } from '../../types';

const TYPE_LABELS: Partial<Record<QuestionType, string>> = {
  song: 'Song', image: 'Photo', latin: 'Latin', family: 'Family',
  order: 'Order', sono: 'Spectro',
  'image-latin': 'Photo+Latin', 'song-latin': 'Song+Latin', 'family-latin': 'Family+Latin',
  'image-song': 'Photo+Song', 'sono-song': 'Spectro+Song', 'latin-song': 'Latin+Song',
};

interface Props {
  regionCode:    string;
  recentDays:    number;
  questionTypes: QuestionType[];
  onClose:       () => void;
  onTrimmed:     (deleted: Array<{ speciesCode: string; questionType: string }>) => void;
}

export function TrimProgressDialog({ regionCode, recentDays, questionTypes, onClose, onTrimmed }: Props) {
  const [loading, setLoading]             = useState(true);
  const [noCache, setNoCache]             = useState(false);
  const [affected, setAffected]           = useState<BirdProgress[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<Set<QuestionType>>(new Set(questionTypes));
  const [working, setWorking]             = useState(false);

  useEffect(() => {
    (async () => {
      const cacheKey = `${regionCode}:${recentDays}`;
      const [cached, allProgress] = await Promise.all([
        db.regionSpecies.get(cacheKey),
        db.progress.toArray(),
      ]);
      if (!cached || cached.species.length === 0) {
        setNoCache(true);
        setLoading(false);
        return;
      }
      const inWindow = new Set(cached.species.filter(s => !s.isHistorical).map(s => s.speciesCode));
      setAffected(allProgress.filter(r => !inWindow.has(r.speciesCode) && !r.excluded));
      setLoading(false);
    })().catch(() => setLoading(false));
  }, [regionCode, recentDays]);

  const availableTypes = [...new Set(affected.map(r => r.questionType))].sort(
    (a, b) => (TYPE_LABELS[a] ?? a).localeCompare(TYPE_LABELS[b] ?? b),
  );

  const toDelete   = affected.filter(r => selectedTypes.has(r.questionType));
  const windowLabel = recentDays === 1 ? '1 day' : `${recentDays} days`;

  // Unique birds sorted by name, each annotated with which type labels will be deleted
  const birdsToDelete = [...new Map(toDelete.map(r => [r.speciesCode, r.comName])).entries()]
    .map(([speciesCode, comName]) => ({
      speciesCode,
      comName,
      typeLabels: toDelete
        .filter(r => r.speciesCode === speciesCode)
        .map(r => TYPE_LABELS[r.questionType] ?? r.questionType)
        .join(', '),
    }))
    .sort((a, b) => a.comName.localeCompare(b.comName));

  const toggleType = (type: QuestionType) => {
    setSelectedTypes(prev => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  };

  const handleConfirm = async () => {
    setWorking(true);
    const deleted = toDelete.map(r => ({ speciesCode: r.speciesCode, questionType: r.questionType }));
    await db.progress
      .where('[speciesCode+questionType]')
      .anyOf(deleted.map(r => [r.speciesCode, r.questionType]))
      .delete();
    onTrimmed(deleted);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col max-h-[85vh]">

        {/* Header */}
        <div className="shrink-0 px-6 pt-5 pb-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-800">Trim Outdated Progress</h2>
          <p className="text-sm text-slate-500 mt-1">
            Remove progress for birds no longer seen in your region in the past {windowLabel}.
            Birds marked "do not show again" are kept. The algorithm for generating quiz questions
            will always favour the birds you haven't mastered, that are also currently in your 
            area. So, you may wish use this feature in order to see the new birds trickling  
            into your area each day, as you are given the opportunity to remaster them with
            your morning coffee.
          </p>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
          {loading ? (
            <p className="text-slate-400 text-sm text-center py-8">Loading…</p>
          ) : noCache ? (
            <p className="text-slate-500 text-sm text-center py-8">
              No species data found for this region and window.
              Play a round first to populate the cache.
            </p>
          ) : affected.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-8">
              Nothing to trim — all your progress is for birds currently in your region's window. 🎉
            </p>
          ) : (
            <>
              {/* Question type filter — only shown when multiple types are affected */}
              {availableTypes.length > 1 && (
                <div className="mb-5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    Question types to trim
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {availableTypes.map(type => (
                      <label
                        key={type}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs cursor-pointer transition-colors ${
                          selectedTypes.has(type)
                            ? 'bg-red-50 border-red-300 text-red-700'
                            : 'bg-slate-50 border-slate-200 text-slate-400'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={selectedTypes.has(type)}
                          onChange={() => toggleType(type)}
                        />
                        {TYPE_LABELS[type] ?? type}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Bird list */}
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                {birdsToDelete.length} bird{birdsToDelete.length !== 1 ? 's' : ''}
                {' · '}
                {toDelete.length} record{toDelete.length !== 1 ? 's' : ''} will be removed
              </p>

              {birdsToDelete.length === 0 ? (
                <p className="text-slate-400 text-sm">No records match the selected types.</p>
              ) : (
                <div className="border border-slate-100 rounded-xl overflow-hidden">
                  {birdsToDelete.map((b, i) => (
                    <div
                      key={b.speciesCode}
                      className={`flex items-center justify-between px-3 py-2 ${i % 2 === 1 ? 'bg-slate-50' : 'bg-white'}`}
                    >
                      <span className="text-sm text-slate-700">{b.comName}</span>
                      <span className="text-xs text-slate-400 ml-2 shrink-0">{b.typeLabels}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex gap-3 px-6 py-4 border-t border-slate-100">
          <button
            onClick={onClose}
            disabled={working}
            className="flex-1 px-4 py-2 border border-slate-300 text-slate-600 rounded-xl text-sm hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          {!loading && !noCache && birdsToDelete.length > 0 && (
            <button
              onClick={handleConfirm}
              disabled={working}
              className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {working ? 'Removing…' : `Remove ${toDelete.length} record${toDelete.length !== 1 ? 's' : ''}`}
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
