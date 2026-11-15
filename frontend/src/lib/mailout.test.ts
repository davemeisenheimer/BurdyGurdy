import { describe, it, expect } from 'vitest';
import {
  validateMailoutDraft,
  pluralPeople,
  confirmSendMessage,
  describeSendResult,
  describeMailoutError,
  mailoutImageBase,
  pickImageFiles,
  imageTypeError,
  imageSizeError,
  shouldScaleImage,
  scaledImageSize,
  imageDisplayWidth,
  MAILOUT_SUBJECT_MAX,
  MAILOUT_IMAGE_MAX_BYTES,
} from './mailout';

describe('mailout images', () => {
  it('builds the image bucket address, with or without a trailing slash', () => {
    const want = 'https://p.supabase.co/storage/v1/object/public/mailout-images/';
    expect(mailoutImageBase('https://p.supabase.co')).toBe(want);
    expect(mailoutImageBase('https://p.supabase.co/')).toBe(want);
  });

  it('picks only image files', () => {
    const png = new File(['x'], 'a.png', { type: 'image/png' });
    const txt = new File(['x'], 'a.txt', { type: 'text/plain' });
    expect(pickImageFiles([png, txt])).toEqual([png]);
    expect(pickImageFiles(null)).toEqual([]);
  });

  it('accepts PNG, JPEG, GIF and WebP only', () => {
    for (const t of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) expect(imageTypeError(t)).toBeNull();
    expect(imageTypeError('image/svg+xml')).toMatch(/PNG, JPEG, GIF or WebP/);
    expect(imageTypeError('image/heic')).not.toBeNull();
  });

  it('limits upload size to 5 MB', () => {
    expect(imageSizeError(MAILOUT_IMAGE_MAX_BYTES)).toBeNull();
    expect(imageSizeError(MAILOUT_IMAGE_MAX_BYTES + 1)).toMatch(/5 MB/);
  });

  it('scales only wide, non-GIF images', () => {
    expect(shouldScaleImage('image/png', 1201)).toBe(true);
    expect(shouldScaleImage('image/png', 1200)).toBe(false);
    expect(shouldScaleImage('image/gif', 4000)).toBe(false);
  });

  it('keeps the aspect ratio when scaling', () => {
    expect(scaledImageSize(2400, 1600, 1200)).toEqual({ width: 1200, height: 800 });
    expect(scaledImageSize(800, 600, 1200)).toEqual({ width: 800, height: 600 });
    expect(scaledImageSize(10000, 1, 1200)).toEqual({ width: 1200, height: 1 });
  });

  it('shows images at most 512px wide', () => {
    expect(imageDisplayWidth(1200)).toBe(512);
    expect(imageDisplayWidth(300)).toBe(300);
  });
});

describe('validateMailoutDraft', () => {
  it('accepts a subject and a non-empty message', () => {
    expect(validateMailoutDraft('Spring news', false)).toBeNull();
  });

  it('requires a subject within the limit', () => {
    expect(validateMailoutDraft('   ', false)).toMatch(/subject/);
    expect(validateMailoutDraft('x'.repeat(MAILOUT_SUBJECT_MAX + 1), false)).toMatch(/under 200/);
  });

  it('requires a message', () => {
    expect(validateMailoutDraft('Hi', true)).toMatch(/message/);
  });
});

describe('pluralPeople / confirmSendMessage', () => {
  it('pluralises correctly', () => {
    expect(pluralPeople(1)).toBe('1 person');
    expect(pluralPeople(42)).toBe('42 people');
  });

  it('names the trimmed subject and the recipient count', () => {
    expect(confirmSendMessage(' News ', 3)).toBe(`Send "News" to 3 people? This can't be undone.`);
  });
});

describe('describeSendResult', () => {
  it('reports full success, partial failure, and total failure', () => {
    expect(describeSendResult({ recipientCount: 5, sentCount: 5, failedCount: 0 })).toBe('Sent to 5 people.');
    expect(describeSendResult({ recipientCount: 5, sentCount: 4, failedCount: 1 })).toMatch(/^Sent to 4 people; 1 failed/);
    expect(describeSendResult({ recipientCount: 2, sentCount: 0, failedCount: 2 })).toMatch(/^Sending failed for all 2 people/);
  });
});

describe('describeMailoutError', () => {
  it("shows the server's error message", () => {
    const err = { response: { status: 500, data: { error: 'MAILOUT_UNSUBSCRIBE_SECRET is not set on the server.' } } };
    expect(describeMailoutError(err, 'fallback')).toBe('MAILOUT_UNSUBSCRIBE_SECRET is not set on the server.');
  });

  it('falls back for errors without a server message', () => {
    expect(describeMailoutError({ response: { status: 500, data: {} } }, 'fallback')).toBe('fallback');
    expect(describeMailoutError({ code: 'ECONNABORTED' }, 'fallback')).toMatch(/taking too long/);
  });
});
