import type { IdTipParams } from '../../../services/remote/api';
import { ID_TIP_TEXT_MAX } from '../../../lib/idTip';
import { useTipEditor } from './useTipEditor';

/**
 * Edit the tip players see for one (species, guess, photo). Independent of resolving reports:
 * saving never closes a report, and regenerating only fills the box until you save.
 */
export function TipEditor({ params }: { params: IdTipParams }) {
  const ed = useTipEditor(params);
  const working = ed.busy !== null;

  const status =
    ed.busy === 'loading' ? 'Loading…'
    : !ed.saved ? 'No tip stored - players get a new AI tip next time, unless you save one here.'
    : ed.saved.editedAt ? `Curator-edited, saved ${new Date(ed.saved.editedAt).toLocaleString()}`
    : `AI-written (${ed.saved.model}), ${new Date(ed.saved.createdAt).toLocaleString()}`;

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Current tip</p>
      <p className="text-[11px] text-slate-400">{status}</p>
      <textarea
        value={ed.draft}
        onChange={e => ed.editDraft(e.target.value.slice(0, ID_TIP_TEXT_MAX))}
        disabled={ed.busy === 'loading'}
        rows={5}
        className={`w-full px-3 py-2 border rounded-xl text-sm leading-snug resize-y focus:outline-none focus:ring-2 focus:ring-forest-400 disabled:opacity-50 ${ed.dirty ? 'border-amber-400 bg-amber-50/40' : 'border-slate-200 bg-white'}`}
      />
      <div className="flex items-center justify-between text-[11px] -mt-0.5">
        <span className={ed.dirty ? 'text-amber-700' : 'text-slate-400'}>
          {ed.busy === 'regenerating' ? 'Generating a new tip…'
            : ed.dirty ? 'Unsaved changes - players still see the saved tip'
            : ed.justSaved ? 'Saved - players now see this tip'
            : ''}
        </span>
        <span className="text-slate-400">{ed.draft.length}/{ID_TIP_TEXT_MAX}</span>
      </div>
      <div className="flex gap-2">
        <button
          disabled={working}
          onClick={ed.regenerate}
          className="flex-1 py-2 border border-sky-300 text-sky-700 hover:bg-sky-50 rounded-xl text-sm font-medium disabled:opacity-50"
        >
          {ed.busy === 'regenerating' ? 'Generating…' : 'Regenerate'}
        </button>
        <button
          disabled={working || !ed.dirty}
          onClick={ed.revert}
          className="flex-1 py-2 border border-slate-300 text-slate-600 hover:bg-slate-50 rounded-xl text-sm font-medium disabled:opacity-40"
        >
          Revert
        </button>
        <button
          disabled={!ed.canSave}
          onClick={ed.save}
          className="flex-1 py-2 bg-forest-600 hover:bg-forest-700 text-white rounded-xl text-sm font-medium disabled:opacity-40"
        >
          {ed.busy === 'saving' ? 'Saving…' : 'Save'}
        </button>
      </div>
      {ed.error && <p className="text-xs text-red-600">{ed.error}</p>}
    </div>
  );
}
