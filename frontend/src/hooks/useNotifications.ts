import { useState, useRef, useEffect } from 'react';
import type { SupabaseUser } from '../lib/supabase';
import { supabase } from '../lib/supabase';
import type { AppNotification } from '../lib/notifications';
import { fetchNotifications, formatNotificationMessage, mapNotificationRow, deleteNotifications } from '../lib/notifications';
import { notifyFriends } from '../lib/friends';
import type { ToastData } from '../components/ui/Toast';

export function useNotifications({
  user,
  screen,
  onViewNotifications,
}: {
  user: SupabaseUser | null;
  screen: string;
  onViewNotifications: () => void;
}) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [hasUnread, setHasUnread]         = useState(false);
  const [currentToast, setCurrentToast]   = useState<ToastData | null>(null);
  const lastToastTimeRef                  = useRef<number>(0);
  const pendingToastTimerRef              = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Session stats - refs so they don't trigger re-renders
  const sessionQuestionsRef       = useRef(0);
  const sessionRoundsRef          = useRef(0);
  const sessionMasteredRef        = useRef(0);
  const sessionInitialMasteredRef = useRef(0);

  // Keep mutable values current via refs so Realtime callbacks (which close over
  // a stale render) always see the latest screen and navigation callback.
  const screenRef             = useRef(screen);
  const onViewNotificationsRef = useRef(onViewNotifications);
  useEffect(() => { screenRef.current = screen; });
  useEffect(() => { onViewNotificationsRef.current = onViewNotifications; });

  async function sendFriendNotification(
    type: 'login' | 'victory' | 'logout' | 'session',
    data: Record<string, unknown>,
    accessToken?: string,
  ) {
    try {
      const token = accessToken ?? (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) return;
      await notifyFriends(type, data, token);
    } catch { /* best-effort */ }
  }

  function showToast(message: string, actionLabel?: string, onAction?: () => void) {
    setCurrentToast({ id: String(Date.now()), message, actionLabel, onAction });
    lastToastTimeRef.current = Date.now();
    if (pendingToastTimerRef.current) {
      clearTimeout(pendingToastTimerRef.current);
      pendingToastTimerRef.current = null;
    }
  }

  function handleNewNotification(n: AppNotification) {
    setNotifications(prev => {
      if (n.type === 'login') {
        const mostRecentFromSender = prev.find(x => x.senderUserId === n.senderUserId);
        if (mostRecentFromSender?.type === 'login') {
          deleteNotifications([mostRecentFromSender.id]).catch(() => {});
          return prev.map(x => x.id === mostRecentFromSender.id ? n : x);
        }
      }
      return [n, ...prev];
    });
    setHasUnread(true);
    if (screenRef.current === 'notifications') return;

    const FIFTEEN_MINS = 15 * 60 * 1000;
    const now = Date.now();
    if (now - lastToastTimeRef.current >= FIFTEEN_MINS) {
      showToast(formatNotificationMessage(n));
    } else if (!pendingToastTimerRef.current) {
      const remaining = FIFTEEN_MINS - (now - lastToastTimeRef.current);
      pendingToastTimerRef.current = setTimeout(() => {
        pendingToastTimerRef.current = null;
        setNotifications(current => {
          const unread = current.filter(x => !x.read);
          if (!unread.length) return current;
          if (unread.length === 1) {
            showToast(formatNotificationMessage(unread[0]));
          } else {
            showToast(`You have ${unread.length} new notifications.`, 'View', () => onViewNotificationsRef.current());
          }
          return current;
        });
      }, remaining);
    }
  }

  async function sendSessionNotification() {
    if (sessionRoundsRef.current === 0) return;
    await sendFriendNotification('session', {
      questionsAnswered:  sessionQuestionsRef.current,
      roundsCompleted:    sessionRoundsRef.current,
      birdsMasteredCount: sessionMasteredRef.current,
    });
    sessionQuestionsRef.current = 0;
    sessionRoundsRef.current    = 0;
    sessionMasteredRef.current  = 0;
  }

  async function performSignOut() {
    if (sessionRoundsRef.current > 0) {
      await sendSessionNotification();
    } else {
      await sendFriendNotification('logout', {});
    }
    supabase.auth.signOut();
  }

  // Load notifications and subscribe to Realtime inserts for the signed-in user
  useEffect(() => {
    if (!user) { setNotifications([]); setHasUnread(false); return; }
    fetchNotifications(user.id)
      .then(ns => { setNotifications(ns); setHasUnread(ns.some(n => !n.read)); })
      .catch(() => {});

    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_user_id=eq.${user.id}` },
        payload => { handleNewNotification(mapNotificationRow(payload.new as Record<string, unknown>)); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return {
    notifications,
    setNotifications,
    hasUnread,
    setHasUnread,
    currentToast,
    setCurrentToast,
    sendFriendNotification,
    sendSessionNotification,
    performSignOut,
    sessionQuestionsRef,
    sessionRoundsRef,
    sessionMasteredRef,
    sessionInitialMasteredRef,
  };
}
