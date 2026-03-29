import { describe, it, expect } from 'vitest';
import { decideTakeRemote } from './sync';

// ── decideTakeRemote ──────────────────────────────────────────────────────────
// Merge policy for cloud sync: determines whether the remote record should
// overwrite the local one. This logic was the source of a previous bug where
// progress was lost when signing in on a second device.
//
// Priority order (highest wins):
//   1. No local record at all → take remote
//   2. Local is seeded/unplayed (lastAsked=0) and remote has been played → take remote
//   3. Remote is graduated (isMastered) and local is not → take remote
//   4. Neither graduated, remote has a higher mastery level → take remote
//   5. Same history + level, remote is more recent → take remote
//   Otherwise → keep local

describe('decideTakeRemote', () => {
  // ── Case 1: no local record ─────────────────────────────────────────────────

  it('takes remote when there is no local record', () => {
    expect(decideTakeRemote(null, { last_asked: 1000 })).toBe(true);
  });

  // ── Case 2: seeded local vs played remote ───────────────────────────────────
  // Local records seeded into the palette have lastAsked=0. They should be
  // replaced by any actual progress from another device.

  it('takes remote when local is seeded (lastAsked=0) and remote has been played', () => {
    const local  = { lastAsked: 0, isMastered: false, masteryLevel: 0 };
    const remote = { last_asked: 5000, in_history: false, mastery_level: 0 };
    expect(decideTakeRemote(local, remote)).toBe(true);
  });

  it('keeps local when both are seeded (neither has been played)', () => {
    const local  = { lastAsked: 0, isMastered: false, masteryLevel: 0 };
    const remote = { last_asked: 0, in_history: false, mastery_level: 0 };
    expect(decideTakeRemote(local, remote)).toBe(false);
  });

  // ── Case 3: graduation status ───────────────────────────────────────────────
  // Once a bird is graduated (isMastered=true) it should never be "downgraded"
  // back to an active palette bird — but remote graduation always wins over
  // a local non-graduated record.

  it('takes remote when remote is graduated and local is not', () => {
    const local  = { lastAsked: 9000, isMastered: false, masteryLevel: 2 };
    const remote = { last_asked: 1000, in_history: true,  mastery_level: 2 };
    expect(decideTakeRemote(local, remote)).toBe(true);
  });

  it('keeps local when local is graduated and remote is not', () => {
    const local  = { lastAsked: 9000, isMastered: true,  masteryLevel: 2 };
    const remote = { last_asked: 9999, in_history: false, mastery_level: 2 };
    expect(decideTakeRemote(local, remote)).toBe(false);
  });

  // ── Case 4: mastery level comparison (neither graduated) ────────────────────

  it('takes remote when remote has a higher mastery level', () => {
    const local  = { lastAsked: 5000, isMastered: false, masteryLevel: 0 };
    const remote = { last_asked: 3000, in_history: false, mastery_level: 1 };
    expect(decideTakeRemote(local, remote)).toBe(true);
  });

  it('keeps local when local has a higher mastery level', () => {
    const local  = { lastAsked: 3000, isMastered: false, masteryLevel: 1 };
    const remote = { last_asked: 5000, in_history: false, mastery_level: 0 };
    expect(decideTakeRemote(local, remote)).toBe(false);
  });

  // ── Case 5: same level & history — fall back to recency ─────────────────────

  it('takes remote when same level and remote is more recent', () => {
    const local  = { lastAsked: 1000, isMastered: false, masteryLevel: 1 };
    const remote = { last_asked: 2000, in_history: false, mastery_level: 1 };
    expect(decideTakeRemote(local, remote)).toBe(true);
  });

  it('keeps local when same level and local is more recent', () => {
    const local  = { lastAsked: 2000, isMastered: false, masteryLevel: 1 };
    const remote = { last_asked: 1000, in_history: false, mastery_level: 1 };
    expect(decideTakeRemote(local, remote)).toBe(false);
  });

  it('keeps local when same level, both graduated, and local is more recent', () => {
    const local  = { lastAsked: 2000, isMastered: true, masteryLevel: 2 };
    const remote = { last_asked: 1000, in_history: true, mastery_level: 2 };
    expect(decideTakeRemote(local, remote)).toBe(false);
  });

  it('takes remote when same level, both graduated, and remote is more recent', () => {
    const local  = { lastAsked: 1000, isMastered: true, masteryLevel: 2 };
    const remote = { last_asked: 2000, in_history: true, mastery_level: 2 };
    expect(decideTakeRemote(local, remote)).toBe(true);
  });
});
