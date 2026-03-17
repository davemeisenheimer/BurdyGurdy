import axios from 'axios';
import { cache } from '../cache';

const EBIRD_BASE = 'https://api.ebird.org/v2';

export function ebirdClient() {
  return axios.create({
    baseURL: EBIRD_BASE,
    headers: { 'X-eBirdApiToken': process.env.EBIRD_API_KEY },
  });
}

export interface EBirdSpecies {
  speciesCode: string;
  comName: string;
  sciName: string;
  familyComName: string;
  familySciName: string;
  order: string;
  category: string;
}

export interface EBirdObservation {
  speciesCode: string;
  comName: string;
  sciName: string;
  locName: string;
  obsDt: string;
  howMany: number;
}

const TTL_24H = 24 * 60 * 60 * 1000;
const TTL_1H = 60 * 60 * 1000;

/** Full eBird taxonomy (all species). Cached 24h. */
export async function getTaxonomy(): Promise<EBirdSpecies[]> {
  const key = 'taxonomy';
  const cached = cache.get<EBirdSpecies[]>(key);
  if (cached) return cached;

  const res = await ebirdClient().get('/ref/taxonomy/ebird', {
    params: { fmt: 'json', cat: 'species' },
  });
  cache.set(key, res.data, TTL_24H);
  return res.data;
}

/** Species observed in a region recently, ordered by frequency (most common first). Cached 1h. */
export async function getRegionalSpecies(regionCode: string, back = 30): Promise<EBirdObservation[]> {
  const key = `regional:${regionCode}:${back}`;
  const cached = cache.get<EBirdObservation[]>(key);
  if (cached) return cached;

  const res = await ebirdClient().get(`/data/obs/${regionCode}/recent`, {
    params: { maxResults: 200, back, includeProvisional: true },
  });
  cache.set(key, res.data, TTL_1H);
  return res.data;
}

/** Species ranked by number of appearances in private (backyard/home) location observations over the
 *  past 7 days. Excludes public hotspot data so common backyard birds rank above wetland rarities.
 *  Returns species codes ordered most→least common. Cached 1h. */
export async function getBackyardSpeciesRanking(regionCode: string): Promise<string[]> {
  const key = `backyard:${regionCode}`;
  const cached = cache.get<string[]>(key);
  if (cached) return cached;

  try {
    const res = await ebirdClient().get(`/data/obs/${regionCode}/recent`, {
      params: { back: 7, maxResults: 500, includeProvisional: true },
    });

    const counts = new Map<string, number>();
    // for (const obs of res.data as Array<{ speciesCode: string; locationPrivate?: boolean }>) {
    //   if (obs.locationPrivate === true) {
    //     counts.set(obs.speciesCode, (counts.get(obs.speciesCode) ?? 0) + 1);
    //   }
    // }
    for (const obs of res.data as Array<{ speciesCode: string; locationPrivate?: boolean; locName?: string }>) {
      const isPrivate = obs.locationPrivate === true;
      const name = (obs.locName ?? "").toLowerCase();
      const isTargetPublic = name.includes('feeder') || name.includes('park');

      // Count if it's private OR if it's a public 'feeder/park', then they are likely common birds
      if (isPrivate || isTargetPublic) {
        counts.set(obs.speciesCode, (counts.get(obs.speciesCode) ?? 0) + 1);
      }
    }

    const codes = [...counts.entries()]
      .sort(([, a], [, b]) => b - a)
      .map(([code]) => code);

    cache.set(key, codes, TTL_1H);
    return codes;
  } catch {
    return [];
  }
}

/** Top species by checklist frequency over the past 7 days, aggregated by appearance count and average rank.
 *  Returns species codes ordered most→least common. Cached 24h. */
export async function getCommonSpeciesCodes(regionCode: string): Promise<string[]> {
  const key = `top100w:${regionCode}`;
  const cached = cache.get<string[]>(key);
  if (cached) return cached;

  // Build date list: yesterday back through 7 days ago (yesterday has complete data)
  const dates: Array<{ y: number; m: number; d: number }> = [];
  for (let daysAgo = 1; daysAgo <= 7; daysAgo++) {
    const dt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    dates.push({ y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() });
  }

  const client = ebirdClient();
  const results = await Promise.allSettled(
    dates.map(({ y, m, d }) =>
      client.get(`/product/top100/${regionCode}/${y}/${m}/${d}`, {
        params: { rankBy: 'cl', maxResults: 100 },
      }),
    ),
  );

  // Aggregate: track how many days each species appeared and their sum of ranks (lower = more common)
  const appearances = new Map<string, { count: number; rankSum: number }>();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const items: Array<{ speciesCode: string }> = result.value.data;
    items.forEach((item, idx) => {
      const existing = appearances.get(item.speciesCode) ?? { count: 0, rankSum: 0 };
      appearances.set(item.speciesCode, {
        count: existing.count + 1,
        rankSum: existing.rankSum + idx,
      });
    });
  }

  if (appearances.size === 0) return [];

  // Sort: most days first, then by average rank (lower = more common)
  const codes = [...appearances.entries()]
    .sort(([, a], [, b]) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.rankSum / a.count - b.rankSum / b.count;
    })
    .map(([code]) => code);

  cache.set(key, codes, TTL_24H);
  return codes;
}

/** Species list for a region (just codes + names). Cached 24h. */
export async function getSpeciesList(regionCode: string): Promise<string[]> {
  const key = `spplist:${regionCode}`;
  const cached = cache.get<string[]>(key);
  if (cached) return cached;

  const res = await ebirdClient().get(`/product/spplist/${regionCode}`);
  cache.set(key, res.data, TTL_24H);
  return res.data;
}
