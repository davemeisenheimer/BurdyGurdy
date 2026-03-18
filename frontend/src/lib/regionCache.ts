import { db } from './db';
import { fetchRegionSpecies } from './api';
import type { CachedSpecies } from '../types';

/** Cache TTL scales with the observation window — shorter windows need fresher data. */
function ttlMs(back: number): number {
  if (back <= 1)  return 1 * 60 * 60 * 1000;  // 1 day window  → 1 hour
  if (back <= 7)  return 6 * 60 * 60 * 1000;  // 7 day window  → 6 hours
  return          24 * 60 * 60 * 1000;          // 30 day window → 24 hours
}

/**
 * Returns the ordered regional species list from cache, fetching from the backend if needed.
 * Order: backyard-family species (most common first), then other species (most common first).
 * This ordering is the promotion queue — new birds enter the Learning Palette from the top.
 * Uses a composite cache key "${regionCode}:${back}" so different observation windows are cached separately.
 */
export async function getRegionSpecies(regionCode: string, back = 30): Promise<CachedSpecies[]> {
  const cacheKey = `${regionCode}:${back}`;
  const cached = await db.regionSpecies.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < ttlMs(back)) {
    return cached.species;
  }

  const full = await fetchRegionSpecies(regionCode, back);
  const species: CachedSpecies[] = full.map(s => ({
    speciesCode: s.speciesCode,
    comName: s.comName,
    sciName: s.sciName,
    isHistorical: s.isHistorical,
  }));

  // Preserve promotionIndex across cache refreshes so we don't restart the promotion queue
  const existing = await db.regionSpecies.get(cacheKey);
  await db.regionSpecies.put({
    regionCode: cacheKey,
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
export async function getNextUnseenSpecies(regionCode: string, back = 30): Promise<CachedSpecies | null> {
  const [regionSpecies, progressRecords] = await Promise.all([
    getRegionSpecies(regionCode, back),
    db.progress.toArray(),
  ]);

  const seenCodes = new Set(progressRecords.map(r => r.speciesCode));
  return regionSpecies.find(s => !seenCodes.has(s.speciesCode)) ?? null;
}
