import { db } from './db';
import { STRUGGLING_THRESHOLD } from './struggling';
import { getRegionSpecies } from '../services/local/region';
import type { QuestionType, CachedSpecies, BirdProgress } from '../types';

export interface VictoryLogEntry {
  tier: AwardTier;
  questionTypes: QuestionType[];
  earnedAt: string; // ISO 8601
  /** Pool birds for this award: total window size for first-ever, unmastered count for repeats. */
  count?: number;
}

export type AwardTier = 'firstStep' | 'backyardBirder' | 'patchRegular' | 'localLegend' | 'regionalChampion';

/** Species count threshold for the Backyard Birder award. */
export const BACKYARD_BIRDER_COUNT = 7;

export const AWARD_NAMES: Record<AwardTier, string> = {
  firstStep:        'First Step',
  backyardBirder:   'Backyard Birder',
  patchRegular:     'Patch Regular',
  localLegend:      'Local Legend',
  regionalChampion: 'Regional Champion',
};

// Permanent tiers fire once per question-type combination, ever.
const PERMANENT_TIERS = new Set<AwardTier>(['firstStep', 'backyardBirder']);

// Checked highest-to-lowest; only the top-most earned tier fires per round.
const TIER_ORDER: AwardTier[] = ['regionalChampion', 'localLegend', 'patchRegular', 'backyardBirder', 'firstStep'];

const KEY        = 'victories';
const LEGACY_KEY = 'birdygurdy_victories';
const LOG_KEY    = 'victoryLog';

function victoryId(snapshotKey: string, types: QuestionType[], tier: AwardTier): string {
  const key = PERMANENT_TIERS.has(tier) ? 'permanent' : snapshotKey;
  return `${tier}:${key}:${[...types].sort().join(',')}`;
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

export async function hasSeenVictory(snapshotKey: string, types: QuestionType[], tier: AwardTier = 'localLegend'): Promise<boolean> {
  try {
    const seen = await getSeen();
    return seen.includes(victoryId(snapshotKey, types, tier));
  } catch { return false; }
}

export async function markVictorySeen(snapshotKey: string, types: QuestionType[], tier: AwardTier = 'localLegend', count?: number): Promise<void> {
  try {
    const seen = await getSeen();
    const id = victoryId(snapshotKey, types, tier);
    if (!seen.includes(id)) {
      seen.push(id);
      await db.keyValue.put({ key: KEY, value: JSON.stringify(seen) });
      const row = await db.keyValue.get(LOG_KEY).catch(() => null);
      const log: VictoryLogEntry[] = row ? (JSON.parse(row.value) as VictoryLogEntry[]) : [];
      const entry: VictoryLogEntry = { tier, questionTypes: [...types].sort(), earnedAt: new Date().toISOString() };
      if (count !== undefined) entry.count = count;
      log.push(entry);
      await db.keyValue.put({ key: LOG_KEY, value: JSON.stringify(log) });
    }
  } catch { /* non-fatal */ }
}

export async function getVictorySeen(): Promise<string[]> {
  try { return await getSeen(); } catch { return []; }
}

export async function mergeVictorySeen(remoteKeys: string[]): Promise<void> {
  try {
    const local = await getSeen();
    const merged = Array.from(new Set([...local, ...remoteKeys]));
    await db.keyValue.put({ key: KEY, value: JSON.stringify(merged) });
  } catch { /* non-fatal */ }
}

export async function getVictoryLog(): Promise<VictoryLogEntry[]> {
  try {
    const row = await db.keyValue.get(LOG_KEY).catch(() => null);
    return row ? (JSON.parse(row.value) as VictoryLogEntry[]) : [];
  } catch { return []; }
}

export async function mergeVictoryLog(remote: VictoryLogEntry[]): Promise<void> {
  try {
    const local = await getVictoryLog();
    const seen = new Set(local.map(e => `${e.tier}:${e.earnedAt}`));
    const merged = [...local, ...remote.filter(e => !seen.has(`${e.tier}:${e.earnedAt}`))];
    merged.sort((a, b) => a.earnedAt.localeCompare(b.earnedAt));
    await db.keyValue.put({ key: LOG_KEY, value: JSON.stringify(merged) });
  } catch { /* non-fatal */ }
}

// ── Challenge snapshot ────────────────────────────────────────────────────────
// Stored at snapshot-save time; records how many species×type pairs were
// unmastered in each award pool so the achievements screen can show meaningful
// counts without needing historical mastery state at award-fire time.

export interface ChallengeSnapshot {
  nonHistorical: number; // for localLegend
  recentCommon: number;  // for patchRegular
  all: number;           // for regionalChampion
}

const CHALLENGE_PREFIX = 'challenge';

function challengeKey(snapshotKey: string, types: QuestionType[]): string {
  return `${CHALLENGE_PREFIX}:${snapshotKey}:${[...types].sort().join(',')}`;
}

export function computeChallengeSnapshot(
  currentSpecies: CachedSpecies[],
  records: BirdProgress[],
  types: QuestionType[],
): ChallengeSnapshot {
  const recordMap = new Map(records.map(r => [`${r.speciesCode}:${r.questionType}`, r]));
  const countUnmastered = (pool: CachedSpecies[]) =>
    pool.reduce((sum, s) =>
      sum + types.filter(t => !(recordMap.get(`${s.speciesCode}:${t}`)?.isMastered ?? false)).length, 0);
  return {
    nonHistorical: countUnmastered(currentSpecies.filter(s => !s.isHistorical)),
    recentCommon:  countUnmastered(currentSpecies.filter(s => s.priorityGroup === 'recentCommon')),
    all:           countUnmastered(currentSpecies),
  };
}

export async function storeChallengeSnapshot(
  snapshotKey: string,
  types: QuestionType[],
  snapshot: ChallengeSnapshot,
): Promise<void> {
  await db.keyValue.put({ key: challengeKey(snapshotKey, types), value: JSON.stringify(snapshot) }).catch(() => {});
}

export async function getChallengeSnapshot(
  snapshotKey: string,
  types: QuestionType[],
): Promise<ChallengeSnapshot | null> {
  try {
    const row = await db.keyValue.get(challengeKey(snapshotKey, types));
    return row ? JSON.parse(row.value) as ChallengeSnapshot : null;
  } catch { return null; }
}

/** Clears all stored challenge snapshots. Call after clearing play history
 *  so stale pre-clear counts don't misrepresent the next award cycle. */
export async function clearChallengeSnapshots(): Promise<void> {
  try {
    const toDelete = await db.keyValue.filter(r => r.key.startsWith(CHALLENGE_PREFIX + ':')).toArray();
    if (toDelete.length > 0) await db.keyValue.bulkDelete(toDelete.map(e => e.key));
  } catch { /* non-fatal */ }
}

// ── Award logic ───────────────────────────────────────────────────────────────

// Pure helper: all target species×type pairs must be mastered, and overall accuracy must clear the threshold.
function allMasteredWithAccuracy(
  targetSpecies: CachedSpecies[],
  records: BirdProgress[],
  types: QuestionType[],
): boolean {
  if (targetSpecies.length === 0) return false;
  const recordMap = new Map(records.map(r => [`${r.speciesCode}:${r.questionType}`, r]));
  let totalCorrect = 0, totalIncorrect = 0;
  for (const s of targetSpecies) {
    for (const t of types) {
      const r = recordMap.get(`${s.speciesCode}:${t}`);
      if (!r?.isMastered) return false;
      totalCorrect   += r.correct;
      totalIncorrect += r.incorrect;
    }
  }
  const total = totalCorrect + totalIncorrect;
  return total > 0 && totalCorrect / total > STRUGGLING_THRESHOLD;
}

/**
 * Checks which award tier (if any) the user just earned this round.
 * Returns the highest tier earned and marks it seen, or null.
 *
 * Graduation requirements (prevents spurious repeats when the window shrinks):
 *   firstStep / backyardBirder  — any graduation this round
 *   patchRegular                — must have graduated a recentCommon bird
 *   localLegend                 — must have graduated any non-historical (window) bird
 *   regionalChampion            — any graduation (including historical birds)
 */
export async function findEarnedAward(
  regionCode: string,
  back: number,
  questionTypes: QuestionType[],
  snapshotKey: string,
  graduatedCodes: Set<string>,
): Promise<AwardTier | null> {
  if (graduatedCodes.size === 0) return null;

  const [species, records] = await Promise.all([
    getRegionSpecies(regionCode, back),
    db.progress.toArray(),
  ]);

  const recentCommon  = species.filter(s => s.priorityGroup === 'recentCommon');
  const nonHistorical = species.filter(s => !s.isHistorical);
  const masteredCodes = new Set(records.filter(r => r.isMastered).map(r => r.speciesCode));

  const commonCodes = new Set(recentCommon.map(s => s.speciesCode));
  const windowCodes = new Set(nonHistorical.map(s => s.speciesCode));

  const graduatedCommon = [...graduatedCodes].some(c => commonCodes.has(c));
  const graduatedWindow = [...graduatedCodes].some(c => windowCodes.has(c));

  for (const tier of TIER_ORDER) {
    const eligibleToEarn =
      tier === 'patchRegular' ? graduatedCommon :
      tier === 'localLegend'  ? graduatedWindow :
      true;
    if (!eligibleToEarn) continue;

    if (await hasSeenVictory(snapshotKey, questionTypes, tier)) continue;

    const won =
      tier === 'firstStep'        ? masteredCodes.size >= 1 :
      tier === 'backyardBirder'   ? masteredCodes.size >= BACKYARD_BIRDER_COUNT :
      tier === 'patchRegular'     ? allMasteredWithAccuracy(recentCommon,  records, questionTypes) :
      tier === 'localLegend'      ? allMasteredWithAccuracy(nonHistorical, records, questionTypes) :
      /* regionalChampion */        allMasteredWithAccuracy(species,       records, questionTypes);

    if (!won) continue;

    let count: number | undefined;
    if (!PERMANENT_TIERS.has(tier)) {
      const log = await getVictoryLog();
      const typesKey = [...questionTypes].sort().join(',');
      const isFirstEver = !log.some(e => e.tier === tier && [...e.questionTypes].sort().join(',') === typesKey);
      if (isFirstEver) {
        // First-ever: show the total pool size ("identified all N birds")
        count =
          tier === 'patchRegular'     ? recentCommon.length :
          tier === 'localLegend'      ? nonHistorical.length :
          /* regionalChampion */        species.length;
      } else {
        // Repeat: show how many were newly mastered this cycle ("mastered N new birds")
        const challenge = await getChallengeSnapshot(snapshotKey, questionTypes);
        count =
          tier === 'patchRegular'     ? (challenge?.recentCommon  ?? recentCommon.length) :
          tier === 'localLegend'      ? (challenge?.nonHistorical ?? nonHistorical.length) :
          /* regionalChampion */        (challenge?.all            ?? species.length);
      }
    }

    await markVictorySeen(snapshotKey, questionTypes, tier, count);
    return tier;
  }

  return null;
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
