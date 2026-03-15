import axios from 'axios';
import { cache } from '../cache';

const INAT_TAXA_API = 'https://api.inaturalist.org/v1/taxa';
const INAT_OBS_API  = 'https://api.inaturalist.org/v1/observations';
const TTL_24H = 24 * 60 * 60 * 1000;

const HEADERS = { 'User-Agent': 'BurdyGurdy/1.0 (bird identification learning app)' };

export interface PhotoSet {
  primary: string | null;   // high-quality taxa API photo (75% quiz probability)
  optional: string[];       // lower-quality observation photos (25% split equally)
}

/**
 * Fetches the single high-quality "default photo" from the iNaturalist taxa API.
 * Returns a large or medium URL.
 */
async function fetchPrimaryPhoto(sciName: string): Promise<string | null> {
  const res = await axios.get(INAT_TAXA_API, {
    params: { q: sciName, is_active: true, per_page: 1 },
    headers: HEADERS,
  });
  const photo = res.data?.results?.[0]?.default_photo;
  if (!photo) return null;
  return (photo.large_url ?? photo.medium_url ?? null) as string | null;
}

/**
 * Fetches up to 12 photo URLs from research-grade iNaturalist observations.
 * These are variable quality — the user can dismiss individual ones.
 */
async function fetchOptionalPhotos(sciName: string): Promise<string[]> {
  const res = await axios.get(INAT_OBS_API, {
    params: {
      taxon_name: sciName,
      quality_grade: 'research',
      photos: true,
      per_page: 12,
      order_by: 'votes',
    },
    headers: HEADERS,
  });

  const urls: string[] = [];
  for (const obs of (res.data?.results ?? [])) {
    for (const photo of (obs.photos ?? [])) {
      if (photo.url) {
        const mediumUrl = (photo.url as string).replace('/square.', '/medium.');
        if (!urls.includes(mediumUrl)) urls.push(mediumUrl);
      }
    }
    if (urls.length >= 12) break;
  }
  return urls;
}

async function loadPhotoSet(
  speciesCode: string,
  comName?: string,
  sciName?: string,
): Promise<PhotoSet> {
  const cacheKey = `photoset:${speciesCode}`;
  const cached = cache.get<PhotoSet>(cacheKey);
  if (cached !== undefined) return cached;

  const searchTerm = sciName ?? comName;
  let primary: string | null = null;
  let optional: string[] = [];

  if (searchTerm) {
    const [pResult, oResult] = await Promise.allSettled([
      fetchPrimaryPhoto(searchTerm),
      fetchOptionalPhotos(searchTerm),
    ]);
    if (pResult.status === 'fulfilled') primary = pResult.value;
    if (oResult.status === 'fulfilled') optional = oResult.value;
  }

  const result: PhotoSet = { primary, optional };
  cache.set(cacheKey, result, TTL_24H);
  return result;
}

/** Returns all photos for the reveal screen: { primary, optional }. */
export async function getSpeciesPhotoUrls(
  speciesCode: string,
  comName?: string,
  sciName?: string,
): Promise<PhotoSet> {
  return loadPhotoSet(speciesCode, comName, sciName);
}

/**
 * Returns a single photo URL for a quiz question.
 * 75% probability: primary (high-quality taxa photo).
 * 25% probability: one of the optional observation photos.
 * Blocked URLs (user-dismissed) are excluded from selection.
 */
export async function getSpeciesPhotoUrl(
  speciesCode: string,
  comName?: string,
  sciName?: string,
  blockedUrls: string[] = [],
): Promise<string | null> {
  const { primary, optional } = await loadPhotoSet(speciesCode, comName, sciName);
  const blocked = new Set(blockedUrls);
  const usablePrimary = primary && !blocked.has(primary) ? primary : null;
  const usableOptional = optional.filter(u => !blocked.has(u));

  if (!usablePrimary && usableOptional.length === 0) return null;
  if (!usablePrimary) return usableOptional[Math.floor(Math.random() * usableOptional.length)];
  if (usableOptional.length === 0) return usablePrimary;
  return Math.random() < 0.75
    ? usablePrimary
    : usableOptional[Math.floor(Math.random() * usableOptional.length)];
}
