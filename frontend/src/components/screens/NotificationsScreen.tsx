import { useState, useEffect, useMemo } from 'react';
import type { AppNotification } from '../../lib/notifications';
import { markNotificationsRead, formatNotificationMessage } from '../../lib/notifications';

interface Props {
  notifications: AppNotification[];
  onBack: () => void;
  onNotificationsRead: (ids: string[]) => void;
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

export function NotificationsScreen({ notifications, onBack, onNotificationsRead }: Props) {
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
    // Sort groups by most recent notification
    return [...map.entries()]
      .sort((a, b) =>
        new Date(b[1].items[0].createdAt).getTime() - new Date(a[1].items[0].createdAt).getTime(),
      )
      .map(([userId, { displayName, items }]) => ({
        userId,
        displayName,
        // Items already in desc order from fetch
        items,
        hasUnread: items.some(n => !n.read),
        latest: items[0],
      }));
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
      <div className="max-w-2xl mx-auto w-full px-4 flex flex-col flex-1 min-h-0">

        {/* Header */}
        <div className="shrink-0 pt-6">
          <div className="flex items-center gap-4 mb-6">
            <button onClick={onBack} className="text-slate-500 hover:text-slate-700 text-5xl">←</button>
            <h1 className="text-2xl font-bold text-slate-800">Notifications</h1>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 space-y-3 pb-8">
          {grouped.length === 0 && (
            <p className="text-sm text-slate-400 text-center pt-8">No notifications yet.</p>
          )}

          {grouped.map(group => (
            <div key={group.userId} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              {/* Sender header row */}
              <button
                onClick={() => setExpandedSender(s => s === group.userId ? null : group.userId)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 text-left"
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
                </div>
              </button>

              {/* Latest preview when collapsed */}
              {expandedSender !== group.userId && (
                <p className="px-4 pb-3 text-sm text-slate-500 truncate">
                  {formatNotificationMessage(group.latest)}
                </p>
              )}

              {/* Expanded: all notifications chronologically */}
              {expandedSender === group.userId && (
                <ul className="border-t border-slate-100 divide-y divide-slate-100">
                  {[...group.items].reverse().map(n => (
                    <li key={n.id} className="px-4 py-3">
                      <p className="text-sm text-slate-700">{formatNotificationMessage(n)}</p>
                      <p className="text-xs text-slate-400 mt-1">
                        {new Date(n.createdAt).toLocaleString(undefined, {
                          month: 'short', day: 'numeric',
                          hour: 'numeric', minute: '2-digit',
                        })}
                      </p>
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
