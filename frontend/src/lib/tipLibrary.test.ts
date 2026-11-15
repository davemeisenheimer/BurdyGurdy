import { describe, it, expect } from 'vitest';
import {
  filterTipEntries, buildTaxonomicGroups, buildAlphabetical, sortNewest, lastChanged, tipEntryKey,
  type TipLibraryEntry,
} from './tipLibrary';

const HAWKS = { familyComName: 'Hawks, Eagles, and Kites', familySciName: 'Accipitridae' };
const WOODPECKERS = { familyComName: 'Woodpeckers', familySciName: 'Picidae' };

function entry(over: Partial<TipLibraryEntry>): TipLibraryEntry {
  return {
    speciesCode: 'coohaw', guessKey: 'sharp-shinned hawk', photoUrl: 'https://a/1.jpg',
    comName: "Cooper's Hawk", sciName: 'Astur cooperii', guess: 'Sharp-shinned Hawk',
    tip: 'Rounded tail.', model: 'claude-haiku-5-5', createdAt: '2026-11-10T00:00:00Z', editedAt: null,
    reportCount: 0, ...HAWKS, taxonIndex: 20, ...over,
  };
}

const coohaw   = entry({});
const coohaw2  = entry({ guessKey: 'northern goshawk', guess: 'Northern Goshawk', createdAt: '2026-11-12T00:00:00Z', editedAt: '2026-11-14T00:00:00Z', reportCount: 2 });
const shshaw   = entry({ speciesCode: 'shshaw', comName: 'Sharp-shinned Hawk', sciName: 'Accipiter striatus', guessKey: "cooper's hawk", guess: "Cooper's Hawk", taxonIndex: 19, createdAt: '2026-11-11T00:00:00Z' });
const dowwoo   = entry({ speciesCode: 'dowwoo', comName: 'Downy Woodpecker', sciName: 'Dryobates pubescens', guessKey: 'hairy woodpecker', guess: 'Hairy Woodpecker', ...WOODPECKERS, taxonIndex: 50, createdAt: '2026-11-13T00:00:00Z' });
const mystery  = entry({ speciesCode: 'xxx', comName: 'Aardvark Bird', sciName: 'X y', guessKey: 'zebra bird', guess: 'Zebra Bird', familyComName: null, familySciName: null, taxonIndex: null });
const all = [dowwoo, coohaw, mystery, coohaw2, shshaw];

describe('filterTipEntries', () => {
  it('matches the correct bird by common or scientific name, case-insensitively', () => {
    expect(filterTipEntries(all, 'downy', 'all')).toEqual([dowwoo]);
    expect(filterTipEntries(all, 'ASTUR', 'all')).toEqual([coohaw, coohaw2]);
  });

  it('also matches the guessed bird', () => {
    expect(filterTipEntries(all, 'sharp-shinned', 'all')).toEqual([coohaw, shshaw]);
  });

  it('applies the AI / edited / reported filters', () => {
    expect(filterTipEntries(all, '', 'edited')).toEqual([coohaw2]);
    expect(filterTipEntries(all, '', 'ai')).not.toContain(coohaw2);
    expect(filterTipEntries(all, '', 'ai')).toHaveLength(4);
    expect(filterTipEntries(all, '', 'reported')).toEqual([coohaw2]);
  });

  it('returns everything for a blank search and "all"', () => {
    expect(filterTipEntries(all, '   ', 'all')).toEqual(all);
  });
});

describe('buildTaxonomicGroups', () => {
  it('orders families and species taxonomically, with unknown family last', () => {
    const groups = buildTaxonomicGroups(all);
    expect(groups.map(g => g.familySciName)).toEqual(['Accipitridae', 'Picidae', null]);
    expect(groups[0].species.map(s => s.speciesCode)).toEqual(['shshaw', 'coohaw']);
    expect(groups[0].tipCount).toBe(3);
  });

  it('lists each species\' tips most recently changed first', () => {
    const coop = buildTaxonomicGroups(all)[0].species[1];
    expect(coop.tips).toEqual([coohaw2, coohaw]);
  });

  it('returns no groups for no tips', () => {
    expect(buildTaxonomicGroups([])).toEqual([]);
  });
});

describe('buildAlphabetical', () => {
  it('sorts species by common name', () => {
    expect(buildAlphabetical(all).map(s => s.comName))
      .toEqual(['Aardvark Bird', "Cooper's Hawk", 'Downy Woodpecker', 'Sharp-shinned Hawk']);
  });
});

describe('sortNewest', () => {
  it('sorts tips by last change (edit beats creation) without mutating the input', () => {
    const before = [...all];
    expect(sortNewest(all).map(tipEntryKey)[0]).toBe(tipEntryKey(coohaw2));
    expect(sortNewest(all)[1]).toBe(dowwoo);
    expect(all).toEqual(before);
  });
});

describe('lastChanged', () => {
  it('uses the edit time when later than creation', () => {
    expect(lastChanged(coohaw2)).toBe('2026-11-14T00:00:00Z');
    expect(lastChanged(coohaw)).toBe('2026-11-10T00:00:00Z');
  });
});
