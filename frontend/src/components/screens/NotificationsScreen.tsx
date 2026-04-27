import { useState, useEffect, useMemo } from 'react';
import type { AppNotification } from '../../lib/notifications';
import { markNotificationsRead, deleteNotifications, formatNotificationMessage } from '../../lib/notifications';

interface Props {
  notifications: AppNotification[];
  onBack: () => void;
  onNotificationsRead: (ids: string[]) => void;
  onDeleteNotifications: (ids: string[]) => void;
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1)   return 'just now';
  if (diffMins < 60)  return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24)   return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7)   return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function NotificationsScreen({ notifications, onBack, onNotificationsRead, onDeleteNotifications }: Props) {
  const [expandedSender, setExpandedSender] = useState<string | null>(null);

  // Group by sender, sorted by most recent
  const grouped = useMemo(() => {
    const map = new Map<string, { displayName: string; items: AppNotification[] }>();
    for (const n of notifications) {
      const existing = map.get(n.senderUserId);
      if (existing) {
        existing.items.push(n);
      } else {
        map.set(n.senderUserId, { displayName: n.senderDisplayName, items: [n] });
      }
    }
    // Sort each group's items newest-first, then sort groups by their most recent item
    return [...map.entries()]
      .map(([userId, { displayName, items }]) => {
        const sorted = [...items].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        return { userId, displayName, items: sorted, hasUnread: sorted.some(n => !n.read), latest: sorted[0] };
      })
      .sort((a, b) => new Date(b.latest.createdAt).getTime() - new Date(a.latest.createdAt).getTime());
  }, [notifications]);

  // Mark all as read when the screen mounts
  useEffect(() => {
    const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
    if (!unreadIds.length) return;
    markNotificationsRead(unreadIds).catch(() => {});
    onNotificationsRead(unreadIds);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="h-dvh flex flex-col bg-slate-50">
      <div className="shrink-0 flex items-center gap-3 px-4 py-4 bg-sky-700">
        <button onClick={onBack} className="text-white/80 hover:text-white text-4xl leading-none">←</button>
        <h1 className="font-semibold text-white">Notifications</h1>
      </div>
      <div className="max-w-2xl mx-auto w-full px-4 flex flex-col flex-1 min-h-0">

        <div className="overflow-y-auto flex-1 space-y-3 py-4">
          {grouped.length === 0 && (
            <p className="text-sm text-slate-400 text-center pt-8">No notifications yet.</p>
          )}

          {grouped.map(group => (
            <div key={group.userId} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              {/* Sender header row */}
              <div
                onClick={() => setExpandedSender(s => s === group.userId ? null : group.userId)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 cursor-pointer"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {group.hasUnread && (
                    <span className="shrink-0 w-2 h-2 rounded-full bg-forest-500" />
                  )}
                  <span className={`font-medium text-slate-800 truncate ${group.hasUnread ? '' : 'ml-4'}`}>
                    {group.displayName}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <span className="text-xs text-slate-400">{timeLabel(group.latest.createdAt)}</span>
                  <span className="text-slate-400 text-sm">{expandedSender === group.userId ? '▲' : '▼'}</span>
                  <button
                    onClick={e => { e.stopPropagation(); const ids = group.items.map(i => i.id); onDeleteNotifications(ids); deleteNotifications(ids).catch(() => {}); }}
                    className="w-5 h-5 flex items-center justify-center rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50 text-xs leading-none"
                    aria-label="Dismiss all from this sender"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Latest preview when collapsed */}
              {expandedSender !== group.userId && (
                <p className="px-4 pb-3 text-sm text-slate-500 truncate">
                  {formatNotificationMessage(group.latest)}
                </p>
              )}

              {/* Expanded: all notifications chronologically */}
              {expandedSender === group.userId && (
                <ul className="border-t border-slate-100 divide-y divide-slate-100">
                  {group.items.map(n => (
                    <li key={n.id} className="px-4 py-3 flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-700">{formatNotificationMessage(n)}</p>
                        <p className="text-xs text-slate-400 mt-1">
                          {new Date(n.createdAt).toLocaleString(undefined, {
                            month: 'short', day: 'numeric',
                            hour: 'numeric', minute: '2-digit',
                          })}
                        </p>
                      </div>
                      <button
                        onClick={() => { onDeleteNotifications([n.id]); deleteNotifications([n.id]).catch(() => {}); }}
                        className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50 text-xs leading-none mt-0.5"
                        aria-label="Dismiss notification"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
