import type { CachedSpecies } from '../../types';

const SNAPSHOT_KEY = 'birdygurdy_region_snapshot';

export interface SnapshotSpecies {
  speciesCode: string;
  comName: string;
  sciName: string;
}

export interface RegionSnapshot {
  regionCode: string;
  back: number;
  species: SnapshotSpecies[];
}

export interface RegionUpdateInfo {
  added: CachedSpecies[];
  dropped: SnapshotSpecies[];
}

export function loadSnapshot(): RegionSnapshot | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    return raw ? (JSON.parse(raw) as RegionSnapshot) : null;
  } catch {
    return null;
  }
}

export function saveSnapshot(snapshot: RegionSnapshot): void {
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
}

export function buildSnapshot(
  regionCode: string,
  back: number,
  currentSpecies: CachedSpecies[],
): RegionSnapshot {
  return {
    regionCode,
    back,
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

  const added   = currentNonHistorical.filter(s => !snapshotCodes.has(s.speciesCode));
  const dropped = snapshot.species.filter(s => !currentCodes.has(s.speciesCode));

  if (added.length === 0 && dropped.length === 0) return null;
  return { added, dropped };
}
