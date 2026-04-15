import { lazy, Suspense, useEffect, useState } from 'react';
import type { RegionalSighting } from '../../services/remote/api';
import type { MapMode } from '../bird/SightingsMap';

const SightingsMap = lazy(() =>
  import('../bird/SightingsMap').then(m => ({ default: m.SightingsMap })),
);

interface Props {
  allSightings:     RegionalSighting[];
  selectedSighting: RegionalSighting | null;
}

const btnBase = 'px-3 py-1 text-xs font-semibold rounded-full border transition-colors whitespace-nowrap';
const btnActive = 'bg-sky-600 border-sky-600 text-white';
const btnInactive = 'bg-white border-slate-300 text-slate-600 hover:border-sky-400';

export function SightingsMapPanel({ allSightings, selectedSighting }: Props) {
  const [mode, setMode] = useState<MapMode>('single');

  // Reset to single-pin view whenever the user picks a different sighting.
  useEffect(() => {
    setMode('single');
  }, [selectedSighting]);

  if (!selectedSighting) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 text-sm p-6 text-center">
        Select a sighting from the list to view it on the map
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ height: '100%' }}>
      {/* Toggle bar — lives outside the Leaflet container so layout is unambiguous */}
      <div className="shrink-0 flex gap-2 px-3 py-2 border-b border-slate-200 bg-white overflow-x-auto">
        <button className={`${btnBase} ${mode === 'single'  ? btnActive : btnInactive}`} onClick={() => setMode('single')}>Only this sighting</button>
        <button className={`${btnBase} ${mode === 'species' ? btnActive : btnInactive}`} onClick={() => setMode('species')}>All for this species</button>
        <button className={`${btnBase} ${mode === 'all'     ? btnActive : btnInactive}`} onClick={() => setMode('all')}>All sightings</button>
      </div>

      {/* Map — fills remaining height */}
      <div className="flex-1 min-h-0 relative">
        <Suspense fallback={
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-slate-400 text-sm">Loading map…</p>
          </div>
        }>
          <SightingsMap
            allSightings={allSightings}
            selectedSighting={selectedSighting}
            mode={mode}
          />
        </Suspense>
      </div>
    </div>
  );
}
