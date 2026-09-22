import { cache } from '../cache';
import { getWikipediaPhotos, AttributedPhoto } from './wikipedia';
import { describeUpstreamFailure } from '../lib/upstreamError';
import { USER_AGENT } from '../lib/userAgent';
import { HostCoolingDownError, isAbortLike } from '../lib/hostGate';
import { assessAttempt, classifyPhotoResult, type SourceOutcome } from '../lib/photoOutcome';
import {
  PHOTO_SOURCES, buildPhotoSet, planSlotWrite, slotFreshness, sourcesAllKnown,
  type PhotoSource, type SlotOutcome, type SourceLookupState,
} from '../lib/photoSlots';
import { loadSlots, saveSlot, touchSlot } from './photoStore';
import { gatedGet, inatGate, macaulayGate } from './upstreamGates';
import { classifyMacaulayBody } from '../lib/macaulaySeed';

export type { AttributedPhoto };

const MACAULAY_SEARCH = 'https://search.macaulaylibrary.org/api/v2/search';
const INAT_TAXA_API = 'https://api.inaturalist.org/v1/taxa';
const HEADERS = { 'User-Agent': USER_AGENT };
const TIMEOUT_MS = 10_000;

// Option C timeout strategy: 2.5s initial window, 500ms trailing window after that
const INITIAL_MS = 2500;
const TRAILING_MS = 500;

/** How long to skip Macaulay after it answers with a bot-challenge page instead of JSON. */
const MACAULAY_BLOCK_COOLDOWN_MS = 60 * 60 * 1000;

export interface PhotoSet {
  primary: AttributedPhoto | null;
  optional: AttributedPhoto[];
}

/** A photo set plus whether it is empty only because the sources could not be asked. */
export interface PhotoSetResult extends PhotoSet {
  unavailable: boolean;
}

// Exclusions for quiz question photos - informational but don't help with visual ID.
const QUESTION_EXCLUDE = /egg|eggs|nest|habitat|clutch|chick|hatchling|juvenile|immature|skeleton|prey|mhnt/i;

function filenameFromUrl(url: string): string {
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop() ?? ''); }
  catch { return url; }
}

/** Macaulay's search API is behind an Anubis bot challenge that answers HTTP 200 with an HTML page. */
class MacaulayBlockedError extends Error {
  constructor() {
    super('Macaulay search is serving a bot-challenge page');
    this.name = 'MacaulayBlockedError';
  }
}

/** Fetches the top-rated photo from the Macaulay Library (eBird media archive). */
async function fetchMacaulayPhoto(speciesCode: string, signal?: AbortSignal): Promise<AttributedPhoto | null> {
  const t0 = Date.now();
  const res = await gatedGet(macaulayGate, MACAULAY_SEARCH, {
    params: { taxonCode: speciesCode, mediaType: 'photo', count: 1, sort: 'rating_rank_desc' },
    headers: HEADERS,
    timeout: TIMEOUT_MS,
    signal,
  });
  const body = classifyMacaulayBody(res.data);
  if (body.kind === 'challenge') {
    if (macaulayGate.coolDown(MACAULAY_BLOCK_COOLDOWN_MS)) {
      console.warn(`[macaulay] search API is serving a bot challenge - skipping Macaulay for ${MACAULAY_BLOCK_COOLDOWN_MS / 60_000} min`);
    }
    throw new MacaulayBlockedError();
  }
  if (body.kind === 'unexpected') throw new Error(`Macaulay search: ${body.detail}`);
  console.log(`[macaulay] ${speciesCode} → ${body.photos.length} results in ${Date.now() - t0}ms`);
  return body.photos[0] ?? null;
}

/**
 * Fetches the hand-picked representative photo from the iNaturalist taxa API.
 * Resolves to null when iNaturalist answered but has no usable photo for the species;
 * throws when the request itself failed (so callers can tell "no photo" from "couldn't ask").
 */
async function fetchInatPhoto(sciName: string, signal?: AbortSignal): Promise<AttributedPhoto | null> {
  const res = await gatedGet(inatGate, INAT_TAXA_API, {
    params: { q: sciName, is_active: true, per_page: 20 },
    headers: HEADERS,
    timeout: TIMEOUT_MS,
    signal,
  });
  // A bot-challenge / error page served with HTTP 200 arrives as a string rather than parsed JSON.
  if (typeof res.data !== 'object' || res.data === null) {
    throw new Error(`iNaturalist returned a non-JSON response (challenge page?): ${String(res.data).slice(0, 80).replace(/\s+/g, ' ')}`);
  }
  type InatTaxon = { name: string; default_photo?: { large_url?: string; medium_url?: string; attribution?: string } };
  const results: InatTaxon[] = res.data?.results ?? [];
  // The text search does prefix matching on individual words, not the full binomial, so tautonyms
  // and other false positives can rank above the correct taxon. Find the exact match explicitly.
  const result = results.find(r => r.name.toLowerCase() === sciName.toLowerCase());
  if (!result) {
    console.warn(`[inat] ${sciName}: no exact name match among ${results.length} results`);
    return null;
  }
  const photo = result.default_photo;
  if (!photo) {
    console.warn(`[inat] ${sciName}: taxon found but has no default photo`);
    return null;
  }
  const url = (photo.large_url ?? photo.medium_url ?? null) as string | null;
  if (!url) {
    console.warn(`[inat] ${sciName}: default photo has no usable URL`);
    return null;
  }
  // iNaturalist provides a pre-formatted attribution string e.g. "(c) Jane Smith, some rights reserved (CC BY-NC)"
  const raw: string = photo.attribution ?? '';
  const credit = raw
    ? raw.replace(/^\(c\)/i, '©').replace(/,?\s*some rights reserved/i, '').trim() + ' · iNaturalist'
    : 'iNaturalist';
  return { url, credit, source: 'inat' as const };
}

// A source that fails is never treated as "no photos": see lib/photoOutcome.ts. Macaulay is
// currently unreachable for us (Cornell's bot challenge), so it is excluded from the decision
// instead of counted as a failure; iNaturalist and Wikipedia are the sources that matter.
const MAX_PHOTO_ATTEMPTS = 3;
const PHOTO_RETRY_DELAY_MS = 2000;

/**
 * In-memory copy of a finished lookup, in front of the database. The database slots are the source
 * of truth (see lib/photoSlots.ts); this just spares a database read on every request.
 */
const HOT_TTL = 60 * 60 * 1000;
const HOT_RETRY_TTL = 5 * 60 * 1000;

interface TrackedSource<T> extends SourceOutcome {
  value?: T;
}

/**
 * Starts a source request and records how it ended on the returned object. An abort (the attempt's
 * time window closing) leaves the source 'pending'; `isBlocked` marks errors that mean "this source
 * is known to be unavailable" rather than "this request failed".
 */
function trackSource<T>(
  name: string,
  logLabel: string,
  logKey: string,
  t0: number,
  start: () => Promise<T>,
  isBlocked: (err: unknown) => boolean = () => false,
): { source: TrackedSource<T>; done: Promise<void> } {
  const source: TrackedSource<T> = { name, state: 'pending' };
  const done = start().then(
    value => { source.state = 'ok'; source.value = value; },
    err => {
      if (isAbortLike(err)) return;
      if (isBlocked(err)) { source.state = 'blocked'; return; }
      source.state = 'failed';
      source.reason = describeUpstreamFailure(err);
      source.rateLimited = err instanceof HostCoolingDownError
        || (err as { response?: { status?: number } })?.response?.status === 429;
      // Cooldown rejections are expected in bulk while a host is paused; the gate already logged the pause.
      if (!(err instanceof HostCoolingDownError)) {
        console.warn(`[${logLabel}] ${logKey}: request failed after ${Date.now() - t0}ms: ${source.reason}`);
      }
    },
  );
  return { source, done };
}

const asList = (p: AttributedPhoto | null): AttributedPhoto[] => (p ? [p] : []);

/**
 * Runs a single attempt against the requested sources with the Option-C timeout strategy.
 * Requests still queued or running when the window closes are aborted so an abandoned attempt
 * never leaves work behind for the next one.
 */
async function fetchSourcesOnce(
  speciesCode: string,
  sc: string,
  cn: string,
  names: PhotoSource[],
): Promise<Map<PhotoSource, TrackedSource<AttributedPhoto[]>>> {
  const t0 = Date.now();
  const controller = new AbortController();
  const started = new Map<PhotoSource, ReturnType<typeof trackSource<AttributedPhoto[]>>>();

  for (const name of names) {
    if (name === 'macaulay') {
      started.set(name, trackSource<AttributedPhoto[]>(
        'macaulay', 'macaulay', speciesCode, t0,
        async () => asList(await fetchMacaulayPhoto(speciesCode, controller.signal)),
        err => err instanceof MacaulayBlockedError
          || (err instanceof HostCoolingDownError && err.host === macaulayGate.host),
      ));
    } else if (name === 'inat') {
      started.set(name, trackSource<AttributedPhoto[]>(
        'inat', 'inat', sc, t0,
        async () => asList(await fetchInatPhoto(sc, controller.signal)),
      ));
    } else {
      started.set(name, trackSource<AttributedPhoto[]>(
        'wiki', 'wiki-photos', sc, t0,
        () => getWikipediaPhotos(sc, cn, controller.signal),
      ));
    }
  }

  const allDone = Promise.all([...started.values()].map(s => s.done));
  const sources = [...started.values()].map(s => s.source);
  const anyPending = () => sources.some(s => s.state === 'pending');

  // Phase 1: give the services INITIAL_MS, or stop early if all settle first
  await Promise.race([allDone, new Promise<void>(resolve => setTimeout(resolve, INITIAL_MS))]);

  // Phase 2: if any service is still pending, give it a trailing window to catch up.
  // (Checking "all settled" rather than "any settled" matters: without it, a fast source
  // finishing within INITIAL_MS would short-circuit this wait and a slightly slower
  // sibling's photos would be silently dropped instead of just delayed.)
  if (anyPending()) {
    await Promise.race([allDone, new Promise<void>(resolve => setTimeout(resolve, TRAILING_MS))]);
  }

  // Whatever is still queued or in flight is abandoned by this attempt.
  controller.abort();

  if (anyPending()) {
    const pending = sources.filter(s => s.state === 'pending').map(s => s.name).join(', ');
    console.warn(`[photos] ${speciesCode} (${sc}): still pending after ${Date.now() - t0}ms: ${pending}`);
  }

  return new Map([...started].map(([name, s]) => [name, s.source]));
}

interface PhotoLookup {
  photoSet: PhotoSet;
  /** Every source that could be asked answered, and none had a photo. Awards a free mastery, so be sure. */
  noPhoto: boolean;
  /** No photos, but at least one source could not be asked: we cannot tell whether photos exist. */
  unavailable: boolean;
}

const inflight = new Map<string, Promise<PhotoLookup>>();

/**
 * Returns the photo set for a species, built from per-source slots persisted in the database
 * (lib/photoSlots.ts). Only sources whose slot is missing or stale are fetched; a source that
 * fails keeps serving what we already stored. Concurrent lookups of one species share one run.
 *
 * What the result means:
 *  - photos           → served; cached in memory 1 hour (5 minutes if a source could not be checked)
 *  - none, all known  → `noPhoto`, a genuine absence; cached in memory 1 hour
 *  - none, some unknown → `unavailable`: NOT `noPhoto` and not cached, because `noPhoto` awards a
 *    free mastery and "couldn't ask" is not "no photos exist"
 */
function loadPhotoSet(speciesCode: string, comName?: string, sciName?: string): Promise<PhotoLookup> {
  const cached = cache.get<PhotoLookup>(`photoset7:${speciesCode}`);
  if (cached !== undefined) return Promise.resolve(cached);
  const running = inflight.get(speciesCode);
  if (running) return running;
  const lookup = lookupPhotoSet(speciesCode, comName, sciName).finally(() => inflight.delete(speciesCode));
  inflight.set(speciesCode, lookup);
  return lookup;
}

async function lookupPhotoSet(speciesCode: string, comName?: string, sciName?: string): Promise<PhotoLookup> {
  const sc = sciName ?? comName ?? '';
  const cn = comName ?? sc;
  const now = Date.now();

  const slots = await loadSlots(speciesCode);
  const hadSlot = new Set(slots.keys());
  const outcomes = new Map<PhotoSource, TrackedSource<AttributedPhoto[]>>();
  const hasAnyPhotos = () => PHOTO_SOURCES.some(
    n => (slots.get(n)?.photos.length ?? 0) > 0 || (outcomes.get(n)?.value?.length ?? 0) > 0,
  );

  // Only ask sources whose stored slot is missing or stale; retry just the ones that did not resolve.
  let toFetch = PHOTO_SOURCES.filter(n => slotFreshness(slots.get(n), now) !== 'fresh');
  let attempt = 0;
  while (toFetch.length > 0) {
    attempt++;
    for (const [name, source] of await fetchSourcesOnce(speciesCode, sc, cn, toFetch)) outcomes.set(name, source);
    toFetch = toFetch.filter(n => { const s = outcomes.get(n)?.state; return s === 'failed' || s === 'pending'; });
    if (toFetch.length === 0) break;
    // Retrying is only worth it while we have nothing to show and the problem might clear up.
    if (hasAnyPhotos() || !assessAttempt([...outcomes.values()]).retryable || attempt >= MAX_PHOTO_ATTEMPTS) break;
    await new Promise<void>(resolve => setTimeout(resolve, PHOTO_RETRY_DELAY_MS));
  }

  // Merge what we learned into each slot (add-only) and persist it in the background.
  const finalPhotos: Record<PhotoSource, AttributedPhoto[]> = { inat: [], wiki: [], macaulay: [] };
  const lookupStates: Array<{ hasSlot: boolean; state: SourceLookupState }> = [];
  for (const name of PHOTO_SOURCES) {
    const existing = slots.get(name);
    const outcome = outcomes.get(name);
    finalPhotos[name] = existing?.photos ?? [];
    if (!outcome) { lookupStates.push({ hasSlot: hadSlot.has(name), state: 'skipped' }); continue; }

    const slotOutcome: SlotOutcome = outcome.state === 'ok' ? 'ok' : outcome.state === 'blocked' ? 'blocked' : 'unknown';
    lookupStates.push({ hasSlot: hadSlot.has(name), state: slotOutcome });
    const plan = planSlotWrite(existing, slotOutcome, outcome.value ?? []);
    if (plan.action === 'save') {
      finalPhotos[name] = plan.photos;
      void saveSlot(speciesCode, name, sc, plan.photos);
    } else if (plan.action === 'touch') {
      void touchSlot(speciesCode, name);
    }
  }

  const photoSet = buildPhotoSet(finalPhotos);
  const hasPhotos = photoSet.primary !== null || photoSet.optional.length > 0;
  const complete = sourcesAllKnown(lookupStates);
  const hotKey = `photoset7:${speciesCode}`;

  switch (classifyPhotoResult(hasPhotos, complete)) {
    case 'photos': {
      const result: PhotoLookup = { photoSet, noPhoto: false, unavailable: false };
      cache.set(hotKey, result, complete ? HOT_TTL : HOT_RETRY_TTL);
      return result;
    }
    case 'confirmed-empty': {
      console.warn(`[photos] ${speciesCode} (${sc}): no photos - every source answered and none had one`);
      const result: PhotoLookup = { photoSet, noPhoto: true, unavailable: false };
      cache.set(hotKey, result, HOT_TTL);
      return result;
    }
    default: {
      const problems = assessAttempt([...outcomes.values()]).problems.join('; ');
      console.warn(`[photos] ${speciesCode} (${sc}): unavailable after ${attempt} attempt(s) - ${problems}`);
      return { photoSet, noPhoto: false, unavailable: true };
    }
  }
}

/** Returns all photos for the reveal/info carousel - unfiltered (eggs, nests etc. are informational). */
export async function getSpeciesPhotoUrls(
  speciesCode: string,
  comName?: string,
  sciName?: string,
): Promise<PhotoSetResult> {
  const { photoSet, unavailable } = await loadPhotoSet(speciesCode, comName, sciName);
  return { ...photoSet, unavailable };
}

/** Returns appearance-only photos for question display - eggs, nests, chicks etc. filtered out. */
export async function getSpeciesPhotoUrlsForQuestion(
  speciesCode: string,
  comName?: string,
  sciName?: string,
): Promise<PhotoSetResult> {
  const { photoSet: { primary, optional }, unavailable } = await loadPhotoSet(speciesCode, comName, sciName);
  const allPhotos = [primary, ...optional].filter((p): p is AttributedPhoto => !!p);
  const suitable = allPhotos.filter(p => !QUESTION_EXCLUDE.test(filenameFromUrl(p.url)));
  return { primary: suitable[0] ?? null, optional: suitable.slice(1), unavailable };
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
    !QUESTION_EXCLUDE.test(filenameFromUrl(p.url)) &&
    !blockedUrls.has(p.url) &&
    !(p.imageKey && blockedUrls.has(p.imageKey)),
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
