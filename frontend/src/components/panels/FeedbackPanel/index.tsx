import { useMemo, useState } from 'react';
import { categoryLabel } from '../../../lib/feedback';
import type { FeedbackStatus } from '../../../lib/feedback';
import type { FeedbackItem } from '../../../services/remote/feedback';
import { useFeedbackAdmin } from './useFeedbackAdmin';

type Filter = 'all' | FeedbackStatus;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'new',     label: 'New' },
  { value: 'read',    label: 'Read' },
  { value: 'replied', label: 'Replied' },
  { value: 'all',     label: 'All' },
];

const STATUS_BADGE: Record<FeedbackStatus, string> = {
  new:     'bg-amber-100 text-amber-700',
  read:    'bg-slate-100 text-slate-600',
  replied: 'bg-forest-100 text-forest-700',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function FeedbackCard({
  item, onStatus, onReply,
}: {
  item: FeedbackItem;
  onStatus: (status: 'new' | 'read') => void;
  onReply: (text: string) => Promise<{ emailed: boolean }>;
}) {
  const [draft, setDraft]       = useState('');
  const [sending, setSending]   = useState(false);
  const [result, setResult]     = useState<string | null>(null);
  const [showReply, setShowReply] = useState(false);

  const handleReply = async () => {
    if (!draft.trim()) return;
    setSending(true);
    setResult(null);
    try {
      const { emailed } = await onReply(draft);
      setDraft('');
      setShowReply(false);
      setResult(emailed ? 'Reply sent (in-app and email).' : 'Reply sent (in-app only).');
    } catch (err) {
      console.error('[feedback-admin] reply:', err);
      setResult('Failed to send reply.');
    } finally {
      setSending(false);
    }
  };

  const ctx = item.context;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">{item.userDisplayName ?? 'Unknown user'}</p>
          {item.userEmail && <p className="text-xs text-slate-500 truncate">{item.userEmail}</p>}
        </div>
        <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase ${STATUS_BADGE[item.status]}`}>
          {item.status}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5 text-[10px]">
        <span className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 font-medium">{categoryLabel(item.category)}</span>
        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">from {item.source}</span>
        {!item.notifyEmail && <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">no email</span>}
      </div>

      <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">{item.message}</p>

      <p className="text-[10px] text-slate-400">
        {formatDate(item.createdAt)}
        {ctx.appVersion && ` · v${ctx.appVersion}`}
        {ctx.regionCode && ` · ${ctx.regionCode}`}
      </p>
      {ctx.userAgent && <p className="text-[10px] text-slate-400 truncate" title={ctx.userAgent}>{ctx.userAgent}</p>}

      {item.adminReply && (
        <div className="border-l-2 border-forest-400 pl-3">
          <p className="text-[10px] text-slate-400 mb-0.5">Reply{item.repliedAt ? ` · ${formatDate(item.repliedAt)}` : ''}</p>
          <p className="text-sm text-slate-600 whitespace-pre-wrap break-words">{item.adminReply}</p>
        </div>
      )}

      {showReply ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value.slice(0, 2000))}
            rows={3}
            autoFocus
            placeholder="Write a reply…"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-forest-500"
          />
          <div className="flex gap-2">
            <button
              onClick={handleReply}
              disabled={sending || !draft.trim()}
              className="text-xs px-3 py-1.5 bg-forest-600 hover:bg-forest-700 text-white rounded-lg font-semibold disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Send reply'}
            </button>
            <button
              onClick={() => setShowReply(false)}
              className="text-xs px-3 py-1.5 border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => setShowReply(true)}
            className="text-xs px-3 py-1.5 bg-sky-100 text-sky-700 hover:bg-sky-200 rounded-lg font-medium"
          >
            {item.adminReply ? 'Reply again' : 'Reply'}
          </button>
          {item.status === 'new' && (
            <button onClick={() => onStatus('read')} className="text-xs px-3 py-1.5 border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50">
              Mark read
            </button>
          )}
          {item.status === 'read' && (
            <button onClick={() => onStatus('new')} className="text-xs px-3 py-1.5 border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50">
              Mark unread
            </button>
          )}
        </div>
      )}
      {result && <p className="text-xs text-slate-500">{result}</p>}
    </div>
  );
}

export function FeedbackPanel() {
  const { items, loading, error, reload, updateStatus, reply } = useFeedbackAdmin();
  const [filter, setFilter] = useState<Filter>('new');

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: items.length, new: 0, read: 0, replied: 0 };
    for (const i of items) c[i.status]++;
    return c;
  }, [items]);

  const visible = filter === 'all' ? items : items.filter(i => i.status === filter);

  return (
    <div className="h-full flex flex-col bg-slate-50">
      <div className="shrink-0 flex items-center gap-1.5 px-4 py-3 border-b border-slate-200 bg-white">
        {FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`text-xs px-3 py-1 rounded-full font-medium ${
              filter === f.value ? 'bg-forest-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {f.label} ({counts[f.value]})
          </button>
        ))}
        <button onClick={reload} className="ml-auto text-xs text-slate-500 hover:text-slate-700" aria-label="Refresh">↻ Refresh</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading && <p className="text-sm text-slate-400 text-center pt-8">Loading…</p>}
        {!loading && error && <p className="text-sm text-red-500 text-center pt-8">{error}</p>}
        {!loading && !error && visible.length === 0 && (
          <p className="text-sm text-slate-400 text-center pt-8">No feedback here.</p>
        )}
        {!loading && !error && visible.map(item => (
          <FeedbackCard
            key={item.id}
            item={item}
            onStatus={s => updateStatus(item.id, s)}
            onReply={text => reply(item.id, text)}
          />
        ))}
      </div>
    </div>
  );
}
