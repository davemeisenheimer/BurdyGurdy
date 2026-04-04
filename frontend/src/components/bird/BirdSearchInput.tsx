import { useEffect, useRef, useState } from 'react';
import { fetchBirdSuggestions } from '../../services/remote/api';
import type { BirdSuggestion } from '../../services/remote/api';
import type { SlideSpecies } from './types';

interface Props {
  onSelect:   (species: SlideSpecies) => void;
  className?: string;
}

export function BirdSearchInput({ onSelect, className = 'mt-3' }: Props) {
  const [query, setQuery]           = useState('');
  const [results, setResults]       = useState<BirdSuggestion[]>([]);
  const [loading, setLoading]       = useState(false);
  const [open, setOpen]             = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const debounceRef                 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef                = useRef<HTMLDivElement>(null);
  const listRef                     = useRef<HTMLUListElement>(null);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 3) {
      setResults([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const suggestions = await fetchBirdSuggestions(query);
      setResults(suggestions);
      setActiveIndex(0);
      setOpen(suggestions.length > 0);
      setLoading(false);
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Scroll active item into view
  useEffect(() => {
    const item = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  function handleSelect(s: BirdSuggestion) {
    onSelect({ speciesCode: s.speciesCode, comName: s.comName, sciName: s.sciName, familyComName: '' });
    setQuery('');
    setResults([]);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleSelect(results[activeIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1.5 focus-within:border-forest-500 transition-colors">
        <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search any bird…"
          className="flex-1 text-xs bg-transparent outline-none text-slate-700 placeholder-slate-400 min-w-0"
        />
        {loading && (
          <svg className="w-3 h-3 text-slate-400 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
        )}
        {query.length > 0 && !loading && (
          <button onClick={() => { setQuery(''); setResults([]); setOpen(false); }} className="text-slate-400 hover:text-slate-600 shrink-0 leading-none">✕</button>
        )}
      </div>

      {/* Results list — floats upward */}
      {open && (
        <ul ref={listRef} className="absolute bottom-full mb-1 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-20 max-h-60 overflow-y-auto">
          {results.map((s, i) => (
            <li key={s.speciesCode}>
              <button
                onMouseDown={e => { e.preventDefault(); handleSelect(s); }}
                onMouseEnter={() => setActiveIndex(i)}
                className={`w-full text-left px-3 py-2 transition-colors ${i === activeIndex ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
              >
                <span className="text-sm font-medium text-slate-700">{s.comName}</span>
                <span className="text-xs text-slate-400 ml-1.5 italic">{s.sciName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
