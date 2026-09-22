/**
 * Pure helpers for the Macaulay Library seeding script (scripts/seed-macaulay-photos.ts) and the
 * runtime Macaulay lookup. No I/O: the script owns the browser, network and database work.
 */

/** Image CDN. The v2 path is the one macaulaylibrary.org itself uses now (v1 still serves the same images). */
export const MACAULAY_CDN = 'https://cdn.download.ams.birds.cornell.edu/api/v2/asset';

export interface MacaulayPhoto {
  url: string;
  credit: string;
  source: 'macaulay';
}

/** The fields we read from a Macaulay search result item (same in the v1 and v2 search APIs). */
export interface MacaulayItem {
  assetId?: number | string;
  userDisplayName?: string;
}

export function macaulayItemToPhoto(item: MacaulayItem | null | undefined): MacaulayPhoto | null {
  if (!item?.assetId) return null;
  return {
    url: `${MACAULAY_CDN}/${item.assetId}/1800`,
    credit: item.userDisplayName ? `© ${item.userDisplayName} · Macaulay Library` : 'Macaulay Library',
    source: 'macaulay',
  };
}

export type MacaulayBody =
  | { kind: 'photos'; photos: MacaulayPhoto[] }   // a real answer; `photos` may be empty
  | { kind: 'challenge' }                          // Anubis bot-challenge page instead of JSON
  | { kind: 'unexpected'; detail: string };

/** Classifies the response body of a Macaulay search request. Accepts parsed JSON or raw text. */
export function classifyMacaulayBody(body: unknown): MacaulayBody {
  let data = body;
  if (typeof body === 'string') {
    if (/not a bot|anubis/i.test(body)) return { kind: 'challenge' };
    try {
      data = JSON.parse(body);
    } catch {
      return { kind: 'unexpected', detail: `non-JSON response: ${body.slice(0, 80).replace(/\s+/g, ' ')}` };
    }
  }
  // v2 (current) answers with a bare array of items; the removed v1 wrapped them as { results: { content } }.
  const items = Array.isArray(data) ? data : (data as { results?: { content?: unknown } } | null)?.results?.content;
  if (!Array.isArray(items)) return { kind: 'unexpected', detail: 'response is neither an array of results nor { results: { content: [] } }' };
  const photos = items
    .map(item => macaulayItemToPhoto(item as MacaulayItem))
    .filter((p): p is MacaulayPhoto => p !== null);
  return { kind: 'photos', photos };
}

// ── Command-line arguments ─────────────────────────────────────────────────

export interface SeedArgs {
  /** eBird region codes whose species lists are seeded, e.g. CA-ON-OT. */
  regions: string[];
  /** Specific eBird species codes to seed, in addition to any region lists. */
  codes: string[];
  /** Observation window (days) used when listing a region's species. */
  back: 1 | 7 | 30;
  /** Stop after this many species (a run can be resumed later). */
  limit: number | null;
  /** Re-fetch species that already have Macaulay photos stored (results are merged, add-only). */
  refresh: boolean;
  /** Photos to keep per species. */
  count: number;
  /** List what would be fetched, without opening a browser or writing anything. */
  dryRun: boolean;
  /** Average pause between requests. */
  delayMs: number;
  /** Local backend used to list species. */
  backendUrl: string;
  /** Path to a Chrome/Edge executable. Defaults to the installed Chrome. */
  chromePath: string | null;
}

export const SEED_DEFAULTS = {
  back: 30 as const,
  count: 3,
  delayMs: 3000,
  backendUrl: 'http://localhost:3001',
};

export type ParsedSeedArgs = { ok: true; args: SeedArgs } | { ok: false; error: string };

export function parseSeedArgs(argv: string[]): ParsedSeedArgs {
  const args: SeedArgs = {
    regions: [], codes: [], back: SEED_DEFAULTS.back, limit: null, refresh: false,
    count: SEED_DEFAULTS.count, dryRun: false, delayMs: SEED_DEFAULTS.delayMs,
    backendUrl: SEED_DEFAULTS.backendUrl, chromePath: null,
  };
  const list = (v: string) => v.split(',').map(s => s.trim()).filter(Boolean);

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const takeValue = (): string | undefined => argv[++i];
    switch (flag) {
      case '--region':      { const v = takeValue(); if (!v) return { ok: false, error: '--region needs a value' }; args.regions.push(...list(v)); break; }
      case '--codes':       { const v = takeValue(); if (!v) return { ok: false, error: '--codes needs a value' }; args.codes.push(...list(v)); break; }
      case '--back':        { const v = Number(takeValue()); if (![1, 7, 30].includes(v)) return { ok: false, error: '--back must be 1, 7 or 30' }; args.back = v as 1 | 7 | 30; break; }
      case '--limit':       { const v = Number(takeValue()); if (!Number.isInteger(v) || v < 1) return { ok: false, error: '--limit must be a positive integer' }; args.limit = v; break; }
      case '--count':       { const v = Number(takeValue()); if (!Number.isInteger(v) || v < 1 || v > 10) return { ok: false, error: '--count must be between 1 and 10' }; args.count = v; break; }
      case '--delay-ms':    { const v = Number(takeValue()); if (!Number.isFinite(v) || v < 1000) return { ok: false, error: '--delay-ms must be at least 1000 (be polite)' }; args.delayMs = v; break; }
      case '--backend-url': { const v = takeValue(); if (!v) return { ok: false, error: '--backend-url needs a value' }; args.backendUrl = v.replace(/\/+$/, ''); break; }
      case '--chrome-path': { const v = takeValue(); if (!v) return { ok: false, error: '--chrome-path needs a value' }; args.chromePath = v; break; }
      case '--refresh':     args.refresh = true; break;
      case '--dry-run':     args.dryRun = true; break;
      default:              return { ok: false, error: `unknown option: ${flag}` };
    }
  }
  if (args.regions.length === 0 && args.codes.length === 0) {
    return { ok: false, error: 'give at least one of --region <code> or --codes <a,b,c>' };
  }
  return { ok: true, args };
}

// ── Choosing what to fetch ─────────────────────────────────────────────────

/**
 * De-duplicates candidates by species code, drops species that already have stored Macaulay photos
 * (unless `refresh`), and applies the limit. Order is preserved, so an interrupted run resumes where
 * it stopped.
 */
export function selectSeedTargets<T extends { speciesCode: string }>(
  candidates: T[],
  alreadySeeded: Set<string>,
  opts: { refresh: boolean; limit: number | null },
): T[] {
  const seen = new Set<string>();
  const targets: T[] = [];
  for (const c of candidates) {
    if (seen.has(c.speciesCode)) continue;
    seen.add(c.speciesCode);
    if (!opts.refresh && alreadySeeded.has(c.speciesCode)) continue;
    targets.push(c);
    if (opts.limit !== null && targets.length >= opts.limit) break;
  }
  return targets;
}

/** Average delay ±25% so requests are not evenly metronomic. `rand` is injectable for tests. */
export function jitteredDelayMs(baseMs: number, rand: () => number = Math.random): number {
  return Math.round(baseMs * (0.75 + rand() * 0.5));
}

/** Stop the run after this many consecutive failures instead of hammering a service that is refusing us. */
export const MAX_CONSECUTIVE_FAILURES = 5;
