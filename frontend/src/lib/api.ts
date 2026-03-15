import axios from 'axios';
import type { QuizQuestion, QuestionType, BirdSpecies } from '../types';

const api = axios.create({ baseURL: (import.meta.env.VITE_API_URL ?? '') + '/api' });

export async function fetchQuizQuestions(
  regionCode: string,
  count: number,
  types: QuestionType[],
  weights: Record<string, number> = {},
  groupId = 'all',
  masteryLevels: Record<string, number> = {},
  banned: string[] = [],
  paletteSpeciesCodes: string[] = [],
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
}

export async function fetchAllSpecies(): Promise<AllSpeciesEntry[]> {
  const res = await api.get<AllSpeciesEntry[]>('/birds/all-species');
  return res.data;
}

export async function fetchRegionSpecies(regionCode: string): Promise<BirdSpecies[]> {
  const res = await api.get<BirdSpecies[]>(`/birds/region/${regionCode}`);
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
    en: string | null;      // English name from xeno-canto (confirmation)
  }>;
  photos: { primary: string | null; optional: string[] };
}

export async function fetchBirdInfo(
  speciesCode: string,
  comName?: string,
  sciName?: string,
): Promise<BirdInfoData | null> {
  const params: Record<string, string> = {};
  if (comName) params.comName = comName;
  if (sciName) params.sciName = sciName;
  try {
    const res = await api.get<BirdInfoData>(`/birds/info/${speciesCode}`, { params });
    return res.data;
  } catch {
    return null;
  }
}

export async function fetchBirdPhoto(speciesCode: string, comName?: string, sciName?: string): Promise<string | null> {
  const params: Record<string, string> = {};
  if (comName) params.comName = comName;
  if (sciName) params.sciName = sciName;
  const res = await api.get<{ url: string | null }>(`/birds/photo/${speciesCode}`, { params });
  return res.data.url;
}

export async function fetchBirdPhotos(speciesCode: string, comName?: string, sciName?: string): Promise<{ primary: string | null; optional: string[] }> {
  const params: Record<string, string> = {};
  if (comName) params.comName = comName;
  if (sciName) params.sciName = sciName;
  const res = await api.get<{ primary: string | null; optional: string[] }>(`/birds/photos/${speciesCode}`, { params });
  return { primary: res.data.primary ?? null, optional: res.data.optional ?? [] };
}
