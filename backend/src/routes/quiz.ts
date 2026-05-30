import { Router } from 'express';
import { getTaxonomy, getRegionalSpecies, getCommonSpeciesCodes, getBackyardSpeciesRanking, getSpeciesList } from '../services/ebird';
import { getRecordings, parseXCLength } from '../services/xenocanto';
import { getSpeciesPhotoUrl } from '../services/macaulay';
import { BACKYARD_FAMILIES, GROUP_ORDERS, ORDER_COMMON_NAMES } from '../constants';
import { getSupabaseAdmin } from '../lib/supabase';
import { cache } from '../cache';
import {
  PALETTE_AND_SM_RATIO, XC_FETCH_BATCH_SIZE,
} from '@birdygurdy/shared';
import { buildCandidates, applyPaletteSMGuarantee, applyAffinityBoosts, pickFromPool, splitCandidates } from '../lib/candidateLogic';
import { filterRecordings, weightedSampleByDuration } from '../lib/recordingFilter';
import { selectDistractors, pickRandom } from '../lib/distractorLogic';
import type { PoolSpecies, Candidate } from '../lib/candidateLogic';

const router = Router();

export type QuestionType =
  | 'song' | 'image' | 'latin' | 'family' | 'order' | 'sono'
  | 'image-latin' | 'song-latin' | 'family-latin'
  | 'image-song' | 'sono-song' | 'latin-song';

export interface QuizQuestion {
  id: string;
  type: QuestionType;
  speciesCode: string;
  comName: string;
  sciName: string;
  familyComName: string;
  familySciName?: string;
  order?: string;
  orderComName?: string;
  promptLatinName?: boolean;
  audioUrl?: string;
  audioDuration?: number;  // duration in seconds for sono clips
  audioTracks?: { audioUrl: string; sonoUrl?: string }[];
  sonoUrl?: string;
  imageUrl?: string;
  imageCredit?: string;
  options: string[];
  optionAudioUrls?: string[];
  correctAnswer: string;
  noAudio?: boolean;  // true when no recordings exist - frontend awards a free correct answer
  noPhoto?: boolean;  // true when no photos exist after retrying - frontend awards a free correct answer
}


// ── Helpers ──────────────────────────────────────────────────────────────────
// selectDistractors, pickRandom, pickWithPalettePreference and visual-similarity
// helpers live in ../lib/distractorLogic (imported above).

function pickWeightedType(
  types: QuestionType[],
  speciesCode: string,
  weights: Record<string, number>,
): QuestionType {
  if (types.length === 1) return types[0];
  const typeWeights = types.map(t => Math.max(weights[`${speciesCode}:${t}`] ?? 1.0, 0.01));
  const total = typeWeights.reduce((a, b) => a + b, 0);
  let rand = Math.random() * total;
  for (let i = 0; i < types.length; i++) {
    rand -= typeWeights[i];
    if (rand <= 0) return types[i];
  }
  return types[types.length - 1];
}

function pickWeighted<T extends { speciesCode: string }>(
  arr: T[],
  n: number,
  weights: Record<string, number>,
  types: string[],
): T[] {
  if (Object.keys(weights).length === 0) return pickRandom(arr, n);

  const result: T[]    = [];
  const remaining      = [...arr];

  while (result.length < n && remaining.length > 0) {
    const itemWeights = remaining.map(item => {
      const w = types.reduce((max, t) => {
        return Math.max(max, weights[`${item.speciesCode}:${t}`] ?? 1.0);
      }, 0);
      return Math.max(w, 0.01);
    });

    const total = itemWeights.reduce((a, b) => a + b, 0);
    let rand = Math.random() * total;
    let idx  = 0;
    for (let i = 0; i < itemWeights.length; i++) {
      rand -= itemWeights[i];
      if (rand <= 0) { idx = i; break; }
    }
    result.push(remaining.splice(idx, 1)[0]);
  }

  return result;
}

// ── Blocked photo URLs ────────────────────────────────────────────────────────

async function getBlockedPhotoUrls(): Promise<Set<string>> {
  const CACHE_KEY = 'blocked_photo_urls';
  const cached = cache.get<Set<string>>(CACHE_KEY);
  if (cached) return cached;
  try {
    const admin = getSupabaseAdmin();
    const { data } = await admin
      .from('media_reports')
      .select('url')
      .eq('status', 'blocked')
      .eq('media_type', 'photo');
    const urls = new Set<string>((data ?? []).map((r: { url: string }) => r.url));
    cache.set(CACHE_KEY, urls, 5 * 60 * 1000);
    return urls;
  } catch {
    return new Set();  // non-fatal: don't block quiz generation on Supabase errors
  }
}

// ── Route ────────────────────────────────────────────────────────────────────

// POST /api/quiz/questions
router.post('/questions', async (req, res) => {
  try {
    const {
      regionCode    = 'CA-ON-OT',
      count         = 10,
      types         = ['image'],
      exclude              = [],
      weights              = {},
      groupId              = 'all',
      masteryLevels        = {},
      banned               = [],
      paletteSpeciesCodes  = [],
      back                 = 1,
      paletteKeys          = [],
      historyKeys          = [],
      strugglingKeys       = [],
      bannedAudioUrls      = [],
      birderLevel          = 'novice',
      speciesFilter        = [],
    } = req.body;

    const bannedAudioSet = new Set<string>(bannedAudioUrls as string[]);

    const paletteCodes = new Set<string>(paletteSpeciesCodes as string[]);

    const [observations, taxonomy, backyardCodes, top100Codes, historicalCodes, blockedPhotoUrls] = await Promise.all([
      getRegionalSpecies(regionCode, back),
      getTaxonomy(),
      getBackyardSpeciesRanking(regionCode),
      getCommonSpeciesCodes(regionCode),
      getSpeciesList(regionCode),
      getBlockedPhotoUrls(),
    ]);

    // Use backyard (private location) ranking as primary; fall back to top100 if too sparse
    const commonCodes = backyardCodes.length >= 10 ? backyardCodes : top100Codes.map(e => e.code);

    const taxMap = new Map(taxonomy.map(t => [t.speciesCode, t]));

    const excludeSet = new Set<string>([...exclude, ...banned]);
    const seen       = new Set<string>();

    const pool = observations
      .filter(obs =>
        !excludeSet.has(obs.speciesCode) &&
        !seen.has(obs.speciesCode) &&
        (seen.add(obs.speciesCode), true),
      )
      .map(obs => {
        const tax = taxMap.get(obs.speciesCode);
        return { ...obs, tax: tax ? { ...tax, orderComName: ORDER_COMMON_NAMES[tax.order] } : undefined };
      })
      .filter(s => s.tax) as PoolSpecies[];

    const groupOrders   = GROUP_ORDERS[groupId] ?? [];
    let filteredPool  = groupOrders.length > 0
      ? pool.filter(s => groupOrders.includes(s.tax!.order))
      : pool;

    // Sort filteredPool: backyard-family species first (by commonness), then others (by commonness).
    // This ensures the initial questions favour familiar backyard birds over rarities.
    const commonRank = new Map(commonCodes.map((code, i) => [code, i]));
    let questionPool = [...filteredPool].sort((a, b) => {
      const aBackyard = BACKYARD_FAMILIES.has(a.tax!.familySciName ?? '');
      const bBackyard = BACKYARD_FAMILIES.has(b.tax!.familySciName ?? '');
      if (aBackyard !== bBackyard) return aBackyard ? -1 : 1;
      const ra = commonRank.get(a.speciesCode) ?? 9999;
      const rb = commonRank.get(b.speciesCode) ?? 9999;
      return ra - rb;
    });

    // Supplement with the full historical species list as a low-priority fallback.
    // Historical species are appended after recent ones and given a much lower selection
    // weight (0.05 vs 1.0) so they only appear when the recent pool runs short.
    // In adaptive mode they are skipped entirely (no weight entry means no candidate).
    const recentCodes = new Set(questionPool.map(s => s.speciesCode));
    const historicalExtras: PoolSpecies[] = (historicalCodes as string[])
      .filter(code => !recentCodes.has(code) && !excludeSet.has(code) && taxMap.has(code))
      .map(code => {
        const tax = taxMap.get(code)!;
        return {
          speciesCode: code,
          comName: tax.comName,
          sciName: tax.sciName,
          tax: { familySciName: tax.familySciName, familyComName: tax.familyComName, order: tax.order, orderComName: ORDER_COMMON_NAMES[tax.order] },
        } as PoolSpecies;
      })
      .filter(s => groupOrders.length === 0 || groupOrders.includes(s.tax!.order));
    // Historical extras supplement both the distractor pool and the non-recent question pool.
    // Filtered to species in the annual frequency list to exclude one-off accidentals that
    // the user would never recognise as belonging to their region.
    const top100Set = new Set(top100Codes.map(e => e.code));
    filteredPool = [...filteredPool, ...historicalExtras.filter(s => top100Set.has(s.speciesCode))];

    // When the user has a custom species selection, restrict question subjects to those codes.
    // filteredPool (distractors) is left unfiltered so distractors remain varied when the
    // selected set is small; selectDistractors prefers selected birds when the pool is large enough.
    const speciesFilterSet = new Set<string>(speciesFilter as string[]);
    if (speciesFilterSet.size > 0) {
      questionPool = questionPool.filter(s => speciesFilterSet.has(s.speciesCode));
    }

    const adaptiveMode = Object.keys(weights as object).length > 0;
    const weightsMap = weights as Record<string, number>;
    // Species the user has encountered in at least one question type (used to prefer
    // familiar birds as distractors over completely unintroduced ones).
    const introducedCodes = adaptiveMode
      ? new Set<string>(Object.keys(weightsMap).map(k => k.split(':')[0]))
      : new Set<string>();

    const paletteKeySet   = new Set<string>(paletteKeys as string[]);
    const historyKeySet   = new Set<string>(historyKeys as string[]);
    const strugglingKeySet = new Set<string>(strugglingKeys as string[]);

    // Palette birds that are absent from both the recent window and the annual frequency list
    // (e.g. uncommon migrants the user has encountered before) are promoted into the learning
    // palette by maintainLevel0Palette but would be silently skipped by buildCandidates because
    // they never appear in filteredPool. Add them here so they remain question candidates.
    if (adaptiveMode) {
      const filteredPoolCodes = new Set(filteredPool.map(s => s.speciesCode));
      for (const key of Object.keys(weightsMap)) {
        const code = key.split(':')[0];
        if (filteredPoolCodes.has(code) || excludeSet.has(code) || !taxMap.has(code)) continue;
        const tax = taxMap.get(code)!;
        if (groupOrders.length > 0 && !groupOrders.includes(tax.order)) continue;
        filteredPool.push({
          speciesCode: code,
          comName: tax.comName,
          sciName: tax.sciName,
          tax: { familySciName: tax.familySciName, familyComName: tax.familyComName, order: tax.order, orderComName: ORDER_COMMON_NAMES[tax.order] },
        });
        filteredPoolCodes.add(code);
      }
    }

    const candidates: Candidate[] = buildCandidates(
      questionPool, filteredPool, recentCodes, weightsMap, types as QuestionType[], adaptiveMode, paletteKeySet, paletteCodes, speciesFilterSet, strugglingKeySet,
    );

    const palettePlusStrugglingMin = adaptiveMode ? Math.ceil(count * PALETTE_AND_SM_RATIO) : 0;

    let picked: Candidate[];
    if (adaptiveMode && palettePlusStrugglingMin > 0) {
      const { ruCandidates, smCandidates, otherCandidates } = splitCandidates(
        candidates, paletteKeySet, strugglingKeySet,
      );

      // Unmastered birds use target=count+5 so replacement fill lets them repeat naturally
      // to fill a round (e.g. 8 palette birds across 25 questions).
      // Mastered birds use target=pool size so no replacement fill — each mastered bird
      // appears at most once, preventing a single recently-mastered species from
      // crowding out all the review slots.
      const pickedRU    = pickFromPool(ruCandidates, count + 5);
      const pickedSM    = pickFromPool(smCandidates, smCandidates.length);
      const anchorSpecies = [...ruCandidates, ...smCandidates].map(c => c.species);
      const boostedOther  = birderLevel === 'advanced'
        ? applyAffinityBoosts(otherCandidates, anchorSpecies)
        : otherCandidates;
      const pickedOther = pickFromPool(boostedOther, boostedOther.length);
      console.log(`[quiz] RU: ${ruCandidates.length}, SM: ${smCandidates.length}, other: ${otherCandidates.length}, min: ${palettePlusStrugglingMin}/${count}`);
      picked = [...pickedRU, ...pickedSM, ...pickedOther];
    } else {
      picked = pickFromPool(candidates, count + 5);
    }

    // Pre-warm xeno-canto cache with limited concurrency to avoid 500 rate-limit errors.
    // On a warm cache this loop completes instantly (all cache hits).
    // On a cold start it serialises requests in small batches instead of firing ~40+ at once.
    const xcUnique = [...new Set(picked.map(c => c.species.sciName))];
    for (let i = 0; i < xcUnique.length; i += XC_FETCH_BATCH_SIZE) {
      await Promise.all(xcUnique.slice(i, i + XC_FETCH_BATCH_SIZE).map(n => getRecordings(n)));
    }

    const questions: QuizQuestion[] = await Promise.all(
      picked.map(async ({ species, type }, i) => {
        const masteryKey   = `${species.speciesCode}:${type}`;
        const masteryLevel = (masteryLevels as Record<string, number>)[masteryKey] ?? 0;

        // For order/family questions, distractors must come from a different order/family —
        // otherwise multiple answer options would be correct.
        const distractorPool = type === 'order'
          ? filteredPool.filter(s => s.tax?.order !== species.tax!.order)
          : (type === 'family' || type === 'family-latin')
            ? filteredPool.filter(s => s.tax?.familySciName !== species.tax!.familySciName)
            : filteredPool;

        const distractorSpecies = selectDistractors(species, distractorPool, masteryLevel, 3, paletteCodes, speciesFilterSet, introducedCodes);
        // Fill any gaps (e.g. not enough birds at this mastery tier) with random picks
        while (distractorSpecies.length < 3) {
          const fallback = pickRandom(
            distractorPool.filter(s =>
              s.speciesCode !== species.speciesCode &&
              !distractorSpecies.some(d => d.speciesCode === s.speciesCode)
            ),
            1,
          );
          if (fallback.length === 0) break;
          distractorSpecies.push(fallback[0]);
        }

        const isLatinAnswer = (type as string).endsWith('-latin');
        const isSongAnswer  = (type as string).endsWith('-song');
        const needsPhoto    = ['image', 'image-latin', 'image-song'].includes(type as string);

        // Shuffle all 4 option species together so correctAnswer position is random.
        // Fisher-Yates produces a uniform permutation; sort(() => Math.random() - 0.5)
        // is biased because V8's sort makes repeated comparisons per element, causing
        // the original first element (always the correct answer) to stay near index 0.
        const allOptionSpecies = [species, ...distractorSpecies];
        const shuffled = [...allOptionSpecies];
        for (let j = shuffled.length - 1; j > 0; j--) {
          const k = Math.floor(Math.random() * (j + 1));
          [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
        }
        const options      = shuffled.map(s => isLatinAnswer ? s.sciName : s.comName);
        const correctAnswer = isLatinAnswer ? species.sciName : species.comName;

        const q: QuizQuestion = {
          id: `${species.speciesCode}-${type}-${Date.now()}-${i}`,
          type,
          speciesCode: species.speciesCode,
          comName: species.comName,
          sciName: species.sciName,
          familyComName:  species.tax!.familyComName,
          familySciName:  species.tax!.familySciName,
          order:          species.tax!.order,
          orderComName:   species.tax!.orderComName,
          promptLatinName: (['family', 'family-latin', 'order'] as string[]).includes(type)
            ? masteryLevel >= 2 ? true : masteryLevel === 1 ? Math.random() < 0.5 : false
            : undefined,
          options,
          correctAnswer,
        };

        const [recordings, photoResult] = await Promise.all([
          getRecordings(species.sciName),
          needsPhoto
            ? getSpeciesPhotoUrl(species.speciesCode, species.comName, species.sciName, masteryLevels[`${species.speciesCode}:${type}`], blockedPhotoUrls)
            : Promise.resolve({ photo: null, noPhoto: false } as { photo: null; noPhoto: boolean }),
        ]);

        const availableRecordings = filterRecordings(recordings, bannedAudioSet);
        if (availableRecordings.length === 0 && ['song', 'song-latin'].includes(q.type as string)) {
          q.noAudio = true;
        }
        if (availableRecordings.length > 0) {
          // For sono questions prefer clips ≤ 10 s so the spectrogram is easy to read.
          // Fall back to all available recordings if none meet the threshold.
          const MAX_SONO_S = 10;
          const isSonoType = ['sono', 'sono-song'].includes(q.type as string);
          const candidateRecs = isSonoType
            ? (availableRecordings.filter(r => parseXCLength(r.length) <= MAX_SONO_S).length > 0
                ? availableRecordings.filter(r => parseXCLength(r.length) <= MAX_SONO_S)
                : availableRecordings)
            : availableRecordings;

          // Pick up to 3 paired tracks so the frontend can fall back if a URL fails.
          // Sono questions already filtered to short clips above; for audio questions use
          // weighted sampling (weight = 1/duration) so shorter clips are preferred while
          // variety is preserved — longer clips remain in the pool and can still be picked.
          const shuffledRecs = isSonoType
            ? [...candidateRecs].sort(() => Math.random() - 0.5).slice(0, 3)
            : weightedSampleByDuration(candidateRecs, 3);
          const toHttps = (u?: string) => {
            if (!u) return u;
            if (u.startsWith('//')) return `https:${u}`;
            if (u.startsWith('http://')) return `https://${u.slice(7)}`;
            return u;
          };
          q.audioUrl    = shuffledRecs[0].file;
          q.sonoUrl     = toHttps(shuffledRecs[0].sono?.med ?? shuffledRecs[0].sono?.small);
          const dur = parseXCLength(shuffledRecs[0].length);
          if (isFinite(dur)) q.audioDuration = dur;
          q.audioTracks = shuffledRecs.map(r => ({
            audioUrl: r.file,
            sonoUrl:  toHttps(r.sono?.med ?? r.sono?.small),
          }));
        }

        if (photoResult.photo) { q.imageUrl = photoResult.photo.url; q.imageCredit = photoResult.photo.credit; }
        if (photoResult.noPhoto) q.noPhoto = true;

        if (isSongAnswer) {
          const distractorRecs = await Promise.all(
            distractorSpecies.map(d => getRecordings(d.sciName))
          );
          const distractorAudioMap = new Map(
            distractorSpecies.map((d, j) => {
              const recs = filterRecordings(distractorRecs[j], bannedAudioSet);
              return [d.speciesCode, recs.length > 0 ? recs[Math.floor(Math.random() * recs.length)].file : ''];
            })
          );
          q.optionAudioUrls = shuffled.map(s =>
            s.speciesCode === species.speciesCode
              ? (q.audioUrl ?? '')
              : (distractorAudioMap.get(s.speciesCode) ?? '')
          );
        }

        return q;
      }),
    );

    const allValid = questions.filter(q => {
      const t = q.type as string;
      if (['song', 'song-latin'].includes(t) && !q.audioUrl && !q.noAudio) return false;
      if (['image', 'image-latin', 'image-song'].includes(t) && !q.imageUrl && !q.noPhoto) return false;
      if (['sono', 'sono-song'].includes(t) && !q.sonoUrl) return false;
      if (t.endsWith('-song') && (!q.optionAudioUrls || q.optionAudioUrls.length < 4 || q.optionAudioUrls.some(u => !u))) return false;
      return true;
    });

    let finalQuestions: QuizQuestion[];
    if (adaptiveMode && palettePlusStrugglingMin > 0) {
      const ruValidCount = allValid.filter(q => paletteKeySet.has(`${q.speciesCode}:${q.type}`)).length;
      const smValidCount = allValid.filter(q => strugglingKeySet.has(`${q.speciesCode}:${q.type}`)).length;
      console.log(`[quiz] allValid: ${allValid.length}, ruValid: ${ruValidCount}, smValid: ${smValidCount}, target: ${palettePlusStrugglingMin}/${count}`);
      finalQuestions = applyPaletteSMGuarantee(
        allValid, recentCodes, weightsMap, count, palettePlusStrugglingMin, paletteKeySet, strugglingKeySet,
      );
    } else {
      finalQuestions = allValid.slice(0, count);
    }

    res.json(finalQuestions);
  } catch (err: unknown) {
    const message  = err instanceof Error ? err.message : String(err);
    const axiosMsg = (err as { response?: { status: number; data: unknown } })?.response;
    console.error('Quiz error:', message, axiosMsg ? JSON.stringify(axiosMsg.data) : '');
    res.status(500).json({
      error: 'Failed to generate quiz questions',
      detail: message,
      ebirdResponse: axiosMsg ? { status: axiosMsg.status, data: axiosMsg.data } : undefined,
    });
  }
});

export default router;
