import { useCallback, useEffect, useState } from 'react';
import type { IdTipParams } from '../../../services/remote/api';
import { fetchStoredTip, generateTipDraft, saveTip, type StoredTip } from '../../../services/remote/idTipReports';
import { canSaveTipEdit } from '../../../lib/idTip';

export type TipEditorBusy = 'loading' | 'regenerating' | 'saving' | null;

/**
 * Edits the stored tip for one (species, guess, photo). The draft is local until saved: regenerating
 * only replaces the draft, so players keep seeing the saved tip until the curator saves.
 */
export function useTipEditor(params: IdTipParams) {
  const [saved, setSaved] = useState<StoredTip | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy]   = useState<TipEditorBusy>('loading');
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const { speciesCode, comName, sciName, guess, photoUrl } = params;

  useEffect(() => {
    let cancelled = false;
    setBusy('loading');
    setError(null);
    fetchStoredTip({ speciesCode, comName, sciName, guess, photoUrl })
      .then(record => { if (!cancelled) { setSaved(record); setDraft(record?.tip ?? ''); } })
      .catch(() => { if (!cancelled) setError('Could not load the current tip.'); })
      .finally(() => { if (!cancelled) setBusy(null); });
    return () => { cancelled = true; };
  }, [speciesCode, comName, sciName, guess, photoUrl]);

  const editDraft = useCallback((text: string) => { setDraft(text); setJustSaved(false); }, []);

  const regenerate = useCallback(async () => {
    setBusy('regenerating');
    setError(null);
    setJustSaved(false);
    try {
      setDraft(await generateTipDraft({ speciesCode, comName, sciName, guess, photoUrl }));
    } catch {
      setError('Could not generate a new tip. Please try again.');
    } finally {
      setBusy(null);
    }
  }, [speciesCode, comName, sciName, guess, photoUrl]);

  const save = useCallback(async () => {
    setBusy('saving');
    setError(null);
    try {
      const record = await saveTip({ speciesCode, comName, sciName, guess, photoUrl }, draft.trim());
      setSaved(record);
      setDraft(record.tip);
      setJustSaved(true);
    } catch {
      setError('Could not save the tip. Please try again.');
    } finally {
      setBusy(null);
    }
  }, [speciesCode, comName, sciName, guess, photoUrl, draft]);

  const revert = useCallback(() => { setDraft(saved?.tip ?? ''); setError(null); }, [saved]);

  const dirty = draft.trim() !== (saved?.tip ?? '').trim();

  return {
    saved, draft, busy, error, justSaved, dirty,
    canSave: busy === null && canSaveTipEdit(draft, saved?.tip ?? null),
    editDraft, regenerate, save, revert,
  };
}
