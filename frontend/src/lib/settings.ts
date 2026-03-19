export interface AppSettings {
  autoplayRevealAudio: boolean;
  includeLatinAnswerVariants: boolean;
  includeSongAnswerVariants: boolean;
  randomizeQuestionPhotos: boolean;
  maxRecentSightings: number;
  autoScrollRelatedSpecies: boolean;
  recentWindow: 'day' | 'week' | 'month';
}

const DEFAULTS: AppSettings = {
  autoplayRevealAudio: true,
  includeLatinAnswerVariants: false,
  includeSongAnswerVariants: false,
  randomizeQuestionPhotos: true,
  maxRecentSightings: 4,
  autoScrollRelatedSpecies: true,
  recentWindow: 'day',
};

const KEY = 'birdygurdy_settings';

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: AppSettings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

// ── Quiz config prefs (question types, mode, questions per round) ─────────────

const CONFIG_KEY = 'birdygurdy_quiz_prefs';

export interface QuizConfigPrefs {
  questionTypes?: string[];
  mode?: string;
  questionsPerRound?: number;
  regionCode?: string;
}

export function loadQuizPrefs(): QuizConfigPrefs {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function saveQuizPrefs(prefs: QuizConfigPrefs): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(prefs));
}
