import type { QuestionType } from '../types';

/** Question types whose stimulus is a photo - the only ones an ID tip can describe. */
export const ID_TIP_QUESTION_TYPES: readonly QuestionType[] = ['image', 'image-latin', 'image-song'];

export interface IdTipEligibilityInput {
  enabled: boolean;
  questionType: QuestionType;
  selectedAnswer: string | null;
  isCorrect: boolean;
  noPhoto?: boolean;
  noAudio?: boolean;
  photoUrl: string | null;
}

/** Whether a wrong answer should get an AI tip about the question photo. */
export function isIdTipEligible(i: IdTipEligibilityInput): boolean {
  return i.enabled
    && ID_TIP_QUESTION_TYPES.includes(i.questionType)
    && i.selectedAnswer !== null
    && !i.isCorrect
    && !i.noPhoto
    && !i.noAudio
    && !!i.photoUrl;
}

// ── Reports ──────────────────────────────────────────────────────────────────
// Kept in step with backend/src/lib/idTip.ts (issue types, length limits).

export const ID_TIP_ISSUE_TYPES = ['wrong_fact', 'not_visible', 'mixed_up', 'unhelpful', 'other'] as const;
export type IdTipIssueType = typeof ID_TIP_ISSUE_TYPES[number];

/** Choices shown to the player in the report dialog. */
export const ID_TIP_ISSUE_CHOICES: Record<IdTipIssueType, string> = {
  wrong_fact:  "It's wrong about this species",
  not_visible: "It mentions a feature I can't see in this photo",
  mixed_up:    'It mixes up the two birds',
  unhelpful:   "It's unhelpful or confusing",
  other:       'Other',
};

/** Short labels for badges and notifications. */
export const ID_TIP_ISSUE_LABELS: Record<IdTipIssueType, string> = {
  wrong_fact:  'Wrong fact',
  not_visible: 'Not visible',
  mixed_up:    'Mixed up',
  unhelpful:   'Unhelpful',
  other:       'Other',
};

export const ID_TIP_REPORT_MIN = 10;
export const ID_TIP_REPORT_MAX = 500;

/** The report form can be sent once an issue is chosen and the details are long enough. */
export function canSubmitIdTipReport(issueType: IdTipIssueType | null, description: string): boolean {
  const len = description.trim().length;
  return issueType !== null && len >= ID_TIP_REPORT_MIN && len <= ID_TIP_REPORT_MAX;
}

export interface IdTipReportItem {
  id: string;
  speciesCode: string;
  guessKey: string;
  photoUrl: string;
  comName: string;
  sciName: string;
  guess: string;
  tip: string;
  issueType: IdTipIssueType;
  description: string;
  reporterName: string | null;
  reporterEmail: string | null;
  regionCode: string | null;
  createdAt: string;
}

/** All pending reports about one tip (same species, guess and photo). */
export interface IdTipReportGroup {
  key: string;
  latest: IdTipReportItem;
  reports: IdTipReportItem[];
}

/**
 * Groups reports by the tip they refer to, newest group first; reports within a group newest first.
 * The group's tip text is taken from its newest report.
 */
export function groupIdTipReports(reports: IdTipReportItem[]): IdTipReportGroup[] {
  const byKey = new Map<string, IdTipReportItem[]>();
  for (const r of reports) {
    const key = `${r.speciesCode}|${r.guessKey}|${r.photoUrl}`;
    byKey.set(key, [...(byKey.get(key) ?? []), r]);
  }
  return [...byKey.entries()]
    .map(([key, items]) => {
      const sorted = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { key, latest: sorted[0], reports: sorted };
    })
    .sort((a, b) => b.latest.createdAt.localeCompare(a.latest.createdAt));
}

export type IdTipResolution = 'fixed' | 'kept' | 'dismissed';

/**
 * What the reporter's in-app notification says about the outcome. Mirrors the backend email text.
 * 'regenerated' is a retired action kept so notifications sent before it was replaced still read well.
 */
export function idTipResolutionText(action: string): string {
  switch (action) {
    case 'fixed':       return 'Thanks - you were right. The tip has been corrected.';
    case 'regenerated': return 'Thanks - you were right. The tip has been removed and a new one will be written the next time it is needed.';
    case 'kept':        return 'Your concern was noted, but after review the tip was found to be accurate, so it has been kept.';
    default:            return 'After review, this report was found to be inaccurate and has been closed.';
  }
}

// ── Curator tip editing ──────────────────────────────────────────────────────

export const ID_TIP_TEXT_MAX = 1000;

/** Save is offered only for non-blank text within the limit that differs from what is saved. */
export function canSaveTipEdit(draft: string, saved: string | null): boolean {
  const text = draft.trim();
  return text.length > 0 && text.length <= ID_TIP_TEXT_MAX && text !== (saved ?? '').trim();
}
