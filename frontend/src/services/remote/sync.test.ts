import { describe, it, expect } from 'vitest';
import { fieldIdToRows, fieldIdFromRow, mergeFieldIdRows, type FieldIdRow, type FieldIdDetailRow } from './sync';
import type { FieldId } from '../../types';

// ── Field ID row mapping ──────────────────────────────────────────────────────
// A tick is split across user_field_ids (friends can read: tick + date) and the owner-only
// user_field_id_details (location + notes). These cover the split and the re-join.

const FULL_TICK: FieldId = {
  speciesCode: 'yebsap', questionType: 'image', comName: 'Yellow-bellied Sapsucker',
  masteredByField: true, confirmedAt: 5000, sightedOn: '2026-05-14',
  locationName: 'Mud Lake', locationLat: 45.4, locationLng: -75.8, notes: 'Drumming on a birch',
};

const ROW: FieldIdRow = {
  species_code: 'yebsap', question_type: 'image', com_name: 'Yellow-bellied Sapsucker',
  mastered_by_field: true, confirmed_at: 5000, sighted_on: '2026-05-14',
};

const DETAIL: FieldIdDetailRow = {
  species_code: 'yebsap', question_type: 'image',
  location_name: 'Mud Lake', location_lat: 45.4, location_lng: -75.8, notes: 'Drumming on a birch',
};

describe('fieldIdToRows', () => {
  it('keeps location and notes out of the friend-readable row', () => {
    const { row, detail } = fieldIdToRows('user-1', FULL_TICK);
    expect(row).toEqual({ user_id: 'user-1', ...ROW });
    expect(detail).toEqual({ user_id: 'user-1', ...DETAIL });
    expect(row).not.toHaveProperty('location_name');
    expect(row).not.toHaveProperty('notes');
  });

  it('writes nulls for missing details, so clearing a field clears it in the cloud', () => {
    const bare: FieldId = { speciesCode: 'yebsap', questionType: 'song', comName: 'Yellow-bellied Sapsucker', masteredByField: false, confirmedAt: 1 };
    const { row, detail } = fieldIdToRows('user-1', bare);
    expect(row.sighted_on).toBeNull();
    expect(detail).toMatchObject({ location_name: null, location_lat: null, location_lng: null, notes: null });
  });
});

describe('fieldIdFromRow', () => {
  it('round-trips a tick through its two rows', () => {
    const { row, detail } = fieldIdToRows('user-1', FULL_TICK);
    expect(fieldIdFromRow(row, detail)).toEqual(FULL_TICK);
  });

  it("gives a friend's tick (no detail row) only the shared fields", () => {
    const tick = fieldIdFromRow(ROW);
    expect(tick).toMatchObject({ speciesCode: 'yebsap', sightedOn: '2026-05-14' });
    expect(tick.locationName).toBeUndefined();
    expect(tick.notes).toBeUndefined();
  });

  it('converts a bigint confirmed_at that arrives as a string', () => {
    expect(fieldIdFromRow({ ...ROW, confirmed_at: '5000' as unknown as number }).confirmedAt).toBe(5000);
  });
});

describe('mergeFieldIdRows', () => {
  it('joins each tick with its own detail row, and leaves ticks without one bare', () => {
    const robinRow: FieldIdRow = { ...ROW, species_code: 'amerob', com_name: 'American Robin', question_type: 'song' };
    const merged = mergeFieldIdRows([ROW, robinRow], [DETAIL]);
    expect(merged[0]).toEqual(FULL_TICK);
    expect(merged[1]).toMatchObject({ speciesCode: 'amerob', questionType: 'song', locationName: undefined, notes: undefined });
  });
});
