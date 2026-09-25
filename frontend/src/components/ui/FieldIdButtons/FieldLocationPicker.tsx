import { useCallback, useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { locateRegion } from '../../../services/remote/api';

export interface PickedLocation {
  lat: number;
  lng: number;
  /** Readable region name for the pin (e.g. "Ottawa"), if the lookup succeeded. */
  name?: string;
}

interface Props {
  /** Existing pin to start from; otherwise the map opens on the user's current location. */
  initial?: { lat: number; lng: number };
  onSelect: (location: PickedLocation) => void;
  onClose: () => void;
}

const WORLD_CENTER: [number, number] = [30, 0];
const PIN_ZOOM = 13;
// locateRegion's zoom hint: >= 8 asks for the most specific (county / district) region.
const LOOKUP_ZOOM = 10;

function MapClicks({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: e => onClick(e.latlng.lat, e.latlng.lng) });
  return null;
}

/** Moves the map once the user's current location arrives. */
function Recenter({ center }: { center: [number, number] | null }) {
  const map = useMap();
  useEffect(() => { if (center) map.setView(center, PIN_ZOOM); }, [center, map]);
  return null;
}

/**
 * Map for pinning where a bird was seen/heard. Tapping drops a pin and looks up a readable
 * region name for it, which the sighting dialog can use as the location text.
 */
export default function FieldLocationPicker({ initial, onSelect, onClose }: Props) {
  const [pin, setPin]         = useState<{ lat: number; lng: number } | null>(initial ?? null);
  const [name, setName]       = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [here, setHere]       = useState<[number, number] | null>(null);
  // Track in-flight lookups so a stale response can't overwrite a newer pin's name
  const requestId = useRef(0);

  useEffect(() => {
    if (initial || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => setHere([pos.coords.latitude, pos.coords.longitude]),
      () => { /* denied or unavailable - stay on the world view */ },
    );
  }, [initial]);

  const handleClick = useCallback(async (lat: number, lng: number) => {
    setPin({ lat, lng });
    setName(undefined);
    setLoading(true);
    const id = ++requestId.current;
    try {
      const result = await locateRegion(lat, lng, LOOKUP_ZOOM);
      if (id === requestId.current) setName(result.regionName);
    } catch {
      /* no name - the pin still works */
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center p-4 bg-black/60"
      onClick={e => e.stopPropagation()}
    >
      <div
        className="relative flex flex-col bg-sky-50 rounded-2xl overflow-hidden shadow-2xl w-full max-w-2xl"
        style={{ height: 'min(90dvh, 600px)' }}
      >
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div>
            <h2 className="font-semibold text-slate-800">Where was it?</h2>
            <p className="text-xs text-slate-500">Tap the map to drop a pin</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-500 text-lg"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 min-h-0">
          <MapContainer
            center={initial ? [initial.lat, initial.lng] : WORLD_CENTER}
            zoom={initial ? PIN_ZOOM : 2}
            minZoom={2}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />
            <Recenter center={here} />
            <MapClicks onClick={handleClick} />
            {pin && (
              <CircleMarker
                center={[pin.lat, pin.lng]}
                radius={9}
                pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#16a34a', fillOpacity: 1 }}
              />
            )}
          </MapContainer>
        </div>

        <div className="shrink-0 px-5 py-4 border-t border-slate-200 bg-slate-50 min-h-[72px] flex items-center justify-between gap-4">
          {!pin && <p className="text-sm text-slate-400 italic">No location selected yet</p>}
          {pin && (
            <>
              <p className="text-sm text-slate-700">
                {loading ? <span className="animate-pulse text-slate-500">Looking up area…</span> : (name ?? 'Pinned location')}
              </p>
              <button
                type="button"
                onClick={() => { onSelect({ ...pin, name }); onClose(); }}
                className="shrink-0 px-4 py-2 rounded-xl bg-forest-600 hover:bg-forest-700 text-white font-semibold text-sm transition-colors"
              >
                Use this location
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
