import { db } from './db';
import { STRUGGLING_THRESHOLD } from './struggling';
import type { QuestionType } from '../types';

const VICTORY_KEY = 'birdygurdy_victories';

/**
 * Victory is suppressed per snapshot, not per time period. The snapshotKey is
 * derived from the region snapshot's savedAt timestamp so that each RegionUpdate
 * naturally produces a new key, resetting the suppression without any explicit
 * clearing step.
 */
function victoryId(snapshotKey: string, types: QuestionType[]): string {
  return `${snapshotKey}:${[...types].sort().join(',')}`;
}

export function hasSeenVictory(snapshotKey: string, types: QuestionType[]): boolean {
  try {
    const raw = localStorage.getItem(VICTORY_KEY);
    const seen: string[] = raw ? JSON.parse(raw) : [];
    return seen.includes(victoryId(snapshotKey, types));
  } catch { return false; }
}

export function markVictorySeen(snapshotKey: string, types: QuestionType[]): void {
  try {
    const raw = localStorage.getItem(VICTORY_KEY);
    const seen: string[] = raw ? JSON.parse(raw) : [];
    const id = victoryId(snapshotKey, types);
    if (!seen.includes(id)) {
      seen.push(id);
      localStorage.setItem(VICTORY_KEY, JSON.stringify(seen));
    }
  } catch { /* non-fatal */ }
}

export function getVictorySeen(): string[] {
  try {
    const raw = localStorage.getItem(VICTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function mergeVictorySeen(remoteKeys: string[]): void {
  try {
    const raw = localStorage.getItem(VICTORY_KEY);
    const local: string[] = raw ? JSON.parse(raw) : [];
    const merged = Array.from(new Set([...local, ...remoteKeys]));
    localStorage.setItem(VICTORY_KEY, JSON.stringify(merged));
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
