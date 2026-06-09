import { Router } from 'express';
import axios from 'axios';
import { Resend } from 'resend';
import { getTaxonomy, getRegionalSpecies, ebirdClient, getCommonSpeciesCodes, getSpeciesList, type CommonSpeciesEntry } from '../services/ebird';
import { getRecordings, parseXCLength } from '../services/xenocanto';
import { getSpeciesPhotoUrl, getSpeciesPhotoUrls, getSpeciesPhotoUrlsForQuestion } from '../services/macaulay';
import { getWikipediaSummary, getWikipediaRangeMap, getWikipediaRangeMapLegend, getWikipediaPhotos } from '../services/wikipedia';
import { cache } from '../cache';
import { BACKYARD_FAMILIES, ORDER_COMMON_NAMES } from '../constants';
import { filterObservationsToKnownSpecies } from '../lib/speciesFilter';
import { filterRecordings } from '../lib/recordingFilter';
import { getSupabaseAdmin } from '../lib/supabase';

/** Decode a JWT payload without verifying the signature. Returns null on failure or expiry. */
function decodeJwt(jwt: string): { sub?: string; exp?: number } | null {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

const router = Router();

async function getBannedAudioUrls(): Promise<Set<string>> {
  const CACHE_KEY = 'birds:banned-audio';
  const cached = cache.get<Set<string>>(CACHE_KEY);
  if (cached) return cached;
  try {
    const admin = getSupabaseAdmin();
    const { data } = await admin
      .from('media_reports')
      .select('url')
      .eq('status', 'blocked')
      .eq('media_type', 'audio');
    const urls = new Set<string>((data ?? []).map((r: { url: string }) => r.url));
    cache.set(CACHE_KEY, urls, 5 * 60 * 1000);
    return urls;
  } catch {
    return new Set();
  }
}

const PRIORITY_GROUPS = ['recentCommon', 'recentUncommon', 'regionCommon', 'regionUncommon', 'rareUncommon'] as const;

/** Returns the 0-based sort index for a species given its region/observation flags. */
function pgIndex(isHistorical: boolean, isBackyard: boolean, appearances: number): number {
  if (!isHistorical && isBackyard)      return 0; // recentCommon
  if (!isHistorical && !isBackyard)     return 1; // recentUncommon
  if (isHistorical && appearances >= 3) return 2; // regionCommon   - appeared in 3+ of 12 monthly samples
  if (isHistorical && isBackyard)       return 3; // regionUncommon - uncommon but backyard family
  return 4;                                       // rareUncommon   - uncommon + non-backyard (vagrants)
}

// GET /api/birds/region/:regionCode
// Returns species recently observed in a region, enriched with taxonomy info.
// Sorted backyard-family-first (by commonness), then remaining species by commonness.
// Includes isBackyard flag for client-side promotion queue logic.
router.get('/region/:regionCode', async (req, res) => {
  try {
    const { regionCode } = req.params;
    const backParam = parseInt(req.query.back as string);
    const back = [1, 7, 30].includes(backParam) ? backParam : 30;
    const [observations, taxonomy, top100Codes, historicalCodes] = await Promise.all([
      getRegionalSpecies(regionCode, back),
      getTaxonomy(),
      getCommonSpeciesCodes(regionCode),
      getSpeciesList(regionCode),
    ]);

    const taxMap = new Map(taxonomy.map(t => [t.speciesCode, t]));
    const commonRankMap  = new Map(top100Codes.map((e: CommonSpeciesEntry) => [e.code, e.rank]));
    const appearancesMap = new Map(top100Codes.map((e: CommonSpeciesEntry) => [e.code, e.appearances]));

    // Build recent species (deduplicated, hybrids/slashes/spuhs excluded),
    // tagged as not historical
    const knownObservations = filterObservationsToKnownSpecies(observations, taxMap);
    const recentCodes = new Set(knownObservations.map(obs => obs.speciesCode));
    const recent = knownObservations
      .map(obs => {
        const tax = taxMap.get(obs.speciesCode);
        return {
          speciesCode: obs.speciesCode,
          comName: obs.comName,
          sciName: obs.sciName,
          familyComName: tax?.familyComName ?? '',
          familySciName: tax?.familySciName ?? '',
          order: tax?.order ?? '',
          orderComName: ORDER_COMMON_NAMES[tax?.order ?? ''],
          isBackyard: BACKYARD_FAMILIES.has(tax?.familySciName ?? ''),
          commonRank: commonRankMap.get(obs.speciesCode) ?? 9999,
          appearances: appearancesMap.get(obs.speciesCode) ?? 0,
          isHistorical: false,
          recentLocName: obs.locName ?? null,
          recentObsDt:   obs.obsDt   ?? null,
        };
      });

    // Build historical-only species (in spplist but not in recent observations)
    const historical = (historicalCodes as string[])
      .filter(code => !recentCodes.has(code) && taxMap.has(code))
      .map(code => {
        const tax = taxMap.get(code)!;
        return {
          speciesCode: code,
          comName: tax.comName,
          sciName: tax.sciName,
          familyComName: tax.familyComName ?? '',
          familySciName: tax.familySciName ?? '',
          order: tax.order ?? '',
          isBackyard: BACKYARD_FAMILIES.has(tax.familySciName ?? ''),
          commonRank: commonRankMap.get(code) ?? 9999,
          appearances: appearancesMap.get(code) ?? 0,
          isHistorical: true,
        };
      });

    const all = [...recent, ...historical];

    // Sort into 5 priority groups:
    //   0: recentCommon   - recent + backyard family
    //   1: recentUncommon - recent + non-backyard family
    //   2: regionCommon   - historical + appeared in 3+ of 12 monthly samples
    //   3: regionUncommon - historical + fewer than 3 monthly appearances + backyard family
    //   4: rareUncommon   - historical + fewer than 3 monthly appearances + non-backyard (vagrants)
    // Within each group: more monthly appearances first, then by frequency rank within those months.
    all.sort((a, b) => {
      const gA = pgIndex(a.isHistorical, a.isBackyard, a.appearances);
      const gB = pgIndex(b.isHistorical, b.isBackyard, b.appearances);
      if (gA !== gB) return gA - gB;
      if (b.appearances !== a.appearances) return b.appearances - a.appearances;
      return a.commonRank - b.commonRank;
    });

    // Strip raw sort keys; send priorityGroup string for client-side promotion ordering
    res.json(all.map(s => {
      const { commonRank, appearances, ...rest } = s;
      return { ...rest, priorityGroup: PRIORITY_GROUPS[pgIndex(rest.isHistorical, rest.isBackyard, appearances)] };
    }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch regional birds' });
  }
});

const EUROPE_CODES = [
  'FR', 'DE', 'ES', 'PT', 'IT', 'NL', 'BE', 'SE', 'NO', 'FI',
  'DK', 'PL', 'AT', 'CH', 'IE', 'GR', 'HR', 'CZ', 'HU', 'RO',
  'SK', 'SI', 'BG', 'LT', 'LV', 'EE', 'UA', 'MT', 'CY', 'LU', 'IS',
];
const S_AMERICA_CODES = [
  'BR', 'AR', 'CL', 'CO', 'PE', 'EC', 'BO', 'VE', 'PY', 'UY', 'GY', 'SR',
];
const AFRICA_CODES = [
  'ZA', 'KE', 'TZ', 'ET', 'GH', 'NG', 'SN', 'CM', 'CD', 'MG',
  'MW', 'ZM', 'ZW', 'UG', 'RW', 'MZ', 'BW', 'NA', 'AO', 'CI', 'MA', 'EG',
];

// GET /api/birds/all-species
// Returns the full eBird species taxonomy with per-continent flags, sorted NA-first then
// alphabetically. Country lists are individually cached 24h; combined result cached 24h.
router.get('/all-species', async (req, res) => {
  const cacheKey = 'all-species-v2';
  const cached = cache.get<object[]>(cacheKey);
  if (cached) return res.json(cached);

  const safe = (code: string) => getSpeciesList(code).catch(() => [] as string[]);

  try {
    const [
      [usCodes, caCodes, gbCodes],
      europeLists,
      sAmericaLists,
      africaLists,
      taxonomy,
    ] = await Promise.all([
      Promise.all(['US', 'CA', 'GB'].map(safe)),
      Promise.all(EUROPE_CODES.map(safe)),
      Promise.all(S_AMERICA_CODES.map(safe)),
      Promise.all(AFRICA_CODES.map(safe)),
      getTaxonomy(),
    ]);

    const naSet = new Set([...usCodes, ...caCodes]);
    const gbSet = new Set(gbCodes);
    const euSet = new Set(europeLists.flat());
    const saSet = new Set(sAmericaLists.flat());
    const afSet = new Set(africaLists.flat());

    const result = taxonomy
      .map(t => ({
        speciesCode:    t.speciesCode,
        comName:        t.comName,
        sciName:        t.sciName,
        isNorthAmerican: naSet.has(t.speciesCode),
        isGreatBritain:  gbSet.has(t.speciesCode),
        isEuropean:      euSet.has(t.speciesCode),
        isSouthAmerican: saSet.has(t.speciesCode),
        isAfrican:       afSet.has(t.speciesCode),
      }))
      .sort((a, b) => {
        if (a.isNorthAmerican !== b.isNorthAmerican) return a.isNorthAmerican ? -1 : 1;
        return a.comName.localeCompare(b.comName);
      });

    cache.set(cacheKey, result, 24 * 60 * 60 * 1000);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch species list' });
  }
});

// GET /api/birds/info/:speciesCode?sciName=...&comName=...
// Returns rich bird metadata: Wikipedia extract, conservation status, recordings, photos.
router.get('/info/:speciesCode', async (req, res) => {
  const comName = req.query.comName ? String(req.query.comName) : '';
  const sciName = req.query.sciName ? String(req.query.sciName) : comName;

  const cacheKey = `birdinfo:${req.params.speciesCode}`;
  const cached = cache.get<object>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const [wikipedia, rangeMap, recordings, photos, taxaRes] = await Promise.allSettled([
      getWikipediaSummary(sciName, comName),
      getWikipediaRangeMap(sciName, comName),
      getRecordings(sciName),
      getSpeciesPhotoUrls(req.params.speciesCode, comName, sciName),
      // iNaturalist taxa API for conservation status
      axios.get('https://api.inaturalist.org/v1/taxa', {
        params: { q: sciName, is_active: true, per_page: 1 },
        headers: { 'User-Agent': 'BurdyGurdy/1.0 (bird identification learning app)' },
      }),
    ]);

    const wikiData     = wikipedia.status  === 'fulfilled' ? wikipedia.value  : null;
    const rangeMapUrl  = rangeMap.status   === 'fulfilled' ? rangeMap.value   : null;
    const recs         = recordings.status === 'fulfilled' ? recordings.value : [];
    const photoData    = photos.status     === 'fulfilled' ? photos.value     : { primary: null, optional: [] };

    let conservationStatus: { code: string; name: string } | null = null;
    if (taxaRes.status === 'fulfilled') {
      const taxaResult = taxaRes.value.data?.results?.[0];
      const cs = taxaResult?.name?.toLowerCase() === sciName?.toLowerCase()
        ? taxaResult?.conservation_status
        : undefined;
      if (cs?.status) {
        conservationStatus = {
          code: (cs.status as string).toUpperCase(),
          name: cs.status_name as string ?? cs.status as string,
        };
      }
    }

    // Fetch legend and Wikipedia photos in parallel (both need sciName/comName)
    const [rangeMapLegend, wikiPhotos] = await Promise.all([
      getWikipediaRangeMapLegend(sciName, comName),
      getWikipediaPhotos(sciName, comName),
    ]);

    const result = {
      wikipedia: wikiData,
      rangeMapUrl,
      rangeMapLegend,
      conservationStatus,
      recordings: recs.slice(0, 6).map((r: { file: string; sono?: { med?: string; small?: string }; type?: string; cnt?: string; en?: string; length?: string }) => {
        const dur = parseXCLength(r.length);
        return {
          file:            r.file,
          sonoUrl:         r.sono?.med ?? r.sono?.small ?? null,
          type:            r.type ?? null,
          country:         r.cnt ?? null,
          en:              r.en ?? null,
          durationSeconds: isFinite(dur) ? dur : null,
        };
      }),
      // Primary photo from iNaturalist taxa API (high quality), optionals from Wikipedia article
      photos: { primary: photoData.primary, optional: wikiPhotos },
    };

    cache.set(cacheKey, result, 24 * 60 * 60 * 1000);
    res.json(result);
  } catch (err) {
    console.error('Bird info error:', err);
    res.status(500).json({ error: 'Failed to fetch bird info' });
  }
});

// GET /api/birds/audio/:sciName
// Returns the 5 shortest non-banned xeno-canto recordings for a species,
// matching the duration-weighted bias of quiz question selection.
router.get('/audio/:sciName', async (req, res) => {
  try {
    const sciName = req.params.sciName.replace(/_/g, ' ');
    const [recordings, bannedUrls] = await Promise.all([
      getRecordings(sciName),
      getBannedAudioUrls(),
    ]);
    const filtered = filterRecordings(recordings, bannedUrls);
    const sorted   = [...filtered].sort((a, b) => parseXCLength(a.length) - parseXCLength(b.length));
    res.json(sorted.slice(0, 5));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch audio' });
  }
});

// GET /api/birds/taxonomy?codes=amro,wbnu,bcch
// Returns taxonomy fields for the given species codes (comma-separated).
// Used by the frontend to backfill taxonomy on existing BirdProgress records.
router.get('/taxonomy', async (req, res) => {
  const codesParam = String(req.query.codes ?? '').trim();
  if (!codesParam) return res.json([]);
  const codes = codesParam.split(',').map(c => c.trim()).filter(Boolean);
  if (codes.length === 0) return res.json([]);

  try {
    const taxonomy = await getTaxonomy();
    const taxMap = new Map(taxonomy.map(t => [t.speciesCode, t]));
    const result = codes.flatMap(code => {
      const t = taxMap.get(code);
      if (!t) return [];
      return [{
        speciesCode:   code,
        familyComName: t.familyComName ?? '',
        familySciName: t.familySciName ?? '',
        order:         t.order ?? '',
        orderComName:  ORDER_COMMON_NAMES[t.order ?? ''] ?? '',
      }];
    });
    res.json(result);
  } catch (err) {
    console.error('taxonomy error:', err);
    res.status(500).json({ error: 'Failed to fetch taxonomy' });
  }
});

// GET /api/birds/suggest?q=robin
// Filters the cached eBird taxonomy (24h TTL) by common or scientific name.
// Returns up to 10 matches, prioritising starts-with over contains.
router.get('/suggest', async (req, res) => {
  const q = String(req.query.q ?? '').trim().toLowerCase();
  if (q.length < 3) return res.json([]);
  try {
    const taxonomy = await getTaxonomy();
    const matches = taxonomy.filter(s =>
      s.comName.toLowerCase().includes(q) || s.sciName.toLowerCase().includes(q),
    );
    matches.sort((a, b) => {
      const aName = a.comName.toLowerCase();
      const bName = b.comName.toLowerCase();
      const aStarts = aName.startsWith(q) ? 0 : 1;
      const bStarts = bName.startsWith(q) ? 0 : 1;
      return aStarts - bStarts || aName.localeCompare(bName);
    });
    res.json(matches.slice(0, 10).map(s => ({
      speciesCode: s.speciesCode, comName: s.comName, sciName: s.sciName,
    })));
  } catch (err) {
    console.error('suggest error:', err);
    res.status(500).json({ error: 'Suggest failed' });
  }
});

// GET /api/birds/regions/search?q=Ottawa
router.get('/regions/search', async (req, res) => {
  try {
    const q = String(req.query.q ?? '');
    if (q.length < 2) return res.json([]);

    const TTL_1H = 60 * 60 * 1000;
    const cacheKey = `regionsearch:${q.toLowerCase()}`;
    const cached = cache.get<Array<{ code: string; name: string }>>(cacheKey);
    if (cached) return res.json(cached);

    const res2 = await ebirdClient().get('/ref/region/find', {
      params: { q, locale: 'en', maxResults: 10 },
    });

    // eBird returns [{code, name}]
    const results = (res2.data as Array<{ code: string; name: string }>).map(r => ({
      code: r.code,
      name: r.name,
    }));

    cache.set(cacheKey, results, TTL_1H);
    res.json(results);
  } catch (err) {
    console.error('Region search error:', err);
    res.json([]); // fail silently - don't break the UI
  }
});

// GET /api/birds/regions/locate?lat=47.6&lng=-122.3&mapZoom=4
// Reverse-geocodes a lat/lng to an eBird region code using Nominatim (OpenStreetMap).
// At mapZoom >= 8, also attempts county/district (subnational2) resolution.
router.get('/regions/locate', async (req, res) => {
  const lat = parseFloat(req.query.lat as string);
  const lng = parseFloat(req.query.lng as string);
  const mapZoom = parseInt(req.query.mapZoom as string) || 4;
  if (isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ detail: 'Invalid coordinates' });
  }

  const nominatimZoom = mapZoom >= 8 ? 10 : mapZoom >= 4 ? 5 : 3;
  const cacheKey = `locate2:${lat.toFixed(2)},${lng.toFixed(2)},${nominatimZoom}`;
  const cached = cache.get<object>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const nominatim = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: { lat, lon: lng, format: 'json', zoom: nominatimZoom },
      headers: { 'User-Agent': 'BurdyGurdy/1.0 (bird identification learning app)' },
    });

    const data = nominatim.data;
    const addr = data?.address;
    if (!addr) return res.status(404).json({ detail: 'No region found for these coordinates' });

    const countryCode = (addr.country_code as string | undefined)?.toUpperCase();
    if (!countryCode) return res.status(404).json({ detail: 'Could not determine country' });

    const countryName: string = addr.country ?? countryCode;

    // At country zoom, return the country directly without state/county resolution
    if (nominatimZoom <= 3) {
      const result = { regionCode: countryCode, regionName: countryName };
      cache.set(cacheKey, result, 24 * 60 * 60 * 1000);
      return res.json(result);
    }

    // Different countries use different address fields for the state/province:
    // US → addr.state, Canada → addr.province (zoom=5) or addr.state (zoom=10)
    const stateName = (addr.state ?? addr.province ?? addr.region) as string | undefined;

    // ISO3166-2 lives inside addr (not at the top level of the Nominatim response).
    // The level number varies by country: US states are lvl4, some countries use lvl3/lvl5.
    const isoState = (
      addr['ISO3166-2-lvl4'] ?? addr['ISO3166-2-lvl3'] ?? addr['ISO3166-2-lvl5']
    ) as string | undefined;

    let sub1Code: string | undefined = isoState?.startsWith(countryCode) ? isoState : undefined;
    let sub1Name: string = stateName ?? addr.country ?? countryCode;

    // Fallback: search eBird's subnational1 list by province/state name
    if (!sub1Code && stateName) {
      try {
        const listRes = await ebirdClient().get(`/ref/region/list/subnational1/${countryCode}`);
        const regions = listRes.data as Array<{ code: string; name: string }>;
        const sl = stateName.toLowerCase();
        const match =
          regions.find(r => r.name.toLowerCase() === sl) ??
          regions.find(r => r.name.toLowerCase().includes(sl)) ??
          regions.find(r => sl.includes(r.name.toLowerCase()));
        if (match) { sub1Code = match.code; sub1Name = match.name; }
      } catch { /* fall back to country */ }
    }

    // Get the eBird display name for the province/state
    if (sub1Code) {
      try {
        const findRes = await ebirdClient().get('/ref/region/find', {
          params: { q: sub1Name, locale: 'en', maxResults: 5 },
        });
        const match = (findRes.data as Array<{ code: string; name: string }>)
          .find(r => r.code === sub1Code);
        if (match) sub1Name = match.name;
      } catch { /* keep Nominatim name */ }
    }

    // At high zoom: try county/district (subnational2).
    // Nominatim puts county names in addr.county for most regions, but independent
    // cities (e.g. Toronto) appear under addr.city with no addr.county.
    // Strip common administrative suffixes before matching against eBird names.
    let sub2Code: string | undefined;
    let sub2Name: string | undefined;
    if (nominatimZoom >= 10 && sub1Code) {
      const rawCounty = (addr.county ?? addr.city ?? addr.municipality) as string | undefined;
      if (rawCounty) {
        const stripped = rawCounty.replace(
          /\s+(County|District|Region|Regional Municipality|Municipality|Borough|Parish|Census Division)$/i,
          ''
        ).trim();
        try {
          const sub2Res = await ebirdClient().get(`/ref/region/list/subnational2/${sub1Code}`);
          const sub2s = sub2Res.data as Array<{ code: string; name: string }>;
          // Try exact match on stripped name, then partial matches
          const cl = stripped.toLowerCase();
          const match =
            sub2s.find(r => r.name.toLowerCase() === cl) ??
            sub2s.find(r => r.name.toLowerCase().includes(cl)) ??
            sub2s.find(r => cl.includes(r.name.toLowerCase()));
          if (match) { sub2Code = match.code; sub2Name = match.name; }
        } catch { /* ignore */ }
      }
    }

    const regionCode = sub2Code ?? sub1Code ?? countryCode;
    const regionName = sub2Name ?? sub1Name;
    const broader = sub2Code && sub1Code
      ? { code: sub1Code, name: sub1Name }
      : sub1Code
      ? { code: countryCode, name: countryName }
      : undefined;

    const result = { regionCode, regionName, broader };
    cache.set(cacheKey, result, 24 * 60 * 60 * 1000);
    res.json(result);
  } catch (err) {
    console.error('Locate region error:', (err as Error).message);
    res.status(500).json({ detail: 'Geocoding failed' });
  }
});

// GET /api/birds/recent-all?regionCode=CA-ON-OT
// Returns all eBird observations in a region for the past 24 hours.
// Includes speciesCode, comName, sciName, locName, obsDt, howMany, lat, lng, subId, userDisplayName.
// Cached 5 minutes server-side.
router.get('/recent-all', async (req, res) => {
  const regionCode = String(req.query.regionCode ?? '');
  if (!regionCode) return res.status(400).json({ error: 'regionCode required' });

  res.set('Cache-Control', 'no-store');

  const cacheKey = `recent-all:${regionCode}`;
  const cached = cache.get<object[]>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const result = await ebirdClient().get(`/data/obs/${regionCode}/recent`, {
      params: { back: 1, detail: 'full', maxResults: 10000 },
    });
    type EbirdObs = {
      speciesCode: string; comName: string; sciName: string;
      locName: string; obsDt: string; howMany?: number;
      lat?: number; lng?: number; subId?: string; userDisplayName?: string;
    };
    const sightings = (result.data as EbirdObs[]).map(s => ({
      speciesCode:     s.speciesCode,
      comName:         s.comName,
      sciName:         s.sciName,
      locName:         s.locName,
      obsDt:           s.obsDt,
      howMany:         s.howMany        ?? null,
      lat:             s.lat            ?? null,
      lng:             s.lng            ?? null,
      subId:           s.subId          ?? null,
      userDisplayName: s.userDisplayName ?? null,
    }));
    cache.set(cacheKey, sightings, 5 * 60 * 1000); // 5 minutes
    res.json(sightings);
  } catch {
    res.json([]);
  }
});

// GET /api/birds/recent-species/:speciesCode?regionCode=CA-ON-OT
// Returns all recent eBird sightings of one species across all locations in the region (30 days).
// Returns RegionalSighting-compatible objects. Cached 1 hour.
router.get('/recent-species/:speciesCode', async (req, res) => {
  const { speciesCode } = req.params;
  const regionCode = String(req.query.regionCode ?? '');
  if (!regionCode) return res.status(400).json({ error: 'regionCode required' });

  const cacheKey = `recent-species:${regionCode}:${speciesCode}`;
  const cached = cache.get<object[]>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const result = await ebirdClient().get(`/data/obs/${regionCode}/recent/${speciesCode}`, {
      params: { back: 30, detail: 'full', maxResults: 100 },
    });
    type EbirdObs = {
      speciesCode: string; comName: string; sciName: string;
      locName: string; obsDt: string; howMany?: number;
      lat?: number; lng?: number; subId?: string; userDisplayName?: string;
    };
    const sightings = (result.data as EbirdObs[]).map(s => ({
      speciesCode:     s.speciesCode,
      comName:         s.comName,
      sciName:         s.sciName,
      locName:         s.locName,
      obsDt:           s.obsDt,
      howMany:         s.howMany        ?? null,
      lat:             s.lat            ?? null,
      lng:             s.lng            ?? null,
      subId:           s.subId          ?? null,
      userDisplayName: s.userDisplayName ?? null,
    }));
    cache.set(cacheKey, sightings, 60 * 60 * 1000); // 1 hour
    res.json(sightings);
  } catch {
    res.json([]);
  }
});

// GET /api/birds/recent/:speciesCode?regionCode=CA-ON-OT
// Returns up to 3 most recent eBird observations of a species in a region (last 30 days).
router.get('/recent/:speciesCode', async (req, res) => {
  const { speciesCode } = req.params;
  const regionCode = String(req.query.regionCode ?? '');
  if (!regionCode) return res.status(400).json({ error: 'regionCode required' });
  const maxResults = Math.min(10, Math.max(1, parseInt(String(req.query.maxResults ?? '5')) || 5));

  const cacheKey = `recent:${regionCode}:${speciesCode}:${maxResults}`;
  const cached = cache.get<object[]>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const result = await ebirdClient().get(`/data/obs/${regionCode}/recent/${speciesCode}`, {
      params: { maxResults, back: 30 },
    });
    const sightings = (result.data as Array<{ locName: string; obsDt: string; howMany?: number; lat?: number; lng?: number }>)
      .slice(0, maxResults)
      .map(s => ({ locName: s.locName, obsDt: s.obsDt, howMany: s.howMany ?? null, lat: s.lat ?? null, lng: s.lng ?? null }));
    cache.set(cacheKey, sightings, 60 * 60 * 1000); // 1 hour
    res.json(sightings);
  } catch {
    res.json([]);
  }
});

// GET /api/birds/photo/:speciesCode?comName=American+Robin&sciName=Turdus+migratorius
router.get('/photo/:speciesCode', async (req, res) => {
  try {
    const comName = req.query.comName ? String(req.query.comName) : undefined;
    const sciName = req.query.sciName ? String(req.query.sciName) : undefined;
    const url = await getSpeciesPhotoUrl(req.params.speciesCode, comName, sciName);
    res.json({ url });
  } catch {
    res.json({ url: null });
  }
});

// GET /api/birds/photos/:speciesCode?comName=...&sciName=...&forQuestion=true
// Returns photo URLs for the species. forQuestion=true applies appearance-only filtering.
router.get('/photos/:speciesCode', async (req, res) => {
  try {
    const comName = req.query.comName ? String(req.query.comName) : undefined;
    const sciName = req.query.sciName ? String(req.query.sciName) : undefined;
    const forQuestion = req.query.forQuestion === 'true';
    const photos = forQuestion
      ? await getSpeciesPhotoUrlsForQuestion(req.params.speciesCode, comName, sciName)
      : await getSpeciesPhotoUrls(req.params.speciesCode, comName, sciName);
    res.json(photos);
  } catch {
    res.json({ primary: null, optional: [] });
  }
});

// POST /api/birds/report-media
// Submits a media error report. Requires authentication.
router.post('/report-media', async (req, res) => {
  const { url, mediaType, service, speciesCode, comName, issueType, wrongBird, description, regionCode, notifyEmail } = req.body ?? {};
  if (!url || !mediaType || !speciesCode || !comName || !issueType) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  const reporterId = token ? (decodeJwt(token)?.sub ?? null) : null;
  if (!reporterId) return res.status(401).json({ error: 'Authentication required to submit reports' });

  try {
    const admin = getSupabaseAdmin();

    // Find or create the media_reports row for this URL + species.
    const { data: existing } = await admin
      .from('media_reports')
      .select('id')
      .eq('url', url)
      .eq('species_code', speciesCode)
      .maybeSingle();

    let reportId: string;
    if (existing) {
      reportId = (existing as { id: string }).id;
    } else {
      const { data: created, error: createErr } = await admin
        .from('media_reports')
        .insert({ url, media_type: mediaType, service: service ?? null, species_code: speciesCode, com_name: comName, status: 'pending' })
        .select('id')
        .single();
      if (createErr || !created) {
        console.error('[report-media] create report:', createErr?.message);
        return res.status(500).json({ error: createErr?.message ?? 'Failed to create report' });
      }
      reportId = (created as { id: string }).id;
    }

    const { error: subErr } = await admin
      .from('media_report_submissions')
      .insert({
        report_id:    reportId,
        reporter_id:  reporterId,
        issue_type:   issueType,
        wrong_bird:   wrongBird ?? null,
        description:  description ?? null,
        region_code:  regionCode ?? null,
        notify_email: notifyEmail === true,
      });
    if (subErr) {
      console.error('[report-media] create submission:', subErr.message);
      return res.status(500).json({ error: subErr.message });
    }

    res.json({ ok: true });

    // Fire-and-forget: send in-app + email notifications to all admins
    (async () => {
      try {
        // Resolve reporter display name
        const { data: reporterData } = await admin.auth.admin.getUserById(reporterId);
        const reporterName: string =
          (reporterData?.user?.user_metadata?.full_name as string | undefined) ??
          (reporterData?.user?.user_metadata?.name      as string | undefined) ??
          reporterData?.user?.email ?? 'A user';

        // Fetch all admin users
        const { data: usersPage } = await admin.auth.admin.listUsers({ perPage: 1000 });
        const adminUsers = (usersPage?.users ?? []).filter(u => u.user_metadata?.is_admin === true);

        const issueLabels: Record<string, string> = {
          wrong_bird:   'wrong bird',
          poor_quality: 'poor quality',
          confusing:    'confusing',
          nest:         'contains nest',
          egg:          'contains egg',
          other:        'other issue',
        };
        const issueLabel = issueLabels[issueType] ?? issueType;

        const apiKey    = process.env.RESEND_API_KEY;
        const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev';
        const resend    = apiKey ? new Resend(apiKey) : null;

        for (const adminUser of adminUsers) {
          await admin.from('notifications').insert({
            recipient_user_id:   adminUser.id,
            sender_user_id:      reporterId,
            sender_display_name: reporterName,
            type:                'new_report',
            data:                { comName, mediaType, issueType },
            read:                false,
          });

          if (resend && adminUser.email) {
            resend.emails.send({
              from:    `BurdyGurdy <${fromEmail}>`,
              to:      adminUser.email,
              subject: `New ${mediaType} report for ${comName}`,
              text:    `${reporterName} submitted a new ${mediaType} report for ${comName}.\n\nIssue: ${issueLabel}\n\nLog in and open the Curation panel to review it.`,
              html: `
                <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
                  <h2 style="color: #2d6a4f;">New media report</h2>
                  <p><strong>${reporterName}</strong> submitted a new <strong>${mediaType}</strong> report for <strong>${comName}</strong>.</p>
                  <p>Issue: ${issueLabel}</p>
                  <p style="color: #666; font-size: 13px;">Log in and open the Curation panel to review it.</p>
                </div>
              `,
            }).catch(err => console.error('[report-media] email:', (err as Error).message));
          }
        }
      } catch (err) {
        console.error('[report-media] admin notify:', (err as Error).message);
      }
    })();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    console.error('[report-media]', msg);
    res.status(500).json({ error: msg });
  }
});

// POST /api/birds/report-resolved
// Called by an admin after resolving a media report. Creates an in-app notification
// (via service-role client to bypass RLS) and optionally sends an email.
router.post('/report-resolved', async (req, res) => {
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token' });

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try { admin = getSupabaseAdmin(); }
  catch (e) { return res.status(500).json({ error: (e as Error).message }); }

  const { data: { user: caller }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !caller) return res.status(401).json({ error: 'Invalid token' });
  if (caller.user_metadata?.is_admin !== true) return res.status(403).json({ error: 'Forbidden' });

  const { reporterUserId, reporterEmail, comName, mediaType, action, note, blockScope } = req.body ?? {};
  if (!reporterUserId || !comName || !mediaType || !action) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const actionLabel =
    action === 'blocked' && blockScope === 'question'
      ? 'Blocked from questions — the media has been blocked from quiz questions but will remain visible in the bird info screen for reference.'
    : action === 'blocked'
      ? 'Removed from game — the media has been removed from the game entirely.'
    : action === 'marked_valid'
      ? 'Acceptable — your concern was noted, but after review the media was found to be appropriate for its current use. No changes were made.'
      : 'Dismissed — after review, this report was found to be inaccurate and has been closed.';
  const callerDisplayName: string =
    (caller.user_metadata?.full_name as string | undefined) ??
    (caller.user_metadata?.name      as string | undefined) ??
    caller.email ?? 'BirdyGurdy';

  // Create in-app notification using service-role client (bypasses RLS)
  const { error: notifErr } = await admin.from('notifications').insert({
    recipient_user_id:   reporterUserId,
    sender_user_id:      caller.id,
    sender_display_name: callerDisplayName,
    type:                'report_resolved',
    data:                { action, comName, mediaType, ...(blockScope ? { blockScope } : {}), ...(note ? { note } : {}) },
    read:                false,
  });
  if (notifErr) {
    console.error('[report-resolved] notification insert:', notifErr.message);
    return res.status(500).json({ error: notifErr.message });
  }

  // Send email if reporter opted in
  if (reporterEmail) {
    const apiKey   = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev';
    if (apiKey) {
      const resend = new Resend(apiKey);
      resend.emails.send({
        from:    `BurdyGurdy <${fromEmail}>`,
        to:      reporterEmail,
        subject: 'Your BurdyGurdy report has been reviewed',
        text:    `Your ${mediaType} report for ${comName} has been reviewed.\n\n${actionLabel}${note ? `\n\nNote from reviewer: ${note}` : ''}\n\nThank you for helping improve BurdyGurdy!`,
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
            <h2 style="color: #2d6a4f;">Your report has been reviewed</h2>
            <p>Your <strong>${mediaType}</strong> report for <strong>${comName}</strong> has been reviewed.</p>
            <p>${actionLabel}</p>
            ${note ? `<p><strong>Note from reviewer:</strong> ${note}</p>` : ''}
            <p style="color: #666; font-size: 13px;">Thank you for helping improve BurdyGurdy!</p>
          </div>
        `,
      }).catch(err => console.error('[report-resolved] email:', (err as Error).message));
    }
  }

  res.json({ ok: true });
});

// POST /api/birds/regional-presence/refresh
// Called fire-and-forget by the frontend. Checks if the shared regional presence
// cache is stale (>24h) and if so fetches fresh eBird data and upserts last_seen_date
// per species. Uses the service-role client so RLS doesn't block writes.
router.post('/regional-presence/refresh', async (req, res) => {
  const { regionCode } = req.body ?? {};
  if (!regionCode) return res.status(400).json({ error: 'regionCode required' });

  try {
    const admin = getSupabaseAdmin();

    // Check when this region was last refreshed.
    const { data: meta } = await admin
      .from('regional_presence_meta')
      .select('last_fetched_at, fetch_back_days')
      .eq('region_code', regionCode)
      .maybeSingle();

    const lastFetched = meta ? new Date((meta as { last_fetched_at: string }).last_fetched_at) : null;
    const hoursSince  = lastFetched ? (Date.now() - lastFetched.getTime()) / 3_600_000 : Infinity;
    if (hoursSince < 24) return res.json({ updated: false });

    // eBird recent-obs endpoint caps at back=30; use that for new regions, otherwise
    // cover the gap since last fetch (capped at 30).
    const daysSince = lastFetched ? Math.ceil((Date.now() - lastFetched.getTime()) / 86_400_000) : 30;
    const back      = Math.min(30, Math.max(2, daysSince + 1));

    const observations = await getRegionalSpecies(regionCode, back);
    if (observations.length === 0) return res.json({ updated: false });

    // Upsert last_seen_date using the actual eBird observation date (obsDt), not today.
    const rows = observations.map((obs: { speciesCode: string; obsDt: string }) => ({
      region_code:    regionCode,
      species_code:   obs.speciesCode,
      last_seen_date: obs.obsDt.slice(0, 10), // "YYYY-MM-DD HH:MM" → "YYYY-MM-DD"
      updated_at:     new Date().toISOString(),
    }));

    const { error: upsertErr } = await admin
      .from('regional_presence')
      .upsert(rows, { onConflict: 'region_code,species_code' });
    if (upsertErr) {
      console.error('[regional-presence] upsert:', upsertErr.message);
      return res.status(500).json({ error: upsertErr.message });
    }

    await admin
      .from('regional_presence_meta')
      .upsert({ region_code: regionCode, last_fetched_at: new Date().toISOString(), fetch_back_days: back },
               { onConflict: 'region_code' });

    res.json({ updated: true, count: rows.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    console.error('[regional-presence]', msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
