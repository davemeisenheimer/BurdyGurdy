import { useEffect, useRef, useState } from 'react';
import type { RegionalSighting } from '../../services/remote/api';

// Leaflet is imported at module level; the bundle is only fetched when this
// module is first imported (i.e. when the user navigates to Sightings).
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix the default marker icon paths broken by bundlers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl:       new URL('leaflet/dist/images/marker-icon.png',    import.meta.url).href,
  iconRetinaUrl: new URL('leaflet/dist/images/marker-icon-2x.png', import.meta.url).href,
  shadowUrl:     new URL('leaflet/dist/images/marker-shadow.png',  import.meta.url).href,
});

export type MapMode = 'single' | 'species' | 'all';

interface Props {
  allSightings:     RegionalSighting[];
  selectedSighting: RegionalSighting;
  mode:             MapMode;
}

function formatObsDt(obsDt: string): string {
  const d = new Date(obsDt.replace(' ', 'T'));
  if (isNaN(d.getTime())) return obsDt;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * Pure Leaflet map renderer.  The toggle control lives in the parent component
 * so it is completely outside Leaflet's layout influence.
 */
export function SightingsMap({ allSightings, selectedSighting, mode }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<L.Map | null>(null);
  const layerRef     = useRef<L.LayerGroup | null>(null);
  const [ready, setReady] = useState(false);

  const visibleSightings = (() => {
    if (mode === 'single')  return [selectedSighting].filter(s => s.lat != null && s.lng != null);
    if (mode === 'species') return allSightings.filter(s => s.speciesCode === selectedSighting.speciesCode && s.lat != null && s.lng != null);
    return allSightings.filter(s => s.lat != null && s.lng != null);
  })();

  // Initialise the Leaflet map once the container div is in the DOM.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, { zoomControl: true }).setView(
      [selectedSighting.lat ?? 43, selectedSighting.lng ?? -79],
      13,
    );

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    mapRef.current   = map;
    layerRef.current = L.layerGroup().addTo(map);
    setReady(true);

    return () => {
      map.remove();
      mapRef.current   = null;
      layerRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-draw pins whenever the visible set or selected sighting changes.
  useEffect(() => {
    if (!ready || !mapRef.current || !layerRef.current) return;

    layerRef.current.clearLayers();
    const bounds: [number, number][] = [];

    for (const s of visibleSightings) {
      if (s.lat == null || s.lng == null) continue;
      bounds.push([s.lat, s.lng]);

      const isSelected =
        s.lat === selectedSighting.lat &&
        s.lng === selectedSighting.lng &&
        s.speciesCode === selectedSighting.speciesCode &&
        s.obsDt === selectedSighting.obsDt;

      const icon = isSelected
        ? L.divIcon({
            className: '',
            html: '<div style="width:16px;height:16px;border-radius:50%;background:#0369a1;border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
            iconSize: [16, 16], iconAnchor: [8, 8],
          })
        : L.divIcon({
            className: '',
            html: '<div style="width:12px;height:12px;border-radius:50%;background:#38bdf8;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.3)"></div>',
            iconSize: [12, 12], iconAnchor: [6, 6],
          });

      const popup = L.popup({ maxWidth: 260 }).setContent(`
        <div style="font-family:sans-serif;font-size:13px;line-height:1.5">
          <p style="margin:0 0 2px;font-weight:600">${s.comName}</p>
          <p style="margin:0 0 2px;color:#64748b;font-size:11px">${s.sciName}</p>
          <hr style="margin:6px 0;border-color:#e2e8f0">
          <p style="margin:0 0 2px">${s.locName}</p>
          <p style="margin:0 0 2px;color:#64748b;font-size:11px">${formatObsDt(s.obsDt)}${s.howMany != null ? ` · ×${s.howMany}` : ''}</p>
          ${s.userDisplayName ? `<p style="margin:0;color:#64748b;font-size:11px">Reported by ${s.userDisplayName}</p>` : ''}
        </div>
      `);

      L.marker([s.lat, s.lng], { icon }).bindPopup(popup).addTo(layerRef.current!);
    }

    if (bounds.length === 1) {
      mapRef.current.setView(bounds[0], 13);
    } else if (bounds.length > 1) {
      mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }

    // Auto-open the popup for the selected sighting in single mode.
    if (mode === 'single' && selectedSighting.lat != null && selectedSighting.lng != null) {
      layerRef.current.eachLayer(layer => {
        if (layer instanceof L.Marker) {
          const ll = layer.getLatLng();
          if (Math.abs(ll.lat - selectedSighting.lat!) < 0.0001 &&
              Math.abs(ll.lng - selectedSighting.lng!) < 0.0001) {
            layer.openPopup();
          }
        }
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, visibleSightings.length, selectedSighting, mode]);

  // The map container fills 100% of its parent — the parent must have an explicit height.
  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
