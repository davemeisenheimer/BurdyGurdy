import { supabase } from './supabase';
import { api } from '../services/remote/api';
import type { BirdProgress } from '../types';

export interface Profile {
  id: string;
  display_name: string;
}

export interface Friend {
  userId: string;
  displayName: string;
}

export interface SentInvite {
  token: string;
  toEmail: string;
  createdAt: string;
}

export interface InviteDetails {
  token: string;
  fromUserId: string;
  fromDisplayName: string;
  toEmail: string;
  status: 'pending' | 'accepted' | 'expired';
  expiresAt: string;
}

/** Creates a profile for the user if one doesn't exist yet. Returns the profile. */
export async function ensureProfile(userId: string, email: string): Promise<Profile> {
  const defaultName = email.split('@')[0];
  // Upsert with ignoreDuplicates: existing rows are untouched, new rows get the email prefix as default name.
  // This avoids the 409 race condition that occurs with a separate INSERT when effects run twice.
  await supabase
    .from('profiles')
    .upsert({ id: userId, display_name: defaultName }, { onConflict: 'id', ignoreDuplicates: true });
  const { data } = await supabase
    .from('profiles')
    .select('id, display_name')
    .eq('id', userId)
    .single();
  return data as Profile;
}

export async function updateDisplayName(userId: string, displayName: string): Promise<void> {
  await supabase
    .from('profiles')
    .update({ display_name: displayName })
    .eq('id', userId);
}

export async function getMyFriends(userId: string): Promise<Friend[]> {
  const { data: friendships } = await supabase
    .from('friendships')
    .select('user_id_a, user_id_b')
    .or(`user_id_a.eq.${userId},user_id_b.eq.${userId}`);
  if (!friendships?.length) return [];

  const friendIds = friendships.map(f =>
    f.user_id_a === userId ? f.user_id_b : f.user_id_a,
  );
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name')
    .in('id', friendIds);

  return (profiles ?? []).map(p => ({ userId: p.id, displayName: p.display_name }));
}

export async function getSentInvites(userId: string): Promise<SentInvite[]> {
  const { data } = await supabase
    .from('friend_invites')
    .select('token, to_email, created_at')
    .eq('from_user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  return (data ?? []).map(d => ({
    token: d.token,
    toEmail: d.to_email,
    createdAt: d.created_at,
  }));
}

export async function getReceivedPendingInvites(email: string): Promise<InviteDetails[]> {
  const { data } = await supabase
    .from('friend_invites')
    .select('token, from_user_id, from_display_name, to_email, status, expires_at')
    .eq('to_email', email)
    .eq('status', 'pending');
  return (data ?? []).map(d => ({
    token: d.token,
    fromUserId: d.from_user_id,
    fromDisplayName: d.from_display_name,
    toEmail: d.to_email,
    status: d.status as InviteDetails['status'],
    expiresAt: d.expires_at,
  }));
}

export async function getInviteByToken(token: string): Promise<InviteDetails | null> {
  const { data } = await supabase
    .from('friend_invites')
    .select('token, from_user_id, from_display_name, to_email, status, expires_at')
    .eq('token', token)
    .single();
  if (!data) return null;
  return {
    token: data.token,
    fromUserId: data.from_user_id,
    fromDisplayName: data.from_display_name,
    toEmail: data.to_email,
    status: data.status,
    expiresAt: data.expires_at,
  };
}

export async function sendInvite(
  userId: string,
  fromDisplayName: string,
  toEmail: string,
): Promise<{ ok: boolean; error?: string }> {
  // Write invite record to Supabase
  const { data: invite, error } = await supabase
    .from('friend_invites')
    .insert({ from_user_id: userId, from_display_name: fromDisplayName, to_email: toEmail })
    .select('token')
    .single();
  if (error || !invite) return { ok: false, error: error?.message ?? 'Failed to create invite' };

  // Ask backend to send the email
  try {
    await api.post('/friends/send-invite-email', {
      token: invite.token,
      toEmail,
      fromDisplayName,
      appUrl: window.location.origin,
    });
    return { ok: true };
  } catch (err: unknown) {
    let detail = 'unknown error';
    if (err && typeof err === 'object' && 'response' in err) {
      // Axios error — response body is already parsed in .response.data
      const data = (err as { response: { data?: { error?: string } } }).response.data;
      detail = data?.error ?? 'unknown error';
    } else if (err instanceof Error) {
      detail = err.message;
    }
    return { ok: false, error: `Invite saved but email could not be sent: ${detail}` };
  }
}

export async function declineInvite(token: string): Promise<void> {
  await supabase.from('friend_invites').delete().eq('token', token);
}

export async function acceptInvite(
  token: string,
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  const invite = await getInviteByToken(token);
  if (!invite) return { ok: false, error: 'Invite not found' };
  if (invite.status !== 'pending') return { ok: false, error: 'This invite has already been used' };
  if (new Date(invite.expiresAt) < new Date()) return { ok: false, error: 'This invite has expired' };

  if (invite.fromUserId === userId) {
    return { ok: false, error: 'You cannot accept your own invite' };
  }

  // Insert with JS-ordered pair first; if the DB's collation orders them differently,
  // Postgres will reject with check constraint 23514 — retry with the pair swapped.
  const pair1 = invite.fromUserId < userId
    ? { user_id_a: invite.fromUserId, user_id_b: userId }
    : { user_id_a: userId, user_id_b: invite.fromUserId };
  let { error: friendshipError } = await supabase.from('friendships').insert(pair1);

  if (friendshipError?.code === '23514') {
    // Ordering constraint fired — DB collation differs from JS; try the reversed pair
    const pair2 = { user_id_a: pair1.user_id_b, user_id_b: pair1.user_id_a };
    ({ error: friendshipError } = await supabase.from('friendships').insert(pair2));
  }

  if (friendshipError && !friendshipError.message.includes('unique')) {
    return { ok: false, error: friendshipError.message };
  }

  await supabase.from('friend_invites').delete().eq('token', token);

  return { ok: true };
}

/** Fetches a friend's cloud-synced progress records (requires the friends-can-read RLS policy). */
export async function fetchFriendProgress(friendUserId: string): Promise<BirdProgress[]> {
  const { data } = await supabase
    .from('bird_progress')
    .select('species_code, question_type, com_name, correct, incorrect, last_asked, weight, favourited, excluded, mastery_level, consecutive_correct, in_history')
    .eq('user_id', friendUserId);
  return (data ?? []).map(d => ({
    speciesCode:        d.species_code,
    questionType:       d.question_type,
    comName:            d.com_name,
    correct:            d.correct,
    incorrect:          d.incorrect,
    lastAsked:          d.last_asked,
    weight:             d.weight,
    favourited:         d.favourited  ?? false,
    excluded:           d.excluded    ?? false,
    masteryLevel:       d.mastery_level       ?? 0,
    consecutiveCorrect: d.consecutive_correct ?? 0,
    isMastered:         d.in_history  ?? false,
  }));
}

/** Sends a notification to the current user's friends via the backend. Best-effort. */
export async function notifyFriends(
  type: 'login' | 'victory' | 'logout',
  data: Record<string, unknown>,
  accessToken: string,
): Promise<void> {
  await api.post('/friends/notify', { type, data }, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}
