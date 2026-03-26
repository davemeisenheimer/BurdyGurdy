interface Props {
  label:    string;
  variant:  'correct' | 'incorrect' | 'neutral';
  backLabel?: string;
  onBack?:    () => void;
}

export function AnswerBanner({ label, variant, backLabel, onBack }: Props) {
  const bg   = variant === 'correct'   ? 'bg-green-50 border-green-100'
             : variant === 'incorrect' ? 'bg-red-50 border-red-100'
             :                           'bg-slate-50 border-slate-200';
  const text = variant === 'correct'   ? 'text-green-700'
             : variant === 'incorrect' ? 'text-red-700'
             :                           'text-slate-700';
  return (
    <div className={`shrink-0 flex items-center px-4 py-2.5 border-b ${bg}`}>
      <p className={`flex-1 text-sm font-semibold ${text}`}>{label}</p>
      {backLabel && onBack && (
        <button
          onClick={onBack}
          className="shrink-0 ml-3 text-xs text-sky-600 hover:text-sky-800 whitespace-nowrap"
        >
          {backLabel}
        </button>
      )}
    </div>
  );
}
