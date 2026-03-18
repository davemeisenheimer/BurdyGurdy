import { describe, it, expect } from 'vitest';
import { filterObservationsToKnownSpecies } from './speciesFilter';

type Obs = { speciesCode: string; comName: string };

function makeTaxMap(codes: string[]): Map<string, unknown> {
  return new Map(codes.map(c => [c, { speciesCode: c }]));
}

describe('filterObservationsToKnownSpecies', () => {
  it('passes through observations whose speciesCode is in taxMap', () => {
    const obs: Obs[] = [{ speciesCode: 'amero', comName: 'American Robin' }];
    const taxMap = makeTaxMap(['amero']);
    expect(filterObservationsToKnownSpecies(obs, taxMap)).toHaveLength(1);
  });

  it('excludes hybrids (not in taxMap)', () => {
    const obs: Obs[] = [
      { speciesCode: 'snogo x cangoo', comName: 'Snow Goose x Canada Goose' },
      { speciesCode: 'amero', comName: 'American Robin' },
    ];
    const taxMap = makeTaxMap(['amero']); // hybrid not in taxMap
    const result = filterObservationsToKnownSpecies(obs, taxMap);
    expect(result).toHaveLength(1);
    expect(result[0].speciesCode).toBe('amero');
  });

  it('excludes slash entries (not in taxMap)', () => {
    const obs: Obs[] = [
      { speciesCode: 'purfin/commur', comName: 'Purple Finch/Common Redpoll' },
      { speciesCode: 'amero', comName: 'American Robin' },
    ];
    const taxMap = makeTaxMap(['amero']);
    const result = filterObservationsToKnownSpecies(obs, taxMap);
    expect(result).toHaveLength(1);
    expect(result[0].speciesCode).toBe('amero');
  });

  it('deduplicates repeated observations of the same species', () => {
    const obs: Obs[] = [
      { speciesCode: 'amero', comName: 'American Robin' },
      { speciesCode: 'amero', comName: 'American Robin' },
      { speciesCode: 'amero', comName: 'American Robin' },
    ];
    const taxMap = makeTaxMap(['amero']);
    expect(filterObservationsToKnownSpecies(obs, taxMap)).toHaveLength(1);
  });

  it('deduplication and hybrid filtering work together', () => {
    const obs: Obs[] = [
      { speciesCode: 'snogo x cangoo', comName: 'Hybrid' },
      { speciesCode: 'amero', comName: 'Robin' },
      { speciesCode: 'amero', comName: 'Robin duplicate' },
      { speciesCode: 'mallar', comName: 'Mallard' },
      { speciesCode: 'snogo x cangoo', comName: 'Hybrid duplicate' },
    ];
    const taxMap = makeTaxMap(['amero', 'mallar']);
    const result = filterObservationsToKnownSpecies(obs, taxMap);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.speciesCode)).toEqual(['amero', 'mallar']);
  });

  it('returns empty array when all observations are hybrids', () => {
    const obs: Obs[] = [
      { speciesCode: 'hybrid1', comName: 'Hybrid 1' },
      { speciesCode: 'hybrid2', comName: 'Hybrid 2' },
    ];
    const taxMap = makeTaxMap(['amero']); // none of the obs are in taxMap
    expect(filterObservationsToKnownSpecies(obs, taxMap)).toHaveLength(0);
  });

  it('returns empty array for empty observations', () => {
    expect(filterObservationsToKnownSpecies([], makeTaxMap(['amero']))).toHaveLength(0);
  });

  it('preserves original order of first occurrences', () => {
    const obs: Obs[] = [
      { speciesCode: 'mallar', comName: 'Mallard' },
      { speciesCode: 'amero', comName: 'Robin' },
      { speciesCode: 'bkcchi', comName: 'Chickadee' },
    ];
    const taxMap = makeTaxMap(['mallar', 'amero', 'bkcchi']);
    const result = filterObservationsToKnownSpecies(obs, taxMap);
    expect(result.map(r => r.speciesCode)).toEqual(['mallar', 'amero', 'bkcchi']);
  });

  it('works with extra fields on observations (generic T)', () => {
    const obs = [
      { speciesCode: 'amero', comName: 'Robin', count: 3, lat: 45.1 },
    ];
    const taxMap = makeTaxMap(['amero']);
    const result = filterObservationsToKnownSpecies(obs, taxMap);
    expect(result[0]).toMatchObject({ speciesCode: 'amero', count: 3, lat: 45.1 });
  });
});
