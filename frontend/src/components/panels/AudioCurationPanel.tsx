import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { db } from '../../lib/db';
import { fetchBirdAudio, fetchAllSpecies } from '../../services/remote/api';
import { blockAudioDirectly, unblockAudioDirectly } from '../../lib/adminSync';
import type { AllSpeciesEntry, CarouselRecording } from '../../services/remote/api';

const MAX_LIST = 400;
const DOUBLE_CLICK_MS = 250;

const toHttps = (url: string) => url.startsWith('//') ? `https:${url}` : url;

interface RecordingEntry extends CarouselRecording {
  label: string;
}

function AudioPlayer({ url }: { url: string }) {
  const [playing, setPlaying] = useState(false);
  const [error, setError]     = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const httpsUrl = toHttps(url);

  if (error) return <span className="text-slate-400 text-xs">unavailable</span>;

  return (
    <>
      <button
        onClick={e => {
          e.stopPropagation();
          const a = audioRef.current;
          if (!a) return;
          if (playing) a.pause(); else a.play().catch(() => setError(true));
        }}
        className="w-7 h-7 rounded-full bg-slate-200 hover:bg-slate-300 flex items-center justify-center text-slate-700 text-xs shrink-0"
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? '⏸' : '▶'}
      </button>
      <audio
        ref={audioRef}
        src={httpsUrl}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setError(true)}
      />
    </>
  );
}

export function AudioCurationPanel() {
  const [allSpecies, setAllSpecies]           = useState<AllSpeciesEntry[]>([]);
  const [loadingList, setLoadingList]         = useState(true);
  const [search, setSearch]                   = useState('');
  const [selected, setSelected]               = useState<AllSpeciesEntry | null>(null);
  const [recordings, setRecordings]           = useState<RecordingEntry[]>([]);
  const [loadingRecordings, setLoadingRecs]   = useState(false);
  const [blocked, setBlocked]                 = useState<Map<string, 'full' | 'question'>>(new Map());
  const [blockScope, setBlockScope]           = useState<'full' | 'question'>('question');
  const [busy, setBusy]                       = useState<Set<string>>(new Set());

  const blockedRef  = useRef(blocked);
  const selectedRef = useRef(selected);
  const busyRef     = useRef(busy);
  useEffect(() => { blockedRef.current  = blocked;  }, [blocked]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { busyRef.current     = busy;     }, [busy]);

  const clickTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingUrlRef   = useRef<string | null>(null);

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
    setRecordings([]);
    setLoadingRecs(true);
    try {
      const [recs, blockedRows] = await Promise.all([
        fetchBirdAudio(bird.sciName),
        db.adminBlockedMedia.filter(r => r.speciesCode === bird.speciesCode && r.mediaType === 'audio').toArray(),
      ]);
      setBlocked(new Map(blockedRows.map(r => [r.url, r.blockScope])));
      setRecordings(recs.map((r, i) => ({ ...r, label: `#${i + 1}${r.type ? ` · ${r.type}` : ''}${r.country ? ` · ${r.country}` : ''}` })));
    } finally {
      setLoadingRecs(false);
    }
  }, []);

  const doBlock = useCallback(async (url: string, scope: 'full' | 'question') => {
    const bird = selectedRef.current;
    if (!bird) return;
    setBlockScope(scope);
    setBusy(prev => new Set([...prev, url]));
    try {
      await blockAudioDirectly(url, bird.speciesCode, bird.comName, scope);
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
      await unblockAudioDirectly(url, bird.speciesCode);
      setBlocked(prev => { const m = new Map(prev); m.delete(url); return m; });
    } catch (e) {
      console.error('unblock failed', e);
    } finally {
      setBusy(prev => { const s = new Set(prev); s.delete(url); return s; });
    }
  }, []);

  const handleRowClick = useCallback((url: string) => {
    if (busyRef.current.has(url)) return;
    const currentBlocked = blockedRef.current;

    if (currentBlocked.has(url)) {
      setBlockScope(currentBlocked.get(url)!);
      doUnblock(url);
      return;
    }

    if (pendingUrlRef.current === url) {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      pendingUrlRef.current = null;
      doBlock(url, 'full');
    } else {
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

  const blockedCount = recordings.filter(r => blocked.has(r.file)).length;

  return (
    <div className="flex flex-col h-full bg-slate-50">

      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-slate-200 bg-amber-50">
        <p className="text-xs font-bold uppercase tracking-wider text-amber-700">
          Audio Curation
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

        {/* Recording list */}
        <div className="flex-1 overflow-y-auto">
          {!selected && (
            <p className="text-sm text-slate-400 text-center mt-12">← Select a bird</p>
          )}
          {selected && loadingRecordings && (
            <p className="text-sm text-slate-400 text-center mt-12">Loading recordings…</p>
          )}
          {selected && !loadingRecordings && recordings.length === 0 && (
            <p className="text-sm text-slate-400 text-center mt-12">No recordings found</p>
          )}
          {selected && !loadingRecordings && recordings.length > 0 && (
            <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-slate-600">{selected.comName}</p>
                {blockedCount > 0 && (
                  <p className="text-xs text-red-500">{blockedCount} blocked</p>
                )}
              </div>

              {/* Scope indicator */}
              <div className="flex gap-2 mb-3">
                {(['question', 'full'] as const).map(s => (
                  <div key={s} className={`flex-1 flex items-center justify-center gap-1.5 border rounded-lg px-2 py-1.5 text-xs select-none ${blockScope === s ? 'border-red-500 bg-red-50 text-red-700 font-medium' : 'border-slate-200 text-slate-400'}`}>
                    {s === 'question' ? '1× Block from questions only' : '2× Block everywhere'}
                  </div>
                ))}
              </div>

              <div className="space-y-1.5">
                {recordings.map(({ file, label }) => {
                  const scope    = blocked.get(file);
                  const isBlocked = scope !== undefined;
                  const isBusy   = busy.has(file);
                  return (
                    <button
                      key={file}
                      onClick={() => handleRowClick(file)}
                      disabled={isBusy}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border-2 transition-all text-left ${
                        isBlocked ? 'border-red-400 bg-red-50' : 'border-slate-200 bg-white hover:border-slate-300'
                      } ${isBusy ? 'opacity-50' : ''}`}
                    >
                      <AudioPlayer url={file} />
                      <span className={`flex-1 text-xs truncate ${isBlocked ? 'text-red-700' : 'text-slate-600'}`}>
                        {label}
                      </span>
                      {isBlocked && (
                        <span className="text-red-400 text-[10px] font-semibold shrink-0">
                          {scope === 'question' ? 'Q only' : '✕'}
                        </span>
                      )}
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
