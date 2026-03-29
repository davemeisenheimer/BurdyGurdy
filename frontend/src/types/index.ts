export type QuestionType =
  | 'song' | 'image' | 'latin' | 'family' | 'order' | 'sono'
  | 'image-latin' | 'song-latin' | 'family-latin'
  | 'image-song' | 'sono-song' | 'latin-song';
export type GameMode = 'adaptive' | 'random';

export type PriorityGroup = 'recentCommon' | 'recentUncommon' | 'regionCommon' | 'regionUncommon' | 'rareUncommon';

export interface BirdSpecies {
  speciesCode: string;
  comName: string;
  sciName: string;
  familyComName: string;
  familySciName?: string;
  order?: string;
  isBackyard?: boolean;
  isHistorical?: boolean;
  priorityGroup?: PriorityGroup;
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
  priorityGroup?: PriorityGroup;
}

/** IndexedDB record for caching the ordered regional species list. */
export interface RegionSpeciesCache {
  regionCode: string;
  species: CachedSpecies[];  // ordered by 5-group priority: recentCommon → recentUncommon → regionCommon → regionUncommon → rareUncommon
  cachedAt: number;
  promotionIndex?: number;                                     // legacy — no longer written, kept so old records deserialise cleanly
  promotionIndexByType?: Partial<Record<QuestionType, number>>; // legacy — no longer written, kept so old records deserialise cleanly
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
  audioTracks?: { audioUrl: string; sonoUrl?: string }[];
  sonoUrl?: string;
  imageUrl?: string;
  imageCredit?: string;
  options: string[];
  optionAudioUrls?: string[];
  correctAnswer: string;
  noAudio?: boolean;  // true when no recordings exist — frontend awards a free correct answer
}

export interface QuizConfig {
  regionCode: string;
  questionTypes: QuestionType[];
  mode: GameMode;
  questionsPerRound: number;
  groupId: string; // 'all' or a BirdGroup id
  recentDays?: number; // 1, 7, or 30 — observation window for recent species pool
  onlyStruggling?: boolean; // when true, restrict quiz to species where the user is struggling
}

export interface LevelUpEvent {
  speciesCode: string;
  comName: string;
  questionType: QuestionType;
  newLevel: number;   // 1, 2, or 3 where 3 = graduated to mastered
  graduated: boolean; // true when isMastered becomes true
}

/** Fired when a mastered bird's rolling window crosses back to ≥ 80% correct. */
export interface NoLongerStrugglingEvent {
  speciesCode: string;
  comName: string;
  questionType: QuestionType;
  recentCorrect: number;
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
  isMastered?: boolean;        // graduated from learning palette — appears only occasionally for review
  noAudio?: boolean;           // graduated automatically because no recordings exist for this question type
  recentAnswers?: boolean[];   // rolling window of last STRUGGLING_WINDOW answers (mastered birds only)
}
