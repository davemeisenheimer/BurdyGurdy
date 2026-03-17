import { useState, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, CircleMarker, useMapEvents } from 'react-leaflet';
import type { LatLng } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { locateRegion } from '../../lib/api';
import type { LocateResult } from '../../lib/api';

interface Props {
  onSelect: (code: string, name: string) => void;
  onClose: () => void;
}

/** Tracks map zoom and fires click events with the current zoom level. */
function MapEvents({
  onMapClick,
  onZoomChange,
}: {
  onMapClick: (latlng: LatLng, zoom: number) => void;
  onZoomChange: (zoom: number) => void;
}) {
  const map = useMapEvents({
    click: (e) => onMapClick(e.latlng, map.getZoom()),
    zoomend: () => onZoomChange(map.getZoom()),
  });
  return null;
}

export function MapRegionPicker({ onSelect, onClose }: Props) {
  const [pin, setPin] = useState<LatLng | null>(null);
  const [result, setResult] = useState<LocateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(2);
  // Track in-flight request so stale responses don't overwrite newer ones
  const requestId = useRef(0);

  const handleMapClick = useCallback(async (latlng: LatLng, currentZoom: number) => {
    setPin(latlng);
    setResult(null);
    setError(null);
    setLoading(true);
    const id = ++requestId.current;
    try {
      const data = await locateRegion(latlng.lat, latlng.lng, currentZoom);
      if (id !== requestId.current) return; // stale
      setResult(data);
    } catch (err: unknown) {
      if (id !== requestId.current) return;
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? 'Could not identify region — try a different spot');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  const confirm = (code: string, name: string) => {
    onSelect(code, name);
    onClose();
  };

  const zoomLevel = zoom >= 8 ? 'county' : zoom >= 4 ? 'state' : 'country';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div
        className="relative flex flex-col bg-white rounded-2xl overflow-hidden shadow-2xl w-full max-w-2xl"
        style={{ height: 'min(90dvh, 600px)' }}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div>
            <h2 className="font-semibold text-slate-800">Choose Region</h2>
            <p className="text-xs text-slate-500">
              {zoomLevel === 'county'
                ? 'Click to identify county / district'
                : zoomLevel === 'state'
                ? 'Click to identify state / province · zoom in for county, zoom out for country'
                : 'Click to identify country · zoom in for state / province'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-500 text-lg"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Map */}
        <div className="flex-1 min-h-0">
          <MapContainer
            center={[30, 0]}
            zoom={2}
            minZoom={2}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />
            <MapEvents onMapClick={handleMapClick} onZoomChange={setZoom} />
            {pin && (
              <CircleMarker
                center={pin}
                radius={9}
                pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#16a34a', fillOpacity: 1 }}
              />
            )}
          </MapContainer>
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-4 border-t border-slate-200 bg-slate-50 min-h-[72px] flex items-center">
          {!pin && (
            <p className="text-sm text-slate-400 italic">No location selected yet</p>
          )}
          {loading && (
            <p className="text-sm text-slate-500 animate-pulse">Identifying region…</p>
          )}
          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
          {result && (
            <div className="flex flex-col gap-2 w-full">
              {/* Primary (most specific) */}
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-semibold text-slate-800 leading-tight">{result.regionName}</p>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">{result.regionCode}</p>
                </div>
                <button
                  onClick={() => confirm(result.regionCode, result.regionName)}
                  className="shrink-0 px-4 py-2 rounded-xl bg-forest-600 hover:bg-forest-700 text-white font-semibold text-sm transition-colors"
                >
                  Use this region
                </button>
              </div>

              {/* Broader option when county was returned */}
              {result.broader && (
                <div className="flex items-center justify-between gap-4 pt-1 border-t border-slate-200">
                  <div>
                    <p className="text-sm text-slate-600 leading-tight">{result.broader.name}</p>
                    <p className="text-xs text-slate-400 font-mono mt-0.5">{result.broader.code}</p>
                  </div>
                  <button
                    onClick={() => confirm(result.broader!.code, result.broader!.name)}
                    className="shrink-0 px-4 py-2 rounded-xl border border-slate-300 hover:border-forest-400 text-slate-700 font-semibold text-sm transition-colors"
                  >
                    {result.broader!.code.includes('-') ? 'Use province / state' : 'Use country'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
