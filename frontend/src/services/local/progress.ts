import { db } from '../../lib/db';
import { getRegionSpecies } from './region';
import {
  calcWeight, applyAnswer,
  PALETTE_WEIGHT, HISTORY_WEIGHT,
  MAX_LEVEL_0_SIZE, MAX_LEVEL_0_SIZE_FIRST, MAX_LEVEL_0_SIZE_SECOND, MAX_LEVEL_0_SIZE_THIRD,
} from '../../lib/adaptive';
import type { AdaptiveParams, RecordAnswerResult } from '../../lib/adaptive';
import type { QuestionType, CachedSpecies, LevelUpEvent, BirdProgress } from '../../types';

// Re-export so call sites that previously imported these from adaptive can
// switch to this module without touching every consumer individually.
export type { RecordAnswerResult };

// ── recordAnswer ──────────────────────────────────────────────────────────────

/**
 * Records a quiz answer and persists the updated mastery state to IndexedDB.
 * Delegates the pure mastery computation to applyAnswer() in lib/adaptive.ts.
 */
export async function recordAnswer(
  speciesCode: string,
  questionType: QuestionType,
  correct: boolean,
  comName: string,
): Promise<RecordAnswerResult> {
  const existing = await db.progress.get([speciesCode, questionType]);
  const { newState, advancedFromLevel0, levelUp, noLongerStruggling, updatedMastery } = applyAnswer(
    existing ?? null,
    correct,
    speciesCode,
    comName,
    questionType,
  );

  if (existing) {
    await db.progress.put({
      ...existing,
      comName,
      correct:            newState.correct,
      incorrect:          newState.incorrect,
      lastAsked:          Date.now(),
      weight:             newState.weight,
      masteryLevel:       newState.masteryLevel,
      consecutiveCorrect: newState.consecutiveCorrect,
      isMastered:          newState.isMastered,
      recentAnswers:      newState.recentAnswers,
    });
  } else {
    await db.progress.put({
      speciesCode,
      questionType,
      comName,
      correct:            newState.correct,
      incorrect:          newState.incorrect,
      lastAsked:          Date.now(),
      weight:             newState.weight,
      favourited:         false,
      excluded:           false,
      masteryLevel:       newState.masteryLevel,
      consecutiveCorrect: newState.consecutiveCorrect,
      isMastered:          newState.isMastered,
      recentAnswers:      newState.recentAnswers,
    });
  }

  return { advancedFromLevel0, levelUp, noLongerStruggling, updatedMastery };
}

// ── Palette seeding & promotion ───────────────────────────────────────────────

/** Adds a single species+type record to the palette. Returns true if a new record was created. */
async function addToPaletteForType(
  speciesCode: string,
  comName: string,
  type: QuestionType,
): Promise<boolean> {
  const existing = await db.progress.get([speciesCode, type]);
  if (!existing) {
    // Inherit favourited/excluded from any sibling record so a species excluded in one
    // question type is consistently excluded (or favourited) when a new type is seeded.
    const sibling = await db.progress.where('speciesCode').equals(speciesCode).first();
    await db.progress.put({
      speciesCode,
      questionType: type,
      comName,
      correct: 0, incorrect: 0,
      lastAsked: 0,           // 0 = seeded, not yet asked
      weight: PALETTE_WEIGHT,
      favourited: sibling?.favourited ?? false,
      excluded:   sibling?.excluded   ?? false,
      masteryLevel: 0, consecutiveCorrect: 0, isMastered: false,
    });
    return true;
  }
  return false;
}

/**
 * Returns the first `count` species from `list` whose speciesCode is not in `seededCodes`.
 * Always scans from position 0 so higher-priority species (recent, common) are promoted
 * before lower-priority ones, regardless of any prior promotion state.
 *
 * This replaces the old sequential-index approach, which got permanently stuck once
 * the index advanced past the end of the list: when the cache refreshed and inserted
 * new birds anywhere in the sorted list, those birds were behind the saved index and
 * were silently skipped forever.
 */
export function selectSpeciesToPromote(
  list: CachedSpecies[],
  seededCodes: Set<string>,
  count: number,
): CachedSpecies[] {
  const result: CachedSpecies[] = [];
  for (const s of list) {
    if (result.length >= count) break;
    if (!seededCodes.has(s.speciesCode)) result.push(s);
  }
  return result;
}

/** Promotes up to `count` unseeded species for the given type into the learning palette. */
async function promoteNextForType(
  regionCode: string,
  type: QuestionType,
  count: number,
  back = 30,
  seededCodes: Set<string>,
): Promise<void> {
  const cacheKey = `${regionCode}:${back}`;
  const cache = await db.regionSpecies.get(cacheKey);
  if (!cache) return;

  const toSeed = selectSpeciesToPromote(cache.species, seededCodes, count);
  for (const s of toSeed) {
    await addToPaletteForType(s.speciesCode, s.comName, type);
  }
}

/**
 * Returns how many species should be promoted for a given type.
 * The target palette size grows as the user graduates more birds of that type.
 */
export function typeLevel0MaxSize(graduateCount: number): number {
  return graduateCount > 12 ? MAX_LEVEL_0_SIZE
    : graduateCount > 6    ? MAX_LEVEL_0_SIZE_THIRD
    : graduateCount > 1    ? MAX_LEVEL_0_SIZE_SECOND
    :                        MAX_LEVEL_0_SIZE_FIRST;
}

async function getTypePromotionCount(type: QuestionType, level0Count: number): Promise<number> {
  const graduateCount = await db.progress
    .filter(record => record.questionType === type && record.masteryLevel !== 0)
    .count();
  return typeLevel0MaxSize(graduateCount) - level0Count;
}

/**
 * Called at the start of each adaptive quiz round.
 * Tops up each type's level-0 palette to its independent target size.
 */
export async function maintainLevel0Palette(
  regionCode: string,
  types: QuestionType[],
  back = 30,
): Promise<void> {
  await getRegionSpecies(regionCode, back);
  const records = await db.progress.toArray();

  for (const type of types) {
    const level0Count = records.filter(
      r => r.questionType === type && (r.masteryLevel ?? 0) === 0 && !(r.isMastered ?? false) && !(r.excluded ?? false),
    ).length;
    const promotionCount = await getTypePromotionCount(type, level0Count);
    if (promotionCount > 0) {
      const seededCodes = new Set(records.filter(r => r.questionType === type).map(r => r.speciesCode));
      await promoteNextForType(regionCode, type, promotionCount, back, seededCodes);
    }
  }
}


// ── No-audio graduation ───────────────────────────────────────────────────────

/**
 * Graduates a bird to mastered immediately because no audio recordings exist
 * for it. Sets noAudio=true so the UI can distinguish this from a normally-
 * learned bird. Weight is set to HISTORY_WEIGHT so it still gets occasional
 * review checks — if audio becomes available later, the backend will return a
 * real song question instead of a noAudio one, and the bird naturally re-enters
 * normal review rotation.
 */
/**
 * Pure helper — computes the record to write and the result to return.
 * Exported for unit tests; call graduateNoAudio() from production code.
 */
export function buildNoAudioGraduation(
  speciesCode: string,
  questionType: QuestionType,
  comName: string,
  existing: BirdProgress | null,
  now: number,
): {
  record: BirdProgress;
  levelUp: LevelUpEvent;
  updatedMastery: { masteryLevel: number; consecutiveCorrect: number; isMastered: boolean; correct: number; incorrect: number };
} {
  const record: BirdProgress = {
    speciesCode,
    questionType,
    comName,
    correct:            existing?.correct            ?? 0,
    incorrect:          existing?.incorrect          ?? 0,
    lastAsked:          now,
    weight:             HISTORY_WEIGHT,
    favourited:         existing?.favourited         ?? false,
    excluded:           existing?.excluded           ?? false,
    masteryLevel:       existing?.masteryLevel       ?? 0,
    consecutiveCorrect: existing?.consecutiveCorrect ?? 0,
    isMastered:         true,
    noAudio:            true,
    recentAnswers:      existing?.recentAnswers      ?? [],
  };
  return {
    record,
    levelUp: { speciesCode, comName, questionType, newLevel: 3, graduated: true },
    updatedMastery: {
      masteryLevel:       record.masteryLevel,
      consecutiveCorrect: record.consecutiveCorrect,
      isMastered:         true,
      correct:            record.correct,
      incorrect:          record.incorrect,
    },
  };
}

export async function graduateNoAudio(
  speciesCode: string,
  questionType: QuestionType,
  comName: string,
): Promise<{
  levelUp: LevelUpEvent;
  updatedMastery: { masteryLevel: number; consecutiveCorrect: number; isMastered: boolean; correct: number; incorrect: number };
}> {
  const existing = await db.progress.get([speciesCode, questionType]);
  const { record, levelUp, updatedMastery } = buildNoAudioGraduation(
    speciesCode, questionType, comName, existing ?? null, Date.now(),
  );
  await db.progress.put(record);
  return { levelUp, updatedMastery };
}

// ── Favourite ─────────────────────────────────────────────────────────────────

export async function setFavourite(
  speciesCode: string,
  questionType: QuestionType,
  favourited: boolean,
): Promise<void> {
  const existing = await db.progress.get([speciesCode, questionType]);
  if (existing) {
    const weight = calcWeight(existing.isMastered ?? false, favourited, existing.recentAnswers, existing.correct ?? 0, existing.incorrect ?? 0);
    await db.progress.put({ ...existing, favourited, weight });
  } else {
    await db.progress.put({
      speciesCode, questionType, comName: speciesCode,
      correct: 0, incorrect: 0, lastAsked: Date.now(),
      weight: calcWeight(false, favourited, undefined, 0, 0),
      favourited, excluded: false,
      masteryLevel: 0, consecutiveCorrect: 0, isMastered: false,
    });
  }
}

export async function getFavourited(
  speciesCode: string,
  questionType: QuestionType,
): Promise<boolean> {
  return (await db.progress.get([speciesCode, questionType]))?.favourited ?? false;
}

// ── Excluded ──────────────────────────────────────────────────────────────────

export async function setExcluded(
  speciesCode: string,
  excluded: boolean,
): Promise<void> {
  const records = await db.progress.where('speciesCode').equals(speciesCode).toArray();
  if (records.length > 0) {
    await db.progress.bulkPut(records.map(r => ({ ...r, excluded })));
  }
}

export async function getExcluded(
  speciesCode: string,
  questionType: QuestionType,
): Promise<boolean> {
  return (await db.progress.get([speciesCode, questionType]))?.excluded ?? false;
}

// ── Adaptive params ───────────────────────────────────────────────────────────

export async function getAdaptiveParams(): Promise<AdaptiveParams> {
  const records = await db.progress.toArray();

  const masteryLevels: Record<string, number> = {};
  const bannedSet = new Set<string>();

  const bySpecies = new Map<string, typeof records>();
  for (const r of records) {
    const list = bySpecies.get(r.speciesCode) ?? [];
    list.push(r);
    bySpecies.set(r.speciesCode, list);
    masteryLevels[`${r.speciesCode}:${r.questionType}`] = r.masteryLevel ?? 0;
  }

  const weights: Record<string, number> = {};
  const paletteSpeciesCodes: string[] = [];
  const level0Keys: string[] = [];
  const historyKeys: string[] = [];

  for (const [speciesCode, speciesRecords] of bySpecies) {
    // A species is banned only when the user has excluded ALL its question-type records.
    // Excluding a single type (e.g. image) must not silently block other types (e.g. song).
    if (speciesRecords.every(r => r.excluded)) bannedSet.add(speciesCode);

    const hasActivePaletteType = speciesRecords.some(r => !(r.isMastered ?? false));
    if (hasActivePaletteType) paletteSpeciesCodes.push(speciesCode);

    for (const record of speciesRecords) {
      const key    = `${speciesCode}:${record.questionType}`;
      weights[key] = calcWeight(record.isMastered ?? false, record.favourited ?? false, record.recentAnswers, record.correct ?? 0, record.incorrect ?? 0);
      if (record.isMastered) historyKeys.push(key);
      if (!bannedSet.has(speciesCode) && (record.masteryLevel ?? 0) === 0 && !(record.isMastered ?? false)) {
        level0Keys.push(key);
      }
    }
  }

  return { weights, masteryLevels, banned: [...bannedSet], paletteSpeciesCodes, level0Keys, historyKeys };
}

// ── Legacy helpers ────────────────────────────────────────────────────────────

export async function getAllWeights(): Promise<Record<string, number>> {
  return (await getAdaptiveParams()).weights;
}

export async function getWeights(
  speciesCodes: string[],
  questionType: QuestionType,
): Promise<Map<string, number>> {
  const records = await db.progress
    .where('[speciesCode+questionType]')
    .anyOf(speciesCodes.map(code => [code, questionType]))
    .toArray();
  return new Map(records.map(r => [r.speciesCode, r.weight]));
}

// ── Re-export weight constants for callers that need them ─────────────────────

export { PALETTE_WEIGHT, HISTORY_WEIGHT };
