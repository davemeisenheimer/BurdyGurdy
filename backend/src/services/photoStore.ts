import { getSupabaseAdmin } from '../lib/supabase';
import { rowsToSlots, type PhotoSource, type StoredRow, type StoredSlot } from '../lib/photoSlots';
import type { AttributedPhoto } from './wikipedia';

/**
 * Persistence for per-source photo slots (`species_photos` table, one row per species per source).
 * Every method is failure-tolerant: a Supabase problem is logged and the photo lookup carries on
 * from live data, so this store can never be the reason a photo request fails.
 */

const TABLE = 'species_photos';
/** Rows loaded in bulk (or written) are remembered briefly so a burst of lookups hits the database once. */
const SLOT_CACHE_TTL_MS = 60_000;
const WARM_CHUNK = 200;

type Slots = Map<PhotoSource, StoredSlot<AttributedPhoto>>;

const slotCache = new Map<string, { slots: Slots; expiresAt: number }>();

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

let adminClient: ReturnType<typeof getSupabaseAdmin> | null | undefined;
function client() {
  if (adminClient === undefined) {
    try {
      adminClient = getSupabaseAdmin();
    } catch (err) {
      adminClient = null;
      console.warn(`[photo-store] disabled (${errorMessage(err)}) - photos will not be persisted`);
    }
  }
  return adminClient;
}

function cached(speciesCode: string): Slots | undefined {
  const hit = slotCache.get(speciesCode);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) { slotCache.delete(speciesCode); return undefined; }
  return hit.slots;
}

function remember(speciesCode: string, slots: Slots): void {
  slotCache.set(speciesCode, { slots, expiresAt: Date.now() + SLOT_CACHE_TTL_MS });
}

/** Loads all stored slots for one species. Resolves to an empty map if the store is unavailable. */
export async function loadSlots(speciesCode: string): Promise<Slots> {
  const hit = cached(speciesCode);
  if (hit) return hit;
  const db = client();
  if (!db) return new Map();
  try {
    const { data, error } = await db.from(TABLE).select('source, photos, checked_at').eq('species_code', speciesCode);
    if (error) throw new Error(error.message);
    const slots = rowsToSlots<AttributedPhoto>((data ?? []) as StoredRow[]);
    remember(speciesCode, slots);
    return slots;
  } catch (err) {
    console.warn(`[photo-store] read failed for ${speciesCode}: ${errorMessage(err)}`);
    return new Map();
  }
}

/**
 * Loads the slots for many species in as few queries as possible, so the lookups that follow are
 * served from memory. Species with no stored rows are remembered as empty.
 */
export async function warmSlots(speciesCodes: string[]): Promise<void> {
  const db = client();
  if (!db) return;
  const missing = [...new Set(speciesCodes)].filter(code => !cached(code));
  try {
    for (let i = 0; i < missing.length; i += WARM_CHUNK) {
      const chunk = missing.slice(i, i + WARM_CHUNK);
      const { data, error } = await db.from(TABLE).select('species_code, source, photos, checked_at').in('species_code', chunk);
      if (error) throw new Error(error.message);
      const bySpecies = new Map<string, StoredRow[]>(chunk.map(code => [code, []]));
      for (const row of (data ?? []) as Array<StoredRow & { species_code: string }>) {
        bySpecies.get(row.species_code)?.push(row);
      }
      for (const [code, rows] of bySpecies) remember(code, rowsToSlots<AttributedPhoto>(rows));
    }
  } catch (err) {
    console.warn(`[photo-store] bulk read failed: ${errorMessage(err)}`);
  }
}

/** Inserts or replaces a slot, resetting its checked_at. Resolves to whether the write succeeded. */
export async function saveSlot(
  speciesCode: string,
  source: PhotoSource,
  sciName: string,
  photos: AttributedPhoto[],
): Promise<boolean> {
  const now = Date.now();
  cached(speciesCode)?.set(source, { photos, checkedAt: now });
  const db = client();
  if (!db) return false;
  try {
    const { error } = await db.from(TABLE).upsert(
      { species_code: speciesCode, source, sci_name: sciName, photos, checked_at: new Date(now).toISOString() },
      { onConflict: 'species_code,source' },
    );
    if (error) throw new Error(error.message);
    return true;
  } catch (err) {
    console.warn(`[photo-store] write failed for ${speciesCode}/${source}: ${errorMessage(err)}`);
    return false;
  }
}

/** Resets a slot's checked_at without touching its photos. */
export async function touchSlot(speciesCode: string, source: PhotoSource): Promise<void> {
  const now = Date.now();
  const slot = cached(speciesCode)?.get(source);
  if (slot) slot.checkedAt = now;
  const db = client();
  if (!db) return;
  try {
    const { error } = await db
      .from(TABLE)
      .update({ checked_at: new Date(now).toISOString() })
      .eq('species_code', speciesCode)
      .eq('source', source);
    if (error) throw new Error(error.message);
  } catch (err) {
    console.warn(`[photo-store] touch failed for ${speciesCode}/${source}: ${errorMessage(err)}`);
  }
}
