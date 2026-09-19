import { useEffect, useState } from 'react';
import { fetchBirdInfo, fetchRecentSightings } from '../services/remote/api';
import type { BirdInfoData, RecentSighting } from '../services/remote/api';
import { describeUpstreamError, type UpstreamErrorPayload } from '../lib/upstreamErrorMessages';

const INFO_FALLBACK = "Couldn't load info for this bird right now. Please try again.";

export function useBirdInfo(
  speciesCode: string | null,
  comName: string,
  sciName: string,
  regionCode?: string,
  maxRecentSightings = 4,
): { info: BirdInfoData | null; sightings: RecentSighting[]; loading: boolean; error: string | null } {
  const [info, setInfo]           = useState<BirdInfoData | null>(null);
  const [sightings, setSightings] = useState<RecentSighting[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  useEffect(() => {
    if (!speciesCode) { setInfo(null); setSightings([]); setError(null); return; }
    let cancelled = false;
    setLoading(true);
    setInfo(null);
    setSightings([]);
    setError(null);
    fetchBirdInfo(speciesCode, comName, sciName)
      .then(data => { if (!cancelled) { setInfo(data); setLoading(false); } })
      .catch((err: unknown) => {
        if (cancelled) return;
        const payload = (err as { response?: { data?: UpstreamErrorPayload } })?.response?.data;
        setError(describeUpstreamError(payload, INFO_FALLBACK));
        setLoading(false);
      });
    if (regionCode && maxRecentSightings > 0) {
      // Sightings here are a small supplementary strip, not the main content -
      // fall back to empty on failure rather than blocking the rest of the panel.
      // See SightingsScreen for the dedicated sightings view's error handling.
      fetchRecentSightings(speciesCode, regionCode, maxRecentSightings)
        .then(data => { if (!cancelled) setSightings(data); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speciesCode]);

  return { info, sightings, loading, error };
}
