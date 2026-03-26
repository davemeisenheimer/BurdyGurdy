interface Props {
  rangeMapUrl: string;
  legend?:     { color: string; label: string }[];
  ebirdUrl:    string;
}

export function RangeMap({ rangeMapUrl, legend, ebirdUrl }: Props) {
  return (
    <div className="flex h-full items-center gap-1.5">
      <div className="flex-1 min-w-0 flex items-center justify-center h-full">
        <img
          src={rangeMapUrl}
          alt="Range map"
          className="max-w-full max-h-full object-contain"
        />
      </div>
      {(legend?.length ?? 0) > 0 && (
        <div className="shrink-0 w-24 self-stretch flex flex-col rounded-lg border border-stone-300 bg-stone-50 px-2 py-1.5">
          <p className="text-stone-500 font-semibold mb-1.5 leading-tight" style={{ fontSize: '0.6rem' }}>
            Range legend:
          </p>
          <div className="flex-1 flex flex-col gap-0.5">
            {legend!.map(({ color, label }, i) => (
              <div key={`${i}-${label}`} className="flex items-start gap-1">
                <span className="shrink-0 mt-0.5 w-3 h-3 rounded-sm border border-stone-300" style={{ backgroundColor: color }} />
                <span className="text-stone-600 leading-tight" style={{ fontSize: '0.62rem' }}>{label}</span>
              </div>
            ))}
          </div>
          <a href={ebirdUrl} target="_blank" rel="noopener noreferrer"
            className="text-sky-600 hover:underline mt-1.5 leading-tight" style={{ fontSize: '0.6rem' }}>
            Interactive map ↗
          </a>
        </div>
      )}
    </div>
  );
}
