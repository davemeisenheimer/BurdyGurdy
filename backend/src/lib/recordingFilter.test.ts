import { describe, it, expect } from 'vitest';
import { filterRecordings } from './recordingFilter';
import type { XCRecording } from '../services/xenocanto';

function makeRec(file: string): XCRecording {
  return { id: file, gen: 'G', sp: 's', en: 'Bird', cnt: 'CA', loc: '', type: 'song', url: '', file, sono: { small: '', med: '' }, q: 'A' };
}

describe('filterRecordings', () => {
  it('returns all recordings when banned set is empty', () => {
    const recs = [makeRec('a.mp3'), makeRec('b.mp3')];
    expect(filterRecordings(recs, new Set())).toHaveLength(2);
  });

  it('excludes recordings whose file URL is banned', () => {
    const recs = [makeRec('a.mp3'), makeRec('b.mp3'), makeRec('c.mp3')];
    const result = filterRecordings(recs, new Set(['b.mp3']));
    expect(result.map(r => r.file)).toEqual(['a.mp3', 'c.mp3']);
  });

  it('returns empty array when all recordings are banned', () => {
    const recs = [makeRec('a.mp3'), makeRec('b.mp3')];
    const result = filterRecordings(recs, new Set(['a.mp3', 'b.mp3']));
    expect(result).toHaveLength(0);
  });

  it('returns original array reference when banned set is empty (fast path)', () => {
    const recs = [makeRec('a.mp3')];
    expect(filterRecordings(recs, new Set())).toBe(recs);
  });

  it('handles empty recordings array', () => {
    expect(filterRecordings([], new Set(['a.mp3']))).toHaveLength(0);
  });
});
