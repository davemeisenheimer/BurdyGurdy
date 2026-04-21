import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { api } from '../../services/remote/api';

interface UserRow {
  id:             string;
  email:          string | null;
  username:       string | null;
  lastSignIn:     string | null;
  birdsSeen:      number;
  masteredAll:    number;
  masteredByType: Record<string, number>;
}

type SortField =
  | 'username' | 'email' | 'lastSignIn' | 'birdsSeen' | 'masteredAll'
  | { type: string };

interface SortState {
  field: SortField;
  asc:   boolean;
}

const TYPE_LABEL: Record<string, string> = {
  song:         'Song',
  image:        'Photo',
  sono:         'Spectro',
  latin:        'Latin',
  family:       'Family',
  order:        'Order',
  'image-latin':  'Photo/Latin',
  'song-latin':   'Song/Latin',
  'family-latin': 'Family/Latin',
  'image-song':   'Photo/Song',
  'sono-song':    'Spectro/Song',
  'latin-song':   'Latin/Song',
};

// Preferred display order for question types
const TYPE_ORDER = [
  'song', 'image', 'sono', 'latin', 'family', 'order',
  'image-latin', 'song-latin', 'family-latin', 'image-song', 'sono-song', 'latin-song',
];

function sortFieldEqual(a: SortField, b: SortField): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  if (typeof a === 'object' && typeof b === 'object') return a.type === b.type;
  return false;
}

function getRowValue(row: UserRow, field: SortField): string | number | null {
  if (field === 'username')   return row.username;
  if (field === 'email')      return row.email;
  if (field === 'lastSignIn') return row.lastSignIn;
  if (field === 'birdsSeen')  return row.birdsSeen;
  if (field === 'masteredAll') return row.masteredAll;
  if (typeof field === 'object') return row.masteredByType[field.type] ?? 0;
  return null;
}

export function DatabasePanel() {
  const [rows,    setRows]    = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [sort,    setSort]    = useState<SortState>({ field: 'lastSignIn', asc: false });

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: { session } } = await supabase.auth.refreshSession();
        const token = session?.access_token;
        if (!token) { setError('Not authenticated'); return; }
        const res = await api.get<UserRow[]>('/admin/users', {
          headers: { Authorization: `Bearer ${token}` },
        });
        setRows(res.data);
      } catch (e: unknown) {
        const msg = (e as { response?: { data?: { error?: string } }; message?: string })
          ?.response?.data?.error ?? (e as Error).message ?? 'Failed to load';
        setError(msg);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Derive which question types have at least one mastered bird across all users.
  const activeTypes = useMemo(() => {
    const seen = new Set<string>();
    for (const row of rows) {
      for (const qt of Object.keys(row.masteredByType)) {
        if (row.masteredByType[qt] > 0) seen.add(qt);
      }
    }
    return TYPE_ORDER.filter(t => seen.has(t));
  }, [rows]);

  const handleSort = (field: SortField) => {
    setSort(prev =>
      sortFieldEqual(prev.field, field)
        ? { field, asc: !prev.asc }
        : { field, asc: typeof field === 'string' && (field === 'username' || field === 'email') },
    );
  };

  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const av = getRowValue(a, sort.field);
    const bv = getRowValue(b, sort.field);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    const cmp = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv));
    return sort.asc ? cmp : -cmp;
  }), [rows, sort]);

  const arrow = (field: SortField) =>
    sortFieldEqual(sort.field, field)
      ? <span className="ml-1">{sort.asc ? '↑' : '↓'}</span>
      : null;

  const thBase = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 cursor-pointer select-none hover:text-slate-700 whitespace-nowrap';
  const thRight = thBase + ' text-right';

  // Number of columns under "Mastered": All + one per active type
  const masteredColspan = 1 + activeTypes.length;

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-3 py-2 border-b border-slate-200 bg-white flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Users</p>
        {!loading && !error && (
          <span className="text-xs text-slate-400">{rows.length} user{rows.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {loading && <p className="text-sm text-slate-400 text-center mt-8">Loading…</p>}
        {error   && <p className="text-sm text-red-500 text-center mt-8">{error}</p>}

        {!loading && !error && (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
              {/* Row 1 */}
              <tr>
                <th rowSpan={2} onClick={() => handleSort('username')}   className={thBase}>
                  Username {arrow('username')}
                </th>
                <th rowSpan={2} onClick={() => handleSort('email')}      className={thBase}>
                  Email {arrow('email')}
                </th>
                <th rowSpan={2} onClick={() => handleSort('lastSignIn')} className={thBase}>
                  Last login {arrow('lastSignIn')}
                </th>
                <th rowSpan={2} onClick={() => handleSort('birdsSeen')}  className={thRight}>
                  Birds seen {arrow('birdsSeen')}
                </th>
                {masteredColspan > 0 && (
                  <th
                    colSpan={masteredColspan}
                    className="px-3 py-1 text-center text-xs font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200"
                  >
                    Mastered
                  </th>
                )}
              </tr>
              {/* Row 2 — sub-columns under Mastered */}
              <tr>
                <th onClick={() => handleSort('masteredAll')} className={thRight}>
                  All {arrow('masteredAll')}
                </th>
                {activeTypes.map(qt => (
                  <th
                    key={qt}
                    onClick={() => handleSort({ type: qt })}
                    className={thRight}
                  >
                    {TYPE_LABEL[qt] ?? qt} {arrow({ type: qt })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(row => (
                <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-700 font-medium max-w-[120px] truncate">
                    {row.username ?? <span className="text-slate-400 italic">—</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-600 max-w-[160px] truncate">
                    {row.email ?? <span className="text-slate-400 italic">—</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                    {row.lastSignIn
                      ? new Date(row.lastSignIn).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                      : <span className="text-slate-400 italic">Never</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-700 text-right">{row.birdsSeen}</td>
                  <td className="px-3 py-2 text-slate-700 text-right font-medium">{row.masteredAll}</td>
                  {activeTypes.map(qt => (
                    <td key={qt} className="px-3 py-2 text-slate-600 text-right">
                      {row.masteredByType[qt] ?? 0}
                    </td>
                  ))}
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={4 + masteredColspan} className="px-3 py-8 text-center text-sm text-slate-400">
                    No users found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
