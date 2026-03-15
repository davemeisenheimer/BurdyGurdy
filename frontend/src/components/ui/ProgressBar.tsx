interface Props {
  current: number;
  total: number;
}

export function ProgressBar({ current, total }: Props) {
  const pct = total > 0 ? (current / total) * 100 : 0;
  return (
    <div className="w-full">
      <div className="flex justify-between text-xs text-slate-500 mb-1">
        <span>Question {current} of {total}</span>
      </div>
      <div className="w-full bg-slate-200 rounded-full h-2">
        <div
          className="bg-forest-500 h-2 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
