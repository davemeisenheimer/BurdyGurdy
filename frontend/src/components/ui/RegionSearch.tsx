import { useState, useEffect, useRef } from 'react';
import axios from 'axios';

interface RegionResult {
  code: string;
  name: string;
}

interface Props {
  value: string;
  onChange: (code: string) => void;
  /** When set externally (e.g. from map picker), overrides the display text */
  displayName?: string;
}

export function RegionSearch({ value, onChange, displayName }: Props) {
  const [query, setQuery] = useState(value);

  // Sync display text when an external source (e.g. map picker) sets a new name
  useEffect(() => {
    if (displayName !== undefined) setQuery(displayName);
  }, [displayName]);
  const [results, setResults] = useState<RegionResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const search = (q: string) => {
    if (q.length < 2) { setResults([]); setOpen(false); return; }
    setLoading(true);
    axios.get<RegionResult[]>('/api/birds/regions/search', { params: { q } })
      .then(r => { setResults(r.data); setOpen(r.data.length > 0); })
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  };

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(q), 300);
  };

  const handleSelect = (r: RegionResult) => {
    setQuery(r.name);
    onChange(r.code);
    setOpen(false);
  };

  const handleBlur = () => {
    // If the user typed something that looks like a raw code (e.g. CA-ON), use it directly
    if (!open && /^[A-Z]{2}(-[A-Z0-9]+)*$/i.test(query.trim())) {
      onChange(query.trim().toUpperCase());
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={handleInput}
          onBlur={handleBlur}
          placeholder="Search by place name or enter code (e.g. CA-ON)"
          className="w-full border border-slate-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-forest-500 pr-8"
        />
        {loading && (
          <span className="absolute right-3 top-2.5 text-slate-400 text-xs">...</span>
        )}
      </div>
      {open && results.length > 0 && (
        <ul className="absolute z-10 w-full bg-white border border-slate-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
          {results.map(r => (
            <li key={r.code}>
              <button
                type="button"
                onMouseDown={() => handleSelect(r)}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-forest-50 flex justify-between items-center"
              >
                <span>{r.name}</span>
                <span className="text-xs text-slate-400 font-mono ml-2">{r.code}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
