import axios from 'axios';
import { cache } from '../cache';
import { getWikipediaPhotos, AttributedPhoto } from './wikipedia';

export type { AttributedPhoto };

const MACAULAY_SEARCH = 'https://search.macaulaylibrary.org/api/v1/search';
const MACAULAY_CDN = 'https://cdn.download.ams.birds.cornell.edu/api/v1/asset';
const INAT_TAXA_API = 'https://api.inaturalist.org/v1/taxa';
const TTL       = 7 * 24 * 60 * 60 * 1000; // 7 days  — successful photo fetches
const RETRY_TTL = 5 * 60 * 1000;            // 5 minutes — failed fetches, retried next round
const HEADERS = { 'User-Agent': 'BurdyGurdy/1.0 (bird identification learning app)' };

// Option C timeout strategy: 1s initial window, 500ms trailing window after first resolves
const INITIAL_MS = 2500;
const TRAILING_MS = 500;

export interface PhotoSet {
  primary: AttributedPhoto | null;
  optional: AttributedPhoto[];
}

// Exclusions for quiz question photos - informational but don't help with visual ID.
const QUESTION_EXCLUDE = /egg|eggs|nest|habitat|clutch|chick|hatchling|juvenile|immature|skeleton|prey|mhnt/i;

function filenameFromUrl(url: string): string {
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop() ?? ''); }
  catch { return url; }
}

/** Fetches the top-rated photo from the Macaulay Library (eBird media archive). */
async function fetchMacaulayPhoto(speciesCode: string): Promise<AttributedPhoto | null> {
  const t0 = Date.now();
  const res = await axios.get(MACAULAY_SEARCH, {
    params: { taxonCode: speciesCode, mediaType: 'Photo', count: 1, sort: 'rating_rank_desc' },
    headers: HEADERS,
  });
  const content = res.data?.results?.content;
  console.log(`[macaulay] ${speciesCode} → ${content?.length ?? 0} results in ${Date.now() - t0}ms`);
  if (!content?.length) return null;
  const item = content[0];
  if (!item?.assetId) return null;
  return {
    url: `${MACAULAY_CDN}/${item.assetId}/1800`,
    credit: item.userDisplayName ? `© ${item.userDisplayName} · Macaulay Library` : 'Macaulay Library',
    source: 'macaulay' as const,
  };
}

/** Fetches the hand-picked representative photo from the iNaturalist taxa API. */
async function fetchInatPhoto(sciName: string): Promise<AttributedPhoto | null> {
  const res = await axios.get(INAT_TAXA_API, {
    params: { q: sciName, is_active: true, per_page: 20 },
    headers: HEADERS,
  });
  type InatTaxon = { name: string; default_photo?: { large_url?: string; medium_url?: string; attribution?: string } };
  const results: InatTaxon[] = res.data?.results ?? [];
  // The text search does prefix matching on individual words, not the full binomial, so tautonyms
  // and other false positives can rank above the correct taxon. Find the exact match explicitly.
  const result = results.find(r => r.name.toLowerCase() === sciName.toLowerCase());
  if (!result) return null;
  const photo = result.default_photo;
  if (!photo) return null;
  const url = (photo.large_url ?? photo.medium_url ?? null) as string | null;
  if (!url) return null;
  // iNaturalist provides a pre-formatted attribution string e.g. "(c) Jane Smith, some rights reserved (CC BY-NC)"
  const raw: string = photo.attribution ?? '';
  const credit = raw
    ? raw.replace(/^\(c\)/i, '©').replace(/,?\s*some rights reserved/i, '').trim() + ' · iNaturalist'
    : 'iNaturalist';
  return { url, credit, source: 'inat' as const };
}

/**
 * Runs a single attempt to fetch photos from all three sources (Macaulay, iNat, Wikipedia)
 * with the Option-C timeout strategy. Returns an empty PhotoSet on total failure.
 */
async function fetchPhotoSetOnce(
  speciesCode: string,
  sc: string,
  cn: string,
): Promise<PhotoSet> {
  let ebirdPhoto: AttributedPhoto | null | undefined = undefined;
  let inatPhoto:  AttributedPhoto | null | undefined = undefined;
  let wikiPhotos: AttributedPhoto[]     | undefined  = undefined;

  const macaulayP = fetchMacaulayPhoto(speciesCode)
    .then(v  => { ebirdPhoto = v;  return v; })
    .catch(() => { ebirdPhoto = null; return null as AttributedPhoto | null; });

  const inatP = fetchInatPhoto(sc)
    .then(v  => { inatPhoto = v;  return v; })
    .catch(() => { inatPhoto = null; return null as AttributedPhoto | null; });

  const wikiP = getWikipediaPhotos(sc, cn)
    .then(v  => { wikiPhotos = v;  return v; })
    .catch(() => { wikiPhotos = []; return [] as AttributedPhoto[]; });

  // Phase 1: give all 3 services INITIAL_MS, or stop early if all settle first
  await Promise.race([
    Promise.all([macaulayP, inatP, wikiP]),
    new Promise<void>(resolve => setTimeout(resolve, INITIAL_MS)),
  ]);

  // Phase 2: if nothing resolved yet, wait for the first one, then a trailing window
  const anyResolved = ebirdPhoto !== undefined || inatPhoto !== undefined || wikiPhotos !== undefined;
  if (!anyResolved) {
    await Promise.race([macaulayP, inatP, wikiP]);
    await new Promise<void>(resolve => setTimeout(resolve, TRAILING_MS));
  }

  return {
    primary: inatPhoto ?? null,
    optional: (
      [ebirdPhoto !== undefined ? ebirdPhoto : null, ...(wikiPhotos ?? [])] as Array<AttributedPhoto | null>
    ).filter((p): p is AttributedPhoto => p !== null),
  };
}

/**
 * Returns the photo set for a species, with one automatic retry if all sources
 * return empty on the first attempt. Failed results are cached for RETRY_TTL (5 min)
 * so the next quiz round re-checks; successful results cache for 7 days.
 */
async function loadPhotoSet(
  speciesCode: string,
  comName?: string,
  sciName?: string,
): Promise<{ photoSet: PhotoSet; noPhoto: boolean }> {
  const cacheKey = `photoset5:${speciesCode}`;
  const cached = cache.get<{ photoSet: PhotoSet; noPhoto: boolean }>(cacheKey);
  if (cached !== undefined) return cached;

  const sc = sciName ?? comName ?? '';
  const cn = comName ?? sc;

  let photoSet = await fetchPhotoSetOnce(speciesCode, sc, cn);
  let hasPhotos = photoSet.primary !== null || photoSet.optional.length > 0;

  if (!hasPhotos) {
    // Retry once after a brief pause to recover from transient failures
    await new Promise<void>(resolve => setTimeout(resolve, 2000));
    photoSet = await fetchPhotoSetOnce(speciesCode, sc, cn);
    hasPhotos = photoSet.primary !== null || photoSet.optional.length > 0;
  }

  const noPhoto = !hasPhotos;
  cache.set(cacheKey, { photoSet, noPhoto }, noPhoto ? RETRY_TTL : TTL);
  return { photoSet, noPhoto };
}

/** Returns all photos for the reveal/info carousel - unfiltered (eggs, nests etc. are informational). */
export async function getSpeciesPhotoUrls(
  speciesCode: string,
  comName?: string,
  sciName?: string,
): Promise<PhotoSet> {
  const { photoSet } = await loadPhotoSet(speciesCode, comName, sciName);
  return photoSet;
}

/** Returns appearance-only photos for question display - eggs, nests, chicks etc. filtered out. */
export async function getSpeciesPhotoUrlsForQuestion(
  speciesCode: string,
  comName?: string,
  sciName?: string,
): Promise<PhotoSet> {
  const { photoSet: { primary, optional } } = await loadPhotoSet(speciesCode, comName, sciName);
  const allPhotos = [primary, ...optional].filter((p): p is AttributedPhoto => !!p);
  const suitable = allPhotos.filter(p => !QUESTION_EXCLUDE.test(filenameFromUrl(p.url)));
  return { primary: suitable[0] ?? null, optional: suitable.slice(1) };
}

/**
 * Returns a single attributed photo for a quiz image question, plus a noPhoto flag
 * when no photos could be found after retrying.
 * Filters out non-appearance photos (eggs, nests, chicks, etc.).
 * Photo source is weighted by mastery level:
 *   level 0            → primary only
 *   level 1            → 75% secondary, 25% primary
 *   level 2+ (or none) → 1/3 primary, 1/3 secondary, 1/3 Wiki (split equally among wiki photos)
 */
export async function getSpeciesPhotoUrl(
  speciesCode: string,
  comName?: string,
  sciName?: string,
  masteryLevel?: number,
  blockedUrls: Set<string> = new Set(),
): Promise<{ photo: AttributedPhoto | null; noPhoto: boolean }> {
  const { photoSet: { primary, optional }, noPhoto } = await loadPhotoSet(speciesCode, comName, sciName);

  if (noPhoto) return { photo: null, noPhoto: true };

  const allPhotos = [primary, ...optional].filter((p): p is AttributedPhoto => !!p);
  const suitable = allPhotos.filter(p =>
    !QUESTION_EXCLUDE.test(filenameFromUrl(p.url)) && !blockedUrls.has(p.url),
  );

  if (suitable.length === 0) return { photo: null, noPhoto: false };

  const ebirdPhoto = suitable.find(p => p.source === 'macaulay') ?? null;
  const inatPhoto  = suitable.find(p => p.source === 'inat')     ?? null;
  const wikiPhotos = suitable.filter(p => p.source === 'wiki');

  // Level 0: iNat only
  if ((masteryLevel ?? 0) <= 0) {
    return { photo: inatPhoto ?? ebirdPhoto ?? wikiPhotos[0] ?? null, noPhoto: false };
  }

  // Level 1: 75% Macaulay (eBird), 25% iNat
  if (masteryLevel === 1) {
    const candidates = [
      ...(ebirdPhoto ? [{ photo: ebirdPhoto, weight: 3 }] : []),
      ...(inatPhoto  ? [{ photo: inatPhoto,  weight: 1 }] : []),
    ];
    if (candidates.length === 0) return { photo: suitable[0] ?? null, noPhoto: false };
    const total = candidates.reduce((s, c) => s + c.weight, 0);
    let r = Math.random() * total;
    for (const c of candidates) { r -= c.weight; if (r <= 0) return { photo: c.photo, noPhoto: false }; }
    return { photo: candidates[candidates.length - 1].photo, noPhoto: false };
  }

  // Level 2+: equal probability across all suitable photos regardless of source
  return { photo: suitable[Math.floor(Math.random() * suitable.length)], noPhoto: false };
}
