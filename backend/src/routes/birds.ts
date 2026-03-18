import { Router } from 'express';
import axios from 'axios';
import { getTaxonomy, getRegionalSpecies, ebirdClient, getCommonSpeciesCodes, getBackyardSpeciesRanking, getSpeciesList } from '../services/ebird';
import { getRecordings } from '../services/xenocanto';
import { getSpeciesPhotoUrl, getSpeciesPhotoUrls, getSpeciesPhotoUrlsForQuestion } from '../services/macaulay';
import { getWikipediaSummary, getWikipediaRangeMap, getWikipediaRangeMapLegend, getWikipediaPhotos } from '../services/wikipedia';
import { cache } from '../cache';
import { BACKYARD_FAMILIES } from '../constants';
import { filterObservationsToKnownSpecies } from '../lib/speciesFilter';

const router = Router();

// GET /api/birds/region/:regionCode
// Returns species recently observed in a region, enriched with taxonomy info.
// Sorted backyard-family-first (by commonness), then remaining species by commonness.
// Includes isBackyard flag for client-side promotion queue logic.
router.get('/region/:regionCode', async (req, res) => {
  try {
    const { regionCode } = req.params;
    const backParam = parseInt(req.query.back as string);
    const back = [1, 7, 30].includes(backParam) ? backParam : 30;
    const [observations, taxonomy, backyardCodes, top100Codes, historicalCodes] = await Promise.all([
      getRegionalSpecies(regionCode, back),
      getTaxonomy(),
      getBackyardSpeciesRanking(regionCode),
      getCommonSpeciesCodes(regionCode),
      getSpeciesList(regionCode),
    ]);

    const taxMap = new Map(taxonomy.map(t => [t.speciesCode, t]));
    const commonCodes = backyardCodes.length >= 10 ? backyardCodes : top100Codes;
    const commonRank = new Map(commonCodes.map((code, i) => [code, i]));

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
          isBackyard: BACKYARD_FAMILIES.has(tax?.familySciName ?? ''),
          commonRank: commonRank.get(obs.speciesCode) ?? 9999,
          isHistorical: false,
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
          commonRank: commonRank.get(code) ?? 9999,
          isHistorical: true,
        };
      });

    const all = [...recent, ...historical];

    // Sort into 4 priority groups:
    //   0: recent + common    1: recent + not common
    //   2: historical + common    3: historical + not common
    // Within each group, order by commonness rank.
    all.sort((a, b) => {
      const groupA = (a.isHistorical ? 2 : 0) + (a.isBackyard ? 0 : 1);
      const groupB = (b.isHistorical ? 2 : 0) + (b.isBackyard ? 0 : 1);
      if (groupA !== groupB) return groupA - groupB;
      return a.commonRank - b.commonRank;
    });

    // Strip raw sort key; expose derived flags for client-side filtering
    res.json(all.map(({ commonRank, ...rest }) => ({ ...rest, isCommon: commonRank < 9999 })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch regional birds' });
  }
});

// GET /api/birds/all-species
// Returns the full eBird species taxonomy sorted: North American (US+CA) first, then the rest.
// Both groups sorted alphabetically by common name. Cached 24h.
router.get('/all-species', async (req, res) => {
  const cacheKey = 'all-species-sorted';
  const cached = cache.get<object[]>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const [taxonomy, usCodes, caCodes] = await Promise.all([
      getTaxonomy(),
      getSpeciesList('US'),
      getSpeciesList('CA'),
    ]);

    const naSet = new Set([...usCodes, ...caCodes]);

    const result = taxonomy
      .map(t => ({
        speciesCode: t.speciesCode,
        comName: t.comName,
        sciName: t.sciName,
        isNorthAmerican: naSet.has(t.speciesCode),
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
      const cs = taxaRes.value.data?.results?.[0]?.conservation_status;
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
      recordings: recs.slice(0, 6).map((r: { file: string; sono?: { med?: string; small?: string }; type?: string; cnt?: string; en?: string }) => ({
        file:    r.file,
        sonoUrl: r.sono?.med ?? r.sono?.small ?? null,
        type:    r.type ?? null,
        country: r.cnt ?? null,
        en:      r.en ?? null,
      })),
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
// Returns xeno-canto recordings for a species
router.get('/audio/:sciName', async (req, res) => {
  try {
    const sciName = req.params.sciName.replace(/_/g, ' ');
    const recordings = await getRecordings(sciName);
    res.json(recordings.slice(0, 5)); // Return top 5
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch audio' });
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
    res.json([]); // fail silently — don't break the UI
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

export default router;
