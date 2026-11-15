import { useEffect, useState } from 'react';

/** Delay before the bar starts moving, so stored tips (which arrive almost instantly) don't flicker it. */
const START_DELAY_MS = 150;
/** Roughly how long a fresh Haiku tip takes; the bar is ~95% full by then. */
const TYPICAL_TIP_MS = 3000;

/**
 * Estimated-progress bar shown while the AI tip loads. The server reports no real progress, so it
 * eases toward 95% over the typical wait and holds there; the caller unmounts it when the tip arrives.
 */
export function TipProgressBar() {
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setStarted(true), START_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-label="Loading tip">
      <div
        className="h-full rounded-full bg-amber-400"
        style={{
          width: started ? '95%' : '0%',
          transition: `width ${TYPICAL_TIP_MS}ms cubic-bezier(0.2, 0.6, 0.35, 1)`,
        }}
      />
    </div>
  );
}
