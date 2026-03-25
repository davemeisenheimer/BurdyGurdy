import { db } from './db';
import { getRegionSpecies } from './regionCache';
import { MASTERY_ADVANCE_STREAK, GRADUATION_STREAK } from './mastery';
import type { QuestionType, LevelUpEvent } from '../types';

// ── Constants ────────────────────────────────────────────────────────────────

// Learning palette size limits
export const MAX_LEVEL_0_SIZE_FIRST   = 6;  // Max birds simultaneously in level 0
export const MAX_LEVEL_0_SIZE_SECOND  = 8
export const MAX_LEVEL_0_SIZE_THIRD   = 10
export const MAX_LEVEL_0_SIZE         = 12;

// Weight given to birds in the learning palette (levels 0, 1, 2)
const PALETTE_WEIGHT = 20.0;
// Weight given to birds in the mastered palette (history)
const HISTORY_WEIGHT = 1.0;


// ── Weight formula ────────────────────────────────────────────────────────────

export const STRUGGLING_THRESHOLD = 0.85; // accuracy below this = struggling

function calcWeight(inHistory: boolean, favourited: boolean, correct: number, incorrect: number): number {
  if (favourited) return PALETTE_WEIGHT;
  const total = correct + incorrect;
  const struggling = total > 0 && correct / total < STRUGGLING_THRESHOLD;
  if (inHistory) return struggling ? PALETTE_WEIGHT : HISTORY_WEIGHT;
  return struggling ? PALETTE_WEIGHT * 1.5 : PALETTE_WEIGHT;
}

// ── recordAnswer ─────────────────────────────────────────────────────────────

export interface RecordAnswerResult {
  advancedFromLevel0: boolean;
  levelUp: LevelUpEvent | null;
  updatedMastery: { masteryLevel: number; consecutiveCorrect: number; inHistory: boolean; correct: number; incorrect: number };
}

/**
 * Records a quiz answer and updates mastery/streak in IndexedDB.
 * Returns whether a level 0→1 advancement occurred (triggers promotion)
 * and a LevelUpEvent if any level advancement or graduation happened.
 */
export async function recordAnswer(
  speciesCode: string,
  questionType: QuestionType,
  correct: boolean,
  comName: string,
): Promise<RecordAnswerResult> {
  const existing = await db.progress.get([speciesCode, questionType]);
  let advancedFromLevel0 = false;
  let levelUp: LevelUpEvent | null = null;

  let updatedMastery: RecordAnswerResult['updatedMastery'];

  if (existing) {
    const newCorrect   = existing.correct   + (correct ? 1 : 0);
    const newIncorrect = existing.incorrect + (correct ? 0 : 1);

    const prevMastery = existing.masteryLevel ?? 0;
    let newMastery   = prevMastery;
    let newStreak    = existing.consecutiveCorrect ?? 0;
    let newInHistory = existing.inHistory ?? false;

    if (correct) {
      newStreak++;
      if (newMastery < 2 && newStreak >= MASTERY_ADVANCE_STREAK) {
        newMastery++;
        newStreak = 0;
        if (prevMastery === 0 && newMastery === 1) advancedFromLevel0 = true;
        levelUp = { speciesCode, comName, questionType, newLevel: newMastery, graduated: false };
      } else if (newMastery >= 2 && newStreak >= GRADUATION_STREAK && !newInHistory) {
        newInHistory = true;
        levelUp = { speciesCode, comName, questionType, newLevel: 3, graduated: true };
      }
    } else {
      newStreak = 0;
    }

    await db.progress.put({
      ...existing,
      comName,
      correct: newCorrect,
      incorrect: newIncorrect,
      lastAsked: Date.now(),
      weight: calcWeight(newInHistory, existing.favourited ?? false, newCorrect, newIncorrect),
      masteryLevel: newMastery,
      consecutiveCorrect: newStreak,
      inHistory: newInHistory,
    });

    // When a level just advanced, show the completed level at its threshold rather than
    // the new level at 0 — e.g. "3/3 Easy" instead of "0/3 Medium".
    if (levelUp && !levelUp.graduated) {
      updatedMastery = { masteryLevel: prevMastery, consecutiveCorrect: MASTERY_ADVANCE_STREAK, inHistory: false, correct: newCorrect, incorrect: newIncorrect };
    } else {
      updatedMastery = { masteryLevel: newMastery, consecutiveCorrect: newStreak, inHistory: newInHistory, correct: newCorrect, incorrect: newIncorrect };
    }
  } else {
    const newStreak = correct ? 1 : 0;
    const newCorrect = correct ? 1 : 0;
    const newIncorrect = correct ? 0 : 1;
    await db.progress.put({
      speciesCode,
      questionType,
      comName,
      correct: newCorrect,
      incorrect: newIncorrect,
      lastAsked: Date.now(),
      weight: PALETTE_WEIGHT,
      favourited: false,
      excluded: false,
      masteryLevel: 0,
      consecutiveCorrect: newStreak,
      inHistory: false,
    });
    updatedMastery = { masteryLevel: 0, consecutiveCorrect: newStreak, inHistory: false, correct: newCorrect, incorrect: newIncorrect };
  }

  return { advancedFromLevel0, levelUp, updatedMastery };
}

// ── Palette seeding & promotion ───────────────────────────────────────────────

/**
 * Creates a placeholder DB entry for a species being introduced to level 0.
 * lastAsked=0 marks it as "seeded but not yet asked" — hidden from My Progress
 * until the user actually encounters it in a quiz round.
 */
async function addToPalette(
  speciesCode: string,
  comName: string,
  types: QuestionType[],
): Promise<boolean> {
  let didAdd = false;
  for (const type of types) {
    const existing = await db.progress.get([speciesCode, type]);
    if (!existing) {
      await db.progress.put({
        speciesCode,
        questionType: type,
        comName,
        correct: 0, incorrect: 0,
        lastAsked: 0,          // 0 = seeded, not yet asked
        weight: PALETTE_WEIGHT,
        favourited: false, excluded: false,
        masteryLevel: 0, consecutiveCorrect: 0, inHistory: false,
      });
      didAdd = true;
    }
  }
  return didAdd;
}

/**
 * Promotes `count` birds from the sorted region list into the learning palette,
 * starting from the stored promotionIndex and advancing it forward.
 * The list is ordered backyard-common-first, so promotions always follow that order.
 */
async function promoteNext(regionCode: string, types: QuestionType[], count: number, back = 30): Promise<void> {
  const cacheKey = `${regionCode}:${back}`;
  const cache = await db.regionSpecies.get(cacheKey);

  if (!cache) return;

  const list  = cache.species;
  let   index = cache.promotionIndex ?? 0;
  let   added = 0;

  while (added < count && index < list.length) {
    const wasNew = await addToPalette(list[index].speciesCode, list[index].comName, types);
    index++;
    if (wasNew) added++;
  }

  await db.regionSpecies.put({ ...cache, promotionIndex: index });
}

async function getPromotionCount(level0Count: number) {  
  const graduateCount = await db.progress
    .filter(record => record.masteryLevel !== 0)
    .count();
  // const historyCount = await db.progress
  //   .filter(record => record.inHistory === true)
  //   .count();
  const level0MaxSize = graduateCount > 12
          ? MAX_LEVEL_0_SIZE : graduateCount > 6 
          ? MAX_LEVEL_0_SIZE_THIRD: graduateCount > 1 
          ? MAX_LEVEL_0_SIZE_SECOND : MAX_LEVEL_0_SIZE_FIRST;
  return level0MaxSize - level0Count;
}

/**
 * Called at the start of each adaptive quiz round.
 * Tops up level 0 to the dynamic target size, which grows as the user masters more birds.
 * Promotions follow the backyard-common-first order stored in the region species cache.
 */
export async function maintainLevel0Palette(regionCode: string, types: QuestionType[], back = 30): Promise<void> {
  // Ensure the region species list is cached before we try to read promotionIndex
  await getRegionSpecies(regionCode, back);
  const records = await db.progress.toArray();
  const recordSet = new Set(
    records
      .filter(r => (r.masteryLevel ?? 0) === 0 && !(r.inHistory ?? false) && !(r.excluded ?? false) && types.includes(r.questionType))
      .map(r => r.speciesCode),
  );

  const level0Count = recordSet.size;

  // if (level0Count >= INITIAL_LEVEL_0_SIZE) return;
  const promotionCount = await getPromotionCount(level0Count);

  if (promotionCount <= 0) return;

  await promoteNext(regionCode, types, promotionCount, back);
}

/**
 * Called after a level 0 → 1 advancement.
 * Adds up to 2 birds from the next positions in the sorted region list.
 */
export async function checkAndPromote(regionCode: string, types: QuestionType[], back = 30): Promise<void> {
  const records = await db.progress.toArray();

  const level0Count = new Set(
    records
      .filter(r => (r.masteryLevel ?? 0) === 0 && !(r.inHistory ?? false) && types.includes(r.questionType))
      .map(r => r.speciesCode),
  ).size;

  const slotsToFill = Math.min(
    4,
    MAX_LEVEL_0_SIZE - level0Count,
  );

  if (slotsToFill <= 0) return;

  await promoteNext(regionCode, types, slotsToFill, back);
}

// ── Favourite ────────────────────────────────────────────────────────────────

export async function setFavourite(
  speciesCode: string,
  questionType: QuestionType,
  favourited: boolean,
): Promise<void> {
  const existing = await db.progress.get([speciesCode, questionType]);
  if (existing) {
    const weight = calcWeight(existing.inHistory ?? false, favourited, existing.correct ?? 0, existing.incorrect ?? 0);
    await db.progress.put({ ...existing, favourited, weight });
  } else {
    await db.progress.put({
      speciesCode, questionType, comName: speciesCode,
      correct: 0, incorrect: 0, lastAsked: Date.now(),
      weight: calcWeight(false, favourited, 0, 0),
      favourited, excluded: false,
      masteryLevel: 0, consecutiveCorrect: 0, inHistory: false,
    });
  }
}

export async function getFavourited(
  speciesCode: string,
  questionType: QuestionType,
): Promise<boolean> {
  return (await db.progress.get([speciesCode, questionType]))?.favourited ?? false;
}

// ── Excluded ─────────────────────────────────────────────────────────────────

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

export interface AdaptiveParams {
  weights: Record<string, number>;
  masteryLevels: Record<string, number>;
  banned: string[];
  paletteSpeciesCodes: string[];
  level0Keys: string[];  // "speciesCode:questionType" keys where masteryLevel===0 and !inHistory
  historyKeys: string[];  // "speciesCode:questionType" keys where inHistory=true
}

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
    if (r.excluded) bannedSet.add(r.speciesCode);
  }

  const weights: Record<string, number> = {};
  const paletteSpeciesCodes: string[] = [];
  const level0Keys: string[] = [];
  const historyKeys: string[] = [];

  for (const [speciesCode, speciesRecords] of bySpecies) {
    const hasActivePaletteType = speciesRecords.some(r => !(r.inHistory ?? false));
    if (hasActivePaletteType) paletteSpeciesCodes.push(speciesCode);

    for (const record of speciesRecords) {
      const key    = `${speciesCode}:${record.questionType}`;
      weights[key] = calcWeight(record.inHistory ?? false, record.favourited ?? false, record.correct ?? 0, record.incorrect ?? 0);
      if (record.inHistory) historyKeys.push(key);
      if (!bannedSet.has(speciesCode) && (record.masteryLevel ?? 0) === 0 && !(record.inHistory ?? false)) {
        level0Keys.push(key);
      }
    }
  }

  return { weights, masteryLevels, banned: [...bannedSet], paletteSpeciesCodes, level0Keys, historyKeys };
}

// ── Legacy ───────────────────────────────────────────────────────────────────

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
