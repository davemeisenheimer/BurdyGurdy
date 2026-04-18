import { db } from './db';
import { STRUGGLING_THRESHOLD } from './struggling';
import type { QuestionType } from '../types';

const KEY        = 'victories';
const LEGACY_KEY = 'birdygurdy_victories';

/**
 * Victory is suppressed per snapshot, not per time period. The snapshotKey is
 * derived from the region snapshot's savedAt timestamp so that each RegionUpdate
 * naturally produces a new key, resetting the suppression without any explicit
 * clearing step.
 */
function victoryId(snapshotKey: string, types: QuestionType[]): string {
  return `${snapshotKey}:${[...types].sort().join(',')}`;
}

async function getSeen(): Promise<string[]> {
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy !== null) {
    await db.keyValue.put({ key: KEY, value: legacy }).catch(() => {});
    localStorage.removeItem(LEGACY_KEY);
    return JSON.parse(legacy) as string[];
  }
  const row = await db.keyValue.get(KEY).catch(() => null);
  return row ? JSON.parse(row.value) : [];
}

export async function hasSeenVictory(snapshotKey: string, types: QuestionType[]): Promise<boolean> {
  try {
    const seen = await getSeen();
    return seen.includes(victoryId(snapshotKey, types));
  } catch { return false; }
}

export async function markVictorySeen(snapshotKey: string, types: QuestionType[]): Promise<void> {
  try {
    const seen = await getSeen();
    const id = victoryId(snapshotKey, types);
    if (!seen.includes(id)) {
      seen.push(id);
      await db.keyValue.put({ key: KEY, value: JSON.stringify(seen) });
    }
  } catch { /* non-fatal */ }
}

export async function getVictorySeen(): Promise<string[]> {
  try {
    return await getSeen();
  } catch { return []; }
}

export async function mergeVictorySeen(remoteKeys: string[]): Promise<void> {
  try {
    const local = await getSeen();
    const merged = Array.from(new Set([...local, ...remoteKeys]));
    await db.keyValue.put({ key: KEY, value: JSON.stringify(merged) });
  } catch { /* non-fatal */ }
}

/**
 * Checks whether the player has mastered all non-historical birds in the region
 * for the given observation window and question types.
 *
 * Mastered = isMastered === true (graduated from level 2 with a 5-consecutive-correct streak)
 * + overall accuracy across those records > STRUGGLING_THRESHOLD.
 */
export async function checkVictoryCondition(
  regionCode: string,
  back: number,
  questionTypes: QuestionType[],
): Promise<boolean> {
  const cacheKey = `${regionCode}:${back}`;
  const cached = await db.regionSpecies.get(cacheKey);
  if (!cached) return false;

  const recentSpecies = cached.species.filter(s => !s.isHistorical);
  if (recentSpecies.length === 0) return false;

  const speciesCodes = recentSpecies.map(s => s.speciesCode);

  const records = await db.progress
    .where('[speciesCode+questionType]')
    .anyOf(speciesCodes.flatMap(code => questionTypes.map(t => [code, t])))
    .toArray();

  const recordMap = new Map(records.map(r => [`${r.speciesCode}:${r.questionType}`, r]));

  let totalCorrect = 0;
  let totalIncorrect = 0;
  let allGraduated = true;

  for (const { speciesCode } of recentSpecies) {
    for (const type of questionTypes) {
      const record = recordMap.get(`${speciesCode}:${type}`);
      if (!record || !record.isMastered) {
        allGraduated = false;
      }
      if (record) {
        totalCorrect += record.correct;
        totalIncorrect += record.incorrect;
      }
    }
  }

  if (!allGraduated) return false;

  const total = totalCorrect + totalIncorrect;
  return total > 0 && totalCorrect / total > STRUGGLING_THRESHOLD;
}

/** Human-readable description of what was mastered based on active question types. */
export function describeMastery(questionTypes: QuestionType[]): string {
  const categories = new Set<string>();
  for (const t of questionTypes) {
    if (['image', 'image-latin', 'image-song'].includes(t)) categories.add('visual appearance');
    if (['song', 'song-latin'].includes(t)) categories.add('song');
    if (['sono', 'sono-song'].includes(t)) categories.add('spectrogram');
    if (['family', 'family-latin'].includes(t)) categories.add('family name');
    if (['latin', 'latin-song'].includes(t)) categories.add('Latin name');
    if (t === 'order') categories.add('order name');
  }
  const list = [...categories];
  if (list.length === 0) return 'all question types';
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}

export function describeWindow(recentWindow: 'day' | 'week' | 'month'): string {
  return { day: 'today', week: 'in the past week', month: 'in the past month' }[recentWindow];
}
