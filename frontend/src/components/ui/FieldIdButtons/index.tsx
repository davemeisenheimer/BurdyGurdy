import { fieldIdKey, fieldIdTooltip, type FieldIdMap, type FieldIdType } from '../../../services/local/fieldIds';
import { useFieldIdEditor } from './useFieldIdEditor';
import { FieldIdDialog } from './FieldIdDialog';

interface Props {
  speciesCode: string;
  comName: string;
  /** The ticks to display - the user's own, or a friend's when readOnly. */
  fieldIds: FieldIdMap;
  /** Shows the ticks (and their tooltips) but ignores taps - used when viewing someone else's (e.g. a friend's) progress. */
  readOnly?: boolean;
  /** Called after a tick change is saved, so the parent screen can reload its ticks and records. */
  onChanged?: () => void;
}

const activeClass   = 'bg-sky-100 border-sky-400 text-sky-700';
const idleClass     = 'bg-white border-slate-300 text-slate-500';
const buttonClass   = 'w-7 h-7 rounded-full border text-sm leading-none flex items-center justify-center shrink-0 transition-colors';
const editableClass = 'hover:bg-slate-50';
const readOnlyClass = 'cursor-default';

const BUTTONS: { type: FieldIdType; emoji: string; markTitle: string }[] = [
  { type: 'image', emoji: '🔭', markTitle: "Mark that you've seen this bird in the field" },
  { type: 'song',  emoji: '🎤', markTitle: "Mark that you've heard this bird in the field" },
];

/**
 * The 🔭/🎤 pair shown on a bird card: the user's record of having personally identified this
 * bird in the wild by sight or sound, with the date, location and notes of the sighting.
 * Tapping an unlit button records a new sighting; tapping a lit one shows/edits/removes it.
 */
export function FieldIdButtons({ speciesCode, comName, fieldIds, readOnly = false, onChanged }: Props) {
  const editor = useFieldIdEditor(speciesCode, comName, onChanged);

  return (
    <>
      <div className="flex items-center gap-1.5 shrink-0">
        {BUTTONS.map(({ type, emoji, markTitle }) => {
          const current = fieldIds.get(fieldIdKey(speciesCode, type));
          const on = current !== undefined;
          // Not `disabled` when read-only: some browsers suppress tooltips on disabled buttons.
          return (
            <button
              key={type}
              type="button"
              aria-disabled={readOnly || undefined}
              title={on || readOnly ? fieldIdTooltip(type, current) : markTitle}
              aria-label={on || readOnly ? fieldIdTooltip(type, current) : markTitle}
              aria-pressed={on}
              onClick={e => {
                e.stopPropagation();
                if (!readOnly) void editor.open(type, current);
              }}
              className={`${buttonClass} ${on ? activeClass : idleClass} ${readOnly ? readOnlyClass : editableClass}`}
            >
              {emoji}
            </button>
          );
        })}
      </div>

      {/* Mounted only while open, so its local state (map, last picked name) starts fresh each time. */}
      {editor.session && <FieldIdDialog editor={editor} speciesCode={speciesCode} comName={comName} />}
    </>
  );
}
