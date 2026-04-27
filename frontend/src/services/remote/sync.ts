/**
 * Cloud sync - uploads local IndexedDB progress to Supabase and merges
 * remote records back. Merge rule: whichever record has the higher
 * `lastAsked` timestamp is considered more recent and wins.
 */
import { supabase } from '../../lib/supabase';
import { api } from './api';
import { db } from '../../lib/db';
import { STRUGGLING_WINDOW } from '../../lib/struggling';
import type { BirdProgress } from '../../types';
import { loadQuizPrefs, saveQuizPrefs } from '../../lib/settings';
import type { AppSettings, QuizConfigPrefs } from '../../lib/settings';

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

/**
 * Upserts all local progress records to the cloud for the given user.
 * Skips seeded-but-never-played records (lastAsked === 0) - these are
 * palette placeholders and uploading them would corrupt cloud progress
 * from other devices.
 *
 * On success: stamps last_upload_at in the cloud AND updates localSyncedAt /
 * needsUpload in localStorage so they are always kept in sync with the upload.
 * These localStorage helpers are intentionally private to this module — all
 * callers go through this function so the coupling can never be broken.
 *
 * Returns true on success, false on failure.
 */
export async function uploadProgress(userId: string): Promise<boolean> {
  const records = (await db.progress.toArray()).filter(r => r.lastAsked > 0);

  if (records.length > 0) {
    const rows = records.map(r => ({
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
    }));

    const { error } = await supabase
      .from('bird_progress')
      .upsert(rows, { onConflict: 'user_id,species_code,question_type' });

    if (error) {
      console.warn('sync: upload failed:', error.message);
      setNeedsUpload(userId, true);
      return false;
    }
  }

  // Stamp last_upload_at so other devices detect this upload on reactivation.
  // Uses UPDATE (not upsert) to avoid creating a partial row; uploadSettings
  // creates the full row on first sign-in.
  const ts = Date.now();
  const { error: tsErr } = await supabase
    .from('user_settings')
    .update({ last_upload_at: new Date(ts).toISOString(), updated_at: new Date(ts).toISOString() })
    .eq('user_id', userId);
  if (tsErr) console.warn('sync: last_upload_at stamp failed:', tsErr.message);
  // tsErr is non-fatal: no row yet means the user_settings row doesn't exist — uploadSettings will create it.

  // Always use the same timestamp we wrote to the cloud, not Date.now() called later.
  setLocalSyncedAt(userId, ts);
  setNeedsUpload(userId, false);
  return true;
}

// ── Download & merge ──────────────────────────────────────────────────────────

type LocalSnapshot  = { lastAsked: number; isMastered?: boolean; masteryLevel?: number } | null;
type RemoteSnapshot = { last_asked: number; in_history?: boolean; mastery_level?: number };

/** Pure predicate - exported for unit tests. */
export function decideTakeRemote(local: LocalSnapshot, remote: RemoteSnapshot): boolean {
  const localHistory  = local?.isMastered   ?? false;
  const remoteHistory = remote.in_history   ?? false;
  const localLevel    = local?.masteryLevel  ?? 0;
  const remoteLevel   = remote.mastery_level ?? 0;
  return (
    !local
    || (local.lastAsked === 0 && remote.last_asked > 0)
    || (remoteHistory && !localHistory)
    || (!remoteHistory && !localHistory && remoteLevel > localLevel)
    || (remoteHistory === localHistory && remoteLevel === localLevel && remote.last_asked > local.lastAsked)
  );
}

/**
 * Downloads all cloud records for the user and merges them into local
 * IndexedDB. Remote record wins when its `last_asked` is newer than the
 * local one; otherwise the local record is kept (and will be uploaded on
 * the next sync).
 */
/** Returns the number of remote records found (0 = brand-new account). */
export async function downloadAndMerge(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('bird_progress')
    .select('*')
    .eq('user_id', userId);

  if (error || !data) {
    console.warn('sync: download failed:', error?.message);
    return 0;
  }

  await Promise.all(
    data.map(async remote => {
      const local = await db.progress.get([remote.species_code, remote.question_type] as [string, string]);
      const shouldTakeRemote = decideTakeRemote(local ?? null, remote);
      if (shouldTakeRemote) {
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
          recentAnswers:      remote.recent_answers ?? local?.recentAnswers,
        };
        // Seed recentAnswers for mastered records that are missing a window.
        // This happens when a cloud record was uploaded before the feature existed,
        // or when the record arrives on a fresh device before local v9 migration had
        // anything to seed.  Mirrors the v9 DB migration's backfill logic.
        if (record.isMastered && !record.recentAnswers) {
          const total = record.correct + record.incorrect;
          const accuracy = total > 0 ? record.correct / total : 1;
          const correctCount = Math.round(accuracy * STRUGGLING_WINDOW);
          record.recentAnswers = [
            ...Array(STRUGGLING_WINDOW - correctCount).fill(false),
            ...Array(correctCount).fill(true),
          ];
        }
        await db.progress.put(record);
      }
    }),
  );

  return data.length;
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
 * them — adding/updating records that exist in the cloud and deleting local
 * records that the cloud no longer has.  Local-only fields (masteredAt,
 * noAudio) are preserved where the record still exists in both.
 *
 * cloudTs: the last_upload_at timestamp already fetched from the cloud (passed
 * in to avoid a second round-trip). On success, localSyncedAt is stamped with
 * this value so the caller never needs to touch localStorage directly.
 *
 * Returns the number of cloud records (> 0), 0 if cloud has no records
 * (safe no-op — local is untouched), or -1 on network error.
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
  if (data.length === 0) return 0; // no cloud records — don't wipe local

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
  victorySeen: string[],
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('user_settings')
    .upsert({
      user_id:      userId,
      app_settings: appSettings,
      quiz_prefs:   quizPrefs,
      victory_seen: victorySeen,
      updated_at:   now,
      // last_upload_at is intentionally NOT set here — it tracks progress sync
      // only (uploadProgress owns it). Settings uploads must not advance that
      // clock or they'll trigger spurious download-and-replace on the same device.
    }, { onConflict: 'user_id' });
  if (error) console.warn('sync: settings upload failed:', error.message);
}

export async function downloadSettings(userId: string): Promise<{
  appSettings: AppSettings;
  quizPrefs: QuizConfigPrefs;
  victorySeen: string[];
} | null> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    appSettings:  data.app_settings  as AppSettings,
    quizPrefs:    data.quiz_prefs    as QuizConfigPrefs,
    victorySeen:  (data.victory_seen as string[]) ?? [],
  };
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
}

export async function submitMediaReport(p: SubmitReportParams): Promise<void> {
  await api.post('/birds/report-media', {
    url:         p.url,
    mediaType:   p.mediaType,
    service:     p.service,
    speciesCode: p.speciesCode,
    comName:     p.comName,
    issueType:   p.issueType,
    wrongBird:   p.wrongBird,
    description: p.description,
  });
}

/** Downloads all admin-blocked media and caches in IndexedDB. Called for all signed-in users. */
export async function fetchAdminBlockedMedia(): Promise<void> {
  const { data, error } = await supabase
    .from('media_reports')
    .select('url, species_code, media_type, block_scope')
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
      })),
  );
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
}
