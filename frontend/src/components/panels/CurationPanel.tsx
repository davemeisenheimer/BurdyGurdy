import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PhotoCurationPanel } from './PhotoCurationPanel';
import {
  fetchPendingReports, fetchBlockedReports,
  blockReport, invalidateReport, deleteReport, unblockReport,
} from '../../lib/adminSync';
import type { MediaReport } from '../../lib/adminSync';
import { fetchAdminBlockedMedia } from '../../services/remote/sync';

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectService(url: string): string {
  if (url.includes('inaturalist.org'))  return 'iNaturalist';
  if (url.includes('macaulaylibrary.org')) return 'Macaulay Library';
  if (url.includes('xeno-canto.org'))   return 'xeno-canto';
  if (url.includes('wikimedia.org') || url.includes('wikipedia.org')) return 'Wikimedia Commons';
  return 'Unknown';
}

const ISSUE_LABELS: Record<string, string> = {
  wrong_bird: 'Wrong bird', poor_quality: 'Poor quality',
  confusing: 'Confusing', other: 'Other',
};

function IssueBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    wrong_bird: 'bg-red-100 text-red-700',
    poor_quality: 'bg-amber-100 text-amber-700',
    confusing: 'bg-purple-100 text-purple-700',
    other: 'bg-slate-100 text-slate-600',
  };
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${colors[type] ?? 'bg-slate-100 text-slate-600'}`}>
      {ISSUE_LABELS[type] ?? type}
    </span>
  );
}

const toHttps = (url: string) => url.startsWith('//') ? `https:${url}` : url;

function MediaThumb({ report, size = 'sm' }: { report: MediaReport; size?: 'sm' | 'lg' }) {
  const [playing, setPlaying]     = useState(false);
  const [audioError, setAudioError] = useState(false);
  const [enlarged, setEnlarged]   = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioUrl = toHttps(report.url);

  if (report.mediaType === 'photo') {
    if (size === 'lg') {
      return (
        <>
          <div
            className="w-full rounded-lg bg-slate-800 cursor-zoom-in flex items-center justify-center"
            onClick={() => setEnlarged(true)}
            title="Click to enlarge"
          >
            <img
              src={report.url}
              alt={report.comName}
              className="h-auto max-h-48 w-full object-contain"
            />
          </div>
          {enlarged && createPortal(
            <div
              className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center cursor-zoom-out p-4"
              onClick={() => setEnlarged(false)}
            >
              <img
                src={report.url}
                alt={report.comName}
                className="max-h-full max-w-full object-contain rounded-lg shadow-2xl"
              />
            </div>,
            document.body,
          )}
        </>
      );
    }
    return (
      <div className="h-14 w-14 shrink-0 rounded-lg overflow-hidden bg-slate-800">
        <img src={report.url} alt={report.comName} className="w-full h-full object-cover" />
      </div>
    );
  }
  return (
    <div className={`${size === 'lg' ? 'h-20 w-full' : 'h-14 w-14 shrink-0'} rounded-lg bg-slate-800 flex items-center justify-center`}>
      {audioError ? (
        <span className="text-white/60 text-xs px-2 text-center">Audio unavailable</span>
      ) : (
        <button
          onClick={e => {
            e.stopPropagation();
            const a = audioRef.current;
            if (!a) return;
            if (playing) { a.pause(); }
            else { a.play().catch(() => setAudioError(true)); }
          }}
          className="w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white text-lg"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? '⏸' : '▶'}
        </button>
      )}
      <audio
        ref={audioRef}
        src={audioUrl}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setAudioError(true)}
      />
    </div>
  );
}

// ── Report detail view ────────────────────────────────────────────────────────

function ReportDetail({
  report, onBack, onAction,
}: {
  report:   MediaReport;
  onBack:   () => void;
  onAction: () => void;
}) {
  const [blockScope, setBlockScope] = useState<'full' | 'question'>('full');
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); onAction(); }
    catch (e) { console.error(e); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-slate-200 bg-white">
        <button onClick={onBack} className="text-slate-500 hover:text-slate-700 text-xl leading-none">←</button>
        <span className="text-sm font-semibold text-slate-700">{report.comName}</span>
        <span className="ml-auto text-xs text-slate-400">{report.submissions.length} report{report.submissions.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Media */}
        <MediaThumb report={report} size="lg" />

        <div className="text-xs text-slate-500 space-y-0.5">
          <p><span className="font-medium text-slate-700">{report.comName}</span> · {report.speciesCode}</p>
          <p>Source: {report.service ?? detectService(report.url)}</p>
          <p className="break-all text-[10px] text-slate-400">{report.url}</p>
        </div>

        {/* Submissions */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Reports</p>
          {report.submissions.map(s => (
            <div key={s.id} className="bg-slate-50 rounded-lg p-2.5 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <IssueBadge type={s.issueType} />
                <span className="text-xs text-slate-400 ml-auto">{new Date(s.createdAt).toLocaleDateString()}</span>
              </div>
              {s.reporterEmail && (
                <p className="text-xs text-slate-500">{s.reporterEmail}</p>
              )}
              {s.wrongBird && (
                <p className="text-xs text-slate-600">Thinks it's: <strong>{s.wrongBird}</strong></p>
              )}
              {s.description && (
                <p className="text-xs text-slate-600 italic">"{s.description}"</p>
              )}
            </div>
          ))}
        </div>

        {/* Admin actions */}
        {report.status === 'pending' && (
          <div className="space-y-2 pt-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Actions</p>

            {/* Block scope — only for photos */}
            {report.mediaType === 'photo' && (
              <div className="flex gap-2 mb-1">
                {(['full', 'question'] as const).map(s => (
                  <label key={s} className={`flex-1 flex items-center justify-center gap-1.5 border rounded-lg px-2 py-1.5 cursor-pointer text-xs transition-colors ${blockScope === s ? 'border-red-500 bg-red-50 text-red-700 font-medium' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                    <input type="radio" name="blockScope" checked={blockScope === s} onChange={() => setBlockScope(s)} className="sr-only" />
                    {s === 'full' ? 'Block everywhere' : 'Block from questions only'}
                  </label>
                ))}
              </div>
            )}

            <button
              disabled={busy}
              onClick={() => act(() => blockReport(report.id, report.mediaType === 'audio' ? 'full' : blockScope))}
              className="w-full py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-medium disabled:opacity-50"
            >
              Block
            </button>
            <button
              disabled={busy}
              onClick={() => act(() => invalidateReport(report.id))}
              className="w-full py-2 border border-amber-400 text-amber-700 hover:bg-amber-50 rounded-xl text-sm font-medium disabled:opacity-50"
            >
              Mark as valid (keep tracking)
            </button>
            <button
              disabled={busy}
              onClick={() => act(() => deleteReport(report.id))}
              className="w-full py-2 border border-slate-300 text-slate-500 hover:bg-slate-50 rounded-xl text-sm font-medium disabled:opacity-50"
            >
              Delete (bogus report)
            </button>
          </div>
        )}

        {report.status === 'blocked' && (
          <div className="space-y-2 pt-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Actions</p>
            <button
              disabled={busy}
              onClick={() => act(() => unblockReport(report.id))}
              className="w-full py-2 border border-slate-300 text-slate-600 hover:bg-slate-50 rounded-xl text-sm font-medium disabled:opacity-50"
            >
              Unblock
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Reports tab ───────────────────────────────────────────────────────────────

function ReportsTab({ onBlocked }: { onBlocked: () => void }) {
  const [reports, setReports]   = useState<MediaReport[]>([]);
  const [loading, setLoading]   = useState(true);
  const [detail, setDetail]     = useState<MediaReport | null>(null);

  const load = () => {
    setLoading(true);
    fetchPendingReports()
      .then(setReports)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleAction = () => {
    setDetail(null);
    load();
    onBlocked(); // refresh blocked list in parent
  };

  if (detail) {
    return <ReportDetail report={detail} onBack={() => setDetail(null)} onAction={handleAction} />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-3 py-2 border-b border-slate-200 bg-white flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Pending reports</p>
        <button onClick={load} className="text-xs text-sky-600 hover:underline">Refresh</button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <p className="text-sm text-slate-400 text-center mt-8">Loading…</p>
        )}
        {!loading && reports.length === 0 && (
          <p className="text-sm text-slate-400 text-center mt-8">No pending reports</p>
        )}
        {!loading && reports.map(r => {
          const issueCounts = r.submissions.reduce<Record<string, number>>((acc, s) => {
            acc[s.issueType] = (acc[s.issueType] ?? 0) + 1;
            return acc;
          }, {});
          return (
            <button
              key={r.id}
              onClick={() => setDetail(r)}
              className="w-full text-left flex items-center gap-3 px-3 py-2.5 border-b border-slate-100 hover:bg-slate-50 transition-colors"
            >
              <MediaThumb report={r} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{r.comName}</p>
                <p className="text-xs text-slate-400 truncate">{r.service ?? detectService(r.url)}</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {Object.entries(issueCounts).map(([type, count]) => (
                    <span key={type} className="flex items-center gap-0.5">
                      <IssueBadge type={type} />
                      {count > 1 && <span className="text-xs text-slate-400">×{count}</span>}
                    </span>
                  ))}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <span className="text-sm font-bold text-slate-700">{r.submissions.length}</span>
                <p className="text-[10px] text-slate-400">report{r.submissions.length !== 1 ? 's' : ''}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Blocked media tab ─────────────────────────────────────────────────────────

function BlockedMediaTab({ refreshKey }: { refreshKey: number }) {
  const [reports, setReports] = useState<MediaReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail]   = useState<MediaReport | null>(null);

  const load = () => {
    setLoading(true);
    fetchBlockedReports()
      .then(setReports)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [refreshKey]);

  const handleUnblock = () => {
    setDetail(null);
    load();
    fetchAdminBlockedMedia().catch(() => {}); // refresh local cache
  };

  if (detail) {
    return <ReportDetail report={detail} onBack={() => setDetail(null)} onAction={handleUnblock} />;
  }

  const SCOPE_BADGE: Record<string, string> = {
    full:     'bg-red-100 text-red-700',
    question: 'bg-amber-100 text-amber-700',
  };

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-3 py-2 border-b border-slate-200 bg-white">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Blocked media</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <p className="text-sm text-slate-400 text-center mt-8">Loading…</p>
        )}
        {!loading && reports.length === 0 && (
          <p className="text-sm text-slate-400 text-center mt-8">Nothing blocked yet</p>
        )}
        {!loading && reports.map(r => (
          <button
            key={r.id}
            onClick={() => setDetail(r)}
            className="w-full text-left flex items-center gap-3 px-3 py-2.5 border-b border-slate-100 hover:bg-slate-50 transition-colors"
          >
            <MediaThumb report={r} size="sm" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800 truncate">{r.comName}</p>
              <p className="text-xs text-slate-400 truncate">{r.service ?? detectService(r.url)}</p>
            </div>
            <div className="shrink-0 flex flex-col items-end gap-1">
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${SCOPE_BADGE[r.blockScope ?? 'full']}`}>
                {r.blockScope === 'question' ? 'questions only' : 'everywhere'}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── CurationPanel (tabbed) ────────────────────────────────────────────────────

type Tab = 'photos' | 'reports' | 'blocked';

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
        active
          ? 'border-forest-600 text-forest-700 bg-forest-50'
          : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  );
}

export function CurationPanel() {
  const [tab, setTab]           = useState<Tab>('reports');
  const [blockedRefresh, setBlockedRefresh] = useState(0);

  const handleBlocked = () => {
    setBlockedRefresh(k => k + 1);
    fetchAdminBlockedMedia().catch(() => {}); // keep local cache fresh
  };

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <div className="shrink-0 flex border-b border-slate-200 bg-white">
        <TabBtn active={tab === 'photos'}  onClick={() => setTab('photos')}>Photos</TabBtn>
        <TabBtn active={tab === 'reports'} onClick={() => setTab('reports')}>Reports</TabBtn>
        <TabBtn active={tab === 'blocked'} onClick={() => setTab('blocked')}>Blocked</TabBtn>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'photos'  && <PhotoCurationPanel />}
        {tab === 'reports' && <ReportsTab onBlocked={handleBlocked} />}
        {tab === 'blocked' && <BlockedMediaTab refreshKey={blockedRefresh} />}
      </div>
    </div>
  );
}
