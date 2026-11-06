// Pure helpers for the user-feedback feature: input validation and email bodies.

export const FEEDBACK_CATEGORIES = ['like', 'dislike', 'idea', 'bug', 'other'] as const;
export const FEEDBACK_SOURCES    = ['notifications', 'settings', 'mastery'] as const;
export const FEEDBACK_STATUSES   = ['new', 'read', 'replied'] as const;

export type FeedbackCategory = typeof FEEDBACK_CATEGORIES[number];
export type FeedbackSource   = typeof FEEDBACK_SOURCES[number];
export type FeedbackStatus   = typeof FEEDBACK_STATUSES[number];

export const FEEDBACK_MAX_LENGTH = 2000;
export const REPLY_MAX_LENGTH    = 2000;

const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  like:    'Something I like',
  dislike: 'Something I dislike',
  idea:    'Idea',
  bug:     'Bug',
  other:   'Other',
};

export interface FeedbackSubmission {
  message:     string;
  category:    FeedbackCategory | null;
  source:      FeedbackSource;
  notifyEmail: boolean;
  context:     Record<string, string>;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

const CONTEXT_KEYS = ['appVersion', 'regionCode', 'userAgent'] as const;
const CONTEXT_VALUE_MAX = 300;

function includes<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v);
}

/** Validates and normalises a feedback POST body. Unknown context keys are dropped. */
export function validateFeedbackSubmission(body: unknown): ValidationResult<FeedbackSubmission> {
  const b = (body ?? {}) as Record<string, unknown>;

  const message = typeof b.message === 'string' ? b.message.trim() : '';
  if (!message) return { ok: false, error: 'Message is required' };
  if (message.length > FEEDBACK_MAX_LENGTH) {
    return { ok: false, error: `Message must be ${FEEDBACK_MAX_LENGTH} characters or fewer` };
  }

  if (!includes(FEEDBACK_SOURCES, b.source)) return { ok: false, error: 'Invalid source' };

  let category: FeedbackCategory | null = null;
  if (b.category != null) {
    if (!includes(FEEDBACK_CATEGORIES, b.category)) return { ok: false, error: 'Invalid category' };
    category = b.category;
  }

  const context: Record<string, string> = {};
  const rawContext = (b.context ?? {}) as Record<string, unknown>;
  for (const key of CONTEXT_KEYS) {
    const v = rawContext[key];
    if (typeof v === 'string' && v.trim()) context[key] = v.trim().slice(0, CONTEXT_VALUE_MAX);
  }

  return {
    ok: true,
    value: { message, category, source: b.source, notifyEmail: b.notifyEmail !== false, context },
  };
}

/** Validates an admin reply body. */
export function validateFeedbackReply(body: unknown): ValidationResult<string> {
  const b = (body ?? {}) as Record<string, unknown>;
  const reply = typeof b.reply === 'string' ? b.reply.trim() : '';
  if (!reply) return { ok: false, error: 'Reply is required' };
  if (reply.length > REPLY_MAX_LENGTH) {
    return { ok: false, error: `Reply must be ${REPLY_MAX_LENGTH} characters or fewer` };
  }
  return { ok: true, value: reply };
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Short single-line excerpt, used in notification payloads and email subjects. */
export function excerpt(s: string, max = 80): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

export function categoryLabel(category: FeedbackCategory | null): string {
  return category ? CATEGORY_LABELS[category] : 'General';
}

interface EmailContent { subject: string; text: string; html: string }

function htmlParagraphs(s: string): string {
  return escapeHtml(s).replace(/\n/g, '<br>');
}

export function buildAdminFeedbackEmail(p: {
  senderName:  string;
  senderEmail: string | null;
  category:    FeedbackCategory | null;
  source:      FeedbackSource;
  message:     string;
}): EmailContent {
  const cat  = categoryLabel(p.category);
  const from = p.senderEmail ? `${p.senderName} (${p.senderEmail})` : p.senderName;
  return {
    subject: `New BurdyGurdy feedback: ${excerpt(p.message, 60)}`,
    text:
      `${from} sent feedback.\n\nCategory: ${cat}\nSent from: ${p.source}\n\n${p.message}\n\n` +
      `Log in and open the Feedback panel to reply.`,
    html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #2d6a4f;">New feedback</h2>
          <p><strong>${escapeHtml(from)}</strong> sent feedback.</p>
          <p>Category: ${escapeHtml(cat)}<br>Sent from: ${escapeHtml(p.source)}</p>
          <blockquote style="border-left: 3px solid #2d6a4f; margin: 16px 0; padding: 4px 12px; color: #333;">${htmlParagraphs(p.message)}</blockquote>
          <p style="color: #666; font-size: 13px;">Log in and open the Feedback panel to reply.</p>
        </div>
      `,
  };
}

export function buildFeedbackReplyEmail(p: {
  replierName:     string;
  originalMessage: string;
  reply:           string;
}): EmailContent {
  return {
    subject: 'A reply to your BurdyGurdy feedback',
    text:
      `${p.replierName} replied to your feedback:\n\n${p.reply}\n\n` +
      `Your original message:\n"${p.originalMessage}"\n\nThanks for helping make BurdyGurdy better!`,
    html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #2d6a4f;">Thanks for your feedback!</h2>
          <p><strong>${escapeHtml(p.replierName)}</strong> replied:</p>
          <blockquote style="border-left: 3px solid #2d6a4f; margin: 16px 0; padding: 4px 12px; color: #333;">${htmlParagraphs(p.reply)}</blockquote>
          <p style="color: #666; font-size: 13px;">Your original message:</p>
          <p style="color: #666; font-size: 13px; font-style: italic;">${htmlParagraphs(p.originalMessage)}</p>
          <p style="color: #999; font-size: 12px;">Thanks for helping make BurdyGurdy better!</p>
        </div>
      `,
  };
}
