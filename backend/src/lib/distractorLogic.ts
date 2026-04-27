import type { PoolSpecies } from './candidateLogic';
import { PALETTE_DISTRACTOR_WEIGHT } from '@birdygurdy/shared';

export function pickRandom<T>(arr: T[], n: number): T[] {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
}

export function pickWithPalettePreference<T extends { speciesCode: string }>(
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

const ORDER_SIZE_CLASS: Record<string, number> = {
  Trochiliformes: 1,
  Apodiformes: 1,
  Passeriformes: 2,
  Piciformes: 3,
  Coraciiformes: 2,
  Cuculiformes: 3,
  Columbiformes: 3,
  Charadriiformes: 3,
  Strigiformes: 4,
  Falconiformes: 4,
  Galliformes: 3,
  Podicipediformes: 3,
  Gaviiformes: 4,
  Anseriformes: 4,
  Pelecaniformes: 4,
  Suliformes: 4,
  Accipitriformes: 4,
  Gruiformes: 4,
  Ciconiiformes: 5,
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

function similarOrAll(target: PoolSpecies, pool: PoolSpecies[], count: number): PoolSpecies[] {
  const sim = visuallySimilar(target, pool);
  return sim.length >= count ? sim : pool;
}

/**
 * Draw from each tier in order using pickWithPalettePreference until count is reached.
 * Already-picked birds are excluded from later tiers. Any remaining slots after all
 * tiers are exhausted are filled with pickRandom from finalFallback.
 */
function greedyFill(
  tiers: PoolSpecies[][],
  count: number,
  paletteCodes: Set<string>,
  finalFallback: PoolSpecies[],
): PoolSpecies[] {
  const picked: PoolSpecies[] = [];
  const usedCodes = new Set<string>();

  for (const tier of tiers) {
    if (picked.length >= count) break;
    const available = tier.filter(s => !usedCodes.has(s.speciesCode));
    const selection = pickWithPalettePreference(available, count - picked.length, paletteCodes);
    for (const s of selection) {
      picked.push(s);
      usedCodes.add(s.speciesCode);
    }
  }

  if (picked.length < count) {
    const available = finalFallback.filter(s => !usedCodes.has(s.speciesCode));
    picked.push(...pickRandom(available, count - picked.length));
  }

  return picked.slice(0, count);
}

/**
 * Core distractor selection logic shared by both modes. `introFirst` selects
 * between the two tier orderings for levels 1 and 2:
 *
 *   introFirst=true  (Mode 1): all introduced tiers exhausted before any unintroduced tier
 *   introFirst=false (Mode 2): intro+unintro interleaved within each taxonomic level
 *
 * Priority 1 (custom-selection override) and Level 0 are unaffected by the mode.
 */
function selectDistractorsImpl(
  target: PoolSpecies,
  pool: PoolSpecies[],
  masteryLevel: number,
  count: number,
  paletteCodes: Set<string>,
  speciesFilterSet: Set<string>,
  introducedCodes: Set<string>,
  introFirst: boolean,
): PoolSpecies[] {
  const others       = pool.filter(s => s.speciesCode !== target.speciesCode && s.tax);
  const targetGenus  = target.sciName.split(' ')[0];
  const targetFamily = target.tax!.familySciName;
  const targetOrder  = target.tax!.order;

  // ── Priority 1: custom-selection override ────────────────────────────────────
  if (speciesFilterSet.size > 0) {
    const selectedOthers = others.filter(s => speciesFilterSet.has(s.speciesCode));
    if (selectedOthers.length >= count) {
      const selSameFamily = selectedOthers.filter(s => s.tax!.familySciName === targetFamily);
      const selSameOrder  = selectedOthers.filter(s =>
        s.tax!.order === targetOrder && s.tax!.familySciName !== targetFamily,
      );
      const selRemaining  = selectedOthers.filter(s =>
        s.tax!.familySciName !== targetFamily && s.tax!.order !== targetOrder,
      );

      const picked: PoolSpecies[] = [];
      for (const tier of [selSameFamily, selSameOrder, selRemaining]) {
        if (picked.length >= count) break;
        const usedCodes = new Set(picked.map(s => s.speciesCode));
        const available = tier.filter(s => !usedCodes.has(s.speciesCode));
        picked.push(...pickWithPalettePreference(available, count - picked.length, paletteCodes));
      }
      if (picked.length >= count) return picked.slice(0, count);
    }
    // Selected pool too small — fall through to mastery-level logic with the full pool
  }

  // ── Priority 2: mastery-level taxonomy tiers ─────────────────────────────────
  if (masteryLevel <= 0) {
    // Level 0 (easy): different family. Use introduced-only subset if large enough.
    const diffFamily = others.filter(s => s.tax!.familySciName !== targetFamily);
    if (introducedCodes.size > 0) {
      const introDiffFam = diffFamily.filter(s => introducedCodes.has(s.speciesCode));
      if (introDiffFam.length >= count) {
        return pickWithPalettePreference(introDiffFam, count, paletteCodes);
      }
    }
    const candidates = diffFamily.length >= count ? diffFamily : similarOrAll(target, others, count);
    return pickWithPalettePreference(candidates, Math.min(count, candidates.length), paletteCodes);
  }

  const intro  = (s: PoolSpecies) =>  introducedCodes.has(s.speciesCode);
  const unint  = (s: PoolSpecies) => !introducedCodes.has(s.speciesCode);
  const samG   = (s: PoolSpecies) => s.sciName.split(' ')[0] === targetGenus;
  const diffG  = (s: PoolSpecies) => s.sciName.split(' ')[0] !== targetGenus;
  const samF   = (s: PoolSpecies) => s.tax!.familySciName === targetFamily;
  const samO   = (s: PoolSpecies) => s.tax!.order === targetOrder && s.tax!.familySciName !== targetFamily;

  const famDGI = others.filter(s => samF(s) && diffG(s) && intro(s));
  const famDGU = others.filter(s => samF(s) && diffG(s) && unint(s));
  const famI   = others.filter(s => samF(s) && intro(s));   // greedyFill dedupes against famDGI
  const famU   = others.filter(s => samF(s) && unint(s));   // greedyFill dedupes against famDGU
  const ordI   = others.filter(s => samO(s) && intro(s));
  const ordU   = others.filter(s => samO(s) && unint(s));

  if (masteryLevel === 1) {
    // Level 1 (medium): greedy fill through family and order tiers.
    // Mode 1 exhausts all intro tiers first; Mode 2 interleaves intro+unintro per level.
    const tiers = introFirst
      ? [famDGI, famI, ordI, famDGU, famU, ordU]
      : [famDGI, famDGU, famI, famU, ordI, ordU];
    return greedyFill(tiers, count, paletteCodes, similarOrAll(target, others, count));
  } else {
    // Level 2 (hard): greedy fill through genus, family, and order tiers.
    const genI = others.filter(s => samG(s) && intro(s));
    const genU = others.filter(s => samG(s) && unint(s));
    const tiers = introFirst
      ? [genI, famDGI, famI, ordI, genU, famDGU, famU, ordU]
      : [genI, genU, famDGI, famDGU, famI, famU, ordI, ordU];
    return greedyFill(tiers, count, paletteCodes, similarOrAll(target, others, count));
  }
}

/**
 * Selects `count` distractor species for a quiz question.
 *
 * Priority 1 — Custom-selection override:
 *   When speciesFilterSet is active and contains ≥ count other species, all
 *   distractors come from the selected pool: same-family selected first, then
 *   same-order (different family), then any remaining selected species.
 *   Falls through to mastery-level logic only when the selected pool is too small.
 *
 * Priority 2 — Mastery-level greedy fill:
 *   Each question randomly picks between two tier orderings:
 *   - Mode 1 (introduced-first): all intro tiers exhausted before any unintro tier
 *   - Mode 2 (relatedness-first): intro+unintro interleaved within each taxonomic level
 *   Within each tier, palette birds (10×) are preferred via pickWithPalettePreference.
 *   Final fallback uses pickRandom on similarOrAll.
 *
 *   Level 0 (easy)   → different family; introduced-only if ≥ count, else full tier
 *   Level 1 (medium) → family (diff-genus preferred) and order tiers
 *   Level 2 (hard)   → genus, family, and order tiers
 *
 * Use selectDistractorsMode1 / selectDistractorsMode2 for deterministic testing.
 */
export function selectDistractors(
  target: PoolSpecies,
  pool: PoolSpecies[],
  masteryLevel: number,
  count: number,
  paletteCodes: Set<string>,
  speciesFilterSet: Set<string> = new Set(),
  introducedCodes: Set<string> = new Set(),
): PoolSpecies[] {
  return selectDistractorsImpl(
    target, pool, masteryLevel, count, paletteCodes, speciesFilterSet, introducedCodes,
    Math.random() < 0.5,
  );
}

/** Mode 1 (introduced-first) — for deterministic testing. */
export function selectDistractorsMode1(
  target: PoolSpecies,
  pool: PoolSpecies[],
  masteryLevel: number,
  count: number,
  paletteCodes: Set<string>,
  speciesFilterSet: Set<string> = new Set(),
  introducedCodes: Set<string> = new Set(),
): PoolSpecies[] {
  return selectDistractorsImpl(
    target, pool, masteryLevel, count, paletteCodes, speciesFilterSet, introducedCodes, true,
  );
}

/** Mode 2 (relatedness-first) — for deterministic testing. */
export function selectDistractorsMode2(
  target: PoolSpecies,
  pool: PoolSpecies[],
  masteryLevel: number,
  count: number,
  paletteCodes: Set<string>,
  speciesFilterSet: Set<string> = new Set(),
  introducedCodes: Set<string> = new Set(),
): PoolSpecies[] {
  return selectDistractorsImpl(
    target, pool, masteryLevel, count, paletteCodes, speciesFilterSet, introducedCodes, false,
  );
}
