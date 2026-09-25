import { Suspense, useState } from 'react';
import { lazyWithReload } from '../../../lib/lazyWithReload';
import { locationTextAfterPick, paletteContextText, type FieldIdAction } from '../../../services/local/fieldIds';
import { HELP_CONTENT } from '../../../lib/helpContent';
import { InfoButton } from '../InfoButton';
import { TYPE_LABELS } from '../ProgressTypePill';
import type { FieldIdEditor } from './useFieldIdEditor';
import type { PickedLocation } from './FieldLocationPicker';

// Leaflet is heavy - only load the map when the user actually opens it.
const FieldLocationPicker = lazyWithReload(() => import('./FieldLocationPicker'));

const ACTION_LABELS: Record<FieldIdAction, string> = {
  record:  'Just record my field sighting',
  palette: 'Add bird to learning palette',
  master:  'Promote bird to mastered',
};

/** helpContent.ts entry explaining each action in more detail. */
const ACTION_HELP_IDS: Record<FieldIdAction, string> = {
  record:  'fieldIdRecord',
  palette: 'fieldIdPalette',
  master:  'fieldIdMaster',
};

const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400';
const labelClass = 'block text-xs font-semibold text-slate-600 mb-1';

interface Props {
  editor: FieldIdEditor;
  speciesCode: string;
  comName: string;
}

/**
 * The sighting form for one 🔭/🎤 tick: date, location (typed, or pinned on a map), notes, and -
 * for a new tick - what else to do (just record / add to palette / master). An existing tick
 * can be edited or removed. Z-index 1100 keeps it above the Leaflet map on the sightings screen.
 */
export function FieldIdDialog({ editor, speciesCode, comName }: Props) {
  const { session, draft, setDraft, choice, setChoice, canSave, confirmingRemove, setConfirmingRemove, close, save, remove } = editor;
  const [showMap, setShowMap] = useState(false);
  // The name the last map pick filled in, so a later pick can replace it (but not typed text).
  const [lastPickedName, setLastPickedName] = useState<string | undefined>(undefined);
  if (!session) return null;

  const isNew = session.mode === 'new';
  const verb  = session.questionType === 'image' ? 'seen' : 'heard';
  const hasPin = draft.locationLat !== undefined && draft.locationLng !== undefined;
  const dateInvalid = !canSave;

  // The palette explanation opens with where this bird already stands for its other question types.
  const paletteContext = paletteContextText(session.questionType, session.otherRecords, t => TYPE_LABELS[t] ?? t);
  const actionHelp = (action: FieldIdAction) => {
    const entry = HELP_CONTENT[ACTION_HELP_IDS[action]];
    return action === 'palette' && paletteContext ? { ...entry, body: [paletteContext, ...entry.body] } : entry;
  };

  const handlePicked = (loc: PickedLocation) => {
    setDraft(d => ({
      ...d,
      locationLat: loc.lat,
      locationLng: loc.lng,
      locationName: locationTextAfterPick(d.locationName, lastPickedName, loc.name),
    }));
    setLastPickedName(loc.name);
  };

  return (
    // The dialog renders inside the (clickable) card, so keep its clicks from selecting the card.
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/50 p-4"
      onClick={e => e.stopPropagation()}
    >
      <div className="bg-sky-50 rounded-2xl shadow-xl w-full max-w-sm max-h-[90dvh] overflow-y-auto p-6 flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800 mb-2">{isNew ? 'Identified in the wild' : 'Your field sighting'}</h2>
          <p className="text-sm text-slate-700">
            You've {verb} the <span className="font-semibold">{comName}</span> in the field.
          </p>
          {isNew && (
            <p className="text-xs text-slate-500 leading-relaxed mt-2">
              🔭 means you've seen this bird yourself, out in the field. 🎤 means you've heard it.
              Tap it again later to see or change these details.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <label htmlFor={`fieldId-date-${speciesCode}`} className={labelClass}>Date</label>
            <input
              id={`fieldId-date-${speciesCode}`}
              type="date"
              max={session.today}
              value={draft.sightedOn}
              onChange={e => setDraft(d => ({ ...d, sightedOn: e.target.value }))}
              className={inputClass}
            />
            {dateInvalid && <p className="text-xs text-red-600 mt-1">Pick a date that isn't in the future.</p>}
          </div>

          <div>
            <label htmlFor={`fieldId-location-${speciesCode}`} className={labelClass}>Location</label>
            <div className="flex gap-2">
              <input
                id={`fieldId-location-${speciesCode}`}
                type="text"
                placeholder="e.g. Mud Lake, Ottawa"
                value={draft.locationName ?? ''}
                onChange={e => setDraft(d => ({ ...d, locationName: e.target.value }))}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => setShowMap(true)}
                title="Pick on a map"
                aria-label="Pick location on a map"
                className="shrink-0 w-10 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-base"
              >
                🗺️
              </button>
            </div>
            {hasPin && (
              <p className="text-xs text-slate-500 mt-1">
                📍 Pinned on the map ·{' '}
                <button
                  type="button"
                  onClick={() => setDraft(d => ({ ...d, locationLat: undefined, locationLng: undefined }))}
                  className="text-sky-700 hover:underline"
                >
                  Remove pin
                </button>
              </p>
            )}
          </div>

          <div>
            <label htmlFor={`fieldId-notes-${speciesCode}`} className={labelClass}>Field notes</label>
            <textarea
              id={`fieldId-notes-${speciesCode}`}
              rows={3}
              value={draft.notes ?? ''}
              onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
              className={`${inputClass} resize-y`}
            />
          </div>

          <p className="text-xs text-slate-500">Friends can see the date, but not the location or notes.</p>
        </div>

        {isNew && (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-semibold text-slate-600 mb-1">Also…</legend>
            {session.actions.map(action => (
              <div key={action} className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
                  <input
                    type="radio"
                    name={`fieldIdAction-${speciesCode}`}
                    value={action}
                    checked={choice === action}
                    onChange={() => setChoice(action)}
                    className="w-4 h-4 accent-sky-600 cursor-pointer"
                  />
                  {ACTION_LABELS[action]}
                </label>
                <InfoButton {...actionHelp(action)} />
              </div>
            ))}
          </fieldset>
        )}

        {confirmingRemove ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-slate-700">Remove this field sighting? Its date, location and notes will be deleted.</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmingRemove(false)}
                className="flex-1 py-2.5 rounded-xl bg-sky-100 border border-sky-200 text-slate-700 font-medium text-sm hover:bg-sky-200 transition-colors"
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={() => { void remove(); }}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold text-sm transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex gap-3">
              <button
                type="button"
                onClick={close}
                className="flex-1 py-2.5 rounded-xl bg-sky-100 border border-sky-200 text-slate-700 font-medium text-sm hover:bg-sky-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!canSave}
                onClick={() => { void save(); }}
                className="flex-1 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors"
              >
                {isNew ? 'OK' : 'Save'}
              </button>
            </div>
            {!isNew && (
              <button
                type="button"
                onClick={() => setConfirmingRemove(true)}
                className="self-center text-sm text-red-600 hover:underline"
              >
                Remove sighting
              </button>
            )}
          </div>
        )}
      </div>

      {showMap && (
        <Suspense fallback={null}>
          <FieldLocationPicker
            initial={hasPin ? { lat: draft.locationLat!, lng: draft.locationLng! } : undefined}
            onSelect={handlePicked}
            onClose={() => setShowMap(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
