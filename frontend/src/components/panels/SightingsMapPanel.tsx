import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { RegionalSighting } from '../../services/remote/api';
import { fetchSpeciesSightings } from '../../services/remote/api';
import type { MapMode } from '../bird/SightingsMap';
import { MapModeToggle } from '../ui/MapModeToggle';

const SightingsMap = lazy(() =>
  import('../bird/SightingsMap').then(m => ({ default: m.SightingsMap })),
);

interface Props {
  allSightings:     RegionalSighting[];
  selectedSighting: RegionalSighting | null;
  regionCode:       string;
}

export function SightingsMapPanel({ allSightings, selectedSighting, regionCode }: Props) {
  const [mode, setMode] = useState<MapMode>('single');
  const [speciesSightings, setSpeciesSightings] = useState<RegionalSighting[]>([]);
  const [speciesLoading, setSpeciesLoading]     = useState(false);
  // Track which species we've already fetched to avoid redundant calls.
  const fetchedSpeciesRef = useRef<string | null>(null);

  useEffect(() => {
    if (mode !== 'species' || !selectedSighting) return;
    const key = `${selectedSighting.speciesCode}:${regionCode}`;
    if (fetchedSpeciesRef.current === key) return;
    fetchedSpeciesRef.current = key;
    setSpeciesSightings([]);
    setSpeciesLoading(true);
    fetchSpeciesSightings(selectedSighting.speciesCode, regionCode).then(data => {
      setSpeciesSightings(data);
      setSpeciesLoading(false);
    });
  }, [mode, selectedSighting, regionCode]);

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
      <MapModeToggle mode={mode} onModeChange={setMode} speciesLoading={speciesLoading} />

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
            speciesSightings={speciesSightings}
          />
        </Suspense>
      </div>
    </div>
  );
}
