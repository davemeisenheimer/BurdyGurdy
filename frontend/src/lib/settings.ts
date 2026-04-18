import type { BirderLevel } from '../types';
import { db } from './db';

export type { BirderLevel };

export interface AppSettings {
  autoplayRevealAudio: boolean;
  includeLatinAnswerVariants: boolean;
  includeSongAnswerVariants: boolean;
  randomizeQuestionPhotos: boolean;
  maxRecentSightings: number;
  autoScrollRelatedSpecies: boolean;
  recentWindow: 'day' | 'week' | 'month';
  enableAdminFeatures: boolean;
  expireMasteredBirds: boolean;
  alwaysFastTrack: boolean;
  birderLevel?: BirderLevel;
}

export const DEFAULTS: AppSettings = {
  autoplayRevealAudio: true,
  includeLatinAnswerVariants: false,
  includeSongAnswerVariants: false,
  randomizeQuestionPhotos: true,
  maxRecentSightings: 4,
  autoScrollRelatedSpecies: true,
  recentWindow: 'day',
  enableAdminFeatures: false,
  expireMasteredBirds: true,
  alwaysFastTrack: false,
};

// Key names used in the per-user keyValue store (no namespacing needed — the DB
// itself is already namespaced per user via BirdyGurdyDB-guest / BirdyGurdyDB-{uid})
const SETTINGS_KEY   = 'settings';
const QUIZ_PREFS_KEY = 'quizPrefs';
const FOCUS_KEY      = 'focusStruggling';

// Legacy localStorage keys — migrated into IndexedDB on first read then deleted
const LEGACY_SETTINGS_KEY   = 'birdygurdy_settings';
const LEGACY_QUIZ_PREFS_KEY = 'birdygurdy_quiz_prefs';
const LEGACY_FOCUS_KEY      = 'birdygurdy_focus_struggling';

async function kvGet(key: string): Promise<string | null> {
  try {
    const row = await db.keyValue.get(key);
    return row?.value ?? null;
  } catch { return null; }
}

async function kvSet(key: string, value: string): Promise<void> {
  await db.keyValue.put({ key, value }).catch(() => {});
}

// ── App settings ──────────────────────────────────────────────────────────────

export async function loadSettings(): Promise<AppSettings> {
  try {
    const legacy = localStorage.getItem(LEGACY_SETTINGS_KEY);
    if (legacy !== null) {
      await kvSet(SETTINGS_KEY, legacy);
      localStorage.removeItem(LEGACY_SETTINGS_KEY);
      return { ...DEFAULTS, ...JSON.parse(legacy) };
    }
    const raw = await kvGet(SETTINGS_KEY);
    return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveSettings(s: AppSettings): Promise<void> {
  await kvSet(SETTINGS_KEY, JSON.stringify(s));
}

// ── Quiz config prefs (question types, mode, questions per round) ─────────────

export interface QuizConfigPrefs {
  questionTypes?: string[];
  mode?: string;
  questionsPerRound?: number;
  regionCode?: string;
  groupId?: string;
}

export async function loadQuizPrefs(): Promise<QuizConfigPrefs> {
  try {
    const legacy = localStorage.getItem(LEGACY_QUIZ_PREFS_KEY);
    if (legacy !== null) {
      await kvSet(QUIZ_PREFS_KEY, legacy);
      localStorage.removeItem(LEGACY_QUIZ_PREFS_KEY);
      return JSON.parse(legacy) as QuizConfigPrefs;
    }
    const raw = await kvGet(QUIZ_PREFS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export async function saveQuizPrefs(prefs: QuizConfigPrefs): Promise<void> {
  await kvSet(QUIZ_PREFS_KEY, JSON.stringify(prefs));
}

// ── Focus-struggling toggle ───────────────────────────────────────────────────

export async function loadFocusStruggling(): Promise<boolean> {
  try {
    const legacy = localStorage.getItem(LEGACY_FOCUS_KEY);
    if (legacy !== null) {
      await kvSet(FOCUS_KEY, legacy);
      localStorage.removeItem(LEGACY_FOCUS_KEY);
      return legacy === 'true';
    }
    const raw = await kvGet(FOCUS_KEY);
    return raw === 'true';
  } catch { return false; }
}

export async function saveFocusStruggling(val: boolean): Promise<void> {
  await kvSet(FOCUS_KEY, String(val));
}

/** Wipes user-specific settings back to factory defaults and returns them.
 *  Call when a brand-new user signs in so they don't inherit a previous user's prefs. */
export async function resetUserSettings(): Promise<AppSettings> {
  const fresh = { ...DEFAULTS };
  await saveSettings(fresh);
  return fresh;
}
