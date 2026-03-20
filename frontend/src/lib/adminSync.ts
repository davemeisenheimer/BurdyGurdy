/**
 * Admin-only Supabase operations for the curation panel.
 * These calls succeed only when the signed-in user has is_admin: true in their
 * Supabase user metadata, enforced by RLS on the media_reports tables.
 */
import { supabase } from './supabase';

export interface MediaReportSubmission {
  id:            string;
  reporterId:    string;
  reporterEmail: string | null;
  issueType:     'wrong_bird' | 'poor_quality' | 'confusing' | 'other';
  wrongBird:     string | null;
  description:   string | null;
  createdAt:     string;
}

export interface MediaReport {
  id:          string;
  url:         string;
  mediaType:   'photo' | 'audio';
  service:     string | null;
  speciesCode: string;
  comName:     string;
  status:      'pending' | 'blocked' | 'invalidated';
  blockScope:  'full' | 'question' | null;
  createdAt:   string;
  resolvedAt:  string | null;
  submissions: MediaReportSubmission[];
}

function mapReport(r: Record<string, unknown>): MediaReport {
  const subs = (r.media_report_submissions as Record<string, unknown>[] | null) ?? [];
  return {
    id:          r.id          as string,
    url:         r.url         as string,
    mediaType:   r.media_type  as 'photo' | 'audio',
    service:     r.service     as string | null,
    speciesCode: r.species_code as string,
    comName:     r.com_name    as string,
    status:      r.status      as 'pending' | 'blocked' | 'invalidated',
    blockScope:  r.block_scope as 'full' | 'question' | null,
    createdAt:   r.created_at  as string,
    resolvedAt:  r.resolved_at as string | null,
    submissions: subs.map(s => ({
      id:            s.id             as string,
      reporterId:    s.reporter_id    as string,
      reporterEmail: s.reporter_email as string | null,
      issueType:     s.issue_type     as MediaReportSubmission['issueType'],
      wrongBird:     s.wrong_bird     as string | null,
      description:   s.description   as string | null,
      createdAt:     s.created_at     as string,
    })),
  };
}

export async function fetchPendingReports(): Promise<MediaReport[]> {
  const { data, error } = await supabase
    .from('media_reports')
    .select('*, media_report_submissions(*)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(mapReport);
}

export async function fetchBlockedReports(): Promise<MediaReport[]> {
  const { data, error } = await supabase
    .from('media_reports')
    .select('*, media_report_submissions(*)')
    .eq('status', 'blocked')
    .order('resolved_at', { ascending: false });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(mapReport);
}

export async function blockReport(id: string, blockScope: 'full' | 'question'): Promise<void> {
  const { error } = await supabase
    .from('media_reports')
    .update({ status: 'blocked', block_scope: blockScope, resolved_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function invalidateReport(id: string): Promise<void> {
  const { error } = await supabase
    .from('media_reports')
    .update({ status: 'invalidated', resolved_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteReport(id: string): Promise<void> {
  const { error } = await supabase
    .from('media_reports')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

export async function unblockReport(id: string): Promise<void> {
  const { error } = await supabase
    .from('media_reports')
    .update({ status: 'pending', block_scope: null, resolved_at: null })
    .eq('id', id);
  if (error) throw error;
}
