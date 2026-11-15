import { describe, it, expect } from 'vitest';
import {
  cleanMailoutHtml,
  styleMailoutHtml,
  mailoutHtmlToText,
  validateMailout,
  buildMailoutEmail,
  unsubscribeHeaders,
  signUnsubscribe,
  verifyUnsubscribe,
  buildUnsubscribeUrl,
  selectRecipients,
  chunk,
  unsubscribeConfirmPage,
  isMailoutImageUrl,
  mailoutImageWidth,
  detectImageType,
  mailoutImagePath,
  MAILOUT_SUBJECT_MAX,
} from './mailout';

describe('cleanMailoutHtml', () => {
  it('keeps the editor formatting', () => {
    const html = '<h2>Hi</h2><p><strong>Bold</strong> <em>it</em> <u>u</u> <s>s</s></p><hr><blockquote><p>q</p></blockquote>';
    expect(cleanMailoutHtml(html)).toBe('<h2>Hi</h2><p><strong>Bold</strong> <em>it</em> <u>u</u> <s>s</s></p><hr /><blockquote><p>q</p></blockquote>');
  });

  it('removes scripts, event handlers, styles, and unknown tags', () => {
    const html = '<p onclick="x()" style="color:red">Hi<script>alert(1)</script></p><img src="x"><iframe src="y"></iframe>';
    expect(cleanMailoutHtml(html)).toBe('<p>Hi</p>');
  });

  it('keeps only http, https and mailto links, with href only', () => {
    const html = '<p><a href="https://burdygurdy.com" target="_blank" rel="noopener" class="x">site</a> ' +
      '<a href="mailto:a@b.c">mail</a> <a href="javascript:alert(1)">bad</a></p>';
    expect(cleanMailoutHtml(html)).toBe('<p><a href="https://burdygurdy.com">site</a> <a href="mailto:a@b.c">mail</a> <a>bad</a></p>');
  });

  it("unwraps a list item's <p> so lists don't get paragraph spacing", () => {
    expect(cleanMailoutHtml('<ul><li><p>One</p></li><li><p>Two</p></li></ul>')).toBe('<ul><li>One</li><li>Two</li></ul>');
  });
});

describe('styleMailoutHtml', () => {
  it('adds inline styles and makes links open in a new tab', () => {
    const out = styleMailoutHtml('<p>Hi <a href="https://x.org">x</a></p>');
    expect(out).toMatch(/^<p style="[^"]+">Hi <a href="https:\/\/x.org" style="[^"]+" target="_blank" rel="noopener noreferrer">x<\/a><\/p>$/);
  });

  it('replaces any style that came with the input', () => {
    const out = styleMailoutHtml('<p style="position:fixed">Hi</p>');
    expect(out).not.toContain('position');
  });
});

describe('mailoutHtmlToText', () => {
  it('turns paragraphs, headings, lists and rules into readable text', () => {
    const html = cleanMailoutHtml('<h2>News</h2><p>Line one<br>line two</p><ul><li><p>A</p></li><li><p>B</p></li></ul><hr><p>End</p>');
    expect(mailoutHtmlToText(html)).toBe('News\n\nLine one\nline two\n\n- A\n- B\n\n----------\n\nEnd');
  });

  it('shows link targets, unless the label is already the URL', () => {
    const html = cleanMailoutHtml('<p><a href="https://a.org/?x=1&amp;y=2">our site</a> and <a href="https://b.org">https://b.org</a></p>');
    expect(mailoutHtmlToText(html)).toBe('our site (https://a.org/?x=1&y=2) and https://b.org');
  });

  it('decodes entities', () => {
    expect(mailoutHtmlToText('<p>Tom &amp; Jerry &lt;3</p>')).toBe('Tom & Jerry <3');
  });
});

describe('validateMailout', () => {
  it('accepts a subject and message, returning cleaned HTML', () => {
    const r = validateMailout({ subject: '  Spring news ', html: '<p>Hi<script>x</script></p>' });
    expect(r).toEqual({ ok: true, value: { subject: 'Spring news', html: '<p>Hi</p>' } });
  });

  it('rejects a missing or over-long subject', () => {
    expect(validateMailout({ subject: ' ', html: '<p>Hi</p>' }).ok).toBe(false);
    expect(validateMailout({ subject: 'x'.repeat(MAILOUT_SUBJECT_MAX + 1), html: '<p>Hi</p>' }).ok).toBe(false);
  });

  it('rejects a message with no text (the editor sends <p></p> when empty)', () => {
    expect(validateMailout({ subject: 'Hi', html: '<p></p>' }).ok).toBe(false);
    expect(validateMailout({ subject: 'Hi' }).ok).toBe(false);
  });
});

describe('buildMailoutEmail', () => {
  const email = buildMailoutEmail({ subject: 'News', cleanHtml: '<p>Hello</p>', unsubscribeUrl: 'https://x.org/u?a=1&b=2' });

  it('includes the message, the opt-in reason, and the unsubscribe link in both versions', () => {
    expect(email.subject).toBe('News');
    expect(email.html).toContain('Hello');
    expect(email.html).toContain('opted in to BurdyGurdy news');
    expect(email.html).toContain('href="https://x.org/u?a=1&amp;b=2"');
    expect(email.text).toBe(
      "Hello\n\n--\nYou're receiving this because you opted in to BurdyGurdy news. " +
      'Questions or ideas? Use Send feedback in the app.\nUnsubscribe: https://x.org/u?a=1&b=2',
    );
  });
});

describe('unsubscribeHeaders', () => {
  it('advertises one-click unsubscribe', () => {
    expect(unsubscribeHeaders('https://x.org/u')).toEqual({
      'List-Unsubscribe':      '<https://x.org/u>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });
});

describe('unsubscribe tokens', () => {
  const secret = 'test-secret';

  it('verifies a token signed for the same user and secret', () => {
    expect(verifyUnsubscribe('user-1', signUnsubscribe('user-1', secret), secret)).toBe(true);
  });

  it("rejects another user's token, a wrong secret, a tampered token, and blanks", () => {
    const token = signUnsubscribe('user-1', secret);
    expect(verifyUnsubscribe('user-2', token, secret)).toBe(false);
    expect(verifyUnsubscribe('user-1', token, 'other-secret')).toBe(false);
    const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    expect(verifyUnsubscribe('user-1', tampered, secret)).toBe(false);
    expect(verifyUnsubscribe('user-1', '', secret)).toBe(false);
    expect(verifyUnsubscribe('user-1', token, '')).toBe(false);
  });

  it('builds a link whose token verifies, ignoring a trailing slash on the base URL', () => {
    const url = new URL(buildUnsubscribeUrl('https://burdygurdy.com/', 'user-1', secret));
    expect(url.origin + url.pathname).toBe('https://burdygurdy.com/api/mailout/unsubscribe');
    expect(verifyUnsubscribe(url.searchParams.get('u')!, url.searchParams.get('t')!, secret)).toBe(true);
  });
});

describe('selectRecipients', () => {
  it('keeps only opted-in users with an email address', () => {
    const users = [
      { id: '1', email: 'a@x.org', user_metadata: { news_opt_in: true } },
      { id: '2', email: 'b@x.org', user_metadata: { news_opt_in: false } },
      { id: '3', email: 'c@x.org', user_metadata: {} },
      { id: '4', email: null,      user_metadata: { news_opt_in: true } },
      { id: '5', email: 'e@x.org', user_metadata: null },
      { id: '6', email: 'f@x.org', user_metadata: { news_opt_in: 'true' } },
    ];
    expect(selectRecipients(users)).toEqual([{ id: '1', email: 'a@x.org' }]);
  });
});

describe('chunk', () => {
  it('splits into batches of the given size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 100)).toEqual([]);
  });
});

describe('unsubscribeConfirmPage', () => {
  it('posts back to the escaped action URL', () => {
    expect(unsubscribeConfirmPage('/api/mailout/unsubscribe?u=1&t=2')).toContain('action="/api/mailout/unsubscribe?u=1&amp;t=2"');
  });
});

describe('mailout images', () => {
  const base = 'https://proj.supabase.co/storage/v1/object/public/mailout-images/';
  const img = `${base}2026-11/abc-123.png`;

  it('recognises only plain files in the image bucket', () => {
    expect(isMailoutImageUrl(img, base)).toBe(true);
    expect(isMailoutImageUrl('https://evil.example/x.png', base)).toBe(false);
    expect(isMailoutImageUrl(`${base}../other-bucket/x.png`, base)).toBe(false);
    expect(isMailoutImageUrl(`${base}2026-11/x.png?y=1`, base)).toBe(false);
    expect(isMailoutImageUrl(img, 'http://proj.supabase.co/storage/v1/object/public/mailout-images/')).toBe(false);
  });

  it('keeps bucket images with src, alt and width only, and drops all others', () => {
    const html = `<img src="${img}" alt="A robin" width="300" title="t" style="x"><img src="https://evil.example/x.png"><img src="data:image/png;base64,AAAA">`;
    expect(cleanMailoutHtml(html, base)).toBe(`<img src="${img}" alt="A robin" width="300" />`);
  });

  it('drops every image when no bucket address is given', () => {
    expect(cleanMailoutHtml(`<p>Hi</p><img src="${img}">`)).toBe('<p>Hi</p>');
  });

  it('styles images to fit the email, capping the width', () => {
    const styled = styleMailoutHtml(`<img src="${img}" alt="A robin" width="1200" />`);
    expect(styled).toContain(`src="${img}"`);
    expect(styled).toContain('alt="A robin"');
    expect(styled).toContain('width="512"');
    expect(styled).toContain('max-width:512px');
    expect(styleMailoutHtml(`<img src="${img}" />`)).toContain('max-width:100%');
  });

  it('reads image widths as capped whole pixels', () => {
    expect(mailoutImageWidth('300')).toBe(300);
    expect(mailoutImageWidth('2000')).toBe(512);
    expect(mailoutImageWidth('0')).toBeNull();
    expect(mailoutImageWidth('50%')).toBeNull();
    expect(mailoutImageWidth(undefined)).toBeNull();
  });

  it('shows images in the plain-text version by their description', () => {
    expect(mailoutHtmlToText(`<p>Look:</p><img src="${img}" alt="A &amp; B" /><img src="${img}" alt="" /><p>End</p>`))
      .toBe('Look:\n\n[Image: A & B]\n\n[Image]\n\nEnd');
  });

  it('accepts a message that is only an image', () => {
    const r = validateMailout({ subject: 'Hi', html: `<img src="${img}">` }, base);
    expect(r.ok).toBe(true);
  });

  it('detects image types from the file bytes', () => {
    expect(detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toEqual({ ext: 'png', contentType: 'image/png' });
    expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ ext: 'jpg', contentType: 'image/jpeg' });
    expect(detectImageType(Buffer.from('GIF89a......', 'latin1'))?.ext).toBe('gif');
    expect(detectImageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'))?.ext).toBe('webp');
    expect(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });

  it('groups uploads by month', () => {
    expect(mailoutImagePath('abc', 'png', new Date(Date.UTC(2026, 10, 10)))).toBe('2026-11/abc.png');
  });
});
