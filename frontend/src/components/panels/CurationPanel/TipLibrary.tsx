import { useMemo, useState } from 'react';
import {
  filterTipEntries, buildTaxonomicGroups, buildAlphabetical, sortNewest, tipEntryKey,
  type TipLibraryEntry, type TipFilter, type TipSort, type SpeciesTips,
} from '../../../lib/tipLibrary';
import { useTipLibrary } from './useTipLibrary';
import { TipEditor } from './TipEditor';
import { EnlargeablePhoto } from './EnlargeablePhoto';

type View =
  | { kind: 'list' }
  | { kind: 'species'; speciesCode: string }
  | { kind: 'tip'; key: string; from: View };

const SORTS: Array<[TipSort, string]> = [['taxonomic', 'Taxonomic'], ['az', 'A–Z'], ['newest', 'Newest']];
const FILTERS: Array<[TipFilter, string]> = [['all', 'All'], ['ai', 'AI only'], ['edited', 'Edited'], ['reported', 'Reported']];

function TipBadges({ e }: { e: TipLibraryEntry }) {
  return (
    <span className="flex items-center gap-1 shrink-0">
      {e.editedAt
        ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-forest-100 text-forest-700 font-medium">Edited</span>
        : <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-medium">AI</span>}
      {e.reportCount > 0 && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium" title={`${e.reportCount} report(s), any status`}>
          ⚑ {e.reportCount}
        </span>
      )}
    </span>
  );
}

function TipCard({ e, showSpecies, onOpen }: { e: TipLibraryEntry; showSpecies: boolean; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="w-full text-left flex gap-3 px-3 py-2.5 border-b border-slate-100 hover:bg-slate-50 transition-colors">
      <div className="h-14 w-14 shrink-0 rounded-lg overflow-hidden bg-slate-800">
        <img src={e.photoUrl} alt={e.comName} loading="lazy" className="w-full h-full object-cover" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs text-slate-500 truncate">
            {showSpecies && <span className="font-medium text-slate-800">{e.comName} · </span>}
            guessed {e.guess}
          </p>
          <TipBadges e={e} />
        </div>
        <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">{e.tip}</p>
      </div>
    </button>
  );
}

function SpeciesRow({ s, onOpen }: { s: SpeciesTips; onOpen: () => void }) {
  const reported = s.tips.filter(t => t.reportCount > 0).length;
  return (
    <button onClick={onOpen} className="w-full text-left flex items-center gap-2 px-3 py-2 border-b border-slate-100 hover:bg-slate-50 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-800 truncate">{s.comName}</p>
        <p className="text-[11px] italic text-slate-400 truncate">{s.sciName}</p>
      </div>
      {reported > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium">⚑ {reported}</span>}
      <span className="text-xs text-slate-400 shrink-0">{s.tips.length} tip{s.tips.length !== 1 ? 's' : ''}</span>
    </button>
  );
}

function Header({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack: () => void }) {
  return (
    <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-slate-200 bg-white">
      <button onClick={onBack} className="text-slate-500 hover:text-slate-700 text-xl leading-none">←</button>
      <span className="text-sm font-semibold text-slate-700 truncate">{title}</span>
      {subtitle && <span className="ml-auto text-xs text-slate-400 shrink-0">{subtitle}</span>}
    </div>
  );
}

/** Curation → Tips → Library: browse, search and edit every stored ID tip. */
export function TipLibrary() {
  const { entries, loading, error, reload } = useTipLibrary();
  const [query, setQuery]   = useState('');
  const [sort, setSort]     = useState<TipSort>('taxonomic');
  const [filter, setFilter] = useState<TipFilter>('all');
  const [view, setView]     = useState<View>({ kind: 'list' });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const visible = useMemo(() => filterTipEntries(entries, query, filter), [entries, query, filter]);
  const families = useMemo(() => (sort === 'taxonomic' ? buildTaxonomicGroups(visible) : []), [visible, sort]);
  const alphabetical = useMemo(() => (sort === 'az' ? buildAlphabetical(visible) : []), [visible, sort]);
  const newest = useMemo(() => (sort === 'newest' ? sortNewest(visible) : []), [visible, sort]);

  const openTip = (e: TipLibraryEntry) => setView({ kind: 'tip', key: tipEntryKey(e), from: view });
  const toggleFamily = (key: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  // ── Tip detail ──
  if (view.kind === 'tip') {
    const e = entries.find(x => tipEntryKey(x) === view.key);
    const back = () => { setView(view.from); reload(); }; // reload so edits show in the list
    if (!e) return <div className="flex flex-col h-full"><Header title="Tip not found" onBack={back} /></div>;
    return (
      <div className="flex flex-col h-full">
        <Header title={e.comName} subtitle={`guessed ${e.guess}`} onBack={back} />
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          <EnlargeablePhoto url={e.photoUrl} alt={e.comName} />
          <div className="text-xs text-slate-500 space-y-0.5">
            <p className="flex items-center gap-2">
              <span><span className="font-medium text-slate-700">{e.comName}</span> <span className="italic">({e.sciName})</span> · {e.speciesCode}</span>
              <TipBadges e={e} />
            </p>
            <p>Player answered: <strong className="text-slate-700">{e.guess}</strong></p>
            {e.familyComName && <p>Family: {e.familyComName} ({e.familySciName})</p>}
            <p className="break-all text-[10px] text-slate-400">{e.photoUrl}</p>
          </div>
          <TipEditor params={{ speciesCode: e.speciesCode, comName: e.comName, sciName: e.sciName, guess: e.guess, photoUrl: e.photoUrl }} />
          {e.reportCount > 0 && (
            <p className="text-[11px] text-slate-400">This tip has {e.reportCount} report{e.reportCount !== 1 ? 's' : ''}. Pending ones are under Reports.</p>
          )}
        </div>
      </div>
    );
  }

  // ── One species' tips ──
  if (view.kind === 'species') {
    const tips = sortNewest(visible.filter(e => e.speciesCode === view.speciesCode));
    const name = tips[0]?.comName ?? entries.find(e => e.speciesCode === view.speciesCode)?.comName ?? view.speciesCode;
    return (
      <div className="flex flex-col h-full">
        <Header title={name} subtitle={`${tips.length} tip${tips.length !== 1 ? 's' : ''}`} onBack={() => setView({ kind: 'list' })} />
        <div className="flex-1 overflow-y-auto">
          {tips.length === 0 && <p className="text-sm text-slate-400 text-center mt-8">No tips match the current filter</p>}
          {tips.map(e => <TipCard key={tipEntryKey(e)} e={e} showSpecies={false} onOpen={() => openTip(e)} />)}
        </div>
      </div>
    );
  }

  // ── Library list ──
  const searching = query.trim().length > 0;
  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-3 py-2 border-b border-slate-200 bg-white space-y-2">
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search bird or guess…"
            className="flex-1 min-w-0 px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-forest-400"
          />
          <button onClick={reload} className="text-xs text-sky-600 hover:underline shrink-0">Refresh</button>
        </div>
        <div className="flex items-center gap-1 text-xs">
          <span className="text-slate-400 mr-1">Sort</span>
          {SORTS.map(([s, label]) => (
            <button key={s} onClick={() => setSort(s)}
              className={`px-2 py-0.5 rounded-full ${sort === s ? 'bg-forest-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-xs flex-wrap">
          <span className="text-slate-400 mr-1">Show</span>
          {FILTERS.map(([f, label]) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-2 py-0.5 rounded-full ${filter === f ? 'bg-slate-700 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</button>
          ))}
          <span className="ml-auto text-slate-400">{visible.length} of {entries.length}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && <p className="text-sm text-slate-400 text-center mt-8">Loading…</p>}
        {!loading && error && <p className="text-sm text-red-600 text-center mt-8">{error}</p>}
        {!loading && !error && visible.length === 0 && (
          <p className="text-sm text-slate-400 text-center mt-8">{entries.length === 0 ? 'No tips stored yet' : 'No tips match'}</p>
        )}

        {!loading && !error && sort === 'taxonomic' && families.map(g => {
          const key = g.familySciName ?? '__unknown';
          const open = searching || expanded.has(key);
          return (
            <div key={key}>
              <button
                onClick={() => toggleFamily(key)}
                className="w-full text-left flex items-center gap-2 px-3 py-2 bg-slate-100 border-b border-slate-200 hover:bg-slate-200/60"
              >
                <span className="text-slate-400 text-xs w-3">{open ? '▾' : '▸'}</span>
                <span className="text-xs font-semibold text-slate-700 truncate">
                  {g.familySciName ? `${g.familySciName} - ${g.familyComName}` : 'Unknown family'}
                </span>
                <span className="ml-auto text-[11px] text-slate-400 shrink-0">{g.tipCount}</span>
              </button>
              {open && g.species.map(s => (
                <SpeciesRow key={s.speciesCode} s={s} onOpen={() => setView({ kind: 'species', speciesCode: s.speciesCode })} />
              ))}
            </div>
          );
        })}

        {!loading && !error && sort === 'az' && alphabetical.map(s => (
          <SpeciesRow key={s.speciesCode} s={s} onOpen={() => setView({ kind: 'species', speciesCode: s.speciesCode })} />
        ))}

        {!loading && !error && sort === 'newest' && newest.map(e => (
          <TipCard key={tipEntryKey(e)} e={e} showSpecies onOpen={() => openTip(e)} />
        ))}
      </div>
    </div>
  );
}
