/**
 * Pure rules for the per-source photo "slots" persisted in the `species_photos` table.
 * Each species has up to one slot per source (iNaturalist, Wikipedia, Macaulay).
 *
 *  - Slots are add-only: a refresh merges newly found photos in and never removes any.
 *  - A slot holding photos keeps being served indefinitely. When it goes stale, a refresh is tried;
 *    if that refresh fails, the photos are kept and the slot's expiry is simply reset.
 *  - A failed lookup on a source we have never successfully asked writes nothing, so it is retried.
 *  - An empty slot means "asked successfully, nothing there" and is re-checked sooner than a full one.
 *
 * No I/O here: see services/photoStore.ts for persistence.
 */

export type PhotoSource = 'inat' | 'wiki' | 'macaulay';
export const PHOTO_SOURCES: readonly PhotoSource[] = ['macaulay', 'inat', 'wiki'];

/** The minimum a photo needs for slot bookkeeping. Callers keep their richer photo type. */
export interface SlotPhoto {
  url: string;
  imageKey?: string;
}

export interface StoredSlot<P extends SlotPhoto = SlotPhoto> {
  photos: P[];
  /** Epoch ms of the last time this slot was confirmed (successful refresh, or refresh failed but photos kept). */
  checkedAt: number;
}

export const SLOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;       // slot with photos
export const EMPTY_SLOT_TTL_MS = 24 * 60 * 60 * 1000;     // slot confirmed empty

export type SlotFreshness = 'missing' | 'fresh' | 'stale';

export function slotFreshness(slot: StoredSlot | undefined, now: number): SlotFreshness {
  if (!slot) return 'missing';
  const ttl = slot.photos.length > 0 ? SLOT_TTL_MS : EMPTY_SLOT_TTL_MS;
  return now - slot.checkedAt < ttl ? 'fresh' : 'stale';
}

function photoKey(p: SlotPhoto): string {
  return p.imageKey ?? p.url;
}

/**
 * Add-only union of two photo lists, keyed by imageKey (falling back to url). Existing photos keep
 * their position and win over incoming duplicates; genuinely new photos are appended.
 */
export function mergePhotos<P extends SlotPhoto>(existing: P[], incoming: P[]): P[] {
  const seen = new Set(existing.map(photoKey));
  const merged = [...existing];
  for (const p of incoming) {
    const key = photoKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(p);
  }
  return merged;
}

/**
 * - ok:      the source answered (with photos or with none)
 * - unknown: the request failed or timed out, so we learned nothing
 * - blocked: the source is known to be unavailable (e.g. Macaulay's bot challenge)
 */
export type SlotOutcome = 'ok' | 'unknown' | 'blocked';

export type SlotWrite<P extends SlotPhoto> =
  | { action: 'save'; photos: P[] }   // write photos and reset checked_at
  | { action: 'touch' }               // only reset checked_at; photos already stored are kept
  | { action: 'none' };

export function planSlotWrite<P extends SlotPhoto>(
  existing: StoredSlot<P> | undefined,
  outcome: SlotOutcome,
  incoming: P[] = [],
): SlotWrite<P> {
  const existingPhotos = existing?.photos ?? [];
  if (outcome === 'ok') {
    const merged = mergePhotos(existingPhotos, incoming);
    // Nothing new to store: just confirm the slot is still good (and keep it, even if empty).
    if (existing && merged.length === existingPhotos.length) return { action: 'touch' };
    return { action: 'save', photos: merged };
  }
  if (outcome === 'unknown' && existingPhotos.length > 0) return { action: 'touch' };
  return { action: 'none' };
}

export type SourceLookupState = 'ok' | 'unknown' | 'blocked' | 'skipped';

/**
 * True when nothing is unknown: every source either has a stored slot, answered this time, or is
 * known-unavailable. Used to tell a genuine "no photos anywhere" from "couldn't ask".
 */
export function sourcesAllKnown(sources: Array<{ hasSlot: boolean; state: SourceLookupState }>): boolean {
  return sources.every(s => s.hasSlot || s.state === 'ok' || s.state === 'blocked' || s.state === 'skipped');
}

/**
 * Assembles the served photo set from each source's photos: iNaturalist supplies the primary,
 * everything else (Macaulay, Wikipedia, extra iNaturalist photos) is optional.
 */
export function buildPhotoSet<P extends SlotPhoto>(
  bySource: Record<PhotoSource, P[]>,
): { primary: P | null; optional: P[] } {
  const [primary = null, ...inatExtras] = bySource.inat;
  return { primary, optional: [...bySource.macaulay, ...bySource.wiki, ...inatExtras] };
}

export interface StoredRow {
  source: string;
  photos: unknown;
  checked_at: string;
}

/** Converts raw `species_photos` rows into slots, ignoring rows with an unknown source or bad data. */
export function rowsToSlots<P extends SlotPhoto>(rows: StoredRow[]): Map<PhotoSource, StoredSlot<P>> {
  const slots = new Map<PhotoSource, StoredSlot<P>>();
  for (const row of rows) {
    if (!(PHOTO_SOURCES as readonly string[]).includes(row.source)) continue;
    const checkedAt = Date.parse(row.checked_at);
    if (Number.isNaN(checkedAt) || !Array.isArray(row.photos)) continue;
    const photos = (row.photos as unknown[]).filter(
      (p): p is P => !!p && typeof p === 'object' && typeof (p as { url?: unknown }).url === 'string',
    );
    slots.set(row.source as PhotoSource, { photos, checkedAt });
  }
  return slots;
}
