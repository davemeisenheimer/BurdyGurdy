/**
 * Cloud sync - uploads local IndexedDB progress to Supabase, and replaces
 * local progress with the cloud copy when another device has uploaded more
 * recently (see downloadAndReplace).
 */
import { supabase } from '../../lib/supabase';
import { api } from './api';
import { db } from '../../lib/db';
import { STRUGGLING_WINDOW } from '../../lib/struggling';
import type { BirdProgress, FieldId } from '../../types';
import type { FieldIdChange } from '../local/fieldIds';
import { loadQuizPrefs, saveQuizPrefs } from '../../lib/settings';
import type { AppSettings, QuizConfigPrefs } from '../../lib/settings';
import type { VictoryLogEntry } from '../../lib/victory';
import { selectChanged, fingerprintAll, withoutKeys, type Fingerprints } from '../../lib/uploadFingerprints';

// ── Upload ────────────────────────────────────────────────────────────────────

// ── Per-user localStorage sync state ─────────────────────────────────────────

const syncedAtKey  = (uid: string) => `birdygurdy_synced_at_${uid}`;
const needsUpKey   = (uid: string) => `birdygurdy_needs_upload_${uid}`;

/** Timestamp (ms) of the last time this device either uploaded or confirmed it
 *  matched the cloud. Persisted per user so it survives page reloads. */
export function getLocalSyncedAt(userId: string): number | null {
  const v = localStorage.getItem(syncedAtKey(userId));
  return v ? Number(v) : null;
}
function setLocalSyncedAt(userId: string, ts: number): void {
  localStorage.setItem(syncedAtKey(userId), String(ts));
}

/** True when the last upload attempt failed and a retry is pending. */
export function getNeedsUpload(userId: string): boolean {
  return localStorage.getItem(needsUpKey(userId)) === '1';
}
function setNeedsUpload(userId: string, val: boolean): void {
  if (val) localStorage.setItem(needsUpKey(userId), '1');
  else     localStorage.removeItem(needsUpKey(userId));
}

// ── Upload change detection ──────────────────────────────────────────────────
// Fingerprints of rows as last uploaded/downloaded, stored in the per-user local DB. Uploads send
// only rows whose fingerprint changed; downloads and cloud deletions keep the fingerprints honest.

const PROGRESS_FP_KEY = 'uploadFingerprints:progress';
const FIELD_ID_FP_KEY = 'uploadFingerprints:fieldIds';

async function loadFingerprints(key: string): Promise<Fingerprints> {
  try {
    const row = await db.keyValue.get(key);
    return row ? (JSON.parse(row.value) as Fingerprints) : {};
  } catch {
    return {}; // unreadable → everything counts as changed, i.e. the old full upload
  }
}

async function saveFingerprints(key: string, fingerprints: Fingerprints): Promise<void> {
  await db.keyValue.put({ key, value: JSON.stringify(fingerprints) }).catch(() => {});
}

async function forgetFingerprints(key: string, keys: string[]): Promise<void> {
  if (keys.length > 0) await saveFingerprints(key, withoutKeys(await loadFingerprints(key), keys));
}

type ProgressRow = ReturnType<typeof progressToRow>;
const progressRowKey = (r: ProgressRow) => `${r.species_code}|${r.question_type}`;
const fieldIdKey = (f: Pick<FieldId, 'speciesCode' | 'questionType'>) => `${f.speciesCode}|${f.questionType}`;

/** Pure - the cloud row for a local progress record. */
function progressToRow(userId: string, r: BirdProgress) {
  return {
    user_id:             userId,
    species_code:        r.speciesCode,
    question_type:       r.questionType,
    com_name:            r.comName,
    correct:             r.correct,
    incorrect:           r.incorrect,
    last_asked:          r.lastAsked,
    weight:              r.weight,
    favourited:          r.favourited  ?? false,
    excluded:            r.excluded    ?? false,
    mastery_level:       r.masteryLevel       ?? 0,
    consecutive_correct: r.consecutiveCorrect ?? 0,
    in_history:          r.isMastered  ?? false,
    recent_answers:      r.recentAnswers      ?? null,
  };
}

/**
 * Upserts changed local progress records (and field-ID ticks) to the cloud for the given user.
 * Rows unchanged since the last successful upload or download are skipped.
 * Skips seeded-but-never-played records (lastAsked === 0) - these are
 * palette placeholders and uploading them would corrupt cloud progress
 * from other devices.
 *
 * On success: stamps last_upload_at in the cloud AND updates localSyncedAt /
 * needsUpload in localStorage so they are always kept in sync with the upload.
 * These localStorage helpers are intentionally private to this module - all
 * callers go through this function so the coupling can never be broken.
 *
 * Returns true on success, false on failure.
 */
export async function uploadProgress(userId: string): Promise<boolean> {
  const records = (await db.progress.toArray()).filter(r => r.lastAsked > 0);

  // Only rows that changed since the last successful upload are sent (see lib/uploadFingerprints).
  const rows = records.map(r => progressToRow(userId, r));
  const progress = selectChanged(rows, progressRowKey, await loadFingerprints(PROGRESS_FP_KEY));
  if (progress.changed.length > 0) {
    const { error } = await supabase
      .from('bird_progress')
      .upsert(progress.changed, { onConflict: 'user_id,species_code,question_type' });

    if (error) {
      console.warn('sync: upload failed:', error.message);
      setNeedsUpload(userId, true);
      return false;
    }
  }
  await saveFingerprints(PROGRESS_FP_KEY, progress.next);

  // Field-ID ticks ride along with every progress upload, so a tick whose immediate upload
  // failed (e.g. offline) still reaches the cloud. Un-tick deletions are pushed at un-tick time.
  const fieldIds = selectChanged(await db.fieldIds.toArray(), fieldIdKey, await loadFingerprints(FIELD_ID_FP_KEY));
  if (fieldIds.changed.length > 0 && !(await upsertFieldIds(userId, fieldIds.changed))) {
    setNeedsUpload(userId, true);
    return false;
  }
  await saveFingerprints(FIELD_ID_FP_KEY, fieldIds.next);

  // Stamp last_upload_at so other devices detect this upload on reactivation.
  // Uses UPDATE (not upsert) to avoid creating a partial row; uploadSettings
  // creates the full row on first sign-in.
  const ts = Date.now();
  const { error: tsErr } = await supabase
    .from('user_settings')
    .update({ last_upload_at: new Date(ts).toISOString(), updated_at: new Date(ts).toISOString() })
    .eq('user_id', userId);
  if (tsErr) console.warn('sync: last_upload_at stamp failed:', tsErr.message);
  // tsErr is non-fatal: no row yet means the user_settings row doesn't exist - uploadSettings will create it.

  // Always use the same timestamp we wrote to the cloud, not Date.now() called later.
  setLocalSyncedAt(userId, ts);
  setNeedsUpload(userId, false);
  return true;
}

// ── Smart sync helpers ────────────────────────────────────────────────────────

/** Returns the timestamp (ms) of the most recent upload stored in the cloud,
 *  or null if unreachable / no row exists yet. */
export async function getCloudUploadTime(userId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('last_upload_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data?.last_upload_at) return null;
  return new Date(data.last_upload_at as string).getTime();
}

/**
 * Downloads all cloud records for the user and REPLACES local IndexedDB with
 * them - adding/updating records that exist in the cloud and deleting local
 * records that the cloud no longer has.  Local-only fields (masteredAt,
 * noAudio) are preserved where the record still exists in both.
 *
 * cloudTs: the last_upload_at timestamp already fetched from the cloud (passed
 * in to avoid a second round-trip). On success, localSyncedAt is stamped with
 * this value so the caller never needs to touch localStorage directly.
 *
 * Returns the number of cloud records (> 0), 0 if cloud has no records
 * (safe no-op - local is untouched), or -1 on network error.
 */
export async function downloadAndReplace(userId: string, cloudTs: number | null): Promise<number> {
  const { data, error } = await supabase
    .from('bird_progress')
    .select('*')
    .eq('user_id', userId);

  if (error || !data) {
    console.warn('sync: downloadAndReplace failed:', error?.message);
    return -1;
  }

  // Field-ID ticks are replaced alongside progress. A user can have ticks without any quiz
  // progress, so they're handled before the no-progress early return below. As with progress,
  // an entirely empty cloud never wipes local ticks.
  const [{ data: fieldIdRows, error: fieldIdError }, { data: detailRows, error: detailError }] = await Promise.all([
    supabase.from('user_field_ids').select('*').eq('user_id', userId),
    supabase.from('user_field_id_details').select('*').eq('user_id', userId),
  ]);
  if (fieldIdError || !fieldIdRows || detailError || !detailRows) {
    console.warn('sync: field ID download failed:', (fieldIdError ?? detailError)?.message);
  } else if (data.length > 0 || fieldIdRows.length > 0) {
    const cloudFieldIds = mergeFieldIdRows(fieldIdRows, detailRows);
    await db.fieldIds.clear();
    await db.fieldIds.bulkPut(cloudFieldIds);
    await saveFingerprints(FIELD_ID_FP_KEY, fingerprintAll(cloudFieldIds, fieldIdKey));
  } else {
    // Cloud has no ticks at all: whatever is local must be uploaded in full next time.
    await saveFingerprints(FIELD_ID_FP_KEY, {});
  }

  if (data.length === 0) {
    // No cloud records - don't wipe local, and make sure the next upload sends everything.
    await saveFingerprints(PROGRESS_FP_KEY, {});
    return 0;
  }

  const local = await db.progress.toArray();
  const localByKey = new Map(local.map(r => [`${r.speciesCode}|${r.questionType}`, r]));
  const cloudKeys  = new Set(data.map(r => `${r.species_code}|${r.question_type}`));

  // Delete local records that are absent from the cloud (trimmed on another device)
  const toDelete = local
    .filter(r => !cloudKeys.has(`${r.speciesCode}|${r.questionType}`))
    .map(r => [r.speciesCode, r.questionType] as [string, string]);
  if (toDelete.length > 0) {
    await db.progress
      .where('[speciesCode+questionType]')
      .anyOf(toDelete)
      .delete();
  }

  // Upsert all cloud records, preserving local-only fields where they exist
  const records: BirdProgress[] = data.map(remote => {
    const existing = localByKey.get(`${remote.species_code}|${remote.question_type}`);
    const record: BirdProgress = {
      speciesCode:        remote.species_code,
      questionType:       remote.question_type,
      comName:            remote.com_name,
      correct:            remote.correct,
      incorrect:          remote.incorrect,
      lastAsked:          remote.last_asked,
      weight:             remote.weight,
      favourited:         remote.favourited,
      excluded:           remote.excluded,
      masteryLevel:       remote.mastery_level,
      consecutiveCorrect: remote.consecutive_correct,
      isMastered:         remote.in_history,
      recentAnswers:      remote.recent_answers ?? existing?.recentAnswers ?? null,
      masteredAt:         existing?.masteredAt,
      noAudio:            existing?.noAudio,
      familyComName:      existing?.familyComName,
      familySciName:      existing?.familySciName,
      order:              existing?.order,
      orderComName:       existing?.orderComName,
    };
    if (record.isMastered && !record.recentAnswers) {
      const total = record.correct + record.incorrect;
      const accuracy = total > 0 ? record.correct / total : 1;
      const correctCount = Math.round(accuracy * STRUGGLING_WINDOW);
      record.recentAnswers = [
        ...Array(STRUGGLING_WINDOW - correctCount).fill(false),
        ...Array(correctCount).fill(true),
      ];
    }
    return record;
  });

  await db.progress.bulkPut(records);
  // Local now mirrors the cloud, so nothing needs uploading until something changes. Records whose
  // recentAnswers were synthesised above aren't in the cloud in that form, so they're left out and
  // get uploaded once.
  const cloudLacksAnswers = new Set(
    data.filter(remote => remote.recent_answers == null).map(remote => `${remote.species_code}|${remote.question_type}`),
  );
  await saveFingerprints(
    PROGRESS_FP_KEY,
    fingerprintAll(
      records.filter(r => r.lastAsked > 0).map(r => progressToRow(userId, r)).filter(row => !cloudLacksAnswers.has(progressRowKey(row))),
      progressRowKey,
    ),
  );

  // Filter selectedSpeciesCodes to only codes still present after sync.
  const downloadedCodes = new Set(records.map(r => r.speciesCode));
  const prefs = await loadQuizPrefs();
  if ((prefs.selectedSpeciesCodes ?? []).length > 0) {
    const filteredCodes = (prefs.selectedSpeciesCodes ?? []).filter(c => downloadedCodes.has(c));
    const updated = { ...prefs, selectedSpeciesCodes: filteredCodes };
    if (filteredCodes.length === 0 && (updated.selectedFamilies ?? []).length === 0 && (updated.selectedOrders ?? []).length === 0) {
      updated.selectionMode = 'all';
    }
    await saveQuizPrefs(updated);
  }

  // Stamp local sync state so callers never need to touch localStorage.
  if (cloudTs !== null) setLocalSyncedAt(userId, cloudTs);
  setNeedsUpload(userId, false);

  return data.length;
}

// ── Settings ──────────────────────────────────────────────────────────────────

export async function uploadSettings(
  userId: string,
  appSettings: AppSettings,
  quizPrefs: QuizConfigPrefs,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('user_settings')
    .upsert({
      user_id:      userId,
      app_settings: appSettings,
      quiz_prefs:   quizPrefs,
      updated_at:   now,
      // last_upload_at is intentionally NOT set here - it tracks progress sync
      // only (uploadProgress owns it). Settings uploads must not advance that
      // clock or they'll trigger spurious download-and-replace on the same device.
    }, { onConflict: 'user_id' });
  if (error) console.warn('sync: settings upload failed:', error.message);
}

export async function uploadAchievements(
  userId: string,
  victorySeen: string[],
  victoryLog: VictoryLogEntry[] = [],
): Promise<void> {
  const { error } = await supabase
    .from('user_achievements')
    .upsert({
      user_id:      userId,
      victory_seen: victorySeen,
      victory_log:  victoryLog,
      updated_at:   new Date().toISOString(),
    }, { onConflict: 'user_id' });
  if (error) console.warn('sync: achievements upload failed:', error.message);
}

export async function downloadSettings(userId: string): Promise<{
  appSettings: AppSettings;
  quizPrefs: QuizConfigPrefs;
  victorySeen: string[];
  victoryLog: VictoryLogEntry[];
} | null> {
  const [settingsRes, achievementsRes] = await Promise.all([
    supabase.from('user_settings').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('user_achievements').select('*').eq('user_id', userId).maybeSingle(),
  ]);
  if (settingsRes.error || !settingsRes.data) return null;
  return {
    appSettings:  settingsRes.data.app_settings as AppSettings,
    quizPrefs:    settingsRes.data.quiz_prefs   as QuizConfigPrefs,
    victorySeen:  (achievementsRes.data?.victory_seen as string[])           ?? [],
    victoryLog:   (achievementsRes.data?.victory_log  as VictoryLogEntry[])  ?? [],
  };
}

export async function fetchFriendVictoryLog(friendUserId: string): Promise<VictoryLogEntry[]> {
  const { data } = await supabase
    .from('user_achievements')
    .select('victory_log')
    .eq('user_id', friendUserId)
    .maybeSingle();
  return (data?.victory_log as VictoryLogEntry[] | null) ?? [];
}

// ── User blocked photos ────────────────────────────────────────────────────────

export async function uploadUserBlockedPhoto(userId: string, url: string): Promise<void> {
  const { error } = await supabase
    .from('user_blocked_photos')
    .upsert({ user_id: userId, url }, { onConflict: 'user_id,url' });
  if (error) console.warn('sync: blocked photo upload failed:', error.message);
}

export async function downloadUserBlockedPhotos(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from('user_blocked_photos')
    .select('url')
    .eq('user_id', userId);
  if (error || !data) return;
  await Promise.all(data.map(row => db.blockedPhotos.put({ url: row.url })));
}

export async function deleteAllUserBlockedPhotos(userId: string): Promise<void> {
  const { error } = await supabase
    .from('user_blocked_photos')
    .delete()
    .eq('user_id', userId);
  if (error) console.warn('sync: blocked photos delete failed:', error.message);
}

// ── Field IDs (seen/heard in the wild) ─────────────────────────────────────────

// A tick is split across two tables: user_field_ids (friends can read it - the tick and its date)
// and user_field_id_details (owner-only - location and notes). Locally it's one FieldId record.

export interface FieldIdRow {
  species_code:      string;
  question_type:     FieldId['questionType'];
  com_name:          string;
  mastered_by_field: boolean;
  confirmed_at:      number;
  sighted_on:        string | null;
}

export interface FieldIdDetailRow {
  species_code:  string;
  question_type: FieldId['questionType'];
  location_name: string | null;
  location_lat:  number | null;
  location_lng:  number | null;
  notes:         string | null;
}

/** Pure - exported for unit tests. */
export function fieldIdToRows(userId: string, f: FieldId): {
  row:    FieldIdRow & { user_id: string };
  detail: FieldIdDetailRow & { user_id: string };
} {
  return {
    row: {
      user_id:           userId,
      species_code:      f.speciesCode,
      question_type:     f.questionType,
      com_name:          f.comName,
      mastered_by_field: f.masteredByField,
      confirmed_at:      f.confirmedAt,
      sighted_on:        f.sightedOn ?? null,
    },
    detail: {
      user_id:       userId,
      species_code:  f.speciesCode,
      question_type: f.questionType,
      location_name: f.locationName ?? null,
      location_lat:  f.locationLat  ?? null,
      location_lng:  f.locationLng  ?? null,
      notes:         f.notes        ?? null,
    },
  };
}

/** Pure - exported for unit tests and friends.ts. `detail` is absent for a friend's ticks. */
export function fieldIdFromRow(row: FieldIdRow, detail?: FieldIdDetailRow): FieldId {
  return {
    speciesCode:     row.species_code,
    questionType:    row.question_type,
    comName:         row.com_name,
    masteredByField: row.mastered_by_field,
    confirmedAt:     Number(row.confirmed_at),
    sightedOn:       row.sighted_on ?? undefined,
    locationName:    detail?.location_name ?? undefined,
    locationLat:     detail?.location_lat  ?? undefined,
    locationLng:     detail?.location_lng  ?? undefined,
    notes:           detail?.notes         ?? undefined,
  };
}

/** Pure - exported for unit tests. Joins each tick row with its (optional) detail row. */
export function mergeFieldIdRows(rows: FieldIdRow[], details: FieldIdDetailRow[]): FieldId[] {
  const detailByKey = new Map(details.map(d => [`${d.species_code}|${d.question_type}`, d]));
  return rows.map(r => fieldIdFromRow(r, detailByKey.get(`${r.species_code}|${r.question_type}`)));
}

/** Upserts ticks, then their detail rows (which reference the ticks). Returns false on error. */
async function upsertFieldIds(userId: string, fieldIds: FieldId[]): Promise<boolean> {
  const split = fieldIds.map(f => fieldIdToRows(userId, f));
  const onConflict = 'user_id,species_code,question_type';
  const { error } = await supabase.from('user_field_ids').upsert(split.map(s => s.row), { onConflict });
  if (error) {
    console.warn('sync: field ID upload failed:', error.message);
    return false;
  }
  const { error: detailError } = await supabase.from('user_field_id_details').upsert(split.map(s => s.detail), { onConflict });
  if (detailError) {
    console.warn('sync: field ID details upload failed:', detailError.message);
    return false;
  }
  return true;
}

/**
 * Mirrors a local tick change to the cloud for the signed-in user (no-op for guests).
 * When this device is current, a full uploadProgress() carries the tick and any progress
 * change, and stamps last_upload_at so other devices pick the change up (and don't re-upload
 * a tick removed here). When the cloud is newer, only the tick itself is pushed - a full
 * upload would overwrite the other device's newer progress (same rule as the hide handler).
 */
export async function syncFieldIdChange(change: FieldIdChange): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user.id;
  if (!userId) return;

  if (change.removed) {
    // Its user_field_id_details row goes with it (on delete cascade).
    const { error } = await supabase
      .from('user_field_ids')
      .delete()
      .eq('user_id', userId)
      .eq('species_code', change.removed.speciesCode)
      .eq('question_type', change.removed.questionType);
    if (error) console.warn('sync: field ID delete failed:', error.message);
    // So an identical re-tick is uploaded again rather than skipped as "unchanged".
    await forgetFingerprints(FIELD_ID_FP_KEY, [fieldIdKey(change.removed)]);
  }
  if (change.progressDeleted) await deleteCloudProgressRecords(userId, [change.progressDeleted]);

  const cloudTs = await getCloudUploadTime(userId).catch(() => null);
  const localSyncedAt = getLocalSyncedAt(userId) ?? 0;
  if (cloudTs === null || localSyncedAt >= cloudTs) {
    await uploadProgress(userId);
  } else if (change.upserted) {
    await upsertFieldIds(userId, [change.upserted]);
  }
}

export async function deleteAllCloudFieldIds(userId: string): Promise<void> {
  const { error } = await supabase
    .from('user_field_ids')
    .delete()
    .eq('user_id', userId);
  if (error) console.warn('sync: field IDs delete failed:', error.message);
  await saveFingerprints(FIELD_ID_FP_KEY, {});
}

// ── Media reports ─────────────────────────────────────────────────────────────

export interface SubmitReportParams {
  url:         string;
  mediaType:   'photo' | 'audio';
  service:     string | null;
  speciesCode: string;
  comName:     string;
  issueType:   'wrong_bird' | 'poor_quality' | 'confusing' | 'nest' | 'egg' | 'other';
  wrongBird:   string | null;
  description: string | null;
  regionCode:  string | null;
  notifyEmail: boolean;
  imageKey?:   string | null;
}

export async function submitMediaReport(p: SubmitReportParams): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = session?.access_token
    ? { Authorization: `Bearer ${session.access_token}` }
    : {};
  await api.post('/birds/report-media', {
    url:         p.url,
    mediaType:   p.mediaType,
    service:     p.service,
    speciesCode: p.speciesCode,
    comName:     p.comName,
    issueType:   p.issueType,
    wrongBird:   p.wrongBird,
    description: p.description,
    regionCode:  p.regionCode,
    notifyEmail: p.notifyEmail,
    imageKey:    p.imageKey ?? null,
  }, { headers });
}

/** Downloads all admin-blocked media and caches in IndexedDB. Called for all signed-in users. */
export async function fetchAdminBlockedMedia(): Promise<void> {
  const { data, error } = await supabase
    .from('media_reports')
    .select('url, species_code, media_type, block_scope, image_key')
    .eq('status', 'blocked');
  if (error || !data) return;
  await db.adminBlockedMedia.clear();
  await db.adminBlockedMedia.bulkPut(
    data
      .filter(r => r.url && r.species_code)
      .map(r => ({
        url:         r.url          as string,
        speciesCode: r.species_code as string,
        mediaType:   r.media_type   as 'photo' | 'audio',
        blockScope:  (r.block_scope ?? 'full') as 'full' | 'question',
        ...(r.image_key ? { imageKey: r.image_key as string } : {}),
      })),
  );
}

// ── Regional presence ─────────────────────────────────────────────────────────

/** Reads the shared presence cache for a region. Returns a map of speciesCode → last_seen_date. */
export async function fetchRegionalPresence(regionCode: string): Promise<Map<string, Date>> {
  const { data, error } = await supabase
    .from('regional_presence')
    .select('species_code, last_seen_date, prev_last_seen_date')
    .eq('region_code', regionCode);
  if (error || !data) return new Map();
  // Use prev_last_seen_date when present - it holds the pre-return date that
  // proves a long absence, before last_seen_date was overwritten by the new sighting.
  return new Map(
    (data as Array<{ species_code: string; last_seen_date: string; prev_last_seen_date: string | null }>)
      .map(r => [r.species_code, new Date(r.prev_last_seen_date ?? r.last_seen_date)]),
  );
}

/** Fire-and-forget: tells the backend to refresh the presence cache if it's stale. */
export function refreshRegionalPresence(regionCode: string): void {
  api.post('/birds/regional-presence/refresh', { regionCode }).catch(() => {});
}

// ── Region snapshot ───────────────────────────────────────────────────────────

import type { RegionSnapshot } from '../local/regionSnapshot';

export async function uploadRegionSnapshot(userId: string, snapshot: RegionSnapshot): Promise<void> {
  const { error } = await supabase
    .from('user_settings')
    .upsert({ user_id: userId, region_snapshot: snapshot, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) console.warn('sync: region snapshot upload failed:', error.message);
}

export async function downloadRegionSnapshot(userId: string): Promise<RegionSnapshot | null> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('region_snapshot')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return (data.region_snapshot as RegionSnapshot) ?? null;
}

// ── Delete ────────────────────────────────────────────────────────────────────

/** Deletes all cloud progress records for the given user. */
export async function deleteCloudProgress(userId: string): Promise<void> {
  const { error } = await supabase
    .from('bird_progress')
    .delete()
    .eq('user_id', userId);
  if (error) console.warn('sync: delete failed:', error.message);
  await saveFingerprints(PROGRESS_FP_KEY, {});
}

/** Deletes specific species+questionType records from the cloud for the given user.
 *  Used after a local trim so the cloud doesn't restore the deleted records on next merge. */
export async function deleteCloudProgressRecords(
  userId: string,
  records: Array<{ speciesCode: string; questionType: string }>,
): Promise<void> {
  if (records.length === 0) return;
  // Build a PostgREST OR filter: and(species_code.eq.X,question_type.eq.Y) per record
  const filter = records
    .map(r => `and(species_code.eq.${r.speciesCode},question_type.eq.${r.questionType})`)
    .join(',');
  const { error } = await supabase
    .from('bird_progress')
    .delete()
    .eq('user_id', userId)
    .or(filter);
  if (error) console.warn('sync: targeted delete failed:', error.message);
  // So a re-created record is uploaded again even if it happens to match the deleted one.
  await forgetFingerprints(PROGRESS_FP_KEY, records.map(r => `${r.speciesCode}|${r.questionType}`));
}
