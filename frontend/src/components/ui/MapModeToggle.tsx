import type { MapMode } from '../bird/SightingsMap';
import { InfoButton } from './InfoButton';
import { HELP_CONTENT } from '../../lib/helpContent';

interface Props {
  mode:           MapMode;
  onModeChange:   (mode: MapMode) => void;
  speciesLoading?: boolean;
}

const btnBase     = 'px-3 py-1 text-xs font-semibold rounded-full border transition-colors whitespace-nowrap';
const btnActive   = 'bg-sky-600 border-sky-600 text-white';
const btnInactive = 'bg-white border-slate-300 text-slate-600 hover:border-sky-400';

export function MapModeToggle({ mode, onModeChange, speciesLoading = false }: Props) {
  return (
    <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-slate-200 bg-white overflow-x-auto">
      <button className={`${btnBase} ${mode === 'single'  ? btnActive : btnInactive}`} onClick={() => onModeChange('single')}>
        Latest selected
      </button>
      <button className={`${btnBase} ${mode === 'species' ? btnActive : btnInactive}`} onClick={() => onModeChange('species')}>
        {mode === 'species' && speciesLoading ? 'Loading…' : 'All for selected'}
      </button>
      <button className={`${btnBase} ${mode === 'all'     ? btnActive : btnInactive}`} onClick={() => onModeChange('all')}>
        All species
      </button>
      <InfoButton {...HELP_CONTENT.mapScope} />
    </div>
  );
}
