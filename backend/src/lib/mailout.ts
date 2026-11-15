// Pure logic for admin mailouts: cleaning the editor's HTML, building the email, and signing
// unsubscribe links. Sending and storage live in routes/mailout.ts.
import { createHmac, timingSafeEqual } from 'crypto';
import sanitizeHtml from 'sanitize-html';
import { escapeHtml } from './feedback';
import type { ValidationResult } from './feedback';

export const MAILOUT_SUBJECT_MAX = 200;
export const MAILOUT_HTML_MAX    = 100_000;
/** Resend's batch API accepts at most 100 emails per call. */
export const MAILOUT_BATCH_SIZE  = 100;

/** Public Supabase Storage bucket that holds images used in mailouts. */
export const MAILOUT_IMAGE_BUCKET    = 'mailout-images';
export const MAILOUT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** The email's content column is 560px wide with 24px padding each side. */
export const MAILOUT_IMAGE_MAX_WIDTH = 512;

const ACCENT = '#2d6a4f';

/** The formatting the admin editor can produce. Everything else is dropped. */
const ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'hr', 'a'];

/** Inline styles per tag - most email clients ignore <style> blocks. */
const TAG_STYLES: Record<string, string> = {
  p:          'margin: 0 0 16px; line-height: 1.6;',
  h1:         `margin: 24px 0 12px; font-size: 24px; line-height: 1.3; color: ${ACCENT};`,
  h2:         `margin: 24px 0 12px; font-size: 20px; line-height: 1.3; color: ${ACCENT};`,
  h3:         `margin: 20px 0 8px; font-size: 17px; line-height: 1.3; color: ${ACCENT};`,
  ul:         'margin: 0 0 16px; padding-left: 24px;',
  ol:         'margin: 0 0 16px; padding-left: 24px;',
  li:         'margin: 0 0 4px; line-height: 1.6;',
  blockquote: `margin: 16px 0; padding: 4px 12px; border-left: 3px solid ${ACCENT}; color: #333;`,
  hr:         'border: none; border-top: 1px solid #ddd; margin: 24px 0;',
  a:          `color: ${ACCENT}; text-decoration: underline;`,
};

const IMAGE_STYLE = 'display: block; height: auto; margin: 0 0 16px; border: 0;';

/**
 * True when src is a file in our mailout image bucket. imageBase is the bucket's public URL,
 * ending in "/". The rest must be a plain path, so "../" can't reach another bucket.
 */
export function isMailoutImageUrl(src: string, imageBase: string): boolean {
  if (!imageBase.startsWith('https://') || !src.startsWith(imageBase)) return false;
  return /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\.[a-z]+$/.test(src.slice(imageBase.length));
}

/** An image's width attribute as whole pixels, capped to the email's width; null if unusable. */
export function mailoutImageWidth(attr: string | undefined): number | null {
  if (!attr || !/^\d+$/.test(attr)) return null;
  const n = parseInt(attr, 10);
  return n > 0 ? Math.min(n, MAILOUT_IMAGE_MAX_WIDTH) : null;
}

/**
 * Pass 1: keep only allowed tags, and only href (http/https/mailto) on links. Images are kept
 * only when they come from our image bucket (imageBase); without it, all images are dropped.
 */
function stripToAllowed(html: string, imageBase?: string): string {
  return sanitizeHtml(html, {
    allowedTags:         [...ALLOWED_TAGS, 'img'],
    allowedAttributes:   { a: ['href'], img: ['src', 'alt', 'width'] },
    allowedSchemes:      ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['https'] },
    exclusiveFilter:     frame => frame.tag === 'img' && !(imageBase && isMailoutImageUrl(frame.attribs.src ?? '', imageBase)),
  });
}

/**
 * Cleans editor HTML down to the allowed formatting. The editor wraps list-item text in <p>,
 * which would add paragraph spacing inside lists, so a list item's outer <p> is unwrapped.
 * Images are kept only from imageBase (see stripToAllowed).
 */
export function cleanMailoutHtml(html: string, imageBase?: string): string {
  return stripToAllowed(html, imageBase)
    .replace(/<li><p>/g, '<li>')
    .replace(/<\/p><\/li>/g, '</li>')
    .trim();
}

/**
 * Adds the email's inline styles to cleaned HTML. Each tag's attributes are replaced outright
 * (keeping only a link's href), so nothing from the input can add its own styles.
 */
export function styleMailoutHtml(cleanHtml: string): string {
  const transformTags: sanitizeHtml.IOptions['transformTags'] = {};
  for (const [tag, style] of Object.entries(TAG_STYLES)) {
    transformTags[tag] = (tagName, attribs) => {
      const out: sanitizeHtml.Attributes = tag === 'a'
        ? { href: attribs.href ?? '', style, target: '_blank', rel: 'noopener noreferrer' }
        : { style };
      return { tagName, attribs: out };
    };
  }
  // The width attribute is for Outlook, which ignores max-width; other apps scale down with the styles
  transformTags.img = (tagName, attribs) => {
    const width = mailoutImageWidth(attribs.width);
    const out: sanitizeHtml.Attributes = width
      ? { src: attribs.src ?? '', alt: attribs.alt ?? '', width: String(width), style: `${IMAGE_STYLE} width: 100%; max-width: ${width}px;` }
      : { src: attribs.src ?? '', alt: attribs.alt ?? '', style: `${IMAGE_STYLE} max-width: 100%;` };
    return { tagName, attribs: out };
  };
  return sanitizeHtml(cleanHtml, {
    allowedTags:       [...ALLOWED_TAGS, 'img'],
    allowedAttributes: { '*': ['style'], a: ['href', 'style', 'target', 'rel'], img: ['src', 'alt', 'width', 'style'] },
    allowedSchemes:    ['http', 'https', 'mailto'],
    transformTags,
  });
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Plain-text version of cleaned HTML, for mail apps that don't show HTML. */
export function mailoutHtmlToText(cleanHtml: string): string {
  const text = cleanHtml
    .replace(/<a href="([^"]*)">([\s\S]*?)<\/a>/g, (_, href: string, label: string) => {
      const plainLabel = label.replace(/<[^>]+>/g, '');
      return decodeEntities(plainLabel) === decodeEntities(href) ? plainLabel : `${plainLabel} (${href})`;
    })
    .replace(/<img[^>]*>/g, tag => {
      const alt = decodeEntities(/\balt="([^"]*)"/.exec(tag)?.[1] ?? '').trim();
      return alt ? `[Image: ${alt}]\n\n` : '[Image]\n\n';
    })
    .replace(/<br \/>|<br>/g, '\n')
    .replace(/<hr \/>|<hr>/g, '\n----------\n\n')
    .replace(/<li>/g, '- ')
    .replace(/<\/li>/g, '\n')
    .replace(/<\/(ul|ol)>/g, '\n')
    .replace(/<\/(p|h1|h2|h3|blockquote)>/g, '\n\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface MailoutDraft { subject: string; html: string }

/**
 * Validates a mailout request body and returns the subject plus cleaned HTML.
 * imageBase is the image bucket's public URL; images from anywhere else are dropped.
 */
export function validateMailout(body: unknown, imageBase?: string): ValidationResult<MailoutDraft> {
  const b = (body ?? {}) as Record<string, unknown>;
  const subject = typeof b.subject === 'string' ? b.subject.trim() : '';
  const rawHtml = typeof b.html === 'string' ? b.html : '';
  if (!subject) return { ok: false, error: 'Please enter a subject.' };
  if (subject.length > MAILOUT_SUBJECT_MAX) return { ok: false, error: `Please keep the subject under ${MAILOUT_SUBJECT_MAX} characters.` };
  if (rawHtml.length > MAILOUT_HTML_MAX) return { ok: false, error: 'The message is too long.' };
  const html = cleanMailoutHtml(rawHtml, imageBase);
  if (!mailoutHtmlToText(html)) return { ok: false, error: 'Please write a message.' };
  return { ok: true, value: { subject, html } };
}

export interface MailoutEmail { subject: string; html: string; text: string }

/** The full email: the message, then a footer explaining the opt-in, with the unsubscribe link. */
export function buildMailoutEmail(p: { subject: string; cleanHtml: string; unsubscribeUrl: string }): MailoutEmail {
  const footerText =
    "You're receiving this because you opted in to BurdyGurdy news. " +
    'Questions or ideas? Use Send feedback in the app.';
  const unsub = escapeHtml(p.unsubscribeUrl);
  return {
    subject: p.subject,
    html:
      '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
      '<body style="margin: 0; padding: 0; background: #ffffff;">' +
      '<div style="font-family: sans-serif; font-size: 15px; color: #222; max-width: 560px; margin: 0 auto; padding: 24px;">' +
      styleMailoutHtml(p.cleanHtml) +
      `<hr style="${TAG_STYLES.hr}">` +
      `<p style="margin: 0; color: #888; font-size: 12px; line-height: 1.5;">${escapeHtml(footerText)} ` +
      `<a href="${unsub}" style="color: #888; text-decoration: underline;">Unsubscribe</a></p>` +
      '</div></body></html>',
    text: `${mailoutHtmlToText(p.cleanHtml)}\n\n--\n${footerText}\nUnsubscribe: ${p.unsubscribeUrl}`,
  };
}

/** Headers that let mail apps (Gmail, Yahoo, Apple Mail) offer one-click unsubscribe. */
export function unsubscribeHeaders(unsubscribeUrl: string): Record<string, string> {
  return {
    'List-Unsubscribe':      `<${unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

// ── Unsubscribe links ─────────────────────────────────────────────────────────

export function signUnsubscribe(userId: string, secret: string): string {
  return createHmac('sha256', secret).update(`unsubscribe:${userId}`).digest('base64url');
}

export function verifyUnsubscribe(userId: string, token: string, secret: string): boolean {
  if (!userId || !token || !secret) return false;
  const expected = Buffer.from(signUnsubscribe(userId, secret));
  const given    = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function buildUnsubscribeUrl(baseUrl: string, userId: string, secret: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/api/mailout/unsubscribe?u=${encodeURIComponent(userId)}&t=${encodeURIComponent(signUnsubscribe(userId, secret))}`;
}

// ── Image uploads ─────────────────────────────────────────────────────────────

export interface DetectedImage { ext: string; contentType: string }

/**
 * The image type from the file's first bytes, or null if it isn't a PNG, JPEG, GIF or WebP.
 * The browser's claimed type isn't trusted, so the stored file is always served as what it is.
 */
export function detectImageType(buf: Buffer): DetectedImage | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: 'png', contentType: 'image/png' };
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: 'jpg', contentType: 'image/jpeg' };
  }
  const head = buf.subarray(0, 12).toString('latin1');
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return { ext: 'gif', contentType: 'image/gif' };
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return { ext: 'webp', contentType: 'image/webp' };
  return null;
}

/** Storage path for a new upload, grouped by month: "2026-11/<id>.png". */
export function mailoutImagePath(id: string, ext: string, now: Date): string {
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${month}/${id}.${ext}`;
}

// ── Recipients ────────────────────────────────────────────────────────────────

export interface MailoutRecipient { id: string; email: string }

/** Users who ticked "news" and have an email address. A missing flag means not opted in. */
export function selectRecipients(
  users: { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null }[],
): MailoutRecipient[] {
  return users
    .filter(u => u.user_metadata?.news_opt_in === true && !!u.email)
    .map(u => ({ id: u.id, email: u.email as string }));
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ── Unsubscribe pages ─────────────────────────────────────────────────────────

function page(title: string, body: string): string {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${escapeHtml(title)}</title></head>` +
    '<body style="margin: 0; font-family: sans-serif; background: #f0f9ff; color: #222;">' +
    '<div style="max-width: 420px; margin: 64px auto; padding: 32px 24px; background: #fff; border-radius: 16px; text-align: center;">' +
    `<h1 style="margin: 0 0 12px; font-size: 22px; color: ${ACCENT};">${escapeHtml(title)}</h1>${body}</div></body></html>`;
}

/**
 * Asks for confirmation rather than unsubscribing on GET: mail scanners open links in emails
 * automatically, which would otherwise unsubscribe people without them clicking anything.
 */
export function unsubscribeConfirmPage(actionUrl: string): string {
  return page('Unsubscribe from BurdyGurdy news?',
    '<p style="line-height: 1.5;">You\'ll stop receiving BurdyGurdy news emails. You can turn them back on any time in Settings.</p>' +
    `<form method="post" action="${escapeHtml(actionUrl)}">` +
    `<button type="submit" style="margin-top: 8px; padding: 10px 24px; border: none; border-radius: 999px; background: ${ACCENT}; color: #fff; font-size: 15px; cursor: pointer;">Unsubscribe</button>` +
    '</form>');
}

export function unsubscribeDonePage(): string {
  return page("You're unsubscribed",
    '<p style="line-height: 1.5;">You won\'t receive BurdyGurdy news emails any more. You can turn them back on any time in Settings.</p>');
}

export function unsubscribeErrorPage(): string {
  return page('Something went wrong',
    '<p style="line-height: 1.5;">We couldn\'t unsubscribe you just now. Please try the link again later, or turn off news emails in BurdyGurdy\'s Settings.</p>');
}

export function unsubscribeInvalidPage(): string {
  return page('Link not recognised',
    '<p style="line-height: 1.5;">This unsubscribe link isn\'t valid. You can turn off news emails in BurdyGurdy\'s Settings instead.</p>');
}
