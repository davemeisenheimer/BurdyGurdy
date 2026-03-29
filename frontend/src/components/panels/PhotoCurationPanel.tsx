import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { db } from '../../lib/db';
import { fetchBirdPhotos, fetchAllSpecies } from '../../services/remote/api';
import { blockPhotoDirectly, unblockPhotoDirectly } from '../../lib/adminSync';
import type { AllSpeciesEntry } from '../../services/remote/api';

interface PhotoEntry { url: string; label: string; }

const MAX_LIST = 400;
const DOUBLE_CLICK_MS = 250;

export function PhotoCurationPanel() {
  const [allSpecies, setAllSpecies]       = useState<AllSpeciesEntry[]>([]);
  const [loadingList, setLoadingList]     = useState(true);
  const [search, setSearch]               = useState('');
  const [selected, setSelected]           = useState<AllSpeciesEntry | null>(null);
  const [photos, setPhotos]               = useState<PhotoEntry[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [blocked, setBlocked]             = useState<Map<string, 'full' | 'question'>>(new Map());
  const [blockScope, setBlockScope]       = useState<'full' | 'question'>('question');
  const [busy, setBusy]                   = useState<Set<string>>(new Set());

  // Refs so debounced callbacks always see current state
  const blockedRef  = useRef(blocked);
  const selectedRef = useRef(selected);
  const busyRef     = useRef(busy);
  useEffect(() => { blockedRef.current  = blocked;  }, [blocked]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { busyRef.current     = busy;     }, [busy]);

  const clickTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingUrlRef    = useRef<string | null>(null);

  useEffect(() => {
    fetchAllSpecies()
      .then(list => setAllSpecies(list))
      .finally(() => setLoadingList(false));
  }, []);

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
      const [{ primary, optional }, blockedRows] = await Promise.all([
        fetchBirdPhotos(bird.speciesCode, bird.comName, bird.sciName),
        db.adminBlockedMedia.filter(r => r.speciesCode === bird.speciesCode).toArray(),
      ]);
      setBlocked(new Map(blockedRows.map(r => [r.url, r.blockScope])));
      setPhotos([
        ...(primary ? [{ url: primary.url, label: 'Primary' }] : []),
        ...optional.map((p, i) => ({ url: p.url, label: `Opt ${i + 1}` })),
      ]);
    } finally {
      setLoadingPhotos(false);
    }
  }, []);

  const doBlock = useCallback(async (url: string, scope: 'full' | 'question') => {
    const bird = selectedRef.current;
    if (!bird) return;
    setBlockScope(scope);
    setBusy(prev => new Set([...prev, url]));
    try {
      await blockPhotoDirectly(url, bird.speciesCode, bird.comName, scope);
      setBlocked(prev => new Map([...prev, [url, scope]]));
    } catch (e) {
      console.error('block failed', e);
    } finally {
      setBusy(prev => { const s = new Set(prev); s.delete(url); return s; });
    }
  }, []);

  const doUnblock = useCallback(async (url: string) => {
    const bird = selectedRef.current;
    if (!bird) return;
    setBusy(prev => new Set([...prev, url]));
    try {
      await unblockPhotoDirectly(url, bird.speciesCode);
      setBlocked(prev => { const m = new Map(prev); m.delete(url); return m; });
    } catch (e) {
      console.error('unblock failed', e);
    } finally {
      setBusy(prev => { const s = new Set(prev); s.delete(url); return s; });
    }
  }, []);

  const handlePhotoClick = useCallback((url: string) => {
    if (busyRef.current.has(url)) return;

    const currentBlocked = blockedRef.current;

    if (currentBlocked.has(url)) {
      // Clicking a blocked photo: show its scope and unblock
      setBlockScope(currentBlocked.get(url)!);
      doUnblock(url);
      return;
    }

    // Unblocked photo: single click = 'question', double click = 'full'
    if (pendingUrlRef.current === url) {
      // Second click within window → double click, block everywhere
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      pendingUrlRef.current = null;
      doBlock(url, 'full');
    } else {
      // First click — wait to see if double click arrives
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      pendingUrlRef.current = url;
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        if (pendingUrlRef.current === url) {
          pendingUrlRef.current = null;
          doBlock(url, 'question');
        }
      }, DOUBLE_CLICK_MS);
    }
  }, [doBlock, doUnblock]);

  const blockedCount = photos.filter(p => blocked.has(p.url)).length;

  return (
    <div className="flex flex-col h-full bg-slate-50">

      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-slate-200 bg-amber-50">
        <p className="text-xs font-bold uppercase tracking-wider text-amber-700">
          Photo Curation
        </p>
        <p className="text-xs text-amber-600 mt-0.5">
          Click to block from questions; double-click to block everywhere
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

              {/* Scope indicator — updates to reflect last interaction */}
              <div className="flex gap-2 mb-3">
                {(['question', 'full'] as const).map(s => (
                  <div key={s} className={`flex-1 flex items-center justify-center gap-1.5 border rounded-lg px-2 py-1.5 text-xs select-none ${blockScope === s ? 'border-red-500 bg-red-50 text-red-700 font-medium' : 'border-slate-200 text-slate-400'}`}>
                    {s === 'question' ? '1× Block from questions only' : '2× Block everywhere'}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-5 gap-1.5">
                {photos.map(({ url, label }) => {
                  const scope = blocked.get(url);
                  const isBlocked = scope !== undefined;
                  const isBusy = busy.has(url);
                  return (
                    <button
                      key={url}
                      onClick={() => handlePhotoClick(url)}
                      disabled={isBusy}
                      className={`relative rounded-lg overflow-hidden border-2 transition-all ${
                        isBlocked ? 'border-red-500' : 'border-transparent hover:border-slate-300'
                      } ${isBusy ? 'opacity-50' : ''}`}
                    >
                      <img
                        src={url}
                        alt={selected.comName}
                        className={`w-full aspect-square object-cover ${isBlocked ? 'opacity-40' : ''}`}
                      />
                      <div className="absolute bottom-0 inset-x-0 flex items-center justify-between px-1 py-0.5 bg-black/50">
                        <span className="text-white text-xs">{label}</span>
                        {isBlocked && (
                          <span className="text-red-300 text-[10px] font-semibold">
                            {scope === 'question' ? 'Q only' : '✕'}
                          </span>
                        )}
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
