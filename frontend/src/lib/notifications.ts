import { supabase } from './supabase';

export interface AppNotification {
  id: string;
  senderUserId: string;
  senderDisplayName: string;
  type: 'login' | 'victory' | 'logout' | 'session';
  data: Record<string, unknown>;
  createdAt: string;
  read: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapNotificationRow(d: Record<string, any>): AppNotification {
  return {
    id: d.id,
    senderUserId: d.sender_user_id,
    senderDisplayName: d.sender_display_name,
    type: d.type as AppNotification['type'],
    data: d.data ?? {},
    createdAt: d.created_at,
    read: d.read,
  };
}

export async function fetchNotifications(userId: string): Promise<AppNotification[]> {
  const { data } = await supabase
    .from('notifications')
    .select('id, sender_user_id, sender_display_name, type, data, created_at, read')
    .eq('recipient_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(200);
  return (data ?? []).map(mapNotificationRow);
}

export async function markNotificationsRead(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await supabase.from('notifications').update({ read: true }).in('id', ids);
}

export async function deleteNotifications(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await supabase.from('notifications').delete().in('id', ids);
}

export function formatNotificationMessage(n: AppNotification): string {
  const name = n.senderDisplayName;
  switch (n.type) {
    case 'login':
      return `${name} just started a session.`;
    case 'victory': {
      const d = n.data as { masteryDesc?: string; windowDesc?: string; regionCode?: string };
      return `${name} achieved Local Legend status! They can identify birds in ${d.regionCode ?? 'their region'} by their ${d.masteryDesc ?? 'all question types'} ${d.windowDesc ?? ''}.`.trim();
    }
    case 'logout': {
      const d = n.data as { questionsAnswered?: number; roundsCompleted?: number; birdsMasteredCount?: number };
      const q = d.questionsAnswered ?? 0;
      const r = d.roundsCompleted ?? 0;
      const m = d.birdsMasteredCount ?? 0;
      const masteryPart = m > 0 ? `, mastering ${m} bird${m !== 1 ? 's' : ''}` : '';
      return `${name} signed out after answering ${q} question${q !== 1 ? 's' : ''} in ${r} round${r !== 1 ? 's' : ''}${masteryPart}.`;
    }
    case 'session': {
      const d = n.data as { questionsAnswered?: number; roundsCompleted?: number; birdsMasteredCount?: number };
      const q = d.questionsAnswered ?? 0;
      const r = d.roundsCompleted ?? 0;
      const m = d.birdsMasteredCount ?? 0;
      const masteryPart = m > 0 ? `, mastering ${m} bird${m !== 1 ? 's' : ''}` : '';
      return `${name} played ${r} round${r !== 1 ? 's' : ''}, answering ${q} question${q !== 1 ? 's' : ''}${masteryPart}.`;
    }
    default:
      return `New notification from ${name}.`;
  }
}
