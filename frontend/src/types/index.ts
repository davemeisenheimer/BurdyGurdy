export type QuestionType =
  | 'song' | 'image' | 'latin' | 'family' | 'order' | 'sono'
  | 'image-latin' | 'song-latin' | 'family-latin'
  | 'image-song' | 'sono-song' | 'latin-song';
export type GameMode = 'adaptive' | 'random';

export interface BirdSpecies {
  speciesCode: string;
  comName: string;
  sciName: string;
  familyComName: string;
  familySciName?: string;
  order?: string;
  isBackyard?: boolean;
  isHistorical?: boolean;
  isCommon?: boolean;
}

export interface AttributedPhoto {
  url: string;
  credit: string;
  source?: 'macaulay' | 'inat' | 'wiki';
}

export interface BirdPhotos {
  primary: AttributedPhoto | null;
  optional: AttributedPhoto[];
}

/** Minimal species record stored in the client-side region cache (promotion queue). */
export interface CachedSpecies {
  speciesCode: string;
  comName: string;
  sciName: string;
  isHistorical?: boolean;
}

/** IndexedDB record for caching the ordered regional species list. */
export interface RegionSpeciesCache {
  regionCode: string;
  species: CachedSpecies[];  // ordered: backyard-common-first, then other-common-first
  cachedAt: number;
  promotionIndex: number;    // index of the next bird to promote into the learning palette
}

export interface QuizQuestion {
  id: string;
  type: QuestionType;
  speciesCode: string;
  comName: string;
  sciName: string;
  familyComName: string;
  order?: string;
  audioUrl?: string;
  sonoUrl?: string;
  imageUrl?: string;
  imageCredit?: string;
  options: string[];
  optionAudioUrls?: string[];
  correctAnswer: string;
}

export interface QuizConfig {
  regionCode: string;
  questionTypes: QuestionType[];
  mode: GameMode;
  questionsPerRound: number;
  groupId: string; // 'all' or a BirdGroup id
  recentDays?: number; // 1, 7, or 30 — observation window for recent species pool
}

export interface LevelUpEvent {
  speciesCode: string;
  comName: string;
  questionType: QuestionType;
  newLevel: number;   // 1, 2, or 3 where 3 = graduated to mastered (inHistory)
  graduated: boolean; // true when inHistory becomes true
}

export interface BirdProgress {
  speciesCode: string;
  questionType: QuestionType;
  comName: string;
  correct: number;
  incorrect: number;
  lastAsked: number;
  weight: number;
  favourited: boolean;
  excluded: boolean;           // user asked never to see this bird again
  masteryLevel: number;        // 0=easy distractors, 1=same-family, 2=same-genus
  consecutiveCorrect: number;  // streak at the current mastery level
  inHistory?: boolean;         // graduated from learning palette to history palette for this question type
}
