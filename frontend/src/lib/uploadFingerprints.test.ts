import { describe, it, expect } from 'vitest';
import { stableStringify, fingerprint, fingerprintAll, selectChanged, withoutKeys } from './uploadFingerprints';

interface Row { key: string; correct: number; notes?: string }
const keyOf = (r: Row) => r.key;

describe('stableStringify', () => {
  it('ignores key order and undefined values', () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }], u: undefined }))
      .toBe(stableStringify({ a: [1, { c: 3, d: 2 }], b: 1 }));
  });

  it('distinguishes different values and types', () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: '1' }));
    expect(stableStringify({ a: null })).not.toBe(stableStringify({}));
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });
});

describe('fingerprint', () => {
  it('is the same for equal data and differs when a field changes', () => {
    expect(fingerprint({ key: 'x', correct: 1 })).toBe(fingerprint({ correct: 1, key: 'x' }));
    expect(fingerprint({ key: 'x', correct: 1 })).not.toBe(fingerprint({ key: 'x', correct: 2 }));
  });
});

describe('selectChanged', () => {
  const a: Row = { key: 'a', correct: 1 };
  const b: Row = { key: 'b', correct: 2 };

  it('treats everything as changed when nothing was uploaded before', () => {
    const { changed, next } = selectChanged([a, b], keyOf, {});
    expect(changed).toEqual([a, b]);
    expect(Object.keys(next).sort()).toEqual(['a', 'b']);
  });

  it('returns nothing when no item changed since the last upload', () => {
    const previous = fingerprintAll([a, b], keyOf);
    const { changed, next } = selectChanged([a, b], keyOf, previous);
    expect(changed).toEqual([]);
    expect(next).toEqual(previous);
  });

  it('returns only new and modified items', () => {
    const previous = fingerprintAll([a, b], keyOf);
    const b2 = { ...b, correct: 3 };
    const c: Row = { key: 'c', correct: 0 };
    expect(selectChanged([a, b2, c], keyOf, previous).changed).toEqual([b2, c]);
  });

  it('notices a field being added or removed', () => {
    const previous = fingerprintAll([a], keyOf);
    expect(selectChanged([{ ...a, notes: 'hi' }], keyOf, previous).changed).toHaveLength(1);
    const withNotes = fingerprintAll([{ ...a, notes: 'hi' }], keyOf);
    expect(selectChanged([a], keyOf, withNotes).changed).toEqual([a]);
  });

  it('drops fingerprints of items that no longer exist locally', () => {
    const previous = fingerprintAll([a, b], keyOf);
    expect(Object.keys(selectChanged([a], keyOf, previous).next)).toEqual(['a']);
  });
});

describe('withoutKeys', () => {
  it('removes the given keys without mutating the input, so a re-created row uploads again', () => {
    const a: Row = { key: 'a', correct: 1 };
    const previous = fingerprintAll([a, { key: 'b', correct: 2 }], keyOf);
    const after = withoutKeys(previous, ['a', 'missing']);
    expect(Object.keys(after)).toEqual(['b']);
    expect(Object.keys(previous).sort()).toEqual(['a', 'b']);
    expect(selectChanged([a], keyOf, after).changed).toEqual([a]);
  });
});
