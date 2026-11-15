import { useCallback, useEffect, useState } from 'react';
import { fetchTipLibrary } from '../../../services/remote/idTipReports';
import type { TipLibraryEntry } from '../../../lib/tipLibrary';

/** Loads every stored tip for the curation library. `reload` refetches (e.g. after an edit). */
export function useTipLibrary() {
  const [entries, setEntries] = useState<TipLibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchTipLibrary()
      .then(setEntries)
      .catch(e => { console.error(e); setError('Could not load the tip library.'); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return { entries, loading, error, reload };
}
