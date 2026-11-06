import { describe, it, expect } from 'vitest';
import {
  buildFeedbackContext,
  validateFeedbackMessage,
  shouldShowFeedbackCallout,
  categoryLabel,
  describeFeedbackError,
  FEEDBACK_MAX_LENGTH,
} from './feedback';

describe('buildFeedbackContext', () => {
  it('keeps non-blank values, trimmed', () => {
    expect(buildFeedbackContext({ appVersion: ' 1.2.3 ', regionCode: 'CA-ON-OT', userAgent: 'UA' }))
      .toEqual({ appVersion: '1.2.3', regionCode: 'CA-ON-OT', userAgent: 'UA' });
  });

  it('omits blank and missing values', () => {
    expect(buildFeedbackContext({ appVersion: '1.0', regionCode: '  ' })).toEqual({ appVersion: '1.0' });
  });
});

describe('validateFeedbackMessage', () => {
  it('rejects blank messages', () => {
    expect(validateFeedbackMessage('   ')).not.toBeNull();
  });

  it('accepts messages up to the limit (after trimming)', () => {
    expect(validateFeedbackMessage('Great app')).toBeNull();
    expect(validateFeedbackMessage(` ${'x'.repeat(FEEDBACK_MAX_LENGTH)} `)).toBeNull();
  });

  it('rejects over-long messages', () => {
    expect(validateFeedbackMessage('x'.repeat(FEEDBACK_MAX_LENGTH + 1))).not.toBeNull();
  });
});

describe('shouldShowFeedbackCallout', () => {
  it('shows on the first showing', () => {
    expect(shouldShowFeedbackCallout(1)).toBe(true);
  });

  it('shows on every Nth showing and not in between', () => {
    const shown = Array.from({ length: 20 }, (_, i) => i + 1).filter(n => shouldShowFeedbackCallout(n, 5));
    expect(shown).toEqual([1, 5, 10, 15, 20]);
  });

  it('never shows for a zero or negative count', () => {
    expect(shouldShowFeedbackCallout(0)).toBe(false);
    expect(shouldShowFeedbackCallout(-3)).toBe(false);
  });
});

describe('categoryLabel', () => {
  it('labels known categories and falls back for null', () => {
    expect(categoryLabel('bug')).toContain('Bug');
    expect(categoryLabel(null)).toBe('General');
  });
});

describe('describeFeedbackError', () => {
  it('explains an expired sign-in (401)', () => {
    expect(describeFeedbackError({ response: { status: 401, data: { error: 'Invalid token' } } })).toMatch(/sign-in seems to have expired/);
  });

  it('explains a sign-in check that could not be made (503)', () => {
    expect(describeFeedbackError({ response: { status: 503, data: {} } })).toMatch(/couldn't verify your sign-in/);
  });

  it('explains a browser timeout', () => {
    expect(describeFeedbackError({ code: 'ECONNABORTED' })).toMatch(/taking too long/);
  });

  it('falls back to a generic message', () => {
    expect(describeFeedbackError({ response: { status: 500, data: {} } })).toBe('Sorry - your feedback could not be sent. Please try again.');
  });
});
