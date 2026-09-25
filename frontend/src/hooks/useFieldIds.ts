import { useCallback, useEffect, useState } from 'react';
import type { FieldId } from '../types';
import { loadFieldIds, buildFieldIdMap, type FieldIdMap } from '../services/local/fieldIds';

/**
 * Loads the seen/heard-in-the-wild ticks a screen shows on its bird cards. Reads the local
 * table, or uses `override` when showing someone else's (a friend's) ticks. `refreshKey`
 * re-reads after a cloud sync; call `reloadFieldIds` after a tick change.
 */
export function useFieldIds(override?: FieldId[], refreshKey?: unknown) {
  const [fieldIds, setFieldIds] = useState<FieldIdMap>(() => new Map());

  const reloadFieldIds = useCallback(() => {
    if (override !== undefined) { setFieldIds(buildFieldIdMap(override)); return; }
    loadFieldIds().then(list => setFieldIds(buildFieldIdMap(list))).catch(() => {});
  }, [override]);

  useEffect(() => { reloadFieldIds(); }, [reloadFieldIds, refreshKey]);

  return { fieldIds, reloadFieldIds };
}
