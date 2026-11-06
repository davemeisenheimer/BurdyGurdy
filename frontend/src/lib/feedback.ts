// Pure logic for the user-feedback feature. Must stay in sync with backend/src/lib/feedback.ts.
import { classifyRequestError, describeRequestError } from './requestDiagnostics';

export type FeedbackCategory = 'like' | 'dislike' | 'idea' | 'bug' | 'other';
export type FeedbackSource   = 'notifications' | 'settings' | 'mastery';
export type FeedbackStatus   = 'new' | 'read' | 'replied';

export const FEEDBACK_MAX_LENGTH = 2000;

export const FEEDBACK_CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: 'like',    label: '👍 Like' },
  { value: 'dislike', label: '👎 Dislike' },
  { value: 'idea',    label: '💡 Idea' },
  { value: 'bug',     label: '🐞 Bug' },
  { value: 'other',   label: 'Other' },
];

export function categoryLabel(category: FeedbackCategory | null): string {
  return FEEDBACK_CATEGORIES.find(c => c.value === category)?.label ?? 'General';
}

export interface FeedbackContext {
  appVersion?: string;
  regionCode?: string;
  userAgent?:  string;
}

/** Builds the context sent with feedback, omitting blank values. */
export function buildFeedbackContext(p: FeedbackContext): FeedbackContext {
  const out: FeedbackContext = {};
  for (const key of ['appVersion', 'regionCode', 'userAgent'] as const) {
    const v = p[key]?.trim();
    if (v) out[key] = v;
  }
  return out;
}

/** Returns an error message for an invalid message, or null when it can be sent. */
export function validateFeedbackMessage(message: string): string | null {
  const trimmed = message.trim();
  if (!trimmed) return 'Please write a message.';
  if (trimmed.length > FEEDBACK_MAX_LENGTH) return `Please keep it under ${FEEDBACK_MAX_LENGTH} characters.`;
  return null;
}

/** User-facing message for a failed feedback submission. */
export function describeFeedbackError(err: unknown): string {
  const c = classifyRequestError(err);
  if (c.kind === 'http' && c.status === 401) {
    return 'Your sign-in seems to have expired. Please sign out and back in, then try again.';
  }
  if (c.kind === 'http' && c.status === 503) {
    return "We couldn't verify your sign-in just now. Please try again in a moment.";
  }
  return describeRequestError(err, 'Sorry - your feedback could not be sent. Please try again.');
}

/** The mastery dialog shows a prominent feedback callout on the 1st and every Nth showing. */
export const FEEDBACK_CALLOUT_INTERVAL = 5;

/** `showCount` is the 1-based number of times the mastery dialog has been shown, including this one. */
export function shouldShowFeedbackCallout(showCount: number, interval = FEEDBACK_CALLOUT_INTERVAL): boolean {
  if (showCount < 1) return false;
  return showCount === 1 || showCount % interval === 0;
}
