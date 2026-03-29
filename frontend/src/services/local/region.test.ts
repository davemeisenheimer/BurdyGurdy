import { describe, it, expect } from 'vitest';
import { buildSpeciesCache } from './region';
import type { BirdSpecies, PriorityGroup } from '../../types';

function species(code: string, priorityGroup: PriorityGroup, isHistorical = false): BirdSpecies {
  return { speciesCode: code, comName: code, sciName: code, familyComName: '', isHistorical, priorityGroup };
}

// The backend returns species pre-sorted into five promotion groups:
//   Group 0: recentCommon   — recent + backyard family
//   Group 1: recentUncommon — recent + non-backyard family
//   Group 2: regionCommon   — historical + backyard + in common ranking
//   Group 3: regionUncommon — historical + non-backyard
//   Group 4: rareUncommon   — historical + backyard + NOT in common ranking (rare visitors/vagrants)
//
// buildSpeciesCache must preserve all five groups and their order so the
// promotion queue correctly prioritises common birds before rare vagrants.

describe('buildSpeciesCache', () => {

  it('includes all five promotion groups', () => {
    const full = [
      species('G0', 'recentCommon'),
      species('G1', 'recentUncommon'),
      species('G2', 'regionCommon',   true),
      species('G3', 'regionUncommon', true),
      species('G4', 'rareUncommon',   true),
    ];
    const result = buildSpeciesCache(full);
    const codes = result.map(s => s.speciesCode);
    expect(codes).toContain('G0');
    expect(codes).toContain('G1');
    expect(codes).toContain('G2');
    expect(codes).toContain('G3');
    expect(codes).toContain('G4'); // regression: Group 3 was previously filtered out
  });

  it('preserves the backend sort order so promotion priority is correct', () => {
    const full = [
      species('G0', 'recentCommon'),
      species('G1', 'recentUncommon'),
      species('G2', 'regionCommon',   true),
      species('G3', 'regionUncommon', true),
      species('G4', 'rareUncommon',   true),
    ];
    const result = buildSpeciesCache(full);
    expect(result.map(s => s.speciesCode)).toEqual(['G0', 'G1', 'G2', 'G3', 'G4']);
  });

  it('preserves isHistorical for downstream promotion logic', () => {
    const full = [
      species('recent',     'recentCommon',  false),
      species('historical', 'regionCommon',  true),
    ];
    const result = buildSpeciesCache(full);
    expect(result.find(s => s.speciesCode === 'recent')?.isHistorical).toBe(false);
    expect(result.find(s => s.speciesCode === 'historical')?.isHistorical).toBe(true);
  });

  it('preserves priorityGroup so callers can distinguish rare vagrants', () => {
    const full = [
      species('vagrant',  'rareUncommon',  true),
      species('common',   'recentCommon',  false),
    ];
    const result = buildSpeciesCache(full);
    expect(result.find(s => s.speciesCode === 'vagrant')?.priorityGroup).toBe('rareUncommon');
    expect(result.find(s => s.speciesCode === 'common')?.priorityGroup).toBe('recentCommon');
  });

  it('returns an empty array for an empty input', () => {
    expect(buildSpeciesCache([])).toHaveLength(0);
  });

});
