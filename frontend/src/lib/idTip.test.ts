import { describe, it, expect } from 'vitest';
import {
  isIdTipEligible, canSubmitIdTipReport, groupIdTipReports, idTipResolutionText,
  ID_TIP_REPORT_MIN, ID_TIP_REPORT_MAX, canSaveTipEdit, ID_TIP_TEXT_MAX,
  type IdTipEligibilityInput, type IdTipReportItem,
} from './idTip';

const wrongPhotoAnswer: IdTipEligibilityInput = {
  enabled: true,
  questionType: 'image',
  selectedAnswer: 'Sharp-shinned Hawk',
  isCorrect: false,
  photoUrl: 'https://example.com/coohaw.jpg',
};

describe('isIdTipEligible', () => {
  it('is eligible for a wrong answer on every photo question type', () => {
    expect(isIdTipEligible(wrongPhotoAnswer)).toBe(true);
    expect(isIdTipEligible({ ...wrongPhotoAnswer, questionType: 'image-latin' })).toBe(true);
    expect(isIdTipEligible({ ...wrongPhotoAnswer, questionType: 'image-song' })).toBe(true);
  });

  it('is not eligible for non-photo question types', () => {
    for (const t of ['song', 'sono', 'latin', 'family', 'order', 'song-latin', 'sono-song', 'latin-song', 'family-latin'] as const) {
      expect(isIdTipEligible({ ...wrongPhotoAnswer, questionType: t })).toBe(false);
    }
  });

  it('is not eligible when correct, unanswered, disabled, or without a photo', () => {
    expect(isIdTipEligible({ ...wrongPhotoAnswer, isCorrect: true })).toBe(false);
    expect(isIdTipEligible({ ...wrongPhotoAnswer, selectedAnswer: null })).toBe(false);
    expect(isIdTipEligible({ ...wrongPhotoAnswer, enabled: false })).toBe(false);
    expect(isIdTipEligible({ ...wrongPhotoAnswer, photoUrl: null })).toBe(false);
    expect(isIdTipEligible({ ...wrongPhotoAnswer, noPhoto: true })).toBe(false);
  });
});

describe('canSubmitIdTipReport', () => {
  it('needs an issue type and details between the limits (trimmed)', () => {
    expect(canSubmitIdTipReport(null, 'The tail is not visible.')).toBe(false);
    expect(canSubmitIdTipReport('not_visible', '   short   ')).toBe(false);
    expect(canSubmitIdTipReport('not_visible', 'x'.repeat(ID_TIP_REPORT_MIN))).toBe(true);
    expect(canSubmitIdTipReport('not_visible', 'x'.repeat(ID_TIP_REPORT_MAX + 1))).toBe(false);
  });
});

describe('groupIdTipReports', () => {
  const base: IdTipReportItem = {
    id: '1', speciesCode: 'coohaw', guessKey: 'sharp-shinned hawk', photoUrl: 'https://a/1.jpg',
    comName: "Cooper's Hawk", sciName: 'Astur cooperii', guess: 'Sharp-shinned Hawk', tip: 'old tip',
    issueType: 'not_visible', description: 'Tail not visible.', reporterName: 'A', reporterEmail: null,
    regionCode: null, createdAt: '2026-11-01T00:00:00Z',
  };

  it('groups reports about the same tip and uses the newest report as the group summary', () => {
    const groups = groupIdTipReports([
      base,
      { ...base, id: '2', tip: 'new tip', createdAt: '2026-11-03T00:00:00Z' },
      { ...base, id: '3', guessKey: 'northern goshawk', guess: 'Northern Goshawk', createdAt: '2026-11-02T00:00:00Z' },
    ]);
    expect(groups.map(g => g.reports.map(r => r.id))).toEqual([['2', '1'], ['3']]);
    expect(groups[0].latest.tip).toBe('new tip');
  });

  it('returns no groups for no reports', () => {
    expect(groupIdTipReports([])).toEqual([]);
  });
});

describe('idTipResolutionText', () => {
  it('gives distinct text for each outcome', () => {
    const texts = ['fixed', 'regenerated', 'kept', 'dismissed'].map(idTipResolutionText);
    expect(new Set(texts).size).toBe(4);
  });
});

describe('canSaveTipEdit', () => {
  it('allows saving changed, non-blank text within the limit', () => {
    expect(canSaveTipEdit('Note the rounded tail.', 'Old tip.')).toBe(true);
    expect(canSaveTipEdit('A first tip.', null)).toBe(true);
  });

  it('blocks unchanged (ignoring surrounding space), blank or over-long text', () => {
    expect(canSaveTipEdit('  Old tip.  ', 'Old tip.')).toBe(false);
    expect(canSaveTipEdit('   ', 'Old tip.')).toBe(false);
    expect(canSaveTipEdit('x'.repeat(ID_TIP_TEXT_MAX + 1), 'Old tip.')).toBe(false);
  });
});
