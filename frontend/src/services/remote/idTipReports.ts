import { supabase } from '../../lib/supabase';
import { api, type IdTipParams } from './api';
import type { IdTipIssueType, IdTipReportItem, IdTipResolution } from '../../lib/idTip';
import type { TipLibraryEntry } from '../../lib/tipLibrary';

async function authHeaders(): Promise<{ Authorization: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not signed in');
  return { Authorization: `Bearer ${session.access_token}` };
}

const SUBMIT_TIMEOUT_MS = 30_000;

export interface SubmitIdTipReportParams extends IdTipParams {
  issueType:   IdTipIssueType;
  description: string;
  notifyEmail: boolean;
  regionCode:  string | null;
}

/** Sends a player's report about an ID tip. Requires sign-in. */
export async function submitIdTipReport(p: SubmitIdTipReportParams): Promise<void> {
  await api.post('/id-tip/report', p, { headers: await authHeaders(), timeout: SUBMIT_TIMEOUT_MS });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapReportRow(d: Record<string, any>): IdTipReportItem {
  return {
    id:            d.id,
    speciesCode:   d.species_code,
    guessKey:      d.guess_key,
    photoUrl:      d.photo_url,
    comName:       d.com_name,
    sciName:       d.sci_name,
    guess:         d.guess,
    tip:           d.tip,
    issueType:     d.issue_type,
    description:   d.description,
    reporterName:  d.reporter_name ?? null,
    reporterEmail: d.reporter_email ?? null,
    regionCode:    d.region_code ?? null,
    createdAt:     d.created_at,
  };
}

/** Admin: pending ID tip reports, newest first. */
export async function fetchPendingIdTipReports(): Promise<IdTipReportItem[]> {
  const res = await api.get<Record<string, unknown>[]>('/id-tip/reports', { headers: await authHeaders() });
  return res.data.map(mapReportRow);
}

/** Admin: resolves every pending report about the same tip as `reportId`. */
export async function resolveIdTipReport(reportId: string, action: IdTipResolution, note: string | null): Promise<void> {
  await api.post(`/id-tip/reports/${reportId}/resolve`, { action, ...(note ? { note } : {}) }, { headers: await authHeaders() });
}

// ── Curator tip editing ──────────────────────────────────────────────────────

export interface StoredTip {
  tip:       string;
  model:     string;
  createdAt: string;
  editedAt:  string | null;
}

/** Admin: the tip players currently see for this key, or null when none is stored. */
export async function fetchStoredTip(p: IdTipParams): Promise<StoredTip | null> {
  const res = await api.get<{ record: StoredTip | null }>('/id-tip/admin/tip', { params: p, headers: await authHeaders() });
  return res.data.record;
}

/** Admin: asks the AI for a new tip to review. Nothing is saved. */
export async function generateTipDraft(p: IdTipParams): Promise<string> {
  const res = await api.post<{ tip: string }>('/id-tip/admin/draft', p, { headers: await authHeaders(), timeout: SUBMIT_TIMEOUT_MS });
  return res.data.tip;
}

/** Admin: saves the text players will see. */
export async function saveTip(p: IdTipParams, tip: string): Promise<StoredTip> {
  const res = await api.put<{ record: StoredTip }>('/id-tip/admin/tip', { ...p, tip }, { headers: await authHeaders() });
  return res.data.record;
}

/** Admin: every stored tip, with family, taxonomic position and report count. */
export async function fetchTipLibrary(): Promise<TipLibraryEntry[]> {
  const res = await api.get<TipLibraryEntry[]>('/id-tip/admin/tips', { headers: await authHeaders(), timeout: SUBMIT_TIMEOUT_MS });
  return res.data;
}
