import type { CachedSpecies } from '../../types';
import { db } from '../../lib/db';

const KEY        = 'regionSnapshot';
const LEGACY_KEY = 'birdygurdy_region_snapshot';

export interface SnapshotSpecies {
  speciesCode: string;
  comName: string;
  sciName: string;
}

export interface RegionSnapshot {
  regionCode: string;
  back: number;
  savedAt?: string;
  species: SnapshotSpecies[];
}

export interface RegionUpdateInfo {
  added: CachedSpecies[];
  dropped: SnapshotSpecies[];
  unchanged: CachedSpecies[];
  back: number;
  savedAt?: string;
}

export async function loadSnapshot(): Promise<RegionSnapshot | null> {
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy !== null) {
      await db.keyValue.put({ key: KEY, value: legacy });
      localStorage.removeItem(LEGACY_KEY);
      return JSON.parse(legacy) as RegionSnapshot;
    }
    const row = await db.keyValue.get(KEY);
    return row ? JSON.parse(row.value) as RegionSnapshot : null;
  } catch {
    return null;
  }
}

export async function saveSnapshot(snapshot: RegionSnapshot): Promise<void> {
  await db.keyValue.put({ key: KEY, value: JSON.stringify(snapshot) }).catch(() => {});
}

export function buildSnapshot(
  regionCode: string,
  back: number,
  currentSpecies: CachedSpecies[],
): RegionSnapshot {
  return {
    regionCode,
    back,
    savedAt: new Date().toISOString(),
    species: currentSpecies
      .filter(s => !s.isHistorical)
      .map(s => ({ speciesCode: s.speciesCode, comName: s.comName, sciName: s.sciName })),
  };
}

/**
 * Compares the current region species list against a stored snapshot (must be same
 * regionCode and back).  Returns null if nothing changed; otherwise returns the diff.
 */
export function computeRegionUpdate(
  currentSpecies: CachedSpecies[],
  snapshot: RegionSnapshot,
): RegionUpdateInfo | null {
  const currentNonHistorical = currentSpecies.filter(s => !s.isHistorical);
  const currentCodes  = new Set(currentNonHistorical.map(s => s.speciesCode));
  const snapshotCodes = new Set(snapshot.species.map(s => s.speciesCode));

  const added     = currentNonHistorical.filter(s => !snapshotCodes.has(s.speciesCode));
  const dropped   = snapshot.species.filter(s => !currentCodes.has(s.speciesCode));
  const unchanged = currentNonHistorical.filter(s => snapshotCodes.has(s.speciesCode));

  if (added.length === 0 && dropped.length === 0) return null;
  return { added, dropped, unchanged, back: snapshot.back, savedAt: snapshot.savedAt };
}
