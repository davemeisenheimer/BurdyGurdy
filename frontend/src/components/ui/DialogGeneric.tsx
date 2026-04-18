import { DIALOGS } from './dialogData';

interface Props {
  dialogId: string;
  /** Extra content appended after the data-file children — for dynamic text at the call site. */
  extraChildren?: React.ReactNode;
  onConfirm?: () => void;
  onCancel?: () => void;
}

export function DialogGeneric({ dialogId, extraChildren, onConfirm, onCancel }: Props) {
  const config = DIALOGS[dialogId];
  if (!config) return null;

  const {
    title,
    children,
    confirmLabel = 'OK',
    cancelLabel = 'Cancel',
    confirmClassName = 'bg-forest-600 hover:bg-forest-700',
  } = config;

  const hasButtons = onConfirm !== undefined || onCancel !== undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-sky-50 rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800 mb-2">{title}</h2>
          {children}
          {extraChildren}
        </div>
        {hasButtons && (
          <div className="flex gap-3">
            {onCancel !== undefined && (
              <button
                onClick={onCancel}
                className="flex-1 py-2.5 rounded-xl bg-sky-100 border border-sky-200 text-slate-700 font-medium text-sm hover:bg-sky-200 transition-colors"
              >
                {cancelLabel}
              </button>
            )}
            {onConfirm !== undefined && (
              <button
                onClick={onConfirm}
                className={`flex-1 py-2.5 rounded-xl text-white font-semibold text-sm transition-colors ${confirmClassName}`}
              >
                {confirmLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
