import { useEffect, useState } from 'react';
import { fetchBirdInfo, fetchRecentSightings } from '../lib/api';
import type { BirdInfoData, RecentSighting } from '../lib/api';

export function useBirdInfo(
  speciesCode: string | null,
  comName: string,
  sciName: string,
  regionCode?: string,
  maxRecentSightings = 4,
): { info: BirdInfoData | null; sightings: RecentSighting[]; loading: boolean } {
  const [info, setInfo]           = useState<BirdInfoData | null>(null);
  const [sightings, setSightings] = useState<RecentSighting[]>([]);
  const [loading, setLoading]     = useState(false);

  useEffect(() => {
    if (!speciesCode) { setInfo(null); setSightings([]); return; }
    let cancelled = false;
    setLoading(true);
    setInfo(null);
    setSightings([]);
    fetchBirdInfo(speciesCode, comName, sciName)
      .then(data => { if (!cancelled) { setInfo(data); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    if (regionCode && maxRecentSightings > 0) {
      fetchRecentSightings(speciesCode, regionCode, maxRecentSightings)
        .then(data => { if (!cancelled) setSightings(data); });
    }
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speciesCode]);

  return { info, sightings, loading };
}
