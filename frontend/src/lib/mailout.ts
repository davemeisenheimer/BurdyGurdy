// Pure logic for the admin mailout panel. Limits must stay in sync with backend/src/lib/mailout.ts.
import { classifyRequestError, describeRequestError } from './requestDiagnostics';

export const MAILOUT_SUBJECT_MAX = 200;

/** Returns a message explaining why the draft can't be sent yet, or null when it can. */
export function validateMailoutDraft(subject: string, messageIsEmpty: boolean): string | null {
  const s = subject.trim();
  if (!s) return 'Please enter a subject.';
  if (s.length > MAILOUT_SUBJECT_MAX) return `Please keep the subject under ${MAILOUT_SUBJECT_MAX} characters.`;
  if (messageIsEmpty) return 'Please write a message.';
  return null;
}

export function pluralPeople(n: number): string {
  return `${n} ${n === 1 ? 'person' : 'people'}`;
}

export function confirmSendMessage(subject: string, recipientCount: number): string {
  return `Send "${subject.trim()}" to ${pluralPeople(recipientCount)}? This can't be undone.`;
}

export interface MailoutSendResult { recipientCount: number; sentCount: number; failedCount: number }

export function describeSendResult(r: MailoutSendResult): string {
  if (r.failedCount === 0) return `Sent to ${pluralPeople(r.sentCount)}.`;
  if (r.sentCount === 0) return `Sending failed for all ${pluralPeople(r.failedCount)}. Check the server logs for details.`;
  return `Sent to ${pluralPeople(r.sentCount)}; ${r.failedCount} failed. Check the server logs for details.`;
}

/** Shows the server's own error message when it gave one (e.g. a missing setting). */
export function describeMailoutError(err: unknown, fallback: string): string {
  const c = classifyRequestError(err);
  const serverMessage = (c.payload as { error?: unknown } | undefined)?.error;
  if (c.kind === 'http' && typeof serverMessage === 'string' && serverMessage) return serverMessage;
  return describeRequestError(err, fallback);
}

// ── Images ────────────────────────────────────────────────────────────────────

export const MAILOUT_IMAGE_TYPES     = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const MAILOUT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** Images are scaled down to this width before upload: sharp on high-density screens, but not huge. */
export const MAILOUT_IMAGE_UPLOAD_WIDTH = 1200;
/** Widest an image is shown in the email (its 560px column minus padding). */
export const MAILOUT_IMAGE_DISPLAY_WIDTH = 512;
const MAILOUT_IMAGE_BUCKET = 'mailout-images';

/** Public URL of the image bucket, ending in "/". The server keeps only images from here. */
export function mailoutImageBase(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${MAILOUT_IMAGE_BUCKET}/`;
}

/** The image files among pasted or dropped files. */
export function pickImageFiles(files: ArrayLike<File> | null | undefined): File[] {
  return Array.from(files ?? []).filter(f => f.type.startsWith('image/'));
}

export function imageTypeError(type: string): string | null {
  return MAILOUT_IMAGE_TYPES.includes(type) ? null : 'Please use a PNG, JPEG, GIF or WebP image.';
}

export function imageSizeError(bytes: number): string | null {
  return bytes <= MAILOUT_IMAGE_MAX_BYTES ? null : `That image is too large (${MAILOUT_IMAGE_MAX_BYTES / (1024 * 1024)} MB max).`;
}

/** GIFs are left alone so they keep their animation; others are scaled down only when wider than the limit. */
export function shouldScaleImage(type: string, width: number): boolean {
  return type !== 'image/gif' && width > MAILOUT_IMAGE_UPLOAD_WIDTH;
}

export function scaledImageSize(width: number, height: number, maxWidth: number): { width: number; height: number } {
  if (width <= maxWidth) return { width, height };
  return { width: maxWidth, height: Math.max(1, Math.round(height * maxWidth / width)) };
}

/** The width an image is shown at in the message. */
export function imageDisplayWidth(width: number): number {
  return Math.min(width, MAILOUT_IMAGE_DISPLAY_WIDTH);
}
