/**
 * Cloud sync — uploads local IndexedDB progress to Supabase and merges
 * remote records back. Merge rule: whichever record has the higher
 * `lastAsked` timestamp is considered more recent and wins.
 */
import { supabase } from './supabase';
import { db } from './db';
import type { BirdProgress } from '../types';
import type { AppSettings, QuizConfigPrefs } from './settings';

// ── Upload ────────────────────────────────────────────────────────────────────

/** Upserts all local progress records to the cloud for the given user. */
export async function uploadProgress(userId: string): Promise<void> {
  const records = await db.progress.toArray();
  if (records.length === 0) return;

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
    in_history:          r.inHistory   ?? false,
  }));

  const { error } = await supabase
    .from('bird_progress')
    .upsert(rows, { onConflict: 'user_id,species_code,question_type' });

  if (error) console.warn('sync: upload failed:', error.message);
}

// ── Download & merge ──────────────────────────────────────────────────────────

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
      if (!local || remote.last_asked > local.lastAsked) {
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
          inHistory:          remote.in_history,
        };
        await db.progress.put(record);
      }
    }),
  );

  return data.length;
}

// ── Settings ──────────────────────────────────────────────────────────────────

export async function uploadSettings(
  userId: string,
  appSettings: AppSettings,
  quizPrefs: QuizConfigPrefs,
  victorySeen: string[],
): Promise<void> {
  const { error } = await supabase
    .from('user_settings')
    .upsert({
      user_id:      userId,
      app_settings: appSettings,
      quiz_prefs:   quizPrefs,
      victory_seen: victorySeen,
      updated_at:   new Date().toISOString(),
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
    .single();
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

// ── Delete ────────────────────────────────────────────────────────────────────

/** Deletes all cloud progress records for the given user. */
export async function deleteCloudProgress(userId: string): Promise<void> {
  const { error } = await supabase
    .from('bird_progress')
    .delete()
    .eq('user_id', userId);
  if (error) console.warn('sync: delete failed:', error.message);
}
