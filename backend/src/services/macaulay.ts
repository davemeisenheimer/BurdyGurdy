import axios from 'axios';
import { cache } from '../cache';
import { getWikipediaPhotos, AttributedPhoto } from './wikipedia';

export type { AttributedPhoto };

const MACAULAY_SEARCH = 'https://search.macaulaylibrary.org/api/v1/search';
const MACAULAY_CDN = 'https://cdn.download.ams.birds.cornell.edu/api/v1/asset';
const INAT_TAXA_API = 'https://api.inaturalist.org/v1/taxa';
const TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const HEADERS = { 'User-Agent': 'BurdyGurdy/1.0 (bird identification learning app)' };

// Option C timeout strategy: 1s initial window, 500ms trailing window after first resolves
const INITIAL_MS = 1000;
const TRAILING_MS = 500;

export interface PhotoSet {
  primary: AttributedPhoto | null;
  optional: AttributedPhoto[];
}

// Exclusions for quiz question photos — informational but don't help with visual ID.
const QUESTION_EXCLUDE = /egg|eggs|nest|habitat|clutch|chick|hatchling|juvenile|immature|skeleton|prey|mhnt/i;

function filenameFromUrl(url: string): string {
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop() ?? ''); }
  catch { return url; }
}

/** Fetches the top-rated photo from the Macaulay Library (eBird media archive). */
async function fetchMacaulayPhoto(speciesCode: string): Promise<AttributedPhoto | null> {
  const res = await axios.get(MACAULAY_SEARCH, {
    params: { taxonCode: speciesCode, mediaType: 'Photo', count: 1, sort: 'rating_rank_desc' },
    headers: HEADERS,
  });
  const content = res.data?.results?.content;
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
    params: { q: sciName, is_active: true, per_page: 1 },
    headers: HEADERS,
  });
  const photo = res.data?.results?.[0]?.default_photo;
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

async function loadPhotoSet(
  speciesCode: string,
  comName?: string,
  sciName?: string,
): Promise<PhotoSet> {
  const cacheKey = `photoset5:${speciesCode}`;
  const cached = cache.get<PhotoSet>(cacheKey);
  if (cached !== undefined) return cached;

  const sc = sciName ?? comName ?? '';
  const cn = comName ?? sc;

  // Track resolved values; undefined means not yet settled
  let ebirdPhoto: AttributedPhoto | null | undefined = undefined;
  let inatPhoto:  AttributedPhoto | null | undefined = undefined;
  let wikiPhotos: AttributedPhoto[]     | undefined  = undefined;

  // Start all 3 fetches; side-effect updates tracking vars when each settles
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

  // Carousel order: primary → secondary → Wikipedia
  const result: PhotoSet = {
    primary: inatPhoto ?? null,
    optional: (
      [ebirdPhoto !== undefined ? ebirdPhoto : null, ...(wikiPhotos ?? [])] as Array<AttributedPhoto | null>
    ).filter((p): p is AttributedPhoto => p !== null),
  };

  cache.set(cacheKey, result, TTL);
  return result;
}

/** Returns all photos for the reveal/info carousel — unfiltered (eggs, nests etc. are informational). */
export async function getSpeciesPhotoUrls(
  speciesCode: string,
  comName?: string,
  sciName?: string,
): Promise<PhotoSet> {
  return loadPhotoSet(speciesCode, comName, sciName);
}

/** Returns appearance-only photos for question display — eggs, nests, chicks etc. filtered out. */
export async function getSpeciesPhotoUrlsForQuestion(
  speciesCode: string,
  comName?: string,
  sciName?: string,
): Promise<PhotoSet> {
  const { primary, optional } = await loadPhotoSet(speciesCode, comName, sciName);
  const allPhotos = [primary, ...optional].filter((p): p is AttributedPhoto => !!p);
  const suitable = allPhotos.filter(p => !QUESTION_EXCLUDE.test(filenameFromUrl(p.url)));
  return { primary: suitable[0] ?? null, optional: suitable.slice(1) };
}

/**
 * Returns a single attributed photo for a quiz image question.
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
): Promise<AttributedPhoto | null> {
  const { primary, optional } = await loadPhotoSet(speciesCode, comName, sciName);

  const allPhotos = [primary, ...optional].filter((p): p is AttributedPhoto => !!p);
  const suitable = allPhotos.filter(p => !QUESTION_EXCLUDE.test(filenameFromUrl(p.url)));

  if (suitable.length === 0) return primary;

  const ebirdPhoto = suitable.find(p => p.source === 'macaulay') ?? null;
  const inatPhoto  = suitable.find(p => p.source === 'inat')     ?? null;
  const wikiPhotos = suitable.filter(p => p.source === 'wiki');

  // Level 0: iNat only
  if ((masteryLevel ?? 0) <= 0) {
    return inatPhoto ?? ebirdPhoto ?? wikiPhotos[0] ?? null;
  }

  // Level 1: 75% Macaulay (eBird), 25% iNat
  if (masteryLevel === 1) {
    const candidates = [
      ...(ebirdPhoto ? [{ photo: ebirdPhoto, weight: 3 }] : []),
      ...(inatPhoto  ? [{ photo: inatPhoto,  weight: 1 }] : []),
    ];
    if (candidates.length === 0) return suitable[0] ?? null;
    const total = candidates.reduce((s, c) => s + c.weight, 0);
    let r = Math.random() * total;
    for (const c of candidates) { r -= c.weight; if (r <= 0) return c.photo; }
    return candidates[candidates.length - 1].photo;
  }

  // Level 2+: 1/3 iNat, 1/3 Macaulay, 1/3 Wiki (split equally among wiki photos)
  const wikiWeight = wikiPhotos.length > 0 ? 1 / wikiPhotos.length : 0;
  const candidates: Array<{ photo: AttributedPhoto; weight: number }> = [
    ...(inatPhoto  ? [{ photo: inatPhoto,  weight: 1          }] : []),
    ...(ebirdPhoto ? [{ photo: ebirdPhoto, weight: 1          }] : []),
    ...wikiPhotos.map(p => ({ photo: p,   weight: wikiWeight })),
  ];

  if (candidates.length === 0) return null;

  const total = candidates.reduce((s, c) => s + c.weight, 0);
  let r = Math.random() * total;
  for (const c of candidates) {
    r -= c.weight;
    if (r <= 0) return c.photo;
  }
  return candidates[candidates.length - 1].photo;
}
