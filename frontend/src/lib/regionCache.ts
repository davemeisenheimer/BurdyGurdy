import { db } from './db';
import { fetchRegionSpecies } from './api';
import type { CachedSpecies } from '../types';

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Returns the ordered regional species list from cache, fetching from the backend if needed.
 * Order: backyard-family species (most common first), then other species (most common first).
 * This ordering is the promotion queue — new birds enter the Learning Palette from the top.
 */
export async function getRegionSpecies(regionCode: string): Promise<CachedSpecies[]> {
  const cached = await db.regionSpecies.get(regionCode);
  if (cached && Date.now() - cached.cachedAt < TTL_MS) {
    return cached.species;
  }

  const full = await fetchRegionSpecies(regionCode);
  const species: CachedSpecies[] = full.map(s => ({
    speciesCode: s.speciesCode,
    comName: s.comName,
    sciName: s.sciName,
  }));

  // Preserve promotionIndex across cache refreshes so we don't restart the promotion queue
  const existing = await db.regionSpecies.get(regionCode);
  await db.regionSpecies.put({
    regionCode,
    species,
    cachedAt: Date.now(),
    promotionIndex: existing?.promotionIndex ?? 0,
  });
  return species;
}

/**
 * Returns the next unseen species to promote into the Learning Palette.
 * "Unseen" means no progress record exists for this species in the DB.
 * Returns null if all regional species have already been introduced.
 */
export async function getNextUnseenSpecies(regionCode: string): Promise<CachedSpecies | null> {
  const [regionSpecies, progressRecords] = await Promise.all([
    getRegionSpecies(regionCode),
    db.progress.toArray(),
  ]);

  const seenCodes = new Set(progressRecords.map(r => r.speciesCode));
  return regionSpecies.find(s => !seenCodes.has(s.speciesCode)) ?? null;
}
