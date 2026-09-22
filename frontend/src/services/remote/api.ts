import axios from 'axios';
import type { QuizQuestion, QuestionType, BirdSpecies, AttributedPhoto } from '../../types';

export const api = axios.create({ baseURL: (import.meta.env.VITE_API_URL ?? '') + '/api' });

/**
 * Bird info, photos and recent sightings are supplementary content shown after an answer. They have a
 * timeout so a stalled request turns into an error message (or a missing section) instead of leaving
 * "Loading..." on screen forever. Generous, because the backend may make several upstream calls.
 */
const SUPPLEMENTARY_REQUEST_TIMEOUT_MS = 30_000;

export async function fetchQuizQuestions(
  regionCode: string,
  count: number,
  types: QuestionType[],
  weights: Record<string, number> = {},
  groupId = 'all',
  masteryLevels: Record<string, number> = {},
  banned: string[] = [],
  paletteSpeciesCodes: string[] = [],
  back = 30,
  paletteKeys: string[] = [],
  historyKeys: string[] = [],
  strugglingKeys: string[] = [],
  bannedAudioUrls: string[] = [],
  birderLevel?: string,
  speciesFilter: string[] = [],
): Promise<QuizQuestion[]> {
  const res = await api.post<QuizQuestion[]>('/quiz/questions', {
    regionCode,
    count,
    types,
    weights,
    groupId,
    masteryLevels,
    banned,
    paletteSpeciesCodes,
    back,
    paletteKeys,
    historyKeys,
    strugglingKeys,
    bannedAudioUrls,
    birderLevel,
    speciesFilter,
  });
  return res.data;
}


export interface LocateResult {
  regionCode: string;
  regionName: string;
  broader?: { code: string; name: string };
}

export async function locateRegion(lat: number, lng: number, mapZoom: number): Promise<LocateResult> {
  const res = await api.get<LocateResult>('/birds/regions/locate', {
    params: { lat, lng, mapZoom },
  });
  return res.data;
}

export interface AllSpeciesEntry {
  speciesCode: string;
  comName: string;
  sciName: string;
  isNorthAmerican: boolean;
  isGreatBritain: boolean;
  isEuropean: boolean;
  isSouthAmerican: boolean;
  isAfrican: boolean;
}

export async function fetchAllSpecies(): Promise<AllSpeciesEntry[]> {
  const res = await api.get<AllSpeciesEntry[]>('/birds/all-species');
  return res.data;
}

export async function fetchRegionSpecies(regionCode: string, back = 30): Promise<BirdSpecies[]> {
  const res = await api.get<BirdSpecies[]>(`/birds/region/${regionCode}`, { params: { back } });
  return res.data;
}

export interface BirdInfoData {
  wikipedia: { extract: string; url: string; imageUrl: string | null } | null;
  rangeMapUrl: string | null;
  rangeMapLegend: Array<{ color: string; label: string }>;
  conservationStatus: { code: string; name: string } | null;
  recordings: Array<{
    file: string;
    sonoUrl: string | null;
    type: string | null;
    country: string | null;
    en: string | null;              // English name from xeno-canto (confirmation)
    durationSeconds: number | null;
  }>;
  photos: { primary: AttributedPhoto | null; optional: AttributedPhoto[] };
}

/**
 * Throws on failure (rather than swallowing to null) so callers can tell "this
 * bird genuinely has no info" apart from "the fetch failed" and show a specific
 * message via describeUpstreamError - see UpstreamErrorPayload.
 */
export async function fetchBirdInfo(
  speciesCode: string,
  comName?: string,
  sciName?: string,
): Promise<BirdInfoData> {
  const params: Record<string, string> = {};
  if (comName) params.comName = comName;
  if (sciName) params.sciName = sciName;
  const res = await api.get<BirdInfoData>(`/birds/info/${speciesCode}`, { params, timeout: SUPPLEMENTARY_REQUEST_TIMEOUT_MS });
  const data = res.data;
  // xeno-canto occasionally returns recordings with a null `file` field at runtime
  data.recordings = data.recordings.filter(r => !!r.file);
  return data;
}

export async function fetchBirdPhoto(speciesCode: string, comName?: string, sciName?: string): Promise<string | null> {
  const params: Record<string, string> = {};
  if (comName) params.comName = comName;
  if (sciName) params.sciName = sciName;
  const res = await api.get<{ url: string | null }>(`/birds/photo/${speciesCode}`, { params });
  return res.data.url;
}

export interface RecentSighting {
  locName: string;
  obsDt: string;
  howMany: number | null;
  lat: number | null;
  lng: number | null;
}

/** Throws on failure - see fetchBirdInfo's note on why these no longer swallow to []. */
export async function fetchRecentSightings(speciesCode: string, regionCode: string, maxResults = 5): Promise<RecentSighting[]> {
  const res = await api.get<RecentSighting[]>(`/birds/recent/${speciesCode}`, { params: { regionCode, maxResults }, timeout: SUPPLEMENTARY_REQUEST_TIMEOUT_MS });
  return res.data;
}

/** A single observation from the regional 24-hour feed. */
export interface RegionalSighting {
  speciesCode:     string;
  comName:         string;
  sciName:         string;
  locName:         string;
  obsDt:           string;
  howMany:         number | null;
  lat:             number | null;
  lng:             number | null;
  subId:           string | null;
  userDisplayName: string | null;
}

/** Throws on failure - see fetchBirdInfo's note on why these no longer swallow to []. */
export async function fetchSpeciesSightings(speciesCode: string, regionCode: string): Promise<RegionalSighting[]> {
  const res = await api.get<RegionalSighting[]>(`/birds/recent-species/${speciesCode}`, { params: { regionCode } });
  return res.data;
}

/** Throws on failure - see fetchBirdInfo's note on why these no longer swallow to []. */
export async function fetchRegionalSightings(regionCode: string): Promise<RegionalSighting[]> {
  const res = await api.get<RegionalSighting[]>('/birds/recent-all', { params: { regionCode } });
  return res.data;
}

export interface CarouselRecording {
  file:    string;
  sonoUrl: string | null;
  type:    string | null;
  country: string | null;
}

/** Throws on failure - see fetchBirdInfo's note on why these no longer swallow to []. */
export async function fetchBirdAudio(sciName: string): Promise<CarouselRecording[]> {
  const encoded = encodeURIComponent(sciName.replace(/ /g, '_'));
  const res = await api.get<Array<{ file: string; sono: { small: string; med: string }; type: string; cnt: string }>>(
    `/birds/audio/${encoded}`,
  );
  const toHttps = (u?: string) => u?.startsWith('//') ? `https:${u}` : u ?? '';
  return res.data.map(r => ({
    file:    toHttps(r.file),
    sonoUrl: r.sono?.med ? toHttps(r.sono.med) : null,
    type:    r.type  || null,
    country: r.cnt   || null,
  }));
}

export interface BirdSuggestion {
  speciesCode: string;
  comName: string;
  sciName: string;
}

export async function fetchBirdSuggestions(q: string): Promise<BirdSuggestion[]> {
  try {
    const res = await api.get<BirdSuggestion[]>('/birds/suggest', { params: { q } });
    return res.data;
  } catch {
    return [];
  }
}

export interface TaxonomyEntry {
  speciesCode:   string;
  familyComName: string;
  familySciName: string;
  order:         string;
  orderComName:  string;
}

export async function fetchTaxonomy(codes: string[]): Promise<TaxonomyEntry[]> {
  if (codes.length === 0) return [];
  const res = await api.get<TaxonomyEntry[]>('/birds/taxonomy', {
    params: { codes: codes.join(',') },
  });
  return res.data;
}

/**
 * `unavailable` is true when there are no photos only because the photo sources could not be asked
 * (rate limited, down, timed out) - as opposed to the bird genuinely having none.
 */
export async function fetchBirdPhotos(speciesCode: string, comName?: string, sciName?: string, forQuestion = false): Promise<{ primary: AttributedPhoto | null; optional: AttributedPhoto[]; unavailable: boolean }> {
  const params: Record<string, string> = {};
  if (comName) params.comName = comName;
  if (sciName) params.sciName = sciName;
  if (forQuestion) params.forQuestion = 'true';
  const res = await api.get<{ primary: AttributedPhoto | null; optional: AttributedPhoto[]; unavailable?: boolean }>(`/birds/photos/${speciesCode}`, { params, timeout: SUPPLEMENTARY_REQUEST_TIMEOUT_MS });
  return { primary: res.data.primary ?? null, optional: res.data.optional ?? [], unavailable: res.data.unavailable ?? false };
}
