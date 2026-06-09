import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchBirdFacts, saveBirdFact, deleteBirdFact, importBirdFacts } from '../../lib/adminSync';
import type { BirdFact } from '../../lib/adminSync';
import { db } from '../../lib/db';

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

// ── JSON import ───────────────────────────────────────────────────────────────

interface CodeValidation {
  code:     string;
  comName:  string | null;
  nameHint: string | null;  // common-name hint from the JSON's speciesNames field
}

interface ImportRow {
  factText:     string;
  sourceUrl:    string | null;
  speciesCodes: string[];
  familyNames:  string[];
  isActive:     boolean;
  validation:   CodeValidation[];
}

async function buildSpeciesMap(): Promise<Map<string, string>> {
  const regions = await db.regionSpecies.toArray();
  const map = new Map<string, string>();
  for (const region of regions) {
    for (const sp of region.species) {
      if (!map.has(sp.speciesCode)) map.set(sp.speciesCode, sp.comName);
    }
  }
  return map;
}

function parseImportJson(text: string, speciesMap: Map<string, string>): ImportRow[] {
  const raw = JSON.parse(text);
  if (!Array.isArray(raw)) throw new Error('JSON root must be an array');
  return raw.flatMap((item: Record<string, unknown>) => {
    const factText = ((item.factText ?? item.fact_text ?? '') as string).trim();
    if (!factText) return [];
    const speciesCodes = ((item.speciesCodes ?? item.species_codes ?? []) as string[])
      .map((s: string) => s.trim()).filter(Boolean);
    const rawNames = item.speciesNames ?? item.species_names ?? item.commonName ?? item.common_name ?? [];
    const speciesNames = (Array.isArray(rawNames) ? rawNames as string[] : [rawNames as string])
      .map(s => String(s ?? '').trim());
    const familyNames = ((item.familyNames ?? item.family_names ?? []) as string[])
      .map((s: string) => s.trim()).filter(Boolean);
    return [{
      factText,
      sourceUrl: ((item.sourceUrl ?? item.source_url ?? null) as string | null) || null,
      speciesCodes,
      familyNames,
      isActive: item.isActive !== false && item.is_active !== false,
      validation: speciesCodes.map((code, i) => ({
        code,
        comName:  speciesMap.get(code) ?? null,
        nameHint: speciesNames[i] ?? null,
      })),
    }];
  });
}

interface SpeciesEntry { speciesCode: string; comName: string; }

function CodeSearchInput({
  nameHint,
  speciesEntries,
  onSelect,
  onRemove,
}: {
  nameHint:       string | null;
  speciesEntries: SpeciesEntry[];
  onSelect:       (code: string) => void;
  onRemove:       () => void;
}) {
  const [showSearch, setShowSearch] = useState(!nameHint);
  const [query, setQuery]           = useState('');

  // When a nameHint is present, find the best match automatically
  const autoMatch = useMemo(() => {
    if (!nameHint) return null;
    const nl = nameHint.toLowerCase();
    return (
      speciesEntries.find(sp => sp.comName.toLowerCase() === nl) ??
      speciesEntries.find(sp => sp.comName.toLowerCase().includes(nl)) ??
      null
    );
  }, [nameHint, speciesEntries]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return speciesEntries
      .filter(sp =>
        sp.comName.toLowerCase().includes(q) ||
        sp.speciesCode.toLowerCase().startsWith(q),
      )
      .slice(0, 5);
  }, [query, speciesEntries]);

  return (
    <div className="mt-1 space-y-1">
      {/* One-click suggestion when a name hint resolves cleanly */}
      {autoMatch && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => onSelect(autoMatch.speciesCode)}
            className="flex-1 text-left text-[10px] px-2 py-1.5 rounded border border-green-300 bg-green-50 hover:bg-green-100 text-slate-700 transition-colors"
          >
            Use <span className="font-mono text-sky-700">{autoMatch.speciesCode}</span> · {autoMatch.comName}
          </button>
          <button
            onClick={onRemove}
            title="Remove this code"
            className="px-2 py-1 border border-slate-200 rounded text-slate-400 hover:border-red-300 hover:text-red-500 transition-colors text-[10px]"
          >
            ✕
          </button>
        </div>
      )}

      {/* Manual search — always shown when no auto-match; on-demand otherwise */}
      {(!autoMatch || showSearch) && (
        <div className="space-y-1">
          <div className="flex gap-1">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by common name…"
              className="flex-1 text-[10px] px-2 py-1 border border-amber-300 rounded bg-white text-slate-700 placeholder-slate-400 focus:outline-none focus:border-amber-500"
            />
            {!autoMatch && (
              <button
                onClick={onRemove}
                title="Remove this code"
                className="px-2 py-1 border border-slate-200 rounded text-slate-400 hover:border-red-300 hover:text-red-500 transition-colors text-[10px]"
              >
                ✕
              </button>
            )}
          </div>
          {suggestions.length > 0 && (
            <div className="rounded border border-amber-200 bg-white overflow-hidden">
              {suggestions.map(sp => (
                <button
                  key={sp.speciesCode}
                  onClick={() => onSelect(sp.speciesCode)}
                  className="w-full text-left text-[10px] px-2 py-1.5 hover:bg-amber-50 border-b border-slate-100 last:border-0 text-slate-700"
                >
                  <span className="font-mono text-sky-700">{sp.speciesCode}</span>
                  <span className="text-slate-400"> · </span>
                  {sp.comName}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {autoMatch && !showSearch && (
        <button
          onClick={() => setShowSearch(true)}
          className="text-[10px] text-slate-400 hover:text-slate-600 transition-colors"
        >
          Search for a different code
        </button>
      )}
    </div>
  );
}

function ImportRowCard({
  row,
  speciesEntries,
  onCodesChange,
}: {
  row:            ImportRow;
  speciesEntries: SpeciesEntry[];
  onCodesChange:  (codes: string[]) => void;
}) {
  const replaceCode = (oldCode: string, newCode: string) =>
    onCodesChange(row.speciesCodes.map(c => c === oldCode ? newCode : c));

  const removeCode = (code: string) =>
    onCodesChange(row.speciesCodes.filter(c => c !== code));

  const hasUnverified = row.validation.some(v => v.comName === null);

  return (
    <div className={`rounded-lg border p-2.5 space-y-2 ${hasUnverified ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
      <p className="text-xs text-slate-700 leading-snug line-clamp-2">{row.factText}</p>

      {row.validation.length > 0 && (
        <div className="space-y-2">
          {row.validation.map((v, i) => (
            <div key={i}>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-medium ${
                v.comName ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
              }`}>
                {v.code}{v.comName ? ` · ${v.comName}` : ' · unrecognized'}
              </span>
              {!v.comName && (
                <CodeSearchInput
                  nameHint={v.nameHint}
                  speciesEntries={speciesEntries}
                  onSelect={newCode => replaceCode(v.code, newCode)}
                  onRemove={() => removeCode(v.code)}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {row.familyNames.length > 0 && (
        <TagPills tags={row.familyNames} color="bg-violet-100 text-violet-700" />
      )}
    </div>
  );
}

function ImportReview({
  rows: initialRows,
  speciesMap,
  onImported,
  onCancel,
}: {
  rows:       ImportRow[];
  speciesMap: Map<string, string>;
  onImported: () => void;
  onCancel:   () => void;
}) {
  const [rows, setRows] = useState(initialRows);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Flat list of all species for CodeSearchInput suggestions
  const speciesEntries = useMemo<SpeciesEntry[]>(
    () => [...speciesMap.entries()].map(([speciesCode, comName]) => ({ speciesCode, comName })),
    [speciesMap],
  );

  const updateCodes = (idx: number, codes: string[]) => {
    setRows(prev => prev.map((r, i) => i !== idx ? r : {
      ...r,
      speciesCodes: codes,
      // Match nameHints by code so removal doesn't shift hints to wrong entries
      validation: codes.map(code => {
        const existing = r.validation.find(v => v.code === code);
        return { code, comName: speciesMap.get(code) ?? null, nameHint: existing?.nameHint ?? null };
      }),
    }));
  };

  const totalCodes      = rows.reduce((n, r) => n + r.speciesCodes.length, 0);
  const unverifiedCount = rows.reduce((n, r) => n + r.validation.filter(v => v.comName === null).length, 0);

  const handleImport = async () => {
    setBusy(true); setError(null);
    const { error: err } = await importBirdFacts(
      rows.map(r => ({
        factText:     r.factText,
        sourceUrl:    r.sourceUrl,
        speciesCodes: r.speciesCodes,
        familyNames:  r.familyNames,
        isActive:     r.isActive,
      })),
    );
    setBusy(false);
    if (err) { setError(err); return; }
    onImported();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-slate-200 bg-white">
        <button onClick={onCancel} className="text-slate-500 hover:text-slate-700 text-xl leading-none">←</button>
        <span className="text-sm font-semibold text-slate-700">Review import</span>
        <span className="ml-auto text-xs text-slate-400">{rows.length} fact{rows.length !== 1 ? 's' : ''}</span>
      </div>

      {totalCodes > 0 && (
        <div className={`shrink-0 mx-3 mt-2 px-3 py-2 rounded-lg border text-xs ${
          unverifiedCount > 0
            ? 'bg-amber-50 border-amber-200 text-amber-700'
            : 'bg-green-50 border-green-200 text-green-700'
        }`}>
          {unverifiedCount > 0
            ? <><strong>{unverifiedCount} species code{unverifiedCount !== 1 ? 's' : ''}</strong> not found in the local cache — correct them below before importing.</>
            : <>All {totalCodes} species code{totalCodes !== 1 ? 's' : ''} verified.</>
          }
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {rows.map((row, idx) => (
          <ImportRowCard
            key={idx}
            row={row}
            speciesEntries={speciesEntries}
            onCodesChange={codes => updateCodes(idx, codes)}
          />
        ))}
      </div>

      <div className="shrink-0 p-3 border-t border-slate-200 bg-white space-y-2">
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button
          disabled={busy}
          onClick={handleImport}
          className="w-full py-2 bg-forest-600 hover:bg-forest-700 text-white rounded-xl text-sm font-medium disabled:opacity-50 transition-colors"
        >
          {busy ? 'Importing…' : `Import ${rows.length} fact${rows.length !== 1 ? 's' : ''}`}
        </button>
        <button
          onClick={onCancel}
          className="w-full py-2 border border-slate-300 text-slate-600 hover:bg-slate-50 rounded-xl text-sm font-medium transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Facts list ────────────────────────────────────────────────────────────────

export function FactsCurationPanel() {
  const [facts, setFacts]       = useState<BirdFact[]>([]);
  const [loading, setLoading]   = useState(true);
  const [editing, setEditing]   = useState<Omit<BirdFact, 'createdAt'> | null>(null);
  const [importState, setImportState] = useState<{ rows: ImportRow[]; speciesMap: Map<string, string> } | null>(null);
  const [search, setSearch]     = useState('');
  const [filter, setFilter]     = useState<'all' | 'active' | 'inactive'>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setLoading(true);
    fetchBirdFacts()
      .then(setFacts)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleSaved   = () => { setEditing(null); load(); };
  const handleDeleted = () => { setEditing(null); load(); };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const speciesMap = await buildSpeciesMap();
      const rows = parseImportJson(text, speciesMap);
      if (rows.length === 0) { alert('No valid facts found in the JSON file.'); return; }
      setImportState({ rows, speciesMap });
    } catch (err) {
      alert(`Could not parse file: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

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

  if (importState !== null) {
    return (
      <ImportReview
        rows={importState.rows}
        speciesMap={importState.speciesMap}
        onImported={() => { setImportState(null); load(); }}
        onCancel={() => setImportState(null)}
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

        {/* Add / Import buttons */}
        <div className="flex gap-1.5">
          <button
            onClick={() => setEditing(EMPTY_FACT)}
            className="flex-1 py-1.5 bg-forest-600 hover:bg-forest-700 text-white rounded-lg text-xs font-semibold transition-colors"
          >
            + Add new fact
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 py-1.5 border border-forest-600 text-forest-700 hover:bg-forest-50 rounded-lg text-xs font-semibold transition-colors"
          >
            ↑ Import JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            onChange={handleFileSelect}
          />
        </div>
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
