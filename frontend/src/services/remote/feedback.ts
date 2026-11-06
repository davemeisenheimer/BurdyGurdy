import { supabase } from '../../lib/supabase';
import { api } from './api';
import type { FeedbackCategory, FeedbackContext, FeedbackSource, FeedbackStatus } from '../../lib/feedback';

export interface FeedbackItem {
  id:              string;
  userId:          string;
  userDisplayName: string | null;
  userEmail:       string | null;
  category:        FeedbackCategory | null;
  message:         string;
  source:          FeedbackSource;
  context:         FeedbackContext;
  notifyEmail:     boolean;
  status:          FeedbackStatus;
  adminReply:      string | null;
  repliedAt:       string | null;
  createdAt:       string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapFeedbackRow(d: Record<string, any>): FeedbackItem {
  return {
    id:              d.id,
    userId:          d.user_id,
    userDisplayName: d.user_display_name ?? null,
    userEmail:       d.user_email ?? null,
    category:        d.category ?? null,
    message:         d.message,
    source:          d.source,
    context:         d.context ?? {},
    notifyEmail:     d.notify_email,
    status:          d.status,
    adminReply:      d.admin_reply ?? null,
    repliedAt:       d.replied_at ?? null,
    createdAt:       d.created_at,
  };
}

async function authHeaders(): Promise<{ Authorization: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not signed in');
  return { Authorization: `Bearer ${session.access_token}` };
}

export interface SubmitFeedbackParams {
  message:     string;
  category:    FeedbackCategory | null;
  source:      FeedbackSource;
  notifyEmail: boolean;
  context:     FeedbackContext;
}

/** Without a timeout a stalled send leaves the form on "Sending…" forever. */
const SUBMIT_TIMEOUT_MS = 30_000;

export async function submitFeedback(p: SubmitFeedbackParams): Promise<void> {
  await api.post('/feedback', p, { headers: await authHeaders(), timeout: SUBMIT_TIMEOUT_MS });
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export async function fetchFeedback(status?: FeedbackStatus): Promise<FeedbackItem[]> {
  const res = await api.get<Record<string, unknown>[]>('/feedback', {
    headers: await authHeaders(),
    params:  status ? { status } : undefined,
  });
  return res.data.map(mapFeedbackRow);
}

export async function setFeedbackStatus(id: string, status: 'new' | 'read'): Promise<void> {
  await api.patch(`/feedback/${id}/status`, { status }, { headers: await authHeaders() });
}

export async function replyToFeedback(id: string, reply: string): Promise<{ repliedAt: string; emailed: boolean }> {
  const res = await api.post<{ repliedAt: string; emailed: boolean }>(
    `/feedback/${id}/reply`, { reply }, { headers: await authHeaders() },
  );
  return { repliedAt: res.data.repliedAt, emailed: res.data.emailed };
}
