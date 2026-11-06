import { describe, it, expect } from 'vitest';
import { formatNotificationMessage } from './notifications';
import type { AppNotification } from './notifications';

function make(type: AppNotification['type'], data: Record<string, unknown>): AppNotification {
  return { id: '1', senderUserId: 'u', senderDisplayName: 'Robin', type, data, createdAt: '2026-11-05T00:00:00Z', read: false };
}

describe('formatNotificationMessage - feedback', () => {
  it('formats new feedback with an excerpt', () => {
    expect(formatNotificationMessage(make('new_feedback', { excerpt: 'More owls please' })))
      .toBe('New feedback from Robin: "More owls please"');
  });

  it('formats new feedback without an excerpt', () => {
    expect(formatNotificationMessage(make('new_feedback', {}))).toBe('New feedback from Robin.');
  });

  it('formats a feedback reply including the reply and original excerpt', () => {
    expect(formatNotificationMessage(make('feedback_reply', { reply: 'Coming soon!', excerpt: 'More owls' })))
      .toBe('Robin replied to your feedback "More owls": "Coming soon!"');
  });

  it('formats a feedback reply with no data', () => {
    expect(formatNotificationMessage(make('feedback_reply', {}))).toBe('Robin replied to your feedback.');
  });
});
