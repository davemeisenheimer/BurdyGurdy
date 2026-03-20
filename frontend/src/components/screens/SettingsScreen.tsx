import { useState } from 'react';
import type { AppSettings } from '../../lib/settings';
import { RegionSearch } from '../ui/RegionSearch';
import { MapRegionPicker } from '../ui/MapRegionPicker';

interface Props {
  initialSettings: AppSettings;
  onSave: (s: AppSettings) => void;
  onBack: () => void;
  isDesktop: boolean;
  regionCode?: string;
  onRegionChange?: (code: string) => void;
  onClearBlockedPhotos?: () => void;
}

interface ToggleRowProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

function ToggleRow({ label, description, checked, onChange }: ToggleRowProps) {
  return (
    <label className="flex items-start justify-between gap-4 px-5 py-4 cursor-pointer">
      <div>
        <p className="font-medium text-slate-800 text-sm">{label}</p>
        <p className="text-xs text-slate-500 mt-0.5">{description}</p>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5 w-5 h-5 accent-forest-600 cursor-pointer shrink-0"
      />
    </label>
  );
}

export function SettingsScreen({ initialSettings, onSave, onBack, isDesktop, regionCode, onRegionChange, onClearBlockedPhotos }: Props) {
  const [settings, setSettings] = useState(initialSettings);
  const [regionDisplayName, setRegionDisplayName] = useState<string | undefined>(undefined);
  const [showMap, setShowMap] = useState(false);

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    onSave(next);
  };

  return (
    <div className="min-h-dvh flex flex-col p-3 sm:p-6">
      <div className="w-full max-w-md mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <button onClick={onBack} className="text-slate-500 hover:text-slate-700 text-5xl leading-none">←</button>
          <h1 className="text-2xl font-bold text-slate-800">Settings</h1>
        </div>

        {/* Region — mobile only; desktop sets region on the home screen */}
        {!isDesktop && regionCode !== undefined && onRegionChange && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 mb-4">
            <p className="font-medium text-slate-800 text-sm mb-1">Region</p>
            <p className="text-xs text-slate-500 mb-3">The area whose recent eBird sightings determine your local bird pool.</p>
            <div className="flex gap-2">
              <div className="flex-1">
                <RegionSearch
                  value={regionCode}
                  onChange={c => { onRegionChange(c); setRegionDisplayName(undefined); }}
                  displayName={regionDisplayName}
                />
              </div>
              <button
                onClick={() => setShowMap(true)}
                className="shrink-0 px-3 py-2 rounded-xl border border-slate-300 hover:border-forest-400 hover:bg-forest-50 text-slate-600 text-sm font-medium transition-colors"
                title="Pick region on map"
              >
                🗺 Map
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-1">Search by place name, enter an eBird code (e.g. CA-ON, US-WA), or pick on the map.</p>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 divide-y divide-slate-100 mb-4">
          <div className="px-5 py-4">
            <p className="font-medium text-slate-800 text-sm mb-1">Recent sightings window</p>
            <p className="text-xs text-slate-500 mb-3">Which birds are included in your local pool — only those spotted very recently, or a broader window?</p>
            <div className="flex gap-2">
              {(['day', 'week', 'month'] as const).map(w => (
                <label key={w} className={`flex-1 flex items-center justify-center gap-2 border rounded-lg px-3 py-2 cursor-pointer text-sm transition-colors ${settings.recentWindow === w ? 'border-forest-600 bg-forest-50 text-forest-700 font-medium' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                  <input
                    type="radio"
                    name="recentWindow"
                    value={w}
                    checked={settings.recentWindow === w}
                    onChange={() => update('recentWindow', w)}
                    className="sr-only"
                  />
                  {w === 'day' ? 'Today' : w === 'week' ? 'Past week' : 'Past month'}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 divide-y divide-slate-100">
          <ToggleRow
            label="Autoplay bird song on reveal"
            description="Automatically play the bird's song when the answer is revealed"
            checked={settings.autoplayRevealAudio}
            onChange={v => update('autoplayRevealAudio', v)}
          />
          <ToggleRow
            label="Latin-answer questions"
            description="Include questions where you choose the correct Latin name as the answer (works with Photo, Song, & Family questions — progress badges get an L suffix)"
            checked={settings.includeLatinAnswerVariants}
            onChange={v => update('includeLatinAnswerVariants', v)}
          />
          <ToggleRow
            label="Song-answer questions"
            description="Include questions where you pick the right bird song (works with Photo, Spectrogram, & Latin questions — progress badges get an S suffix)"
            checked={settings.includeSongAnswerVariants}
            onChange={v => update('includeSongAnswerVariants', v)}
          />
          <ToggleRow
            label="Randomize question photos"
            description="Pick a random photo each time instead of always using the primary photo"
            checked={settings.randomizeQuestionPhotos}
            onChange={v => update('randomizeQuestionPhotos', v)}
          />
          {isDesktop && (
            <ToggleRow
              label="Auto-scroll related species"
              description="When the info panel opens, the related species carousel scrolls through once to show you what's there, then stops"
              checked={settings.autoScrollRelatedSpecies ?? true}
              onChange={v => update('autoScrollRelatedSpecies', v)}
            />
          )}
          {isDesktop && (
            <label className="flex items-start justify-between gap-4 px-5 py-4">
              <div>
                <p className="font-medium text-slate-800 text-sm">Max recent sightings</p>
                <p className="text-xs text-slate-500 mt-0.5">Number of recent eBird sightings shown in the info panel. Set to 0 to hide.</p>
              </div>
              <input
                type="number"
                min={0}
                max={10}
                value={settings.maxRecentSightings ?? 4}
                onChange={e => update('maxRecentSightings', Math.min(10, Math.max(0, parseInt(e.target.value) || 0)))}
                className="mt-0.5 w-14 text-center border border-slate-300 rounded-lg px-2 py-1 text-sm text-slate-800 shrink-0"
              />
            </label>
          )}
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 mt-4">
          <p className="font-medium text-slate-800 text-sm mb-1">Blocked photos</p>
          <p className="text-xs text-slate-500 mb-3">Photos you've removed during quizzes won't appear again. Clear this list to allow them back.</p>
          <button
            onClick={onClearBlockedPhotos}
            className="text-xs px-3 py-1.5 border border-red-300 text-red-500 rounded-lg hover:bg-red-50 transition-colors"
          >
            Clear my blocked photos
          </button>
        </div>
      </div>
      {showMap && onRegionChange && (
        <MapRegionPicker
          onSelect={(code, name) => { onRegionChange(code); setRegionDisplayName(name); setShowMap(false); }}
          onClose={() => setShowMap(false)}
        />
      )}
    </div>
  );
}
