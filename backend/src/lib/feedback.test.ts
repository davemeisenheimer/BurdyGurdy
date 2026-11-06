import { describe, it, expect } from 'vitest';
import {
  validateFeedbackSubmission,
  validateFeedbackReply,
  escapeHtml,
  excerpt,
  buildAdminFeedbackEmail,
  buildFeedbackReplyEmail,
  FEEDBACK_MAX_LENGTH,
} from './feedback';

describe('validateFeedbackSubmission', () => {
  const valid = { message: '  Love the songs!  ', source: 'settings', category: 'like', notifyEmail: true };

  it('accepts a valid body and trims the message', () => {
    const r = validateFeedbackSubmission(valid);
    expect(r).toEqual({
      ok: true,
      value: { message: 'Love the songs!', category: 'like', source: 'settings', notifyEmail: true, context: {} },
    });
  });

  it('rejects a missing or blank message', () => {
    expect(validateFeedbackSubmission({ ...valid, message: '   ' }).ok).toBe(false);
    expect(validateFeedbackSubmission({ source: 'settings' }).ok).toBe(false);
    expect(validateFeedbackSubmission(undefined).ok).toBe(false);
  });

  it('rejects an over-long message', () => {
    expect(validateFeedbackSubmission({ ...valid, message: 'x'.repeat(FEEDBACK_MAX_LENGTH + 1) }).ok).toBe(false);
    expect(validateFeedbackSubmission({ ...valid, message: 'x'.repeat(FEEDBACK_MAX_LENGTH) }).ok).toBe(true);
  });

  it('rejects an unknown source or category', () => {
    expect(validateFeedbackSubmission({ ...valid, source: 'email' }).ok).toBe(false);
    expect(validateFeedbackSubmission({ ...valid, category: 'rant' }).ok).toBe(false);
  });

  it('treats a missing category as null', () => {
    const r = validateFeedbackSubmission({ message: 'hi', source: 'mastery' });
    expect(r.ok && r.value.category).toBe(null);
  });

  it('defaults notifyEmail to true unless explicitly false', () => {
    const a = validateFeedbackSubmission({ message: 'hi', source: 'mastery' });
    const b = validateFeedbackSubmission({ message: 'hi', source: 'mastery', notifyEmail: false });
    expect(a.ok && a.value.notifyEmail).toBe(true);
    expect(b.ok && b.value.notifyEmail).toBe(false);
  });

  it('keeps only known, non-empty string context keys and truncates long values', () => {
    const r = validateFeedbackSubmission({
      ...valid,
      context: { appVersion: '1.2.3', regionCode: '', userAgent: 'u'.repeat(500), secret: 'nope', other: 5 },
    });
    expect(r.ok && r.value.context).toEqual({ appVersion: '1.2.3', userAgent: 'u'.repeat(300) });
  });
});

describe('validateFeedbackReply', () => {
  it('accepts and trims a reply', () => {
    expect(validateFeedbackReply({ reply: ' Thanks! ' })).toEqual({ ok: true, value: 'Thanks!' });
  });

  it('rejects a blank or missing reply', () => {
    expect(validateFeedbackReply({ reply: '  ' }).ok).toBe(false);
    expect(validateFeedbackReply({}).ok).toBe(false);
  });
});

describe('escapeHtml', () => {
  it('escapes HTML-significant characters', () => {
    expect(escapeHtml(`<b onclick="x">Tom & Jerry's</b>`))
      .toBe('&lt;b onclick=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/b&gt;');
  });
});

describe('excerpt', () => {
  it('returns short strings unchanged, collapsing whitespace', () => {
    expect(excerpt('hello\n  world')).toBe('hello world');
  });

  it('truncates long strings with an ellipsis within the limit', () => {
    const r = excerpt('a'.repeat(100), 10);
    expect(r).toBe('aaaaaaaaa…');
    expect(r.length).toBe(10);
  });
});

describe('email builders', () => {
  it('escapes user-supplied text in the admin email HTML but not the plain text', () => {
    const e = buildAdminFeedbackEmail({
      senderName: 'Robin <script>', senderEmail: 'r@example.org', category: 'bug', source: 'settings',
      message: '<img src=x>\nsecond line',
    });
    expect(e.html).toContain('Robin &lt;script&gt;');
    expect(e.html).toContain('&lt;img src=x&gt;<br>second line');
    expect(e.html).not.toContain('<img src=x>');
    expect(e.text).toContain('<img src=x>\nsecond line');
    expect(e.text).toContain('Category: Bug');
  });

  it('includes the reply and original message in the reply email', () => {
    const e = buildFeedbackReplyEmail({ replierName: 'Dave', originalMessage: 'More owls', reply: 'On it!' });
    expect(e.text).toContain('On it!');
    expect(e.text).toContain('More owls');
    expect(e.html).toContain('Dave');
  });
});
