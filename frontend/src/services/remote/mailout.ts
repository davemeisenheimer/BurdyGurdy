import { supabase } from '../../lib/supabase';
import { api } from './api';
import type { MailoutSendResult } from '../../lib/mailout';

export interface MailoutHistoryItem {
  id:             string;
  subject:        string;
  sentByName:     string | null;
  recipientCount: number;
  sentCount:      number | null;
  failedCount:    number | null;
  status:         'sending' | 'sent';
  createdAt:      string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapMailoutRow(d: Record<string, any>): MailoutHistoryItem {
  return {
    id:             d.id,
    subject:        d.subject,
    sentByName:     d.sent_by_name ?? null,
    recipientCount: d.recipient_count,
    sentCount:      d.sent_count ?? null,
    failedCount:    d.failed_count ?? null,
    status:         d.status,
    createdAt:      d.created_at,
  };
}

async function authHeaders(): Promise<{ Authorization: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not signed in');
  return { Authorization: `Bearer ${session.access_token}` };
}

/** Sending is one request for the whole list, at about a second per 100 recipients. */
const SEND_TIMEOUT_MS = 5 * 60_000;
const IMAGE_UPLOAD_TIMEOUT_MS = 60_000;

export async function fetchRecipientCount(): Promise<number> {
  const res = await api.get<{ count: number }>('/mailout/recipients', { headers: await authHeaders() });
  return res.data.count;
}

export async function previewMailout(subject: string, html: string): Promise<string> {
  const res = await api.post<{ html: string }>('/mailout/preview', { subject, html }, { headers: await authHeaders() });
  return res.data.html;
}

/** Sends to the signed-in admin only. Returns the address it went to. */
export async function sendTestMailout(subject: string, html: string): Promise<string> {
  const res = await api.post<{ to: string }>('/mailout/test', { subject, html }, { headers: await authHeaders() });
  return res.data.to;
}

export async function sendMailout(subject: string, html: string): Promise<MailoutSendResult> {
  const res = await api.post<MailoutSendResult>('/mailout', { subject, html }, {
    headers: await authHeaders(),
    timeout: SEND_TIMEOUT_MS,
  });
  return res.data;
}

/** Uploads an image for use in a mailout. Returns its public URL. */
export async function uploadMailoutImage(blob: Blob): Promise<string> {
  const res = await api.post<{ url: string }>('/mailout/images', blob, {
    headers: { ...(await authHeaders()), 'Content-Type': blob.type || 'application/octet-stream' },
    timeout: IMAGE_UPLOAD_TIMEOUT_MS,
  });
  return res.data.url;
}

export async function fetchMailoutHistory(): Promise<MailoutHistoryItem[]> {
  const res = await api.get<Record<string, unknown>[]>('/mailout/history', { headers: await authHeaders() });
  return res.data.map(mapMailoutRow);
}
