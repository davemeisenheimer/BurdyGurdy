interface Props {
  label: string;
  status: 'default' | 'correct' | 'incorrect' | 'disabled';
  onClick: () => void;
  audioUrl?: string;
  isPlaying?: boolean;
  onPlayToggle?: () => void;
  hideLabel?: boolean;
  onReport?: () => void;
}

const statusStyles: Record<Props['status'], string> = {
  default: 'bg-white border-slate-200 hover:border-forest-500 hover:bg-forest-50 cursor-pointer',
  correct: 'bg-green-50 border-green-500 text-green-800',
  incorrect: 'bg-red-50 border-red-400 text-red-800',
  disabled: 'bg-white border-slate-200 text-slate-400 cursor-not-allowed opacity-60',
};

export function AnswerOption({ label, status, onClick, audioUrl, isPlaying, onPlayToggle, hideLabel, onReport }: Props) {
  return (
    <button
      onClick={status === 'default' ? onClick : undefined}
      className={`w-full text-left px-5 py-3 rounded-xl border-2 text-base font-medium transition-all ${statusStyles[status]}`}
    >
      <span className="flex items-center gap-3">
        {audioUrl && (
          <span
            role="button"
            onClick={e => { e.stopPropagation(); onPlayToggle?.(); }}
            className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm leading-none"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? '⏸' : '▶'}
          </span>
        )}
        {!hideLabel && <span className="flex-1">{label}</span>}
        {onReport && (
          <span
            role="button"
            onClick={onReport}
            className="shrink-0 text-xs text-green-500 hover:text-red-500 transition-colors leading-none"
            aria-label="Report an error with this media"
          >
            ⚑ Report error
          </span>
        )}
      </span>
    </button>
  );
}
