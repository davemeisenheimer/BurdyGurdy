import { useEffect, useState } from 'react';
import { fetchBirdFacts, saveBirdFact, deleteBirdFact } from '../../lib/adminSync';
import type { BirdFact } from '../../lib/adminSync';

// ── Tag pill display ──────────────────────────────────────────────────────────

function TagPills({ tags, color }: { tags: string[]; color: string }) {
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map(t => (
        <span key={t} className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-medium ${color}`}>{t}</span>
      ))}
    </div>
  );
}

// ── Tag input (comma-separated) ───────────────────────────────────────────────

function TagInput({
  label, value, onChange, placeholder, color,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  color: string;
}) {
  const [raw, setRaw] = useState(value.join(', '));

  const handleBlur = () => {
    const parsed = raw.split(',').map(s => s.trim()).filter(Boolean);
    onChange(parsed);
    setRaw(parsed.join(', '));
  };

  const pills = raw.split(',').map(s => s.trim()).filter(Boolean);

  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input
        type="text"
        value={raw}
        onChange={e => setRaw(e.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder}
        className="w-full text-xs px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-700 placeholder-slate-400 focus:outline-none focus:border-forest-400 font-mono"
      />
      {pills.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {pills.map((t, i) => (
            <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-medium ${color}`}>{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Edit / Add form ───────────────────────────────────────────────────────────

const EMPTY_FACT: Omit<BirdFact, 'createdAt'> = {
  id: '',
  factText: '',
  sourceUrl: '',
  speciesCodes: [],
  familyNames: [],
  isActive: true,
};

function FactForm({
  initial,
  onSave,
  onDelete,
  onCancel,
}: {
  initial:  Omit<BirdFact, 'createdAt'>;
  onSave:   () => void;
  onDelete: (() => void) | null;
  onCancel: () => void;
}) {
  const [fact, setFact]               = useState(initial);
  const [busy, setBusy]               = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError]             = useState<string | null>(null);

  const set = <K extends keyof typeof fact>(k: K, v: (typeof fact)[K]) =>
    setFact(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!fact.factText.trim()) { setError('Fact text is required.'); return; }
    setBusy(true); setError(null);
    try { await saveBirdFact({ ...fact, factText: fact.factText.trim(), sourceUrl: fact.sourceUrl?.trim() || null }); onSave(); }
    catch { setError('Save failed. Check console for details.'); }
    finally { setBusy(false); }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    setBusy(true); setError(null);
    try { await deleteBirdFact(fact.id); onDelete(); }
    catch { setError('Delete failed.'); }
    finally { setBusy(false); }
  };

  const isNew = !fact.id;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-slate-200 bg-white">
        <button onClick={onCancel} className="text-slate-500 hover:text-slate-700 text-xl leading-none">←</button>
        <span className="text-sm font-semibold text-slate-700">{isNew ? 'New fact' : 'Edit fact'}</span>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Fact text */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Fact text <span className="text-red-500">*</span>
          </label>
          <textarea
            value={fact.factText}
            onChange={e => set('factText', e.target.value)}
            rows={5}
            maxLength={600}
            placeholder="Enter the bird fact…"
            className="w-full text-sm px-2.5 py-2 border border-slate-200 rounded-lg text-slate-700 placeholder-slate-400 resize-none focus:outline-none focus:border-forest-400"
          />
          <p className="text-[10px] text-slate-400 text-right">{fact.factText.length}/600</p>
        </div>

        {/* Source URL */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Source URL</label>
          <input
            type="url"
            value={fact.sourceUrl ?? ''}
            onChange={e => set('sourceUrl', e.target.value)}
            placeholder="https://example.com"
            className="w-full text-xs px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-700 placeholder-slate-400 focus:outline-none focus:border-forest-400"
          />
        </div>

        {/* Species codes */}
        <TagInput
          label="Species codes (eBird, comma-separated)"
          value={fact.speciesCodes}
          onChange={v => set('speciesCodes', v)}
          placeholder="e.g. rthhum, blujay, arcter"
          color="bg-sky-100 text-sky-700"
        />

        {/* Family names */}
        <TagInput
          label="Family names (scientific, comma-separated)"
          value={fact.familyNames}
          onChange={v => set('familyNames', v)}
          placeholder="e.g. Trochilidae, Corvidae"
          color="bg-violet-100 text-violet-700"
        />

        {/* Active toggle */}
        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={fact.isActive}
            onChange={e => set('isActive', e.target.checked)}
            className="w-4 h-4 accent-forest-600"
          />
          <span className="text-sm text-slate-700">Active (shown to users)</span>
        </label>

        {error && <p className="text-xs text-red-600">{error}</p>}

        {/* Actions */}
        <div className="space-y-2 pt-1">
          <button
            disabled={busy}
            onClick={handleSave}
            className="w-full py-2 bg-forest-600 hover:bg-forest-700 text-white rounded-xl text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {busy ? 'Saving…' : 'Save fact'}
          </button>
          <button
            onClick={onCancel}
            className="w-full py-2 border border-slate-300 text-slate-600 hover:bg-slate-50 rounded-xl text-sm font-medium transition-colors"
          >
            Cancel
          </button>
          {onDelete && (
            confirmDelete ? (
              <div className="flex gap-2">
                <button
                  disabled={busy}
                  onClick={handleDelete}
                  className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-medium disabled:opacity-50 transition-colors"
                >
                  Confirm delete
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 py-2 border border-slate-300 text-slate-600 hover:bg-slate-50 rounded-xl text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="w-full py-2 border border-red-300 text-red-600 hover:bg-red-50 rounded-xl text-sm font-medium transition-colors"
              >
                Delete fact
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ── Facts list ────────────────────────────────────────────────────────────────

export function FactsCurationPanel() {
  const [facts, setFacts]   = useState<BirdFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Omit<BirdFact, 'createdAt'> | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const load = () => {
    setLoading(true);
    fetchBirdFacts()
      .then(setFacts)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleSaved = () => { setEditing(null); load(); };
  const handleDeleted = () => { setEditing(null); load(); };

  if (editing !== null) {
    return (
      <FactForm
        initial={editing}
        onSave={handleSaved}
        onDelete={editing.id ? handleDeleted : null}
        onCancel={() => setEditing(null)}
      />
    );
  }

  const q = search.trim().toLowerCase();
  const visible = facts.filter(f => {
    if (filter === 'active'   && !f.isActive) return false;
    if (filter === 'inactive' &&  f.isActive) return false;
    if (q && !f.factText.toLowerCase().includes(q) &&
             !f.speciesCodes.some(c => c.toLowerCase().includes(q)) &&
             !f.familyNames.some(n => n.toLowerCase().includes(q))) return false;
    return true;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="shrink-0 px-3 pt-2 pb-2 border-b border-slate-200 bg-white space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Bird facts
          </p>
          <span className="text-xs text-slate-400">{visible.length} / {facts.length}</span>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1">
          {(['all', 'active', 'inactive'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-1 py-1 rounded-lg text-xs font-medium border transition-colors capitalize ${
                filter === f
                  ? 'bg-forest-600 border-forest-600 text-white'
                  : 'bg-white border-slate-200 text-slate-600 hover:border-forest-400'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          type="search"
          placeholder="Search facts, codes, families…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full text-xs px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-700 placeholder-slate-400 focus:outline-none focus:border-forest-400"
        />

        {/* Add button */}
        <button
          onClick={() => setEditing(EMPTY_FACT)}
          className="w-full py-1.5 bg-forest-600 hover:bg-forest-700 text-white rounded-lg text-xs font-semibold transition-colors"
        >
          + Add new fact
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <p className="text-sm text-slate-400 text-center mt-8">Loading…</p>
        )}
        {!loading && visible.length === 0 && (
          <p className="text-sm text-slate-400 text-center mt-8">
            {facts.length === 0 ? 'No facts yet - add one above' : 'No matches'}
          </p>
        )}
        {!loading && visible.map(fact => (
          <button
            key={fact.id}
            onClick={() => setEditing(fact)}
            className="w-full text-left px-3 py-2.5 border-b border-slate-100 hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-start gap-2">
              {/* Active indicator */}
              <span
                className={`mt-1 shrink-0 w-2 h-2 rounded-full ${fact.isActive ? 'bg-green-400' : 'bg-slate-300'}`}
                title={fact.isActive ? 'Active' : 'Inactive'}
              />
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-xs text-slate-700 leading-snug line-clamp-2">{fact.factText}</p>
                <div className="flex flex-wrap gap-1">
                  <TagPills tags={fact.speciesCodes} color="bg-sky-100 text-sky-700" />
                  <TagPills tags={fact.familyNames}  color="bg-violet-100 text-violet-700" />
                </div>
                {fact.sourceUrl && (
                  <p className="text-[10px] text-slate-400 truncate">{fact.sourceUrl}</p>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
