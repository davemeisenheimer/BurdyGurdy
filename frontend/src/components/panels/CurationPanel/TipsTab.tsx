import { useState } from 'react';
import { IdTipReportsTab } from './IdTipReportsTab';
import { TipLibrary } from './TipLibrary';

/** Curation → Tips: switches between pending player reports and the library of all stored tips. */
export function TipsTab() {
  const [mode, setMode] = useState<'reports' | 'library'>('reports');
  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex gap-1 px-3 py-1.5 border-b border-slate-200 bg-white">
        {(['reports', 'library'] as const).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 py-1 rounded-lg text-xs font-semibold transition-colors ${mode === m ? 'bg-forest-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
          >
            {m === 'reports' ? 'Reports' : 'Library'}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        {mode === 'reports' ? <IdTipReportsTab /> : <TipLibrary />}
      </div>
    </div>
  );
}
