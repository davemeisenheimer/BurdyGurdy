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

describe('formatNotificationMessage - ID tip reports', () => {
  it('formats a new ID tip report for admins with the tip issue label', () => {
    expect(formatNotificationMessage(make('new_report', { comName: "Cooper's Hawk", mediaType: 'ID tip', issueType: 'not_visible' })))
      .toBe("New ID tip report for Cooper's Hawk - feature not visible in photo (submitted by Robin).");
  });

  it('tells the reporter a tip was regenerated, including the guess and the reviewer note', () => {
    expect(formatNotificationMessage(make('tip_report_resolved', {
      action: 'regenerated', comName: "Cooper's Hawk", guess: 'Sharp-shinned Hawk', note: 'Good catch.',
    }))).toBe(
      "Your report about the ID tip for Cooper's Hawk (when you answered Sharp-shinned Hawk) has been reviewed. "
      + 'Thanks - you were right. The tip has been removed and a new one will be written the next time it is needed. '
      + 'Note from reviewer: "Good catch."',
    );
  });

  it('formats a kept tip without a note or guess', () => {
    expect(formatNotificationMessage(make('tip_report_resolved', { action: 'kept', comName: 'Downy Woodpecker' })))
      .toBe('Your report about the ID tip for Downy Woodpecker has been reviewed. Your concern was noted, but after review the tip was found to be accurate, so it has been kept.');
  });
});

describe('formatNotificationMessage - fixed ID tip', () => {
  it('tells the reporter the tip was corrected', () => {
    expect(formatNotificationMessage(make('tip_report_resolved', { action: 'fixed', comName: "Cooper's Hawk", guess: 'Sharp-shinned Hawk' })))
      .toBe("Your report about the ID tip for Cooper's Hawk (when you answered Sharp-shinned Hawk) has been reviewed. Thanks - you were right. The tip has been corrected.");
  });
});
