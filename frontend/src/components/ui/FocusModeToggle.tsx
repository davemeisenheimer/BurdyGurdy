interface Props {
  enabled: boolean;
  onToggle: () => void;
  strugglingCount: number;
}

export function FocusModeToggle({ enabled, onToggle, strugglingCount }: Props) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800">Practice struggling birds only</p>
        <p className="text-xs text-slate-500 mt-0.5">
          You're struggling with{' '}
          <span className="font-semibold text-red-600">
            {strugglingCount} bird{strugglingCount !== 1 ? 's' : ''}
          </span>
          {' '}in your current question types.
        </p>
      </div>
      <button
        role="switch"
        aria-checked={enabled}
        onClick={onToggle}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none ${
          enabled ? 'bg-red-500' : 'bg-slate-300'
        }`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          enabled ? 'translate-x-6' : 'translate-x-1'
        }`} />
      </button>
    </div>
  );
}
