export interface AppSettings {
  autoplayRevealAudio: boolean;
  includeLatinAnswerVariants: boolean;
  includeSongAnswerVariants: boolean;
  randomizeQuestionPhotos: boolean;
}

const DEFAULTS: AppSettings = {
  autoplayRevealAudio: true,
  includeLatinAnswerVariants: false,
  includeSongAnswerVariants: false,
  randomizeQuestionPhotos: true,
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
