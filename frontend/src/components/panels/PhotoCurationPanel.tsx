import { useEffect, useState, useCallback, useMemo } from 'react';
import { db } from '../../lib/db';
import { fetchBirdPhotos, fetchAllSpecies } from '../../lib/api';
import type { AllSpeciesEntry } from '../../lib/api';

interface PhotoEntry { url: string; label: string; }

const MAX_LIST = 400; // max birds rendered at once

export function PhotoCurationPanel() {
  const [allSpecies, setAllSpecies]   = useState<AllSpeciesEntry[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [search, setSearch]           = useState('');
  const [selected, setSelected]       = useState<AllSpeciesEntry | null>(null);
  const [photos, setPhotos]           = useState<PhotoEntry[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [blocked, setBlocked]         = useState<Set<string>>(new Set());

  // Load global species list + blocked set
  useEffect(() => {
    fetchAllSpecies()
      .then(list => setAllSpecies(list))
      .finally(() => setLoadingList(false));
    db.blockedPhotos.toArray()
      .then(rows => setBlocked(new Set(rows.map(r => r.url))));
  }, []);

  // Filter species by search term; NA birds always before non-NA
  const visibleSpecies = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q.length < 2
      ? allSpecies.filter(s => s.isNorthAmerican)
      : allSpecies.filter(s =>
          s.comName.toLowerCase().includes(q) || s.sciName.toLowerCase().includes(q),
        );
    return filtered.slice(0, MAX_LIST);
  }, [allSpecies, search]);

  const selectBird = useCallback(async (bird: AllSpeciesEntry) => {
    setSelected(bird);
    setPhotos([]);
    setLoadingPhotos(true);
    try {
      const { primary, optional } = await fetchBirdPhotos(bird.speciesCode, bird.comName, bird.sciName);
      setPhotos([
        ...(primary ? [{ url: primary, label: 'Primary' }] : []),
        ...optional.map((url, i) => ({ url, label: `Opt ${i + 1}` })),
      ]);
    } finally {
      setLoadingPhotos(false);
    }
  }, []);

  const toggleBlock = useCallback(async (url: string) => {
    if (blocked.has(url)) {
      await db.blockedPhotos.delete(url);
      setBlocked(prev => { const s = new Set(prev); s.delete(url); return s; });
    } else {
      await db.blockedPhotos.put({ url });
      setBlocked(prev => new Set([...prev, url]));
    }
  }, [blocked]);

  const blockedCount = photos.filter(p => blocked.has(p.url)).length;

  return (
    <div className="flex flex-col h-full bg-slate-50">

      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-slate-200 bg-amber-50">
        <p className="text-xs font-bold uppercase tracking-wider text-amber-700">
          ⚠ Temporary: Photo Curation
        </p>
        <p className="text-xs text-amber-600 mt-0.5">
          Will become the bird info panel · Click photos to block/unblock
        </p>
      </div>

      <div className="flex flex-1 min-h-0">

        {/* Bird list */}
        <div className="w-56 shrink-0 border-r border-slate-200 flex flex-col bg-white">
          <div className="shrink-0 p-2 border-b border-slate-100">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search birds…"
              className="w-full text-sm px-2 py-1.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-forest-500"
            />
            <p className="text-xs text-slate-400 mt-1 px-0.5">
              {search.length < 2
                ? `${visibleSpecies.length} N. American birds`
                : `${visibleSpecies.length} results${visibleSpecies.length === MAX_LIST ? ' (refine search)' : ''}`}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loadingList ? (
              <p className="text-xs text-slate-400 p-3 text-center mt-4">Loading species…</p>
            ) : (
              visibleSpecies.map(bird => (
                <button
                  key={bird.speciesCode}
                  onClick={() => selectBird(bird)}
                  className={`w-full text-left px-3 py-1.5 text-sm border-b border-slate-100 transition-colors ${
                    selected?.speciesCode === bird.speciesCode
                      ? 'bg-forest-50 text-forest-700 font-semibold'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {bird.comName}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Photo gallery */}
        <div className="flex-1 overflow-y-auto">
          {!selected && (
            <p className="text-sm text-slate-400 text-center mt-12">← Select a bird</p>
          )}
          {selected && loadingPhotos && (
            <p className="text-sm text-slate-400 text-center mt-12">Loading photos…</p>
          )}
          {selected && !loadingPhotos && photos.length === 0 && (
            <p className="text-sm text-slate-400 text-center mt-12">No photos found</p>
          )}
          {selected && !loadingPhotos && photos.length > 0 && (
            <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-slate-600">{selected.comName}</p>
                {blockedCount > 0 && (
                  <p className="text-xs text-red-500">{blockedCount} blocked</p>
                )}
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {photos.map(({ url, label }) => {
                  const isBlocked = blocked.has(url);
                  return (
                    <button
                      key={url}
                      onClick={() => toggleBlock(url)}
                      className={`relative rounded-lg overflow-hidden border-2 transition-all ${
                        isBlocked ? 'border-red-500' : 'border-transparent hover:border-slate-300'
                      }`}
                    >
                      <img
                        src={url}
                        alt={selected.comName}
                        className={`w-full aspect-square object-cover ${isBlocked ? 'opacity-40' : ''}`}
                      />
                      <div className="absolute bottom-0 inset-x-0 flex items-center justify-between px-1 py-0.5 bg-black/50">
                        <span className="text-white text-xs">{label}</span>
                        {isBlocked && <span className="text-red-300 text-xs font-semibold">✕</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
