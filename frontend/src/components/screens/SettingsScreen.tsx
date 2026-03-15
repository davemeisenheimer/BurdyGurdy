import { useState } from 'react';
import type { AppSettings } from '../../lib/settings';

interface Props {
  initialSettings: AppSettings;
  onSave: (s: AppSettings) => void;
  onBack: () => void;
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

export function SettingsScreen({ initialSettings, onSave, onBack }: Props) {
  const [settings, setSettings] = useState(initialSettings);

  const update = (key: keyof AppSettings, value: boolean) => {
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
        </div>
      </div>
    </div>
  );
}
