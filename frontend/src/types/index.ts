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
}

export interface BirdPhotos {
  primary: string | null;   // high-quality taxa API photo
  optional: string[];       // observation photos the user can dismiss
}

/** Minimal species record stored in the client-side region cache (promotion queue). */
export interface CachedSpecies {
  speciesCode: string;
  comName: string;
  sciName: string;
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
