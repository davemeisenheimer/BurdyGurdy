import { describe, it, expect } from 'vitest';
import {
  availableFieldIdActions, planFieldIdConfirm, planFieldIdUnconfirm, buildFieldIdMap, fieldIdKey,
  localIsoDate, isValidSightedOn, normalizeFieldIdDetails, fieldIdTooltip, locationTextAfterPick, paletteContextText,
} from './fieldIds';
import { GRADUATION_STREAK } from '../../lib/mastery';
import { HISTORY_WEIGHT } from '../../lib/adaptive';
import type { BirdProgress, FieldId } from '../../types';

// Powers the 🔭/🎤 "I've identified this bird in the wild" buttons on bird cards.

function baseRecord(overrides: Partial<BirdProgress> = {}): BirdProgress {
  return {
    speciesCode: 'yebsap', questionType: 'image', comName: 'Yellow-bellied Sapsucker',
    correct: 0, incorrect: 0, lastAsked: 1000, weight: HISTORY_WEIGHT,
    favourited: false, excluded: false, masteryLevel: 0, consecutiveCorrect: 0,
    ...overrides,
  };
}

function tick(overrides: Partial<FieldId> = {}): FieldId {
  return {
    speciesCode: 'yebsap', questionType: 'image', comName: 'Yellow-bellied Sapsucker',
    masteredByField: true, confirmedAt: 1000,
    ...overrides,
  };
}

const NAME = 'Yellow-bellied Sapsucker';
const DETAILS = { sightedOn: '2026-05-14' };

describe('availableFieldIdActions', () => {
  it('offers all three actions for a bird with no progress record', () => {
    expect(availableFieldIdActions(null)).toEqual(['record', 'palette', 'master']);
  });

  it('does not offer the palette for a bird that already has a record', () => {
    expect(availableFieldIdActions(baseRecord())).toEqual(['record', 'master']);
  });

  it('offers only "record" for an already-mastered bird', () => {
    expect(availableFieldIdActions(baseRecord({ isMastered: true }))).toEqual(['record']);
  });
});

describe('planFieldIdConfirm', () => {
  it('"record" stores the tick and leaves progress alone', () => {
    const plan = planFieldIdConfirm('yebsap', 'image', NAME, 'record', DETAILS, null, null, 5000);
    expect(plan).toEqual({
      fieldId: { speciesCode: 'yebsap', questionType: 'image', comName: NAME, masteredByField: false, confirmedAt: 5000, sightedOn: '2026-05-14' },
      progress: null,
      addToPalette: false,
    });
  });

  it('"palette" asks for a palette seed when no record exists', () => {
    const plan = planFieldIdConfirm('yebsap', 'image', NAME, 'palette', DETAILS, null, null, 5000);
    expect(plan.addToPalette).toBe(true);
    expect(plan.progress).toBeNull();
    expect(plan.fieldId.masteredByField).toBe(false);
  });

  it('"palette" does nothing to progress when a record already exists', () => {
    const plan = planFieldIdConfirm('yebsap', 'image', NAME, 'palette', DETAILS, baseRecord(), null, 5000);
    expect(plan.addToPalette).toBe(false);
    expect(plan.progress).toBeNull();
  });

  it('"master" creates a fresh mastered record when no record exists', () => {
    const plan = planFieldIdConfirm('yebsap', 'image', NAME, 'master', DETAILS, null, null, 5000);
    expect(plan.fieldId.masteredByField).toBe(true);
    expect(plan.progress).toMatchObject({
      speciesCode: 'yebsap', questionType: 'image', comName: NAME,
      correct: 0, incorrect: 0, lastAsked: 5000, isMastered: true, masteredAt: 5000,
    });
  });

  it('"master" inherits favourited/excluded from a sibling record when creating one', () => {
    const sibling = baseRecord({ questionType: 'song', favourited: true, excluded: true });
    const plan = planFieldIdConfirm('yebsap', 'image', NAME, 'master', DETAILS, null, sibling, 5000);
    expect(plan.progress).toMatchObject({ favourited: true, excluded: true });
  });

  it('"master" masters an existing record and keeps its quiz history', () => {
    const existing = baseRecord({ masteryLevel: 1, consecutiveCorrect: 1, correct: 7, incorrect: 2, favourited: true });
    const plan = planFieldIdConfirm('yebsap', 'image', NAME, 'master', DETAILS, existing, null, 9000);
    expect(plan.progress).toMatchObject({
      isMastered: true, masteredAt: 9000, lastAsked: 1000,
      masteryLevel: 1, consecutiveCorrect: 1, correct: 7, incorrect: 2, favourited: true,
    });
  });

  it('"master" stamps lastAsked on a never-asked palette record so it shows and syncs', () => {
    const existing = baseRecord({ lastAsked: 0 });
    const plan = planFieldIdConfirm('yebsap', 'image', NAME, 'master', DETAILS, existing, null, 9000);
    expect(plan.progress).toMatchObject({ lastAsked: 9000, isMastered: true });
  });

  it('"master" on an already-mastered record just records the tick', () => {
    const existing = baseRecord({ isMastered: true, masteredAt: 1234 });
    const plan = planFieldIdConfirm('yebsap', 'image', NAME, 'master', DETAILS, existing, null, 9000);
    expect(plan.progress).toBeNull();
    expect(plan.fieldId.masteredByField).toBe(false);
  });
});

describe('planFieldIdUnconfirm', () => {
  it('leaves progress alone when the tick did not master the bird', () => {
    const existing = baseRecord({ isMastered: true, masteredAt: 1234, correct: 5 });
    expect(planFieldIdUnconfirm(tick({ masteredByField: false }), existing)).toEqual({ kind: 'none' });
  });

  it('does nothing when there is no progress record', () => {
    expect(planFieldIdUnconfirm(tick(), null)).toEqual({ kind: 'none' });
  });

  it('deletes a tick-created record that has no quiz answers', () => {
    const existing = baseRecord({ isMastered: true, masteredAt: 1234, lastAsked: 1234 });
    expect(planFieldIdUnconfirm(tick(), existing)).toEqual({ kind: 'delete' });
  });

  it('un-masters a record with quiz answers, keeping the history', () => {
    const existing = baseRecord({ isMastered: true, masteredAt: 1234, correct: 3, incorrect: 1, masteryLevel: 1 });
    const plan = planFieldIdUnconfirm(tick(), existing);
    expect(plan.kind).toBe('put');
    if (plan.kind !== 'put') return;
    expect(plan.record).toMatchObject({ isMastered: false, masteredAt: undefined, correct: 3, incorrect: 1, masteryLevel: 1 });
  });

  it('keeps mastery when quiz performance independently earned it', () => {
    const existing = baseRecord({
      isMastered: true, masteredAt: 1234, correct: 9,
      masteryLevel: 2, consecutiveCorrect: GRADUATION_STREAK,
    });
    expect(planFieldIdUnconfirm(tick(), existing)).toEqual({ kind: 'none' });
  });

  it('keeps mastery when it was auto-mastered via noPhoto', () => {
    const existing = baseRecord({ isMastered: true, masteredAt: 1234, noPhoto: true });
    expect(planFieldIdUnconfirm(tick(), existing)).toEqual({ kind: 'none' });
  });

  it('keeps mastery when it was auto-mastered via noAudio', () => {
    const existing = baseRecord({ questionType: 'song', isMastered: true, masteredAt: 1234, noAudio: true });
    expect(planFieldIdUnconfirm(tick({ questionType: 'song' }), existing)).toEqual({ kind: 'none' });
  });

  it('does nothing when the record is no longer mastered', () => {
    const existing = baseRecord({ isMastered: false, correct: 2 });
    expect(planFieldIdUnconfirm(tick(), existing)).toEqual({ kind: 'none' });
  });
});

describe('buildFieldIdMap', () => {
  it('keys ticks by species and type', () => {
    const robin = tick({ speciesCode: 'amerob', questionType: 'song' });
    const map = buildFieldIdMap([tick(), robin]);
    expect(map.has(fieldIdKey('yebsap', 'image'))).toBe(true);
    expect(map.get(fieldIdKey('amerob', 'song'))).toBe(robin);
    expect(map.has(fieldIdKey('yebsap', 'song'))).toBe(false);
  });
});

// ── Sighting details ──────────────────────────────────────────────────────────

describe('planFieldIdConfirm sighting details', () => {
  it('stores the normalized sighting details on the tick', () => {
    const plan = planFieldIdConfirm('yebsap', 'image', NAME, 'record', {
      sightedOn: '2026-05-14', locationName: '  Mud Lake  ', locationLat: 45.4, locationLng: -75.8, notes: 'Drumming on a birch',
    }, null, null, 5000);
    expect(plan.fieldId).toMatchObject({
      sightedOn: '2026-05-14', locationName: 'Mud Lake', locationLat: 45.4, locationLng: -75.8, notes: 'Drumming on a birch',
    });
  });
});

describe('localIsoDate', () => {
  it('formats the local date as YYYY-MM-DD with zero padding', () => {
    expect(localIsoDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(localIsoDate(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31');
  });
});

describe('isValidSightedOn', () => {
  const today = '2026-09-23';

  it('accepts today and past dates', () => {
    expect(isValidSightedOn('2026-09-23', today)).toBe(true);
    expect(isValidSightedOn('1999-04-01', today)).toBe(true);
  });

  it('rejects future dates', () => {
    expect(isValidSightedOn('2026-09-24', today)).toBe(false);
  });

  it('rejects empty or malformed dates', () => {
    expect(isValidSightedOn('', today)).toBe(false);
    expect(isValidSightedOn('2026-9-1', today)).toBe(false);
    expect(isValidSightedOn('yesterday', today)).toBe(false);
  });
});

describe('normalizeFieldIdDetails', () => {
  it('trims text and turns blank text into undefined', () => {
    expect(normalizeFieldIdDetails({ sightedOn: '2026-05-14', locationName: '   ', notes: ' hi ' }))
      .toEqual({ sightedOn: '2026-05-14', locationName: undefined, locationLat: undefined, locationLng: undefined, notes: 'hi' });
  });

  it('keeps coordinates only as a complete pair', () => {
    expect(normalizeFieldIdDetails({ sightedOn: '2026-05-14', locationLat: 45.4, locationLng: -75.8 }))
      .toMatchObject({ locationLat: 45.4, locationLng: -75.8 });
    expect(normalizeFieldIdDetails({ sightedOn: '2026-05-14', locationLat: 45.4 }))
      .toMatchObject({ locationLat: undefined, locationLng: undefined });
  });

  it('keeps a latitude or longitude of zero', () => {
    expect(normalizeFieldIdDetails({ sightedOn: '2026-05-14', locationLat: 0, locationLng: 0 }))
      .toMatchObject({ locationLat: 0, locationLng: 0 });
  });
});

describe('paletteContextText', () => {
  const label = (t: string) => ({ image: 'Photo', song: 'Song', latin: 'Latin' } as Record<string, string>)[t] ?? t;

  it('says nothing extra for a bird with no other records', () => {
    expect(paletteContextText('song', [], label)).toBeNull();
  });

  it('names the types the bird is being learned for', () => {
    expect(paletteContextText('song', [baseRecord({ questionType: 'image' })], label))
      .toBe('This bird is currently in your learning palette for Photo questions, but not in your learning palette for Song questions.');
  });

  it('lists several types, and mastered ones separately', () => {
    const others = [
      baseRecord({ questionType: 'image' }),
      baseRecord({ questionType: 'latin' }),
      baseRecord({ questionType: 'family', isMastered: true }),
    ];
    expect(paletteContextText('song', others, label))
      .toBe('This bird is currently in your learning palette for Photo and Latin questions and mastered for family questions, '
        + 'but not in your learning palette for Song questions.');
  });

  it('describes a bird that is only mastered for other types', () => {
    expect(paletteContextText('image', [baseRecord({ questionType: 'song', isMastered: true })], label))
      .toBe('This bird is currently mastered for Song questions, but not in your learning palette for Photo questions.');
  });
});

describe('locationTextAfterPick', () => {
  it('fills blank text with the picked name', () => {
    expect(locationTextAfterPick(undefined, undefined, 'Ottawa')).toBe('Ottawa');
    expect(locationTextAfterPick('  ', undefined, 'Ottawa')).toBe('Ottawa');
  });

  it('replaces the name a previous pick filled in', () => {
    expect(locationTextAfterPick('Ottawa', 'Ottawa', 'Lanark')).toBe('Lanark');
  });

  it('keeps text the user typed', () => {
    expect(locationTextAfterPick('Mud Lake', undefined, 'Ottawa')).toBe('Mud Lake');
    expect(locationTextAfterPick('Mud Lake', 'Ottawa', 'Lanark')).toBe('Mud Lake');
  });

  it('leaves the text alone when the pick has no name', () => {
    expect(locationTextAfterPick('Ottawa', 'Ottawa', undefined)).toBe('Ottawa');
  });
});

describe('fieldIdTooltip', () => {
  it('describes an unticked button', () => {
    expect(fieldIdTooltip('image', undefined)).toBe('Not marked as seen in the field');
    expect(fieldIdTooltip('song', undefined)).toBe('Not marked as heard in the field');
  });

  it('includes the date and location when known', () => {
    expect(fieldIdTooltip('image', tick({ sightedOn: '2026-05-14', locationName: 'Mud Lake' })))
      .toBe('Seen on 2026-05-14 at Mud Lake');
  });

  it("shows just the date for a friend's tick (no private location)", () => {
    expect(fieldIdTooltip('song', tick({ questionType: 'song', sightedOn: '2026-05-14' }))).toBe('Heard on 2026-05-14');
  });

  it('falls back when a tick has no date (made before dates existed)', () => {
    expect(fieldIdTooltip('image', tick())).toBe('Seen in the field');
  });
});
