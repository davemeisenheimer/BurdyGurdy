import { useState } from 'react';
import {
  ID_TIP_ISSUE_TYPES, ID_TIP_ISSUE_CHOICES, ID_TIP_REPORT_MAX, ID_TIP_REPORT_MIN,
  canSubmitIdTipReport, type IdTipIssueType,
} from '../../../lib/idTip';

export interface IdTipReportData {
  issueType:   IdTipIssueType;
  description: string;
  notifyEmail: boolean;
}

interface Props {
  photoUrl:   string;
  comName:    string;
  guess:      string;
  tip:        string;
  userEmail?: string | null;
  /** Resolves when the report is saved; rejects to keep the dialog open with an error. */
  onSubmit:   (data: IdTipReportData) => Promise<void>;
  onClose:    () => void;
}

/** Report dialog for an AI ID tip: explains how tips are made and asks what exactly was wrong. */
export function IdTipReportModal({ photoUrl, comName, guess, tip, userEmail, onSubmit, onClose }: Props) {
  const [issueType, setIssueType]     = useState<IdTipIssueType | null>(null);
  const [description, setDescription] = useState('');
  const [notifyEmail, setNotifyEmail] = useState(false);
  const [sending, setSending]         = useState(false);
  const [error, setError]             = useState<string | null>(null);

  const canSubmit = canSubmitIdTipReport(issueType, description) && !sending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!issueType || !canSubmit) return;
    setSending(true);
    setError(null);
    try {
      await onSubmit({ issueType, description: description.trim(), notifyEmail });
    } catch {
      setError("Your report couldn't be sent. Please try again.");
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form
        className="bg-sky-50 rounded-2xl shadow-xl w-full max-w-sm p-5 max-h-full overflow-y-auto"
        onClick={e => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-slate-800">Report a problem with this tip</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
        </div>

        <p className="text-xs text-slate-600 leading-relaxed mb-3">
          When you miss a photo question, the photo is sent to an AI model, which looks at it and writes this tip.
          AI can make mistakes - it may describe the bird incorrectly or point out something that isn't in the photo.
          Please tell us exactly what was wrong so we can fix it.
        </p>

        {/* What is being reported */}
        <div className="mb-3 rounded-xl overflow-hidden bg-slate-900 flex items-center justify-center h-28">
          <img src={photoUrl} alt={comName} className="max-h-full max-w-full object-contain" />
        </div>
        <p className="text-xs text-slate-500 mb-1">
          <strong className="text-slate-700">{comName}</strong> · you answered {guess}
        </p>
        <p className="text-xs text-slate-600 italic bg-white border border-sky-100 rounded-lg px-2.5 py-2 mb-4 max-h-28 overflow-y-auto">
          "{tip}"
        </p>

        {/* Issue type */}
        <div className="space-y-2.5 mb-4">
          {ID_TIP_ISSUE_TYPES.map(type => (
            <label key={type} className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="radio"
                name="tipIssueType"
                checked={issueType === type}
                onChange={() => setIssueType(type)}
                className="mt-0.5 w-4 h-4 accent-forest-600 shrink-0"
              />
              <span className="text-sm text-slate-700 leading-snug">{ID_TIP_ISSUE_CHOICES[type]}</span>
            </label>
          ))}
        </div>

        {/* Required details */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-slate-600 mb-1">What exactly was wrong? (required)</label>
          <textarea
            placeholder="e.g. It says the tail is rounded, but the tail isn't visible in this photo."
            value={description}
            onChange={e => setDescription(e.target.value.slice(0, ID_TIP_REPORT_MAX))}
            rows={3}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-forest-500"
          />
          <p className="text-xs text-slate-400 text-right mt-0.5">
            {description.trim().length < ID_TIP_REPORT_MIN
              ? `At least ${ID_TIP_REPORT_MIN} characters`
              : `${description.length}/${ID_TIP_REPORT_MAX}`}
          </p>
        </div>

        {userEmail && (
          <label className="flex items-start gap-2.5 cursor-pointer mb-4">
            <input
              type="checkbox"
              checked={notifyEmail}
              onChange={e => setNotifyEmail(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-forest-600 shrink-0"
            />
            <span className="text-sm text-slate-700 leading-snug">
              Email me at <strong>{userEmail}</strong> when this report is resolved
            </span>
          </label>
        )}

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2 bg-sky-100 border border-sky-200 rounded-xl text-sm text-slate-700 hover:bg-sky-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="flex-1 py-2 bg-forest-600 hover:bg-forest-700 text-white rounded-xl text-sm font-medium disabled:opacity-40 transition-colors"
          >
            {sending ? 'Sending…' : 'Send report'}
          </button>
        </div>
      </form>
    </div>
  );
}
