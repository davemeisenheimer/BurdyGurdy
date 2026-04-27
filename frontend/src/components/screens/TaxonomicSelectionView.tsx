import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../../lib/db';
import type { QuizConfigPrefs } from '../../lib/settings';
import { backfillProgressTaxonomy } from '../../services/local/progress';
import type { BirdProgress } from '../../types';

// ── Data model ────────────────────────────────────────────────────────────────

interface SpeciesEntry {
  speciesCode: string;
  comName: string;
}

interface FamilyEntry {
  familySciName: string;
  familyComName: string;
  order: string;
  species: SpeciesEntry[];
}

interface OrderEntry {
  order: string;
  orderComName: string;
  families: FamilyEntry[];
}

function buildHierarchy(records: BirdProgress[]): { orders: OrderEntry[]; orphans: SpeciesEntry[] } {
  const speciesMap = new Map<string, { comName: string; familySciName?: string; familyComName?: string; order?: string; orderComName?: string }>();
  for (const r of records) {
    if (!speciesMap.has(r.speciesCode)) {
      speciesMap.set(r.speciesCode, {
        comName:       r.comName,
        familySciName: r.familySciName,
        familyComName: r.familyComName,
        order:         r.order,
        orderComName:  r.orderComName,
      });
    }
  }

  const orderMap = new Map<string, { orderComName: string; families: Map<string, { familyComName: string; species: SpeciesEntry[] }> }>();
  const orphans: SpeciesEntry[] = [];

  for (const [speciesCode, data] of speciesMap) {
    if (!data.order || !data.familySciName) {
      orphans.push({ speciesCode, comName: data.comName });
      continue;
    }
    if (!orderMap.has(data.order)) {
      orderMap.set(data.order, { orderComName: data.orderComName ?? data.order, families: new Map() });
    }
    const orderEntry = orderMap.get(data.order)!;
    if (!orderEntry.families.has(data.familySciName)) {
      orderEntry.families.set(data.familySciName, { familyComName: data.familyComName ?? data.familySciName, species: [] });
    }
    orderEntry.families.get(data.familySciName)!.species.push({ speciesCode, comName: data.comName });
  }

  const orders: OrderEntry[] = [];
  for (const [order, { orderComName, families }] of orderMap) {
    const familyEntries: FamilyEntry[] = [];
    for (const [familySciName, { familyComName, species }] of families) {
      familyEntries.push({
        familySciName, familyComName, order,
        species: species.sort((a, b) => a.comName.localeCompare(b.comName)),
      });
    }
    familyEntries.sort((a, b) => a.familyComName.localeCompare(b.familyComName));
    orders.push({ order, orderComName, families: familyEntries });
  }
  orders.sort((a, b) => a.orderComName.localeCompare(b.orderComName));
  orphans.sort((a, b) => a.comName.localeCompare(b.comName));
  return { orders, orphans };
}

function initSelected(
  records: BirdProgress[],
  prefs: Pick<QuizConfigPrefs, 'selectedSpeciesCodes' | 'selectedFamilies' | 'selectedOrders'>,
): Set<string> {
  const codes    = new Set(prefs.selectedSpeciesCodes ?? []);
  const families = new Set(prefs.selectedFamilies     ?? []);
  const orders   = new Set(prefs.selectedOrders       ?? []);
  if (codes.size === 0 && families.size === 0 && orders.size === 0) return new Set();
  const selected = new Set<string>(codes);
  for (const r of records) {
    if (r.familySciName && families.has(r.familySciName)) selected.add(r.speciesCode);
    if (r.order          && orders.has(r.order))          selected.add(r.speciesCode);
  }
  return selected;
}

function computeSavePrefs(
  selected: Set<string>,
  orders: OrderEntry[],
): { selectedSpeciesCodes: string[]; selectedFamilies: string[]; selectedOrders: string[] } {
  const selectedFamilySciNames: string[] = [];
  const selectedOrderCodes: string[] = [];
  const coveredCodes = new Set<string>();

  for (const order of orders) {
    const allFamiliesSelected = order.families.length > 0 && order.families.every(
      f => f.species.every(s => selected.has(s.speciesCode)),
    );
    if (allFamiliesSelected) {
      selectedOrderCodes.push(order.order);
      for (const f of order.families) f.species.forEach(s => coveredCodes.add(s.speciesCode));
    } else {
      for (const f of order.families) {
        const allInFamily = f.species.length > 0 && f.species.every(s => selected.has(s.speciesCode));
        if (allInFamily) {
          selectedFamilySciNames.push(f.familySciName);
          f.species.forEach(s => coveredCodes.add(s.speciesCode));
        }
      }
    }
  }

  const selectedSpeciesCodes = [...selected].filter(c => !coveredCodes.has(c));
  return { selectedSpeciesCodes, selectedFamilies: selectedFamilySciNames, selectedOrders: selectedOrderCodes };
}

// ── Indeterminate checkbox ─────────────────────────────────────────────────────

function IndeterminateCheckbox({
  checked,
  indeterminate,
  onChange,
  className = '',
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      type="checkbox"
      ref={ref}
      checked={checked}
      onChange={onChange}
      onClick={e => e.stopPropagation()}
      className={`w-4 h-4 accent-forest-600 cursor-pointer shrink-0 ${className}`}
    />
  );
}

// ── Search highlight ───────────────────────────────────────────────────────────

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 text-yellow-900 rounded-sm">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  initialPrefs: Pick<QuizConfigPrefs, 'selectedSpeciesCodes' | 'selectedFamilies' | 'selectedOrders'>;
  onSave:  (prefs: { selectionMode: 'all' | 'custom'; selectedSpeciesCodes: string[]; selectedFamilies: string[]; selectedOrders: string[] }) => void;
  onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TaxonomicSelectionView({ initialPrefs, onSave, onClose }: Props) {
  const [records,  setRecords]  = useState<BirdProgress[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // ── Search state ─────────────────────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput.trim()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  const isSearching = searchQuery.length > 0;

  const clearSearch = () => { setSearchInput(''); setSearchQuery(''); };

  useEffect(() => {
    (async () => {
      await backfillProgressTaxonomy();
      const visible = (await db.progress.toArray()).filter(r => !r.excluded);
      const { orders } = buildHierarchy(visible);
      const initialSelected = initSelected(visible, initialPrefs);
      const init = new Set<string>();
      if (initialSelected.size === 0) {
        if (orders.length > 0) {
          init.add(`order:${orders[0].order}`);
          if (orders[0].families.length > 0) init.add(`family:${orders[0].families[0].familySciName}`);
        }
      } else {
        for (const order of orders) {
          for (const family of order.families) {
            if (family.species.some(s => initialSelected.has(s.speciesCode))) {
              init.add(`order:${order.order}`);
              init.add(`family:${family.familySciName}`);
            }
          }
        }
      }
      setExpanded(init);
      setRecords(visible);
      setSelected(initialSelected);
      setLoading(false);
    })().catch(() => setLoading(false));
  // initialPrefs is stable (passed once on open)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { orders, orphans } = useMemo(() => buildHierarchy(records), [records]);

  const allSpeciesCodes = useMemo(() => {
    const codes = new Set<string>();
    for (const o of orders) for (const f of o.families) f.species.forEach(s => codes.add(s.speciesCode));
    orphans.forEach(s => codes.add(s.speciesCode));
    return codes;
  }, [orders, orphans]);

  // ── Search filtering ──────────────────────────────────────────────────────────

  const { displayOrders, searchExpandOrders, searchExpandFamilies } = useMemo(() => {
    if (!isSearching) {
      return { displayOrders: orders, searchExpandOrders: null, searchExpandFamilies: null };
    }
    const q = searchQuery.toLowerCase();
    const searchExpandOrders   = new Set<string>();
    const searchExpandFamilies = new Set<string>();

    const displayOrders = orders
      .map((order): OrderEntry | null => {
        const orderNameMatches = order.orderComName.toLowerCase().includes(q);
        const filteredFamilies: FamilyEntry[] = [];

        for (const family of order.families) {
          const famNameMatches   = family.familyComName.toLowerCase().includes(q);
          const matchingSpecies  = family.species.filter(sp => sp.comName.toLowerCase().includes(q));

          if (orderNameMatches) {
            // Whole order matches: show all families collapsed (no auto-expand)
            filteredFamilies.push(family);
          } else if (famNameMatches) {
            // Family name matches: show all its species, auto-expand
            searchExpandFamilies.add(`family:${family.familySciName}`);
            filteredFamilies.push(family);
          } else if (matchingSpecies.length > 0) {
            // Species match: show all species in the family (so nearby birds are selectable), auto-expand
            searchExpandFamilies.add(`family:${family.familySciName}`);
            filteredFamilies.push(family);
          }
        }

        if (filteredFamilies.length === 0 && !orderNameMatches) return null;
        if (!orderNameMatches) searchExpandOrders.add(`order:${order.order}`);
        return { ...order, families: filteredFamilies };
      })
      .filter((o): o is OrderEntry => o !== null);

    return { displayOrders, searchExpandOrders, searchExpandFamilies };
  }, [orders, searchQuery, isSearching]);

  // ── Handlers ──────────────────────────────────────────────────────────────────

  const toggleExpanded = (key: string) =>
    setExpanded(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s; });

  const selectAll   = () => setSelected(new Set(allSpeciesCodes));
  const deselectAll = () => setSelected(new Set());

  const toggleOrder = (order: OrderEntry) => {
    const codes = order.families.flatMap(f => f.species.map(s => s.speciesCode));
    const allSel = codes.every(c => selected.has(c));
    setSelected(prev => {
      const s = new Set(prev);
      if (allSel) { codes.forEach(c => s.delete(c)); } else { codes.forEach(c => s.add(c)); }
      return s;
    });
  };

  const toggleFamily = (family: FamilyEntry) => {
    const codes = family.species.map(s => s.speciesCode);
    const allSel = codes.every(c => selected.has(c));
    setSelected(prev => {
      const s = new Set(prev);
      if (allSel) { codes.forEach(c => s.delete(c)); } else { codes.forEach(c => s.add(c)); }
      return s;
    });
  };

  const toggleSpecies = (code: string) =>
    setSelected(prev => { const s = new Set(prev); s.has(code) ? s.delete(code) : s.add(code); return s; });

  const handleBack = () => {
    if (loading) { onClose(); return; }
    const savePrefs = computeSavePrefs(selected, orders);
    onSave({ selectionMode: 'custom', ...savePrefs });
  };

  const selectedCount = selected.size;
  const totalCount    = allSpeciesCodes.size;

  return (
    <div className="flex flex-col flex-1 min-h-0">

      {/* Header */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3 bg-sky-700 rounded-t-2xl">
        <button onClick={handleBack} className="text-white/80 hover:text-white text-4xl leading-none" aria-label="Back">←</button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-white">Life List Selections</p>
          <p className="text-xs text-sky-100">{selectedCount} of {totalCount} species selected</p>
        </div>
      </div>

      {/* Instructions */}
      <div className="shrink-0 px-4 py-2 bg-sky-50 border-b border-sky-100">
        <p className="text-xs text-sky-700">Select whole bird groups, or expand a group to pick individual species.</p>
      </div>

      {/* Select All / None + Search */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-slate-100">
        <button onClick={selectAll}   className="text-xs text-sky-700 hover:text-sky-900 font-medium whitespace-nowrap">Select All</button>
        <span className="text-slate-300">·</span>
        <button onClick={deselectAll} className="text-xs text-slate-500 hover:text-slate-700 font-medium whitespace-nowrap">Deselect All</button>
        <div className="flex-1" />
        <div className="relative flex items-center">
          <input
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Search…"
            className="pl-2 pr-6 py-1 text-xs border border-slate-200 rounded-lg w-32 focus:outline-none focus:ring-1 focus:ring-sky-400"
          />
          {searchInput ? (
            <button
              onClick={clearSearch}
              className="absolute right-1.5 text-slate-400 hover:text-slate-600 leading-none text-base"
              aria-label="Clear search"
            >×</button>
          ) : (
            <span className="absolute right-1.5 text-slate-300 text-xs pointer-events-none">↵</span>
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {loading && <p className="text-slate-400 text-center py-12 text-sm">Loading…</p>}

        {!loading && orders.length === 0 && orphans.length === 0 && (
          <p className="text-slate-400 text-center py-12 text-sm">
            No progress records yet. Play some rounds first.
          </p>
        )}

        {!loading && isSearching && displayOrders.length === 0 && (
          <p className="text-slate-400 text-center py-12 text-sm">No matches for "{searchQuery}".</p>
        )}

        {!loading && displayOrders.map(order => {
          const orderCodes     = order.families.flatMap(f => f.species.map(s => s.speciesCode));
          const orderSelCount  = orderCodes.filter(c => selected.has(c)).length;
          const orderChecked   = orderCodes.length > 0 && orderSelCount === orderCodes.length;
          const orderIndet     = orderSelCount > 0 && !orderChecked;
          const orderKey       = `order:${order.order}`;
          const orderExpanded  = isSearching
            ? (searchExpandOrders?.has(orderKey) ?? false)
            : expanded.has(orderKey);

          return (
            <div key={order.order} className="mb-1">
              {/* Order row */}
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 cursor-pointer select-none"
                onClick={isSearching ? undefined : () => toggleExpanded(orderKey)}
              >
                {!isSearching && (
                  <span className={`text-slate-500 text-base font-bold shrink-0 inline-block transition-transform duration-200 ${orderExpanded ? 'rotate-90' : ''}`}>›</span>
                )}
                <IndeterminateCheckbox
                  checked={orderChecked}
                  indeterminate={orderIndet}
                  onChange={() => toggleOrder(order)}
                  className="mt-0.5"
                />
                <span className="flex-1 text-sm font-semibold text-slate-700">
                  <HighlightMatch text={order.orderComName} query={searchQuery} />
                </span>
                <span className="text-xs text-slate-500">{orderSelCount}/{orderCodes.length}</span>
              </div>

              {/* Families */}
              {orderExpanded && (
                <div className="ml-4 mt-1 space-y-1">
                  {order.families.map(family => {
                    const famCodes    = family.species.map(s => s.speciesCode);
                    const famSelCount = famCodes.filter(c => selected.has(c)).length;
                    const famChecked  = famCodes.length > 0 && famSelCount === famCodes.length;
                    const famIndet    = famSelCount > 0 && !famChecked;
                    const famKey      = `family:${family.familySciName}`;
                    const famExpanded = isSearching
                      ? (searchExpandFamilies?.has(famKey) ?? false)
                      : expanded.has(famKey);

                    return (
                      <div key={family.familySciName}>
                        {/* Family row */}
                        <div
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 cursor-pointer select-none"
                          onClick={isSearching ? undefined : () => toggleExpanded(famKey)}
                        >
                          {!isSearching && (
                            <span className={`text-slate-400 text-base font-bold shrink-0 inline-block transition-transform duration-200 ${famExpanded ? 'rotate-90' : ''}`}>›</span>
                          )}
                          <IndeterminateCheckbox
                            checked={famChecked}
                            indeterminate={famIndet}
                            onChange={() => toggleFamily(family)}
                          />
                          <span className="flex-1 text-sm text-slate-700">
                            <HighlightMatch text={family.familyComName} query={searchQuery} />
                          </span>
                          <span className="text-xs text-slate-400">{famSelCount}/{famCodes.length}</span>
                        </div>

                        {/* Species */}
                        {famExpanded && (
                          <div className="ml-4 mt-0.5 space-y-0.5">
                            {family.species.map(sp => (
                              <div
                                key={sp.speciesCode}
                                className="flex items-center gap-2 px-3 py-1 rounded-lg hover:bg-slate-100 cursor-pointer select-none"
                                onClick={() => toggleSpecies(sp.speciesCode)}
                              >
                                <input
                                  type="checkbox"
                                  checked={selected.has(sp.speciesCode)}
                                  onChange={() => toggleSpecies(sp.speciesCode)}
                                  onClick={e => e.stopPropagation()}
                                  className="w-4 h-4 accent-forest-600 cursor-pointer shrink-0"
                                />
                                <span className="text-sm text-slate-700">
                                  <HighlightMatch text={sp.comName} query={searchQuery} />
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* Orphans — species without taxonomy data */}
        {!loading && orphans.length > 0 && (
          <div className="mb-1 mt-2">
            <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
              <p className="text-xs text-amber-700 font-medium mb-1">
                Species without taxonomy data ({orphans.length}) — will appear after next quiz round
              </p>
              {orphans.map(sp => (
                <div
                  key={sp.speciesCode}
                  className="flex items-center gap-2 px-1 py-0.5 cursor-pointer"
                  onClick={() => toggleSpecies(sp.speciesCode)}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(sp.speciesCode)}
                    onChange={() => toggleSpecies(sp.speciesCode)}
                    onClick={e => e.stopPropagation()}
                    className="w-4 h-4 accent-forest-600 cursor-pointer shrink-0"
                  />
                  <span className="text-xs text-amber-800">{sp.comName}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
