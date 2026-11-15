import { useEffect, useState } from 'react';
import { EnlargeablePhoto } from './EnlargeablePhoto';
import { fetchPendingIdTipReports, resolveIdTipReport } from '../../../services/remote/idTipReports';
import {
  groupIdTipReports, ID_TIP_ISSUE_LABELS,
  type IdTipReportGroup, type IdTipResolution,
} from '../../../lib/idTip';
import { TipEditor } from './TipEditor';

const ISSUE_COLORS: Record<string, string> = {
  wrong_fact:  'bg-red-100 text-red-700',
  not_visible: 'bg-amber-100 text-amber-700',
  mixed_up:    'bg-purple-100 text-purple-700',
  unhelpful:   'bg-sky-100 text-sky-700',
  other:       'bg-slate-100 text-slate-600',
};

function IssueBadge({ type }: { type: string }) {
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${ISSUE_COLORS[type] ?? 'bg-slate-100 text-slate-600'}`}>
      {ID_TIP_ISSUE_LABELS[type as keyof typeof ID_TIP_ISSUE_LABELS] ?? type}
    </span>
  );
}

const ACTIONS: Array<{ action: IdTipResolution; label: string; className: string }> = [
  { action: 'fixed',     label: 'Fixed - the report was right',  className: 'bg-forest-600 hover:bg-forest-700 text-white' },
  { action: 'kept',      label: 'Tip was fine - no change',      className: 'border border-amber-400 text-amber-700 hover:bg-amber-50' },
  { action: 'dismissed', label: 'Dismiss (bogus report)',        className: 'border border-slate-300 text-slate-500 hover:bg-slate-50' },
];

function TipReportDetail({ group, onBack, onResolved }: { group: IdTipReportGroup; onBack: () => void; onResolved: () => void }) {
  const [note, setNote]   = useState('');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = group.latest;

  const resolve = async (action: IdTipResolution) => {
    setBusy(true);
    setError(null);
    try {
      await resolveIdTipReport(r.id, action, note.trim() || null);
      onResolved();
    } catch (e) {
      console.error(e);
      setError('Could not resolve the report. Please try again.');
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-slate-200 bg-white">
        <button onClick={onBack} className="text-slate-500 hover:text-slate-700 text-xl leading-none">←</button>
        <span className="text-sm font-semibold text-slate-700 truncate">{r.comName}</span>
        <span className="ml-auto text-xs text-slate-400 shrink-0">{group.reports.length} report{group.reports.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        <EnlargeablePhoto url={r.photoUrl} alt={r.comName} />

        <div className="text-xs text-slate-500 space-y-0.5">
          <p><span className="font-medium text-slate-700">{r.comName}</span> <span className="italic">({r.sciName})</span> · {r.speciesCode}</p>
          <p>Player answered: <strong className="text-slate-700">{r.guess}</strong></p>
          <p className="break-all text-[10px] text-slate-400">{r.photoUrl}</p>
        </div>

        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Tip as reported</p>
          <p className="text-sm text-slate-600 bg-slate-100 border border-slate-200 rounded-lg p-2.5 leading-snug">{r.tip}</p>
        </div>

        <TipEditor params={{ speciesCode: r.speciesCode, comName: r.comName, sciName: r.sciName, guess: r.guess, photoUrl: r.photoUrl }} />

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Reports</p>
          {group.reports.map(s => (
            <div key={s.id} className="bg-slate-50 rounded-lg p-2.5 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <IssueBadge type={s.issueType} />
                <span className="text-xs text-slate-400 ml-auto">{new Date(s.createdAt).toLocaleDateString()}</span>
              </div>
              <p className="text-xs text-slate-500">
                {s.reporterName ?? s.reporterEmail ?? 'Unknown user'}
                {s.reporterEmail && s.reporterName && <span className="text-slate-400"> ({s.reporterEmail})</span>}
                {s.regionCode && <span className="text-slate-400"> · {s.regionCode}</span>}
              </p>
              <p className="text-xs text-slate-600 italic">"{s.description}"</p>
              {s.tip !== r.tip && <p className="text-[10px] text-slate-400">This report was about an earlier version of the tip: "{s.tip}"</p>}
            </div>
          ))}
        </div>

        <div className="space-y-2 pt-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Resolve report</p>
          <p className="text-[11px] text-slate-400">
            Closes all {group.reports.length} report{group.reports.length !== 1 ? 's' : ''} above and notifies each reporter.
            It doesn't change the tip - save any edits above first.
          </p>
          <textarea
            placeholder="Optional note to reporter…"
            value={note}
            onChange={e => setNote(e.target.value.slice(0, 500))}
            rows={2}
            className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-forest-400"
          />
          {ACTIONS.map(a => (
            <button
              key={a.action}
              disabled={busy}
              onClick={() => resolve(a.action)}
              className={`w-full py-2 rounded-xl text-sm font-medium disabled:opacity-50 ${a.className}`}
            >
              {a.label}
            </button>
          ))}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      </div>
    </div>
  );
}

/** Curation → Tips: pending player reports about AI ID tips, grouped by tip. */
export function IdTipReportsTab() {
  const [groups, setGroups]   = useState<IdTipReportGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [detail, setDetail]   = useState<IdTipReportGroup | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchPendingIdTipReports()
      .then(reports => setGroups(groupIdTipReports(reports)))
      .catch(e => { console.error(e); setError('Could not load tip reports.'); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  if (detail) {
    return <TipReportDetail group={detail} onBack={() => setDetail(null)} onResolved={() => { setDetail(null); load(); }} />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-3 py-2 border-b border-slate-200 bg-white flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Pending tip reports</p>
        <button onClick={load} className="text-xs text-sky-600 hover:underline">Refresh</button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && <p className="text-sm text-slate-400 text-center mt-8">Loading…</p>}
        {!loading && error && <p className="text-sm text-red-600 text-center mt-8">{error}</p>}
        {!loading && !error && groups.length === 0 && <p className="text-sm text-slate-400 text-center mt-8">No pending tip reports</p>}
        {!loading && !error && groups.map(g => {
          const issueCounts = g.reports.reduce<Record<string, number>>((acc, s) => {
            acc[s.issueType] = (acc[s.issueType] ?? 0) + 1;
            return acc;
          }, {});
          return (
            <button
              key={g.key}
              onClick={() => setDetail(g)}
              className="w-full text-left flex items-center gap-3 px-3 py-2.5 border-b border-slate-100 hover:bg-slate-50 transition-colors"
            >
              <div className="h-14 w-14 shrink-0 rounded-lg overflow-hidden bg-slate-800">
                <img src={g.latest.photoUrl} alt={g.latest.comName} className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{g.latest.comName}</p>
                <p className="text-xs text-slate-400 truncate">guessed {g.latest.guess}</p>
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
                <span className="text-sm font-bold text-slate-700">{g.reports.length}</span>
                <p className="text-[10px] text-slate-400">report{g.reports.length !== 1 ? 's' : ''}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
