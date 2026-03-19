import { Router } from 'express';
import { getTaxonomy, getRegionalSpecies, getCommonSpeciesCodes, getBackyardSpeciesRanking, getSpeciesList } from '../services/ebird';
import { getRecordings } from '../services/xenocanto';
import { getSpeciesPhotoUrl } from '../services/macaulay';
import { BACKYARD_FAMILIES, GROUP_ORDERS } from '../constants';
import { buildCandidates, applyRecentUnmasteredGuarantee } from '../lib/candidateLogic';
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
  order?: string;
  audioUrl?: string;
  audioTracks?: { audioUrl: string; sonoUrl?: string }[];
  sonoUrl?: string;
  imageUrl?: string;
  imageCredit?: string;
  options: string[];
  optionAudioUrls?: string[];
  correctAnswer: string;
}


// ── Helpers ──────────────────────────────────────────────────────────────────

function pickRandom<T>(arr: T[], n: number): T[] {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
}

/** Weighted sampling without replacement. palette species are PALETTE_DISTRACTOR_WEIGHT× more likely. */
const PALETTE_DISTRACTOR_WEIGHT = 10;

function pickWithPalettePreference<T extends { speciesCode: string }>(
  arr: T[],
  n: number,
  paletteCodes: Set<string>,
): T[] {
  if (arr.length <= n) return [...arr];
  const result: T[]   = [];
  const remaining     = [...arr];
  while (result.length < n && remaining.length > 0) {
    const weights = remaining.map(s =>
      paletteCodes.has(s.speciesCode) ? PALETTE_DISTRACTOR_WEIGHT : 1,
    );
    const total = weights.reduce((a, b) => a + b, 0);
    let rand = Math.random() * total;
    let idx  = 0;
    for (let i = 0; i < weights.length; i++) {
      rand -= weights[i];
      if (rand <= 0) { idx = i; break; }
    }
    result.push(remaining.splice(idx, 1)[0]);
  }
  return result;
}

// ── Visual-similarity helpers (fallback when taxonomy tiers are exhausted) ──

/**
 * Rough size class by taxonomic order (1 = tiny, 5 = very large).
 * Used to avoid mixing, e.g., hummingbirds with geese as distractors.
 */
const ORDER_SIZE_CLASS: Record<string, number> = {
  'Trochiliformes': 1,
  'Apodiformes': 1,
  'Passeriformes': 2,
  'Piciformes': 3,
  'Coraciiformes': 2,
  'Cuculiformes': 3,
  'Columbiformes': 3,
  'Charadriiformes': 3,
  'Strigiformes': 4,
  'Falconiformes': 4,
  'Galliformes': 3,
  'Podicipediformes': 3,
  'Gaviiformes': 4,
  'Anseriformes': 4,
  'Pelecaniformes': 4,
  'Suliformes': 4,
  'Accipitriformes': 4,
  'Gruiformes': 4,
  'Ciconiiformes': 5,
};

const COLOR_TERMS = [
  'red', 'blue', 'yellow', 'green', 'orange', 'purple',
  'black', 'white', 'gray', 'grey', 'brown', 'rufous',
  'chestnut', 'golden', 'tawny', 'indigo', 'scarlet',
  'olive', 'rosy', 'azure', 'crimson', 'violet',
];

function sizeClass(order: string): number {
  return ORDER_SIZE_CLASS[order] ?? 3;
}

function colorTermsOf(comName: string): string[] {
  const lower = comName.toLowerCase();
  return COLOR_TERMS.filter(t => lower.includes(t));
}

/**
 * Returns pool species that are visually similar to the target:
 *   - within ±1 size class (order-based)
 *   - if the target's name contains colour terms, prefers species sharing at least one
 * Used as a fallback tier before resorting to fully random distractors.
 */
function visuallySimilar(target: PoolSpecies, candidates: PoolSpecies[]): PoolSpecies[] {
  const targetSize   = sizeClass(target.tax!.order);
  const targetColors = colorTermsOf(target.comName);

  return candidates.filter(s => {
    if (Math.abs(sizeClass(s.tax!.order) - targetSize) > 1) return false;
    if (targetColors.length === 0) return true;
    const sc = colorTermsOf(s.comName);
    return sc.length === 0 || sc.some(c => targetColors.includes(c));
  });
}

/** Best fallback set: visually-similar subset of `pool` if large enough, else full `pool`. */
function similarOrAll(target: PoolSpecies, pool: PoolSpecies[], count: number): PoolSpecies[] {
  const sim = visuallySimilar(target, pool);
  return sim.length >= count ? sim : pool;
}

// PoolSpecies and Candidate are imported from ../lib/candidateLogic

function pickFromPool(pool: Candidate[], target: number): Candidate[] {
  const picked: Candidate[] = [];
  const remaining = [...pool];
  while (picked.length < target && remaining.length > 0) {
    const total = remaining.reduce((s, c) => s + c.weight, 0);
    let rand = Math.random() * total;
    let idx  = 0;
    for (let i = 0; i < remaining.length; i++) {
      rand -= remaining[i].weight;
      if (rand <= 0) { idx = i; break; }
    }
    picked.push(remaining.splice(idx, 1)[0]);
  }
  // Fill with replacement when pool is smaller than target
  if (picked.length < target && pool.length > 0) {
    while (picked.length < target) {
      const total = pool.reduce((s, c) => s + c.weight, 0);
      let rand = Math.random() * total;
      let idx  = 0;
      for (let i = 0; i < pool.length; i++) {
        rand -= pool[i].weight;
        if (rand <= 0) { idx = i; break; }
      }
      picked.push(pool[idx]);
    }
  }
  return picked;
}

/**
 * Select distractor common names scaled to the player's mastery level for this bird:
 *   0 = easy   → different family entirely
 *   1 = medium → same family, different genus
 *   2 = hard   → same genus (falls back to same family if too few)
 *
 * Within each tier, palette birds are preferred as distractors (reinforces active learning).
 */
function selectDistractors(
  target: PoolSpecies,
  pool: PoolSpecies[],
  masteryLevel: number,
  count: number,
  paletteCodes: Set<string>,
): PoolSpecies[] {
  const others = pool.filter(s => s.speciesCode !== target.speciesCode && s.tax);
  const targetGenus  = target.sciName.split(' ')[0];
  const targetFamily = target.tax!.familySciName;

  let candidates: PoolSpecies[];

  if (masteryLevel <= 0) {
    // Level 0: pick from a completely different family
    const diffFamily = others.filter(s => s.tax!.familySciName !== targetFamily);
    candidates = diffFamily.length >= count ? diffFamily : similarOrAll(target, others, count);

  } else if (masteryLevel === 1) {
    // Level 1: same family, different genus preferred
    const sameFamDiffGenus = others.filter(
      s => s.tax!.familySciName === targetFamily && s.sciName.split(' ')[0] !== targetGenus,
    );
    if (sameFamDiffGenus.length >= count) {
      candidates = sameFamDiffGenus;
    } else {
      const sameFamily = others.filter(s => s.tax!.familySciName === targetFamily);
      candidates = sameFamily.length >= count ? sameFamily : similarOrAll(target, others, count);
    }

  } else {
    // Level 2: same genus preferred (the "easily confused" tier)
    const sameGenus  = others.filter(s => s.sciName.split(' ')[0] === targetGenus);
    const sameFamily = others.filter(
      s => s.tax!.familySciName === targetFamily && s.sciName.split(' ')[0] !== targetGenus,
    );

    if (sameGenus.length >= count) {
      candidates = sameGenus;
    } else if (sameGenus.length > 0) {
      // Mix genus + family to fill the count
      const extra = pickRandom(sameFamily, count - sameGenus.length);
      const combined = [...sameGenus, ...extra];
      if (combined.length >= count) {
        candidates = combined;
      } else {
        const rest = others.filter(s => !combined.includes(s));
        candidates = [...combined, ...pickRandom(rest, count - combined.length)];
      }
    } else {
      // No same-genus birds available — fall back to same family
      candidates = sameFamily.length >= count ? sameFamily : similarOrAll(target, others, count);
    }
  }

  // Palette birds are 10× more likely to appear as distractors (weighted sampling)
  return pickWithPalettePreference(candidates, Math.min(count, candidates.length), paletteCodes);
}

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

// ── Route ────────────────────────────────────────────────────────────────────

// POST /api/quiz/questions
router.post('/questions', async (req, res) => {
  try {
    const {
      regionCode    = 'CA-ON-OT',
      count         = 10,
      types         = ['song', 'latin', 'family'],
      exclude              = [],
      weights              = {},
      groupId              = 'all',
      masteryLevels        = {},
      banned               = [],
      paletteSpeciesCodes  = [],
      back                 = 30,
      level0SpeciesCodes   = [],
      historyKeys          = [],
    } = req.body;

    const paletteCodes = new Set<string>(paletteSpeciesCodes as string[]);

    const [observations, taxonomy, backyardCodes, top100Codes, historicalCodes] = await Promise.all([
      getRegionalSpecies(regionCode, back),
      getTaxonomy(),
      getBackyardSpeciesRanking(regionCode),
      getCommonSpeciesCodes(regionCode),
      getSpeciesList(regionCode),
    ]);

    // Use backyard (private location) ranking as primary; fall back to top100 if too sparse
    const commonCodes = backyardCodes.length >= 10 ? backyardCodes : top100Codes;

    const taxMap = new Map(taxonomy.map(t => [t.speciesCode, t]));

    const excludeSet = new Set<string>([...exclude, ...banned]);
    const seen       = new Set<string>();

    const pool = observations
      .filter(obs =>
        !excludeSet.has(obs.speciesCode) &&
        !seen.has(obs.speciesCode) &&
        (seen.add(obs.speciesCode), true),
      )
      .map(obs => ({ ...obs, tax: taxMap.get(obs.speciesCode) }))
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
      .filter(code => !recentCodes.has(code) && taxMap.has(code))
      .map(code => {
        const tax = taxMap.get(code)!;
        return {
          speciesCode: code,
          comName: tax.comName,
          sciName: tax.sciName,
          tax: { familySciName: tax.familySciName, familyComName: tax.familyComName, order: tax.order },
        } as PoolSpecies;
      })
      .filter(s => groupOrders.length === 0 || groupOrders.includes(s.tax!.order));
    // Historical extras supplement the distractor pool only — not question subjects.
    // This prevents extinct/rare historical species (e.g. Passenger Pigeon) from
    // appearing as correct answers while still providing taxonomic variety for distractors.
    filteredPool  = [...filteredPool,  ...historicalExtras];

    const adaptiveMode = Object.keys(weights as object).length > 0;
    const weightsMap = weights as Record<string, number>;

    const level0Codes   = new Set<string>(level0SpeciesCodes as string[]);
    const historyKeySet = new Set<string>(historyKeys as string[]);

    const candidates: Candidate[] = buildCandidates(
      questionPool, filteredPool, recentCodes, weightsMap, types as QuestionType[], adaptiveMode, level0Codes,
    );

    const recentUnmasteredMin = adaptiveMode ? Math.ceil(count * 0.67) : 0;

    let picked: Candidate[];
    if (adaptiveMode && recentUnmasteredMin > 0) {
      const isUnmastered = (c: Candidate) =>
        recentCodes.has(c.species.speciesCode) && c.weight >= 5 &&
        !historyKeySet.has(`${c.species.speciesCode}:${c.type}`);
      const isStruggling = (c: Candidate) =>
        recentCodes.has(c.species.speciesCode) && c.weight >= 5 &&
        historyKeySet.has(`${c.species.speciesCode}:${c.type}`);

      const ruCandidates    = candidates.filter(isUnmastered);
      const smCandidates    = candidates.filter(isStruggling);
      const otherCandidates = candidates.filter(c => !isUnmastered(c) && !isStruggling(c));

      const pickedRU    = pickFromPool(ruCandidates,    ruCandidates.length);
      const pickedSM    = pickFromPool(smCandidates,    smCandidates.length);
      const pickedOther = pickFromPool(otherCandidates, count + 5);
      console.log(`[quiz] RU: ${ruCandidates.length}, SM: ${smCandidates.length}, other: ${otherCandidates.length}, min: ${recentUnmasteredMin}/${count}`);
      picked = [...pickedRU, ...pickedSM, ...pickedOther];
    } else {
      picked = pickFromPool(candidates, count + 5);
    }

    // Pre-warm xeno-canto cache with limited concurrency to avoid 500 rate-limit errors.
    // On a warm cache this loop completes instantly (all cache hits).
    // On a cold start it serialises requests in small batches instead of firing ~40+ at once.
    const xcUnique = [...new Set(picked.map(c => c.species.sciName))];
    const XC_BATCH = 6;
    for (let i = 0; i < xcUnique.length; i += XC_BATCH) {
      await Promise.all(xcUnique.slice(i, i + XC_BATCH).map(n => getRecordings(n)));
    }

    const questions: QuizQuestion[] = await Promise.all(
      picked.map(async ({ species, type }, i) => {
        const masteryKey   = `${species.speciesCode}:${type}`;
        const masteryLevel = (masteryLevels as Record<string, number>)[masteryKey] ?? 0;

        const distractorSpecies = selectDistractors(species, filteredPool, masteryLevel, 3, paletteCodes);
        // Fill any gaps (e.g. not enough birds at this mastery tier) with random picks
        while (distractorSpecies.length < 3) {
          const fallback = pickRandom(
            filteredPool.filter(s =>
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

        // Shuffle all 4 option species together so correctAnswer position is random
        const allOptionSpecies = [species, ...distractorSpecies];
        const shuffled = [...allOptionSpecies].sort(() => Math.random() - 0.5);
        const options      = shuffled.map(s => isLatinAnswer ? s.sciName : s.comName);
        const correctAnswer = isLatinAnswer ? species.sciName : species.comName;

        const q: QuizQuestion = {
          id: `${species.speciesCode}-${type}-${Date.now()}-${i}`,
          type,
          speciesCode: species.speciesCode,
          comName: species.comName,
          sciName: species.sciName,
          familyComName: species.tax!.familyComName,
          order: species.tax!.order,
          options,
          correctAnswer,
        };

        const [recordings, photoUrl] = await Promise.all([
          getRecordings(species.sciName),
          needsPhoto ? getSpeciesPhotoUrl(species.speciesCode, species.comName, species.sciName, masteryLevels[`${species.speciesCode}:${type}`]) : Promise.resolve(null),
        ]);

        if (recordings.length > 0) {
          // Shuffle and take up to 3 paired tracks so the frontend can fall back if a URL fails.
          // Each track keeps its audio and spectrogram together to avoid a mismatch on fallback.
          const shuffledRecs = [...recordings].sort(() => Math.random() - 0.5).slice(0, 3);
          q.audioUrl    = shuffledRecs[0].file;
          q.sonoUrl     = shuffledRecs[0].sono?.med ?? shuffledRecs[0].sono?.small;
          q.audioTracks = shuffledRecs.map(r => ({
            audioUrl: r.file,
            sonoUrl:  r.sono?.med ?? r.sono?.small,
          }));
        }

        if (photoUrl) { q.imageUrl = photoUrl.url; q.imageCredit = photoUrl.credit; }

        if (isSongAnswer) {
          const distractorRecs = await Promise.all(
            distractorSpecies.map(d => getRecordings(d.sciName))
          );
          const distractorAudioMap = new Map(
            distractorSpecies.map((d, j) => {
              const recs = distractorRecs[j];
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
      if (['song', 'song-latin'].includes(t) && !q.audioUrl) return false;
      if (['image', 'image-latin', 'image-song'].includes(t) && !q.imageUrl) return false;
      if (['sono', 'sono-song'].includes(t) && !q.sonoUrl) return false;
      if (t.endsWith('-song') && (!q.optionAudioUrls || q.optionAudioUrls.length < 4 || q.optionAudioUrls.some(u => !u))) return false;
      return true;
    });

    let finalQuestions: QuizQuestion[];
    if (adaptiveMode && recentUnmasteredMin > 0) {
      const ruValidCount = allValid.filter(q => {
        const k = `${q.speciesCode}:${q.type}`;
        const wt = (weightsMap[k] ?? 20);
        const np = (recentCodes.has(q.speciesCode) && wt >= 5) || level0Codes.has(q.speciesCode);
        return np && !historyKeySet.has(k);
      }).length;
      const smValidCount = allValid.filter(q => {
        const k = `${q.speciesCode}:${q.type}`;
        const wt = (weightsMap[k] ?? 20);
        const np = recentCodes.has(q.speciesCode) && wt >= 5;
        return np && historyKeySet.has(k);
      }).length;
      console.log(`[quiz] allValid: ${allValid.length}, ruValid: ${ruValidCount}, smValid: ${smValidCount}, target: ${recentUnmasteredMin}/${count}`);
      finalQuestions = applyRecentUnmasteredGuarantee(
        allValid, recentCodes, weightsMap, count, recentUnmasteredMin, level0Codes, historyKeySet,
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
