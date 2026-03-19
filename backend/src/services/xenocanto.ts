import axios from 'axios';
import { cache } from '../cache';

const XC_BASE = 'https://xeno-canto.org/api/3';
const TTL_24H = 24 * 60 * 60 * 1000;

export interface XCRecording {
  id: string;
  gen: string;    // genus
  sp: string;     // species epithet
  en: string;     // english name
  cnt: string;    // country
  loc: string;    // location
  type: string;   // 'song', 'call', etc.
  url: string;    // xeno-canto page url
  file: string;   // audio file url
  sono: { small: string; med: string }; // spectrogram images
  q: string;      // quality rating A-E
}

export interface XCResponse {
  numRecordings: string;
  recordings: XCRecording[];
}

function xcKey(): string {
  const k = process.env.XENO_CANTO_API_KEY;
  if (!k) throw new Error('XENO_CANTO_API_KEY is not set in .env');
  return k;
}

/** Get recordings for a species by scientific name. Cached 24h. Returns [] on any error. */
export async function getRecordings(sciName: string): Promise<XCRecording[]> {
  const cacheKey = `xc:${sciName}`;
  const cached = cache.get<XCRecording[]>(cacheKey);
  if (cached) return cached;

  try {
    // v3 uses sp:"genus species" tag syntax
    const spQuery = `sp:"${sciName}" type:song q:A`;
    const res = await axios.get<XCResponse>(`${XC_BASE}/recordings`, {
      params: { query: spQuery, key: xcKey() },
    });

    // Guard against HTML error pages returned with a 200 status
    if (typeof res.data !== 'object' || !Array.isArray(res.data.recordings)) {
      console.warn(`xeno-canto: unexpected response for "${sciName}"`);
      return [];
    }

    let recordings = res.data.recordings;

    // Fallback: drop quality filter if no A-quality songs found
    if (recordings.length === 0) {
      const fallback = await axios.get<XCResponse>(`${XC_BASE}/recordings`, {
        params: { query: `sp:"${sciName}"`, key: xcKey() },
      });
      if (typeof fallback.data === 'object' && Array.isArray(fallback.data.recordings)) {
        recordings = fallback.data.recordings;
      }
    }

    cache.set(cacheKey, recordings, TTL_24H);
    return recordings;
  } catch (err) {
    const axiosErr = err as { response?: { status: number; data: unknown } };
    const status   = axiosErr.response?.status;
    const body     = axiosErr.response?.data;
    console.warn(
      `xeno-canto: failed to fetch recordings for "${sciName}":`,
      (err as Error).message,
      status ? `(HTTP ${status})` : '',
      body   ? JSON.stringify(body).slice(0, 200) : '',
    );
    return [];
  }
}
