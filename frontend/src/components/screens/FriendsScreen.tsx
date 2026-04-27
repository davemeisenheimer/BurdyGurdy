import { useState, useEffect, useCallback } from 'react';
import {
  ensureProfile, updateDisplayName, getMyFriends,
  getSentInvites, sendInvite, acceptInvite, declineInvite, getReceivedPendingInvites,
} from '../../lib/friends';
import type { Profile, Friend, SentInvite, InviteDetails } from '../../lib/friends';

interface Props {
  userId: string | null;
  userEmail: string | null;
  onBack: () => void;
  onViewFriendLifeList: (friendUserId: string, displayName: string) => void;
}

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export function FriendsScreen({ userId, userEmail, onBack, onViewFriendLifeList }: Props) {
  const [profile, setProfile]           = useState<Profile | null>(null);
  const [friends, setFriends]           = useState<Friend[]>([]);
  const [sentInvites, setSentInvites]   = useState<SentInvite[]>([]);
  const [loading, setLoading]           = useState(true);

  // Pending invites addressed to this user
  const [pendingInvites, setPendingInvites] = useState<InviteDetails[]>([]);
  const [inviteLoading, setInviteLoading]   = useState(false);
  const [inviteMsg, setInviteMsg]           = useState('');

  // Invite form
  const [inviteEmail, setInviteEmail]   = useState('');
  const [sending, setSending]           = useState(false);
  const [sendMsg, setSendMsg]           = useState('');

  // Display name editing
  const [editingName, setEditingName]   = useState(false);
  const [nameInput, setNameInput]       = useState('');
  const [savingName, setSavingName]     = useState(false);

  const load = useCallback(async () => {
    if (!userId || !userEmail) { setLoading(false); return; }
    setLoading(true);
    const [p, f, s, received] = await Promise.all([
      ensureProfile(userId, userEmail),
      getMyFriends(userId),
      getSentInvites(userId),
      getReceivedPendingInvites(userEmail),
    ]);
    setProfile(p);
    setNameInput(p.display_name);
    setFriends(f);
    setSentInvites(s);
    setPendingInvites(received);
    setLoading(false);
  }, [userId, userEmail]);

  useEffect(() => { load(); }, [load]);

  async function handleAccept(token: string, fromDisplayName: string) {
    if (!userId) return;
    setInviteLoading(true);
    const result = await acceptInvite(token, userId);
    if (result.ok) {
      sessionStorage.removeItem('pendingInvite');
      setPendingInvites(prev => prev.filter(i => i.token !== token));
      setInviteMsg(`You are now friends with ${fromDisplayName}!`);
      load();
    } else {
      setInviteMsg(result.error ?? 'Something went wrong');
    }
    setInviteLoading(false);
  }

  async function handleDecline(token: string) {
    sessionStorage.removeItem('pendingInvite');
    setPendingInvites(prev => prev.filter(i => i.token !== token));
    await declineInvite(token);
  }

  async function handleSendInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!userId || !profile || !inviteEmail.trim()) return;
    setSending(true);
    setSendMsg('');
    try {
      const result = await sendInvite(userId, profile.display_name, inviteEmail.trim());
      if (result.ok) {
        setSendMsg(`Invite sent to ${inviteEmail.trim()}!`);
        setInviteEmail('');
        getSentInvites(userId).then(setSentInvites);
      } else {
        setSendMsg(result.error ?? 'Failed to send invite');
      }
    } catch {
      setSendMsg('Failed to send invite');
    } finally {
      setSending(false);
    }
  }

  async function handleSaveName() {
    if (!userId || !nameInput.trim()) return;
    setSavingName(true);
    await updateDisplayName(userId, nameInput.trim());
    setProfile(p => p ? { ...p, display_name: nameInput.trim() } : p);
    setEditingName(false);
    setSavingName(false);
  }

  if (!userId) {
    return (
      <div className="h-dvh flex flex-col bg-slate-50">
        <div className="shrink-0 flex items-center gap-3 px-4 py-4 bg-sky-700">
          <button onClick={onBack} className="text-white/80 hover:text-white text-4xl leading-none">←</button>
          <h1 className="font-semibold text-white">Friends</h1>
        </div>
        <div className="max-w-2xl mx-auto w-full px-4 flex flex-col flex-1 min-h-0">
          <div className="text-slate-500 text-sm mt-8 text-center">
            Sign in to use the Friends feature.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh flex flex-col bg-slate-50">
      <div className="shrink-0 flex items-center gap-3 px-4 py-4 bg-sky-700">
        <button onClick={onBack} className="text-white/80 hover:text-white text-4xl leading-none">←</button>
        <h1 className="font-semibold text-white">Friends</h1>
      </div>
      <div className="max-w-2xl mx-auto w-full px-4 flex flex-col flex-1 min-h-0">

        <div className="overflow-y-auto flex-1 space-y-4 py-4">

          {/* Pending received invites */}
          {pendingInvites.map(invite => (
            <div key={invite.token} className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
              {invite.fromUserId === userId ? (
                <p className="text-slate-700 text-sm">
                  This invite was sent from the account that is currently signed in. Log out and log
                  in as <strong>{invite.toEmail}</strong> to accept it. If{' '}
                  <strong>{invite.toEmail}</strong> does not already have an account, then you
                  will need to create one.
                </p>
              ) : (
                <>
                  <p className="text-slate-700 font-medium mb-3">
                    🤝 <strong>{invite.fromDisplayName}</strong> has invited you to be friends!
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAccept(invite.token, invite.fromDisplayName)}
                      disabled={inviteLoading}
                      className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm disabled:opacity-50"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => handleDecline(invite.token)}
                      disabled={inviteLoading}
                      className="px-4 py-2 rounded-lg border border-slate-300 hover:bg-slate-100 text-slate-600 font-medium text-sm disabled:opacity-50"
                    >
                      Decline
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
          {inviteMsg && (
            <p className="text-sm text-emerald-700 font-medium">{inviteMsg}</p>
          )}

          {/* Display name */}
          {!loading && profile && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Your name</p>
              {editingName ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={nameInput}
                    onChange={e => setNameInput(e.target.value)}
                    className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-forest-500"
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setEditingName(false); }}
                    autoFocus
                  />
                  <button
                    onClick={handleSaveName}
                    disabled={savingName || !nameInput.trim()}
                    className="px-3 py-2 rounded-lg bg-forest-600 hover:bg-forest-700 text-white text-sm font-medium disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => { setEditingName(false); setNameInput(profile.display_name); }}
                    className="px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-100 text-slate-600 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-slate-800 font-medium">{profile.display_name}</span>
                  <button
                    onClick={() => setEditingName(true)}
                    className="text-xs text-slate-400 hover:text-slate-600 underline"
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Invite form */}
          {!loading && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Invite a Friend</p>
              <form onSubmit={handleSendInvite} className="flex gap-2">
                <input
                  type="email"
                  placeholder="friend@example.com"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-forest-500"
                />
                <button
                  type="submit"
                  disabled={sending || !inviteEmail.trim()}
                  className="px-4 py-2 rounded-lg bg-forest-600 hover:bg-forest-700 text-white text-sm font-medium disabled:opacity-50"
                >
                  {sending ? 'Sending…' : 'Send Invite'}
                </button>
              </form>
              {sendMsg && (
                <p className={`text-xs mt-2 ${sendMsg.startsWith('Invite sent') ? 'text-emerald-600' : 'text-red-600'}`}>
                  {sendMsg}
                </p>
              )}
            </div>
          )}

          {/* Friends list */}
          {!loading && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                Friends {friends.length > 0 && `(${friends.length})`}
              </p>
              {friends.length === 0 ? (
                <p className="text-sm text-slate-400">No friends yet - send an invite above!</p>
              ) : (
                <ul className="space-y-2">
                  {friends.map(f => (
                    <li key={f.userId} className="flex items-center justify-between">
                      <span className="text-sm text-slate-700 font-medium">{f.displayName}</span>
                      <button
                        onClick={() => onViewFriendLifeList(f.userId, f.displayName)}
                        className="text-xs text-forest-600 hover:text-forest-800 underline"
                      >
                        Life List
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Pending sent invites */}
          {!loading && sentInvites.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                Pending Invites ({sentInvites.length})
              </p>
              <ul className="space-y-2">
                {sentInvites.map(inv => (
                  <li key={inv.token} className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">{inv.toEmail}</span>
                    <span className="text-slate-400 text-xs">{timeAgo(inv.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {loading && (
            <div className="text-sm text-slate-400 text-center pt-8">Loading…</div>
          )}

        </div>
      </div>
    </div>
  );
}
