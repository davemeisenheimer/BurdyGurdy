import { useCallback, useState } from 'react';
import type { BirdProgress, FieldId } from '../../../types';
import {
  availableFieldIdActions, confirmFieldId, updateFieldIdDetails, unconfirmFieldId, getSpeciesProgress,
  isValidSightedOn, localIsoDate,
  type FieldIdAction, type FieldIdChange, type FieldIdDetails, type FieldIdType,
} from '../../../services/local/fieldIds';
import { syncFieldIdChange } from '../../../services/remote/sync';

export interface FieldIdEditorSession {
  /** 'new' makes a tick (and offers the what-else-to-do actions); 'edit' changes an existing one's details. */
  mode: 'new' | 'edit';
  questionType: FieldIdType;
  actions: FieldIdAction[];
  /** Local date the dialog was opened - the latest allowed sighting date. */
  today: string;
  /** The species' progress records for its other question types - context for the palette option. */
  otherRecords: BirdProgress[];
}

/**
 * Stateful glue for the 🔭/🎤 field-ID dialog on one bird card: opening it for a new or existing
 * tick, the draft sighting details, the what-else-to-do choice, and saving/removing. Nothing is
 * written until save() or remove(). `onChanged` lets the screen reload its ticks and records.
 */
export function useFieldIdEditor(speciesCode: string, comName: string, onChanged?: () => void) {
  const [session, setSession]                   = useState<FieldIdEditorSession | null>(null);
  const [draft, setDraft]                       = useState<FieldIdDetails>({ sightedOn: '' });
  const [choice, setChoice]                     = useState<FieldIdAction>('record');
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const open = useCallback(async (questionType: FieldIdType, current: FieldId | undefined) => {
    const today = localIsoDate(new Date());
    setConfirmingRemove(false);
    if (current) {
      setDraft({
        sightedOn:    current.sightedOn ?? today,
        locationName: current.locationName,
        locationLat:  current.locationLat,
        locationLng:  current.locationLng,
        notes:        current.notes,
      });
      setSession({ mode: 'edit', questionType, actions: [], today, otherRecords: [] });
      return;
    }
    const records  = await getSpeciesProgress(speciesCode);
    const existing = records.find(r => r.questionType === questionType) ?? null;
    setDraft({ sightedOn: today });
    setChoice('record');
    setSession({
      mode: 'new', questionType, actions: availableFieldIdActions(existing), today,
      otherRecords: records.filter(r => r.questionType !== questionType),
    });
  }, [speciesCode]);

  const close = useCallback(() => {
    setSession(null);
    setConfirmingRemove(false);
  }, []);

  const finish = useCallback((change: FieldIdChange | null) => {
    close();
    if (!change) return;
    onChanged?.();
    syncFieldIdChange(change).catch(() => {});
  }, [close, onChanged]);

  const canSave = session !== null && isValidSightedOn(draft.sightedOn, session.today);

  const save = useCallback(async () => {
    if (!session || !canSave) return;
    const change = session.mode === 'new'
      ? await confirmFieldId(speciesCode, session.questionType, comName, choice, draft)
      : await updateFieldIdDetails(speciesCode, session.questionType, draft);
    finish(change);
  }, [session, canSave, speciesCode, comName, choice, draft, finish]);

  const remove = useCallback(async () => {
    if (!session) return;
    finish(await unconfirmFieldId(speciesCode, session.questionType));
  }, [session, speciesCode, finish]);

  return {
    session, draft, setDraft, choice, setChoice, canSave,
    confirmingRemove, setConfirmingRemove,
    open, close, save, remove,
  };
}

export type FieldIdEditor = ReturnType<typeof useFieldIdEditor>;
