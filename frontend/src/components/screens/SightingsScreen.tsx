import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import type { RegionalSighting } from '../../services/remote/api';
import { fetchRegionalSightings, fetchSpeciesSightings } from '../../services/remote/api';
import { db } from '../../lib/db';
import type { BirdProgress } from '../../types';
import type { MapMode } from '../bird/SightingsMap';
import { ProgressTypePill } from '../ui/ProgressTypePill';

// Lazy-load the Leaflet map so its bundle is only fetched on first use.
const SightingsMap = lazy(() =>
  import('../bird/SightingsMap').then(m => ({ default: m.SightingsMap })),
);

/** Groups progress records by species code. */
function buildProgressMap(records: BirdProgress[]): Map<string, BirdProgress[]> {
  const map = new Map<string, BirdProgress[]>();
  for (const r of records) {
    const arr = map.get(r.speciesCode) ?? [];
    arr.push(r);
    map.set(r.speciesCode, arr);
  }
  return map;
}

function formatObsDt(obsDt: string): string {
  const d = new Date(obsDt.replace(' ', 'T'));
  if (isNaN(d.getTime())) return obsDt;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return time;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${time}`;
}

interface Props {
  regionCode:        string;
  isDesktop:         boolean;
  onBack:            () => void;
  /** Called once sightings are fetched, so App can share them with the map panel. */
  onSightingsLoaded?: (sightings: RegionalSighting[]) => void;
  /** Desktop only — called when a row is selected so the map panel can react. */
  onSelectSighting?: (sighting: RegionalSighting | null) => void;
  /** Desktop only — currently selected sighting (controlled from App). */
  selectedSighting?: RegionalSighting | null;
}

export function SightingsScreen({ regionCode, isDesktop, onBack, onSightingsLoaded, onSelectSighting, selectedSighting: externalSelected }: Props) {
  const [sightings,    setSightings]    = useState<RegionalSighting[]>([]);
  const [progressMap,  setProgressMap]  = useState<Map<string, BirdProgress[]>>(new Map());
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);

  // Mobile only: sighting selected to show on map screen.
  // Initialise from externalSelected when arriving directly from a blue tile click.
  const [mobileSelected, setMobileSelected] = useState<RegionalSighting | null>(
    !isDesktop && externalSelected ? externalSelected : null,
  );
  const [mapMode, setMapMode] = useState<MapMode>('single');
  const [speciesSightings, setSpeciesSightings] = useState<RegionalSighting[]>([]);
  const [speciesLoading,   setSpeciesLoading]   = useState(false);
  const fetchedSpeciesRef = useRef<string | null>(null);
  // True when the map was opened via a blue tile (not by tapping a list item).
  // Controls whether the back arrow returns to the previous screen or to the list.
  const [directMap, setDirectMap] = useState(!isDesktop && !!externalSelected);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      fetchRegionalSightings(regionCode),
      db.progress.toArray(),
    ]).then(([s, records]) => {
      if (cancelled) return;
      setSightings(s);
      onSightingsLoaded?.(s);
      setProgressMap(buildProgressMap(records));
      setLoading(false);
      // Auto-select the first sighting on desktop, but only when nothing was pre-selected.
      if (isDesktop && onSelectSighting && s.length > 0 && !externalSelected) {
        onSelectSighting(s[0]);
      }
    }).catch(() => {
      if (!cancelled) { setError('Failed to load sightings'); setLoading(false); }
    });

    return () => { cancelled = true; };
  }, [regionCode]);

  useEffect(() => {
    if (mapMode !== 'species' || !mobileSelected) return;
    const key = `${mobileSelected.speciesCode}:${regionCode}`;
    if (fetchedSpeciesRef.current === key) return;
    fetchedSpeciesRef.current = key;
    setSpeciesSightings([]);
    setSpeciesLoading(true);
    fetchSpeciesSightings(mobileSelected.speciesCode, regionCode).then(data => {
      setSpeciesSightings(data);
      setSpeciesLoading(false);
    });
  }, [mapMode, mobileSelected, regionCode]);

  const handleSelectSighting = (s: RegionalSighting) => {
    if (isDesktop) {
      onSelectSighting?.(s);
    } else {
      setDirectMap(false);
      setMobileSelected(s);
    }
  };

  // Deduplicate sightings for display — same species+location+date can appear multiple times.
  // Must be declared before any early returns to satisfy the Rules of Hooks.
  const displaySightings = useMemo(() => {
    const seen = new Set<string>();
    const result: RegionalSighting[] = [];
    for (const s of sightings) {
      const k = `${s.speciesCode}|${s.locName}|${s.obsDt}`;
      if (!seen.has(k)) { seen.add(k); result.push(s); }
    }
    return result;
  }, [sightings]);

  const activeSelected = isDesktop ? externalSelected : null;

  const btnBase = 'px-3 py-1 text-xs font-semibold rounded-full border transition-colors whitespace-nowrap';
  const btnActive = 'bg-sky-600 border-sky-600 text-white';
  const btnInactive = 'bg-white border-slate-300 text-slate-600 hover:border-sky-400';

  // Mobile map screen — rendered on top of the list.
  if (!isDesktop && mobileSelected) {
    return (
      <div className="flex flex-col h-dvh">
        {/* Header */}
        <div className="shrink-0 flex items-center gap-2 px-3 py-3 border-b border-slate-200 bg-white">
          <button
            onClick={() => directMap ? onBack() : setMobileSelected(null)}
            className="text-slate-500 hover:text-slate-700 text-5xl"
            aria-label="Back"
          >
            ←
          </button>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-700 truncate">{mobileSelected.comName}</p>
            <p className="text-xs text-slate-400 truncate">{mobileSelected.locName}</p>
          </div>
        </div>

        {/* Toggle — sits clearly above the Leaflet container */}
        <div className="shrink-0 flex gap-2 px-3 py-2 border-b border-slate-200 bg-white overflow-x-auto">
          <button className={`${btnBase} ${mapMode === 'single'  ? btnActive : btnInactive}`} onClick={() => setMapMode('single')}>Only this sighting</button>
          <button className={`${btnBase} ${mapMode === 'species' ? btnActive : btnInactive}`} onClick={() => setMapMode('species')}>
            {mapMode === 'species' && speciesLoading ? 'Loading…' : 'All for this species'}
          </button>
          <button className={`${btnBase} ${mapMode === 'all'     ? btnActive : btnInactive}`} onClick={() => setMapMode('all')}>All sightings</button>
        </div>

        {/* Map fills remaining height */}
        <div className="flex-1 min-h-0 relative">
          <Suspense fallback={
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-slate-400 text-sm">Loading map…</p>
            </div>
          }>
            <SightingsMap
              allSightings={sightings}
              selectedSighting={mobileSelected}
              mode={mapMode}
              speciesSightings={speciesSightings}
            />
          </Suspense>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-dvh lg:h-full">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-3 border-b border-slate-200 bg-white">
        <button
          onClick={onBack}
          className="text-slate-500 hover:text-slate-700 text-5xl"
          aria-label="Back"
        >
          ←
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-700">Recent Sightings</p>
          <p className="text-xs text-slate-400">Past 24 hours · {regionCode}</p>
        </div>
        {!loading && !error && (
          <span className="text-xs text-slate-400 shrink-0">{displaySightings.length} sighting{displaySightings.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
        {loading && (
          <p className="text-sm text-slate-400 text-center mt-8">Loading sightings…</p>
        )}
        {error && (
          <p className="text-sm text-red-500 text-center mt-8">{error}</p>
        )}
        {!loading && !error && displaySightings.length === 0 && (
          <p className="text-sm text-slate-400 text-center mt-8">No sightings in the past 24 hours</p>
        )}
        {!loading && !error && displaySightings.map((s, i) => {
          const records = progressMap.get(s.speciesCode) ?? [];
          const isActive = activeSelected != null &&
            activeSelected.speciesCode === s.speciesCode &&
            activeSelected.obsDt === s.obsDt &&
            activeSelected.locName === s.locName;
          return (
            <button
              key={i}
              onClick={() => handleSelectSighting(s)}
              className={`w-full text-left rounded-xl border p-4 mb-2 transition-shadow flex items-start gap-2 cursor-pointer ${
                isActive
                  ? 'bg-sky-50 border-sky-400 shadow-sm'
                  : 'bg-white border-slate-200 hover:border-sky-300 hover:shadow-sm'
              }`}
            >
              {/* Left: species + location */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{s.comName}</p>
                {records.length > 0 && (
                  <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-1 mb-0.5">
                    {records.map(r => (
                      <ProgressTypePill key={r.questionType} record={r} />
                    ))}
                  </div>
                )}
                {records.length === 0 && (
                  <span className="text-[10px] text-slate-400">Not studied</span>
                )}
                <p className="text-xs text-slate-500 truncate mt-0.5">{s.locName}</p>
                {s.userDisplayName && (
                  <p className="text-[10px] text-slate-400 truncate">Reported by {s.userDisplayName}</p>
                )}
              </div>
              {/* Right: time + count */}
              <div className="shrink-0 text-right">
                <p className="text-xs text-slate-500 whitespace-nowrap">{formatObsDt(s.obsDt)}</p>
                {s.howMany != null && (
                  <span className="text-[10px] bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded-full">×{s.howMany}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
