import { describe, it, expect } from 'vitest';
import {
  slotFreshness, mergePhotos, planSlotWrite, sourcesAllKnown, buildPhotoSet, rowsToSlots,
  SLOT_TTL_MS, EMPTY_SLOT_TTL_MS, type StoredSlot, type SlotPhoto,
} from './photoSlots';

const photo = (url: string, imageKey?: string): SlotPhoto => ({ url, ...(imageKey ? { imageKey } : {}) });
const slot = (photos: SlotPhoto[], checkedAt: number): StoredSlot => ({ photos, checkedAt });
const NOW = 1_000_000_000_000;

describe('slotFreshness', () => {
  it('is missing when there is no slot', () => {
    expect(slotFreshness(undefined, NOW)).toBe('missing');
  });

  it('keeps a slot with photos fresh for 7 days', () => {
    expect(slotFreshness(slot([photo('a')], NOW - SLOT_TTL_MS + 1000), NOW)).toBe('fresh');
    expect(slotFreshness(slot([photo('a')], NOW - SLOT_TTL_MS - 1000), NOW)).toBe('stale');
  });

  it('re-checks an empty slot after 24 hours', () => {
    expect(slotFreshness(slot([], NOW - EMPTY_SLOT_TTL_MS + 1000), NOW)).toBe('fresh');
    expect(slotFreshness(slot([], NOW - EMPTY_SLOT_TTL_MS - 1000), NOW)).toBe('stale');
  });
});

describe('mergePhotos', () => {
  it('appends genuinely new photos after the existing ones', () => {
    expect(mergePhotos([photo('a')], [photo('b')]).map(p => p.url)).toEqual(['a', 'b']);
  });

  it('never removes existing photos when the incoming list is empty or different', () => {
    expect(mergePhotos([photo('a'), photo('b')], []).map(p => p.url)).toEqual(['a', 'b']);
    expect(mergePhotos([photo('a'), photo('b')], [photo('c')]).map(p => p.url)).toEqual(['a', 'b', 'c']);
  });

  it('does not duplicate a photo already present, and keeps the existing copy', () => {
    const merged = mergePhotos([photo('a', 'k1')], [photo('a2', 'k1')]);
    expect(merged).toHaveLength(1);
    expect(merged[0].url).toBe('a');
  });

  it('treats the same imageKey as the same photo even when the url differs', () => {
    expect(mergePhotos([photo('thumb-300', 'Foo.jpg')], [photo('thumb-800', 'Foo.jpg')])).toHaveLength(1);
  });

  it('falls back to url identity when there is no imageKey', () => {
    expect(mergePhotos([photo('a')], [photo('a')])).toHaveLength(1);
  });

  it('drops duplicates within the incoming list', () => {
    expect(mergePhotos([], [photo('a'), photo('a')])).toHaveLength(1);
  });
});

describe('planSlotWrite', () => {
  it('saves new photos found for a source we had never asked', () => {
    const plan = planSlotWrite(undefined, 'ok', [photo('a')]);
    expect(plan).toEqual({ action: 'save', photos: [photo('a')] });
  });

  it('records a confirmed-empty result for a source we had never asked', () => {
    expect(planSlotWrite(undefined, 'ok', [])).toEqual({ action: 'save', photos: [] });
  });

  it('merges new photos into an existing slot', () => {
    const plan = planSlotWrite(slot([photo('a')], 0), 'ok', [photo('b')]);
    expect(plan).toEqual({ action: 'save', photos: [photo('a'), photo('b')] });
  });

  it('only touches the slot when a refresh finds nothing new', () => {
    expect(planSlotWrite(slot([photo('a')], 0), 'ok', [photo('a')])).toEqual({ action: 'touch' });
  });

  it('keeps existing photos, and only touches, when a refresh comes back empty', () => {
    expect(planSlotWrite(slot([photo('a')], 0), 'ok', [])).toEqual({ action: 'touch' });
  });

  it('resets the expiry of a slot that has photos when the refresh fails', () => {
    expect(planSlotWrite(slot([photo('a')], 0), 'unknown')).toEqual({ action: 'touch' });
  });

  it('writes nothing when a failed lookup has no stored photos to protect', () => {
    expect(planSlotWrite(undefined, 'unknown')).toEqual({ action: 'none' });
    expect(planSlotWrite(slot([], 0), 'unknown')).toEqual({ action: 'none' });
  });

  it('writes nothing for a blocked source', () => {
    expect(planSlotWrite(undefined, 'blocked')).toEqual({ action: 'none' });
    expect(planSlotWrite(slot([photo('a')], 0), 'blocked')).toEqual({ action: 'none' });
  });
});

describe('sourcesAllKnown', () => {
  it('is true when every source answered, has a slot, or is blocked/skipped', () => {
    expect(sourcesAllKnown([
      { hasSlot: false, state: 'blocked' },
      { hasSlot: false, state: 'ok' },
      { hasSlot: true,  state: 'skipped' },
    ])).toBe(true);
  });

  it('is false when a source failed and has no stored slot', () => {
    expect(sourcesAllKnown([{ hasSlot: false, state: 'unknown' }, { hasSlot: true, state: 'ok' }])).toBe(false);
  });

  it('is true when a refresh failed but a stored slot exists', () => {
    expect(sourcesAllKnown([{ hasSlot: true, state: 'unknown' }])).toBe(true);
  });
});

describe('buildPhotoSet', () => {
  it('uses the first iNaturalist photo as primary', () => {
    const set = buildPhotoSet({ inat: [photo('i1')], wiki: [photo('w1')], macaulay: [photo('m1')] });
    expect(set.primary?.url).toBe('i1');
    expect(set.optional.map(p => p.url)).toEqual(['m1', 'w1']);
  });

  it('appends extra iNaturalist photos to optional', () => {
    const set = buildPhotoSet({ inat: [photo('i1'), photo('i2')], wiki: [], macaulay: [] });
    expect(set.optional.map(p => p.url)).toEqual(['i2']);
  });

  it('has no primary when iNaturalist has nothing', () => {
    const set = buildPhotoSet({ inat: [], wiki: [photo('w1')], macaulay: [] });
    expect(set.primary).toBeNull();
    expect(set.optional).toHaveLength(1);
  });
});

describe('rowsToSlots', () => {
  it('parses valid rows', () => {
    const slots = rowsToSlots([
      { source: 'inat', photos: [{ url: 'a' }], checked_at: '2026-01-01T00:00:00Z' },
      { source: 'wiki', photos: [], checked_at: '2026-01-02T00:00:00Z' },
    ]);
    expect(slots.get('inat')?.photos).toEqual([{ url: 'a' }]);
    expect(slots.get('inat')?.checkedAt).toBe(Date.parse('2026-01-01T00:00:00Z'));
    expect(slots.get('wiki')?.photos).toEqual([]);
  });

  it('ignores unknown sources and malformed rows', () => {
    const slots = rowsToSlots([
      { source: 'flickr', photos: [], checked_at: '2026-01-01T00:00:00Z' },
      { source: 'inat', photos: 'nope', checked_at: '2026-01-01T00:00:00Z' },
      { source: 'wiki', photos: [], checked_at: 'not-a-date' },
    ]);
    expect(slots.size).toBe(0);
  });

  it('drops photo entries that have no url', () => {
    const slots = rowsToSlots([{ source: 'inat', photos: [{ url: 'a' }, { nope: 1 }, null], checked_at: '2026-01-01T00:00:00Z' }]);
    expect(slots.get('inat')?.photos).toEqual([{ url: 'a' }]);
  });
});
