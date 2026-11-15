import { getSupabaseAdmin } from '../lib/supabase';
import { guessKey, ID_TIP_MODEL, type IdTipRequest } from '../lib/idTip';

/**
 * Persistence for ID tips (`id_tips` table). Player-facing reads and AI saves are failure-tolerant
 * like photoStore: a database problem is logged and the caller carries on. Curator operations
 * (loadTipRecord, saveCuratedTip) throw, so the curation panel can show the error.
 */

const TABLE = 'id_tips';

export interface TipKey { speciesCode: string; guess: string; photoUrl: string }

export interface TipRecord {
  tip: string;
  model: string;
  createdAt: string;
  editedAt: string | null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

let adminClient: ReturnType<typeof getSupabaseAdmin> | null | undefined;
function client() {
  if (adminClient === undefined) {
    try { adminClient = getSupabaseAdmin(); }
    catch (err) {
      adminClient = null;
      console.warn(`[id-tip-store] disabled (${errorMessage(err)}) - tips will not be persisted`);
    }
  }
  return adminClient;
}

function requireClient() {
  const db = client();
  if (!db) throw new Error('Tip store is unavailable');
  return db;
}

async function selectRecord(k: TipKey): Promise<TipRecord | null> {
  const { data, error } = await requireClient().from(TABLE).select('tip, model, created_at, edited_at')
    .eq('species_code', k.speciesCode).eq('guess_key', guessKey(k.guess)).eq('photo_url', k.photoUrl)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as { tip: string; model: string; created_at: string; edited_at: string | null } | null;
  return row ? { tip: row.tip, model: row.model, createdAt: row.created_at, editedAt: row.edited_at } : null;
}

/** The tip players are served, or null (also on a database problem). */
export async function loadStoredTip(k: TipKey): Promise<string | null> {
  if (!client()) return null;
  try {
    return (await selectRecord(k))?.tip ?? null;
  } catch (err) {
    console.warn(`[id-tip-store] read failed for ${k.speciesCode}: ${errorMessage(err)}`);
    return null;
  }
}

/** Curator: the full stored record, or null when no tip is stored. Throws on a database problem. */
export function loadTipRecord(k: TipKey): Promise<TipRecord | null> {
  return selectRecord(k);
}

function row(r: IdTipRequest, tip: string, model: string, editedBy: string | null) {
  const now = new Date().toISOString();
  return {
    species_code: r.speciesCode, guess_key: guessKey(r.guess), photo_url: r.photoUrl,
    com_name: r.comName, sci_name: r.sciName, guess: r.guess, tip, model,
    created_at: now, edited_by: editedBy, edited_at: editedBy ? now : null,
  };
}

/** Saves a freshly generated AI tip. Failure-tolerant. */
export async function saveStoredTip(r: IdTipRequest, tip: string): Promise<void> {
  const db = client();
  if (!db) return;
  try {
    const { error } = await db.from(TABLE).upsert(row(r, tip, ID_TIP_MODEL, null), { onConflict: 'species_code,guess_key,photo_url' });
    if (error) throw new Error(error.message);
  } catch (err) {
    console.warn(`[id-tip-store] write failed for ${r.speciesCode}: ${errorMessage(err)}`);
  }
}

/**
 * Curator: saves edited (or regenerated-then-reviewed) text as the tip players see. Keeps the
 * original created_at and model when a row exists. Throws on failure.
 */
export async function saveCuratedTip(r: IdTipRequest, tip: string, editedBy: string): Promise<TipRecord> {
  const db = requireClient();
  const existing = await selectRecord(r);
  const values = row(r, tip, existing?.model ?? ID_TIP_MODEL, editedBy);
  if (existing) values.created_at = existing.createdAt;
  const { error } = await db.from(TABLE).upsert(values, { onConflict: 'species_code,guess_key,photo_url' });
  if (error) throw new Error(error.message);
  return { tip, model: values.model, createdAt: values.created_at, editedAt: values.edited_at };
}

export interface TipListRow {
  species_code: string; guess_key: string; photo_url: string; com_name: string; sci_name: string;
  guess: string; tip: string; model: string; created_at: string; edited_at: string | null;
}

const PAGE = 1000;

/** Curator: every stored tip (paged through PostgREST's 1000-row limit). Throws on failure. */
export async function listAllTips(): Promise<TipListRow[]> {
  const db = requireClient();
  const rows: TipListRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(TABLE)
      .select('species_code, guess_key, photo_url, com_name, sci_name, guess, tip, model, created_at, edited_at')
      .order('species_code').order('guess_key').order('photo_url')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as TipListRow[]));
    if (!data || data.length < PAGE) return rows;
  }
}

/** Curator: the tip key of every report, any status (for per-tip report counts). Throws on failure. */
export async function listReportKeys(): Promise<Array<{ species_code: string; guess_key: string; photo_url: string }>> {
  const db = requireClient();
  const rows: Array<{ species_code: string; guess_key: string; photo_url: string }> = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from('id_tip_reports')
      .select('species_code, guess_key, photo_url').order('id').range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < PAGE) return rows;
  }
}
