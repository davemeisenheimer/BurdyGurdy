import { describe, it, expect } from 'vitest';
import { selectDistractors, selectDistractorsMode1, selectDistractorsMode2 } from './distractorLogic';
import type { PoolSpecies } from './candidateLogic';

// ── Helpers ───────────────────────────────────────────────────────────────────

function sp(
  code: string,
  genus: string,
  family: string,
  order = 'Passeriformes',
): PoolSpecies {
  return {
    speciesCode: code,
    comName: code,
    sciName: `${genus} ${code}`,
    tax: { familySciName: family, familyComName: family, order },
  };
}

const NO_PALETTE = new Set<string>();
const NO_FILTER  = new Set<string>();
const NO_INTRO   = new Set<string>();

// ── Regression: level 0 (easy) ────────────────────────────────────────────────

describe('selectDistractors – level 0 (easy)', () => {
  it('all distractors come from a different family than the target', () => {
    const target = sp('target', 'Setophaga', 'Parulidae');
    const pool   = [
      target,
      sp('samefam', 'Geothlypis',  'Parulidae'),
      sp('other1',  'Cardinalis',   'Cardinalidae'),
      sp('other2',  'Melospiza',    'Passerellidae'),
      sp('other3',  'Turdus',       'Turdidae'),
    ];
    const result = selectDistractors(target, pool, 0, 3, NO_PALETTE);
    expect(result.every(s => s.tax!.familySciName !== 'Parulidae')).toBe(true);
    expect(result).toHaveLength(3);
  });

  it('target is never included in distractors', () => {
    const target = sp('target', 'Setophaga', 'Parulidae');
    const pool   = [target, sp('a', 'Cardinalis', 'Cardinalidae'), sp('b', 'Melospiza', 'Passerellidae'), sp('c', 'Turdus', 'Turdidae')];
    const result = selectDistractors(target, pool, 0, 3, NO_PALETTE);
    expect(result.some(s => s.speciesCode === 'target')).toBe(false);
  });

  it('falls back to similarOrAll when fewer than count different-family birds exist', () => {
    const target = sp('target', 'Setophaga', 'Parulidae');
    // Only 1 different-family bird — not enough for count=3
    const pool   = [target, sp('samefam', 'Geothlypis', 'Parulidae'), sp('other1', 'Cardinalis', 'Cardinalidae')];
    const result = selectDistractors(target, pool, 0, 3, NO_PALETTE);
    // Falls back to all others — should still return as many as possible
    expect(result.length).toBeGreaterThan(0);
  });
});

// ── Regression: level 1 (medium) ─────────────────────────────────────────────

describe('selectDistractors – level 1 (medium)', () => {
  it('prefers same-family birds as distractors', () => {
    const target = sp('target', 'Setophaga', 'Parulidae');
    const pool   = [
      target,
      sp('fam1', 'Geothlypis',  'Parulidae'),
      sp('fam2', 'Mniotilta',   'Parulidae'),
      sp('fam3', 'Vermivora',   'Parulidae'),
      sp('diff', 'Cardinalis',  'Cardinalidae'),
    ];
    const result = selectDistractors(target, pool, 1, 3, NO_PALETTE);
    expect(result.every(s => s.tax!.familySciName === 'Parulidae')).toBe(true);
    expect(result).toHaveLength(3);
  });

  it('prefers different genus within the family', () => {
    const target = sp('target', 'Setophaga', 'Parulidae');
    const pool   = [
      target,
      sp('samegenus', 'Setophaga', 'Parulidae'), // same genus — less preferred
      sp('dg1',       'Geothlypis', 'Parulidae'),
      sp('dg2',       'Mniotilta',  'Parulidae'),
      sp('dg3',       'Vermivora',  'Parulidae'),
    ];
    // Run many times — diff-genus birds should always win when there are 3 of them
    for (let i = 0; i < 20; i++) {
      const result = selectDistractors(target, pool, 1, 3, NO_PALETTE);
      expect(result.every(s => s.sciName.split(' ')[0] !== 'Setophaga')).toBe(true);
    }
  });

  it('falls back to all same-family birds when diff-genus < count', () => {
    const target = sp('target', 'Setophaga', 'Parulidae');
    const pool   = [
      target,
      sp('dg1',  'Geothlypis', 'Parulidae'),   // diff genus (1 bird only)
      sp('sg1',  'Setophaga',  'Parulidae'),
      sp('sg2',  'Setophaga',  'Parulidae'),
      sp('diff', 'Cardinalis', 'Cardinalidae'),
    ];
    const result = selectDistractors(target, pool, 1, 3, NO_PALETTE);
    // Can't fill 3 from diff-genus only — falls back to all same-family
    expect(result.every(s => s.tax!.familySciName === 'Parulidae')).toBe(true);
    expect(result).toHaveLength(3);
  });
});

// ── Regression: level 2 (hard) ───────────────────────────────────────────────

describe('selectDistractors – level 2 (hard)', () => {
  it('uses same-genus birds when ≥ count available', () => {
    const target = sp('target', 'Setophaga', 'Parulidae');
    const pool   = [
      target,
      sp('sg1',  'Setophaga',  'Parulidae'),
      sp('sg2',  'Setophaga',  'Parulidae'),
      sp('sg3',  'Setophaga',  'Parulidae'),
      sp('fam',  'Geothlypis', 'Parulidae'),
      sp('diff', 'Cardinalis', 'Cardinalidae'),
    ];
    const result = selectDistractors(target, pool, 2, 3, NO_PALETTE);
    expect(result.every(s => s.sciName.startsWith('Setophaga'))).toBe(true);
    expect(result).toHaveLength(3);
  });

  it('mixes genus + family when genus has 1-2 birds', () => {
    const target = sp('target', 'Setophaga', 'Parulidae');
    const pool   = [
      target,
      sp('sg1',  'Setophaga',  'Parulidae'), // 1 same-genus bird
      sp('fam1', 'Geothlypis', 'Parulidae'),
      sp('fam2', 'Mniotilta',  'Parulidae'),
      sp('diff', 'Cardinalis', 'Cardinalidae'),
    ];
    const result = selectDistractors(target, pool, 2, 3, NO_PALETTE);
    expect(result).toHaveLength(3);
    const genusCount = result.filter(s => s.sciName.startsWith('Setophaga')).length;
    expect(genusCount).toBeGreaterThanOrEqual(1);
    expect(result.every(s => s.tax!.familySciName === 'Parulidae')).toBe(true);
  });

  it('falls back to same family when no same-genus birds exist', () => {
    const target = sp('target', 'Setophaga', 'Parulidae');
    const pool   = [
      target,
      sp('fam1', 'Geothlypis', 'Parulidae'),
      sp('fam2', 'Mniotilta',  'Parulidae'),
      sp('fam3', 'Vermivora',  'Parulidae'),
      sp('diff', 'Cardinalis', 'Cardinalidae'),
    ];
    const result = selectDistractors(target, pool, 2, 3, NO_PALETTE);
    expect(result.every(s => s.tax!.familySciName === 'Parulidae')).toBe(true);
    expect(result).toHaveLength(3);
  });
});

// ── Regression: palette preference ───────────────────────────────────────────

describe('selectDistractors – palette preference', () => {
  it('palette bird is strongly preferred over non-palette within the same pool (level 2)', () => {
    const target   = sp('target',  'Setophaga', 'Parulidae');
    const palette  = sp('palette', 'Setophaga', 'Parulidae');
    const others   = ['sg1','sg2','sg3'].map(c => sp(c, 'Setophaga', 'Parulidae'));
    const pool     = [target, palette, ...others];
    const paletteCodes = new Set(['palette']);

    // With 10× weight on the palette bird vs 1× for the 3 others, it should
    // appear in nearly every pick. Over 100 runs it must appear > 80 times.
    let paletteCount = 0;
    for (let i = 0; i < 100; i++) {
      const result = selectDistractors(target, pool, 2, 3, paletteCodes);
      if (result.some(s => s.speciesCode === 'palette')) paletteCount++;
    }
    expect(paletteCount).toBeGreaterThan(80);
  });
});

// ── New behaviour: custom-selection override (problem 1) ──────────────────────

describe('selectDistractors – custom-selection override', () => {
  it('all distractors come from the selected pool when ≥ count selected birds exist', () => {
    const target = sp('target', 'Setophaga',  'Parulidae');
    const pool   = [
      target,
      sp('sel1',     'Geothlypis', 'Parulidae'),    // selected
      sp('sel2',     'Mniotilta',  'Parulidae'),    // selected
      sp('sel3',     'Vermivora',  'Parulidae'),    // selected
      sp('nonsel',   'Cardinalis', 'Cardinalidae'), // NOT selected
    ];
    const speciesFilterSet = new Set(['target', 'sel1', 'sel2', 'sel3']);
    const result = selectDistractors(target, pool, 0, 3, NO_PALETTE, speciesFilterSet);
    expect(result.every(s => speciesFilterSet.has(s.speciesCode))).toBe(true);
    expect(result.some(s => s.speciesCode === 'nonsel')).toBe(false);
    expect(result).toHaveLength(3);
  });

  it('fills same-family selected birds first, then same-order to reach count', () => {
    // 2 selected birds in same family + 1 in same order, different family
    const target   = sp('target',   'Setophaga', 'Parulidae',    'Passeriformes');
    const famA     = sp('famA',     'Geothlypis','Parulidae',    'Passeriformes');
    const famB     = sp('famB',     'Mniotilta', 'Parulidae',    'Passeriformes');
    const orderBird = sp('ordbird', 'Melospiza', 'Passerellidae','Passeriformes');
    const nonSel   = sp('nonsel',   'Cardinalis','Cardinalidae', 'Passeriformes');
    const pool = [target, famA, famB, orderBird, nonSel];
    const speciesFilterSet = new Set(['target', 'famA', 'famB', 'ordbird']);

    const result = selectDistractors(target, pool, 0, 3, NO_PALETTE, speciesFilterSet);
    expect(result.some(s => s.speciesCode === 'famA')).toBe(true);
    expect(result.some(s => s.speciesCode === 'famB')).toBe(true);
    expect(result.some(s => s.speciesCode === 'ordbird')).toBe(true);
    expect(result.some(s => s.speciesCode === 'nonsel')).toBe(false);
  });

  it('falls back to mastery-level logic when selected pool has fewer than count birds', () => {
    const target = sp('target', 'Setophaga', 'Parulidae');
    const pool   = [
      target,
      sp('sel1',  'Geothlypis', 'Parulidae'),  // selected (only 1 other)
      sp('fam1',  'Mniotilta',  'Parulidae'),
      sp('fam2',  'Vermivora',  'Parulidae'),
      sp('diff',  'Cardinalis', 'Cardinalidae'),
    ];
    const speciesFilterSet = new Set(['target', 'sel1']); // only 1 other selected

    // Falls back to level 1: should use same-family distractors
    const result = selectDistractors(target, pool, 1, 3, NO_PALETTE, speciesFilterSet);
    expect(result).toHaveLength(3);
    expect(result.every(s => s.tax!.familySciName === 'Parulidae')).toBe(true);
  });

  it('empty speciesFilterSet causes no change — regression guard', () => {
    const target = sp('target', 'Setophaga', 'Parulidae');
    const pool   = [
      target,
      sp('sg1', 'Setophaga', 'Parulidae'),
      sp('sg2', 'Setophaga', 'Parulidae'),
      sp('sg3', 'Setophaga', 'Parulidae'),
    ];
    const result = selectDistractors(target, pool, 2, 3, NO_PALETTE, NO_FILTER);
    expect(result).toHaveLength(3);
    expect(result.every(s => s.sciName.startsWith('Setophaga'))).toBe(true);
  });
});

// ── New behaviour: introduced-codes preference (problem 2) ───────────────────

describe('selectDistractors – introduced-codes preference', () => {
  it('level 0: uses introduced-only pool when ≥ count introduced different-family birds exist', () => {
    const target = sp('target', 'Setophaga', 'Parulidae');
    const pool   = [
      target,
      sp('intro1',   'Cardinalis', 'Cardinalidae'),
      sp('intro2',   'Melospiza',  'Passerellidae'),
      sp('intro3',   'Turdus',     'Turdidae'),
      sp('unintro',  'Myiarchus',  'Tyrannidae'), // different family, NOT introduced
    ];
    const introducedCodes = new Set(['target', 'intro1', 'intro2', 'intro3']);
    const result = selectDistractors(target, pool, 0, 3, NO_PALETTE, NO_FILTER, introducedCodes);
    expect(result.every(s => introducedCodes.has(s.speciesCode))).toBe(true);
    expect(result.some(s => s.speciesCode === 'unintro')).toBe(false);
  });

  it('level 0: falls back to full different-family pool when fewer than count introduced', () => {
    const target = sp('target',  'Setophaga', 'Parulidae');
    const pool   = [
      target,
      sp('intro1',  'Cardinalis', 'Cardinalidae'), // only 1 introduced different-family
      sp('unint1',  'Melospiza',  'Passerellidae'),
      sp('unint2',  'Turdus',     'Turdidae'),
    ];
    const introducedCodes = new Set(['target', 'intro1']);
    const result = selectDistractors(target, pool, 0, 3, NO_PALETTE, NO_FILTER, introducedCodes);
    expect(result).toHaveLength(3);
    expect(result.every(s => s.tax!.familySciName !== 'Parulidae')).toBe(true);
    // Must include the unintroduced birds to fill count
    expect(result.some(s => !introducedCodes.has(s.speciesCode))).toBe(true);
  });

  it('level 1: exhausts introduced same-family birds before drawing unintroduced ones', () => {
    const target = sp('target',  'Setophaga', 'Parulidae');
    const pool   = [
      target,
      sp('intro1',  'Geothlypis', 'Parulidae'),  // introduced, diff genus
      sp('intro2',  'Mniotilta',  'Parulidae'),  // introduced, diff genus
      sp('unintro', 'Vermivora',  'Parulidae'),  // NOT introduced, diff genus
      sp('diff',    'Cardinalis', 'Cardinalidae'),
    ];
    // 2 introduced same-family birds, need 3 → uses both introduced + 1 unintroduced
    const introducedCodes = new Set(['target', 'intro1', 'intro2']);
    const result = selectDistractors(target, pool, 1, 3, NO_PALETTE, NO_FILTER, introducedCodes);
    expect(result).toHaveLength(3);
    expect(result.some(s => s.speciesCode === 'intro1')).toBe(true);
    expect(result.some(s => s.speciesCode === 'intro2')).toBe(true);
    expect(result.some(s => s.speciesCode === 'unintro')).toBe(true);
    expect(result.some(s => s.speciesCode === 'diff')).toBe(false);
  });

  it('level 1: stays within introduced pool when ≥ count introduced same-family birds available', () => {
    const target = sp('target',  'Setophaga', 'Parulidae');
    const pool   = [
      target,
      sp('intro1',  'Geothlypis', 'Parulidae'),
      sp('intro2',  'Mniotilta',  'Parulidae'),
      sp('intro3',  'Vermivora',  'Parulidae'),
      sp('unintro', 'Leiothlypis','Parulidae'),  // NOT introduced
      sp('diff',    'Cardinalis', 'Cardinalidae'),
    ];
    const introducedCodes = new Set(['target', 'intro1', 'intro2', 'intro3']);
    const result = selectDistractors(target, pool, 1, 3, NO_PALETTE, NO_FILTER, introducedCodes);
    expect(result.every(s => introducedCodes.has(s.speciesCode))).toBe(true);
    expect(result.some(s => s.speciesCode === 'unintro')).toBe(false);
  });

  it('level 2: exhausts introduced same-genus birds before drawing unintroduced genus birds', () => {
    const target = sp('target',  'Setophaga', 'Parulidae');
    const pool   = [
      target,
      sp('intro1',  'Setophaga', 'Parulidae'), // introduced, same genus
      sp('intro2',  'Setophaga', 'Parulidae'), // introduced, same genus
      sp('unintro', 'Setophaga', 'Parulidae'), // NOT introduced, same genus
      sp('fam',     'Geothlypis','Parulidae'),
    ];
    // 2 introduced genus birds, need 3 → uses both + 1 unintroduced genus bird
    const introducedCodes = new Set(['target', 'intro1', 'intro2']);
    const result = selectDistractors(target, pool, 2, 3, NO_PALETTE, NO_FILTER, introducedCodes);
    expect(result).toHaveLength(3);
    expect(result.some(s => s.speciesCode === 'intro1')).toBe(true);
    expect(result.some(s => s.speciesCode === 'intro2')).toBe(true);
    expect(result.some(s => s.speciesCode === 'unintro')).toBe(true);
    expect(result.some(s => s.speciesCode === 'fam')).toBe(false);
  });

  it('level 2: stays within introduced genus when ≥ count introduced genus birds available', () => {
    const target = sp('target',  'Setophaga', 'Parulidae');
    const pool   = [
      target,
      sp('intro1',  'Setophaga', 'Parulidae'),
      sp('intro2',  'Setophaga', 'Parulidae'),
      sp('intro3',  'Setophaga', 'Parulidae'),
      sp('unintro', 'Setophaga', 'Parulidae'), // NOT introduced
    ];
    const introducedCodes = new Set(['target', 'intro1', 'intro2', 'intro3']);
    const result = selectDistractors(target, pool, 2, 3, NO_PALETTE, NO_FILTER, introducedCodes);
    expect(result.every(s => introducedCodes.has(s.speciesCode))).toBe(true);
    expect(result.some(s => s.speciesCode === 'unintro')).toBe(false);
  });

  it('empty introducedCodes causes no change to level 1 behaviour — regression guard', () => {
    const target = sp('target', 'Setophaga', 'Parulidae');
    const pool   = [
      target,
      sp('fam1', 'Geothlypis', 'Parulidae'),
      sp('fam2', 'Mniotilta',  'Parulidae'),
      sp('fam3', 'Vermivora',  'Parulidae'),
    ];
    const result = selectDistractors(target, pool, 1, 3, NO_PALETTE, NO_FILTER, NO_INTRO);
    expect(result).toHaveLength(3);
    expect(result.every(s => s.tax!.familySciName === 'Parulidae')).toBe(true);
  });

  it('level 1: uses same-order birds before similarOrAll when family pool < count', () => {
    // 1 same-family bird + 2 same-order diff-family birds + 1 different-order bird.
    // Family pool (1) < count (3) → order tier fills remaining 2 slots. Different-order bird never reached.
    const target = sp('target', 'Setophaga',  'Parulidae',     'Passeriformes');
    const pool   = [
      target,
      sp('fam1', 'Geothlypis',  'Parulidae',     'Passeriformes'), // same family
      sp('ord1', 'Melospiza',   'Passerellidae', 'Passeriformes'), // same order, diff family
      sp('ord2', 'Leiothlypis', 'Passerellidae', 'Passeriformes'), // same order, diff family
      sp('out',  'Actitis',     'Scolopacidae',  'Charadriiformes'), // different order
    ];
    for (let i = 0; i < 20; i++) {
      const result = selectDistractors(target, pool, 1, 3, NO_PALETTE, NO_FILTER, NO_INTRO);
      expect(result).toHaveLength(3);
      expect(result.some(s => s.speciesCode === 'fam1')).toBe(true);
      expect(result.some(s => s.speciesCode === 'out')).toBe(false);
    }
  });

  it('level 1 mode 1: prefers introduced same-order over unintroduced same-family when family partially exhausted', () => {
    // 1 intro fam-dg, 2 unintro fam-dg, 2 intro order. Need 3.
    // Mode 1: famDGIntro(ifam,1) → orderIntro(iord1+iord2, 2) = 3. Unintro fam never reached.
    const target = sp('target', 'Setophaga', 'Parulidae',     'Passeriformes');
    const pool   = [
      target,
      sp('ifam',  'Geothlypis', 'Parulidae',     'Passeriformes'), // intro, diff-genus, same-fam
      sp('ufam1', 'Mniotilta',  'Parulidae',     'Passeriformes'), // unintro, same-fam
      sp('ufam2', 'Vermivora',  'Parulidae',     'Passeriformes'), // unintro, same-fam
      sp('iord1', 'Melospiza',  'Passerellidae', 'Passeriformes'), // intro, same-order
      sp('iord2', 'Pipilo',     'Passerellidae', 'Passeriformes'), // intro, same-order
    ];
    const introducedCodes = new Set(['target', 'ifam', 'iord1', 'iord2']);
    for (let i = 0; i < 20; i++) {
      const result = selectDistractorsMode1(target, pool, 1, 3, NO_PALETTE, NO_FILTER, introducedCodes);
      expect(result.some(s => s.speciesCode === 'ifam')).toBe(true);
      expect(result.some(s => s.speciesCode === 'iord1' || s.speciesCode === 'iord2')).toBe(true);
      expect(result.every(s => s.speciesCode !== 'ufam1' && s.speciesCode !== 'ufam2')).toBe(true);
    }
  });

  it('level 1 mode 2: prefers unintroduced same-family over introduced same-order when family partially exhausted', () => {
    // Same pool as mode 1 test above.
    // Mode 2: famDGIntro(ifam,1) → famDGUnintro(ufam1+ufam2, 2) = 3. Intro order never reached.
    const target = sp('target', 'Setophaga', 'Parulidae',     'Passeriformes');
    const pool   = [
      target,
      sp('ifam',  'Geothlypis', 'Parulidae',     'Passeriformes'),
      sp('ufam1', 'Mniotilta',  'Parulidae',     'Passeriformes'),
      sp('ufam2', 'Vermivora',  'Parulidae',     'Passeriformes'),
      sp('iord1', 'Melospiza',  'Passerellidae', 'Passeriformes'),
      sp('iord2', 'Pipilo',     'Passerellidae', 'Passeriformes'),
    ];
    const introducedCodes = new Set(['target', 'ifam', 'iord1', 'iord2']);
    for (let i = 0; i < 20; i++) {
      const result = selectDistractorsMode2(target, pool, 1, 3, NO_PALETTE, NO_FILTER, introducedCodes);
      expect(result.some(s => s.speciesCode === 'ifam')).toBe(true);
      expect(result.some(s => s.speciesCode === 'ufam1' || s.speciesCode === 'ufam2')).toBe(true);
      expect(result.every(s => s.speciesCode !== 'iord1' && s.speciesCode !== 'iord2')).toBe(true);
    }
  });

  it('level 1: palette birds are preferred within the same-order tier', () => {
    // Family pool (1 bird) < count (3) → order tier fills remaining 2 slots.
    // Order tier has 2 palette + 1 non-palette birds (all unintroduced, so both modes behave the same).
    // The 10× palette weight should cause non-palette to be left out most of the time.
    const target = sp('target', 'Setophaga',  'Parulidae',     'Passeriformes');
    const pool   = [
      target,
      sp('fam1',   'Geothlypis', 'Parulidae',     'Passeriformes'), // same family (1 bird)
      sp('pal1',   'Melospiza',  'Passerellidae', 'Passeriformes'), // same order, palette
      sp('pal2',   'Pipilo',     'Passerellidae', 'Passeriformes'), // same order, palette
      sp('nonpal', 'Leiothlypis','Passerellidae', 'Passeriformes'), // same order, non-palette
    ];
    const paletteCodes = new Set(['pal1', 'pal2']);

    let bothPalettePicked = 0;
    for (let i = 0; i < 100; i++) {
      const result = selectDistractors(target, pool, 1, 3, paletteCodes, NO_FILTER, NO_INTRO);
      if (result.some(s => s.speciesCode === 'pal1') && result.some(s => s.speciesCode === 'pal2')) {
        bothPalettePicked++;
      }
    }
    // P(nonpal wins a slot against pal1+pal2 at 10× each) ≈ 1/21 per pick — both palette birds
    // should appear together in the vast majority of runs.
    expect(bothPalettePicked).toBeGreaterThan(80);
  });

  it('level 2: uses same-order birds before similarOrAll when genus and family pool < count', () => {
    // No same-genus birds. 1 same-family bird + 2 same-order diff-family + 1 different-order.
    // Family pool (1) < count (3) → order tier fills remaining 2 slots. Different-order bird never reached.
    const target = sp('target', 'Setophaga',  'Parulidae',     'Passeriformes');
    const pool   = [
      target,
      sp('fam1', 'Geothlypis',  'Parulidae',     'Passeriformes'), // same family (no same-genus)
      sp('ord1', 'Melospiza',   'Passerellidae', 'Passeriformes'), // same order, diff family
      sp('ord2', 'Leiothlypis', 'Passerellidae', 'Passeriformes'), // same order, diff family
      sp('out',  'Actitis',     'Scolopacidae',  'Charadriiformes'), // different order
    ];
    for (let i = 0; i < 20; i++) {
      const result = selectDistractors(target, pool, 2, 3, NO_PALETTE, NO_FILTER, NO_INTRO);
      expect(result).toHaveLength(3);
      expect(result.some(s => s.speciesCode === 'fam1')).toBe(true);
      expect(result.some(s => s.speciesCode === 'out')).toBe(false);
    }
  });

  it('level 2 mode 1: prefers introduced same-order over unintroduced same-family when genus and family partially exhausted', () => {
    // 1 intro same-genus, 2 unintro same-family (diff genus), 2 intro same-order. Need 3.
    // Mode 1: genusIntro(igen,1) → famDGIntro(empty) → famIntro(empty) → orderIntro(iord1+iord2, 2) = 3.
    const target = sp('target', 'Setophaga', 'Parulidae',     'Passeriformes');
    const pool   = [
      target,
      sp('igen',  'Setophaga',  'Parulidae',     'Passeriformes'), // intro, same-genus
      sp('ufam1', 'Geothlypis', 'Parulidae',     'Passeriformes'), // unintro, diff-genus, same-fam
      sp('ufam2', 'Mniotilta',  'Parulidae',     'Passeriformes'), // unintro, diff-genus, same-fam
      sp('iord1', 'Melospiza',  'Passerellidae', 'Passeriformes'), // intro, same-order
      sp('iord2', 'Pipilo',     'Passerellidae', 'Passeriformes'), // intro, same-order
    ];
    const introducedCodes = new Set(['target', 'igen', 'iord1', 'iord2']);
    for (let i = 0; i < 20; i++) {
      const result = selectDistractorsMode1(target, pool, 2, 3, NO_PALETTE, NO_FILTER, introducedCodes);
      expect(result.some(s => s.speciesCode === 'igen')).toBe(true);
      expect(result.some(s => s.speciesCode === 'iord1' || s.speciesCode === 'iord2')).toBe(true);
      expect(result.every(s => s.speciesCode !== 'ufam1' && s.speciesCode !== 'ufam2')).toBe(true);
    }
  });

  it('level 2 mode 2: prefers unintroduced same-family over introduced same-order when genus and family partially exhausted', () => {
    // Same pool as mode 1 test above.
    // Mode 2: genusIntro(igen,1) → genusUnintro(empty) → famDGIntro(empty) → famDGUnintro(ufam1+ufam2, 2) = 3.
    const target = sp('target', 'Setophaga', 'Parulidae',     'Passeriformes');
    const pool   = [
      target,
      sp('igen',  'Setophaga',  'Parulidae',     'Passeriformes'),
      sp('ufam1', 'Geothlypis', 'Parulidae',     'Passeriformes'),
      sp('ufam2', 'Mniotilta',  'Parulidae',     'Passeriformes'),
      sp('iord1', 'Melospiza',  'Passerellidae', 'Passeriformes'),
      sp('iord2', 'Pipilo',     'Passerellidae', 'Passeriformes'),
    ];
    const introducedCodes = new Set(['target', 'igen', 'iord1', 'iord2']);
    for (let i = 0; i < 20; i++) {
      const result = selectDistractorsMode2(target, pool, 2, 3, NO_PALETTE, NO_FILTER, introducedCodes);
      expect(result.some(s => s.speciesCode === 'igen')).toBe(true);
      expect(result.some(s => s.speciesCode === 'ufam1' || s.speciesCode === 'ufam2')).toBe(true);
      expect(result.every(s => s.speciesCode !== 'iord1' && s.speciesCode !== 'iord2')).toBe(true);
    }
  });

  it('level 1: introduced preference is still applied when sameFamily IS large enough — regression guard for fix', () => {
    // Ensure the fix does not accidentally remove introduced preference from the constrained path.
    const target = sp('target',  'Setophaga', 'Parulidae');
    const pool   = [
      target,
      sp('intro1', 'Geothlypis', 'Parulidae'), // introduced
      sp('intro2', 'Mniotilta',  'Parulidae'), // introduced
      sp('intro3', 'Vermivora',  'Parulidae'), // introduced
      sp('unintro','Leiothlypis','Parulidae'), // NOT introduced
    ];
    const introducedCodes = new Set(['target', 'intro1', 'intro2', 'intro3']);
    const result = selectDistractors(target, pool, 1, 3, NO_PALETTE, NO_FILTER, introducedCodes);
    expect(result.every(s => introducedCodes.has(s.speciesCode))).toBe(true);
    expect(result.some(s => s.speciesCode === 'unintro')).toBe(false);
  });

  it('level 2: introduced preference is still applied when sameFamily IS large enough — regression guard for fix', () => {
    const target = sp('target',  'Setophaga', 'Parulidae');
    const pool   = [
      target,
      sp('intro1', 'Geothlypis', 'Parulidae'),
      sp('intro2', 'Mniotilta',  'Parulidae'),
      sp('intro3', 'Vermivora',  'Parulidae'),
      sp('unintro','Leiothlypis','Parulidae'),
    ];
    const introducedCodes = new Set(['target', 'intro1', 'intro2', 'intro3']);
    const result = selectDistractors(target, pool, 2, 3, NO_PALETTE, NO_FILTER, introducedCodes);
    // sameGenus = 0, sameFamily = 4 >= count → pickPreferIntroduced on sameFamily
    expect(result.every(s => introducedCodes.has(s.speciesCode))).toBe(true);
    expect(result.some(s => s.speciesCode === 'unintro')).toBe(false);
  });

  it('empty introducedCodes causes no change to level 2 behaviour — regression guard', () => {
    const target = sp('target', 'Setophaga', 'Parulidae');
    const pool   = [
      target,
      sp('sg1', 'Setophaga', 'Parulidae'),
      sp('sg2', 'Setophaga', 'Parulidae'),
      sp('sg3', 'Setophaga', 'Parulidae'),
    ];
    const result = selectDistractors(target, pool, 2, 3, NO_PALETTE, NO_FILTER, NO_INTRO);
    expect(result).toHaveLength(3);
    expect(result.every(s => s.sciName.startsWith('Setophaga'))).toBe(true);
  });
});
