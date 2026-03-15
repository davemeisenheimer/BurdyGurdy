import { Router } from 'express';
import axios from 'axios';
import { getTaxonomy, getRegionalSpecies, ebirdClient, getCommonSpeciesCodes, getBackyardSpeciesRanking, getSpeciesList } from '../services/ebird';
import { getRecordings } from '../services/xenocanto';
import { getSpeciesPhotoUrl, getSpeciesPhotoUrls } from '../services/macaulay';
import { getWikipediaSummary, getWikipediaRangeMap, getWikipediaRangeMapLegend, getWikipediaPhotos } from '../services/wikipedia';
import { cache } from '../cache';
import { BACKYARD_FAMILIES } from '../constants';

const router = Router();

// GET /api/birds/region/:regionCode
// Returns species recently observed in a region, enriched with taxonomy info.
// Sorted backyard-family-first (by commonness), then remaining species by commonness.
// Includes isBackyard flag for client-side promotion queue logic.
router.get('/region/:regionCode', async (req, res) => {
  try {
    const { regionCode } = req.params;
    const [observations, taxonomy, backyardCodes, top100Codes] = await Promise.all([
      getRegionalSpecies(regionCode),
      getTaxonomy(),
      getBackyardSpeciesRanking(regionCode),
      getCommonSpeciesCodes(regionCode),
    ]);

    const taxMap = new Map(taxonomy.map(t => [t.speciesCode, t]));
    const commonCodes = backyardCodes.length >= 10 ? backyardCodes : top100Codes;
    const commonRank = new Map(commonCodes.map((code, i) => [code, i]));

    // Deduplicate
    const seen = new Set<string>();
    const unique = observations
      .filter(obs => {
        if (seen.has(obs.speciesCode)) return false;
        seen.add(obs.speciesCode);
        return true;
      })
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
        };
      });

    // Sort: backyard species first (by commonness), then other species (by commonness)
    unique.sort((a, b) => {
      if (a.isBackyard !== b.isBackyard) return a.isBackyard ? -1 : 1;
      return a.commonRank - b.commonRank;
    });

    // Strip internal sort key before sending
    res.json(unique.map(({ commonRank: _cr, ...rest }) => rest));
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

  const nominatimZoom = mapZoom >= 8 ? 10 : 5;
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
    const broader = sub2Code && sub1Code ? { code: sub1Code, name: sub1Name } : undefined;

    const result = { regionCode, regionName, broader };
    cache.set(cacheKey, result, 24 * 60 * 60 * 1000);
    res.json(result);
  } catch (err) {
    console.error('Locate region error:', (err as Error).message);
    res.status(500).json({ detail: 'Geocoding failed' });
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

// GET /api/birds/photos/:speciesCode?comName=...&sciName=...
// Returns all available photo URLs for the species (for reveal-panel navigation)
router.get('/photos/:speciesCode', async (req, res) => {
  try {
    const comName = req.query.comName ? String(req.query.comName) : '';
    const sciName = req.query.sciName ? String(req.query.sciName) : comName;
    const [photoData, wikiPhotos] = await Promise.all([
      getSpeciesPhotoUrls(req.params.speciesCode, comName, sciName),
      getWikipediaPhotos(sciName, comName),
    ]);
    res.json({ primary: photoData.primary, optional: wikiPhotos });
  } catch {
    res.json({ primary: null, optional: [] });
  }
});

export default router;
