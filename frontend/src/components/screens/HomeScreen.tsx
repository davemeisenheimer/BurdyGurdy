import { useState } from 'react';
import type { QuizConfig, QuestionType, GameMode } from '../../types';
import { RegionSearch } from '../ui/RegionSearch';
import { BIRD_GROUPS } from '../../lib/birdGroups';
import { HelpModal } from '../ui/HelpModal';
import { MapRegionPicker } from '../ui/MapRegionPicker';

interface Props {
  initialConfig: QuizConfig;
  onStart: (config: QuizConfig) => void;
  onProgress: () => void;
  onSettings: () => void;
}

const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
  { value: 'song',   label: 'Song / Call' },
  { value: 'image',  label: 'Photo' },
  { value: 'latin',  label: 'Latin Name' },
  { value: 'family', label: 'Bird Family' },
  { value: 'order',  label: 'Bird Order' },
  { value: 'sono',   label: 'Spectrogram' },
];

export function HomeScreen({ initialConfig, onStart, onProgress, onSettings }: Props) {
  const [regionCode, setRegionCode] = useState(initialConfig.regionCode);
  const [selectedTypes, setSelectedTypes] = useState<QuestionType[]>(initialConfig.questionTypes);
  const [mode, setMode] = useState<GameMode>(initialConfig.mode);
  const [questionsPerRound, setQuestionsPerRound] = useState(initialConfig.questionsPerRound);
  const [groupId, setGroupId] = useState(initialConfig.groupId);
  const [regionDisplayName, setRegionDisplayName] = useState<string | undefined>(undefined);
  const [showHelp, setShowHelp] = useState(false);
  const [showMap, setShowMap] = useState(false);

  const toggleType = (type: QuestionType) => {
    setSelectedTypes(prev =>
      prev.includes(type)
        ? prev.length > 1 ? prev.filter(t => t !== type) : prev
        : [...prev, type]
    );
  };

  const handleStart = () => {
    onStart({ regionCode, questionTypes: selectedTypes, mode, questionsPerRound, groupId });
  };

  return (
    <div className="min-h-dvh flex flex-col p-3 sm:p-6">
      <div className="w-full max-w-md mx-auto flex flex-col flex-1">
        <div className="text-center relative">
          <button
            onClick={() => setShowHelp(true)}
            className="absolute right-0 top-0 w-8 h-8 rounded-full border border-slate-300 text-slate-500 hover:bg-slate-100 text-sm font-semibold"
            aria-label="Help"
          >
            ?
          </button>
          <button
            onClick={onSettings}
            className="absolute left-0 top-0 w-8 h-8 rounded-full border border-slate-300 text-slate-500 hover:bg-slate-100 text-sm"
            aria-label="Settings"
          >
            ⚙
          </button>
          <div className="text-6xl mb-3">🐦</div>
          <h1 className="text-4xl font-bold text-forest-800">BurdyGurdy</h1>
          <p className="text-slate-500 mt-2">Learn the birds that make sense</p>
        </div>

        <div className="flex-1 max-h-[1em]" />

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-6">
          {/* Region */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Region</label>
            <div className="flex gap-2">
              <div className="flex-1">
                <RegionSearch value={regionCode} onChange={c => { setRegionCode(c); setRegionDisplayName(undefined); }} displayName={regionDisplayName} />
              </div>
              <button
                onClick={() => setShowMap(true)}
                className="shrink-0 px-3 py-2 rounded-xl border border-slate-300 hover:border-forest-400 hover:bg-forest-50 text-slate-600 text-sm font-medium transition-colors"
                title="Pick region on map"
              >
                🗺 Map
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-1">Search by place name, enter an eBird code directly (e.g. CA-ON, CA-ON-OT, US-WA, or CR), or pick on the map.</p>
          </div>

          {/* Question types */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Question Types</label>
            <div className="grid grid-cols-3 gap-2">
              {QUESTION_TYPES.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => toggleType(value)}
                  className={`px-2 py-1.5 rounded-full text-xs font-medium border transition-colors text-center ${
                    selectedTypes.includes(value)
                      ? 'bg-forest-600 border-forest-600 text-white'
                      : 'bg-white border-slate-300 text-slate-600 hover:border-forest-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Bird group */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Bird Group</label>
            <div className="grid grid-cols-3 gap-2">
              {BIRD_GROUPS.map(g => (
                <button
                  key={g.id}
                  onClick={() => setGroupId(g.id)}
                  className={`px-2 py-1.5 rounded-full text-xs font-medium border transition-colors text-center ${
                    groupId === g.id
                      ? 'bg-forest-600 border-forest-600 text-white'
                      : 'bg-white border-slate-300 text-slate-600 hover:border-forest-400'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          {/* Mode */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Learning Mode</label>
            <div className="flex gap-2">
              {(['adaptive', 'random'] as GameMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors capitalize ${
                    mode === m
                      ? 'bg-sky-600 border-sky-600 text-white'
                      : 'bg-white border-slate-300 text-slate-600 hover:border-sky-400'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Adaptive focuses on birds you find difficult. Random picks evenly.
            </p>
          </div>

          {/* Questions per round */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              Questions per Round: <span className="text-forest-700">{questionsPerRound}</span>
            </label>
            <input
              type="range"
              min={5}
              max={25}
              step={5}
              value={questionsPerRound}
              onChange={e => setQuestionsPerRound(Number(e.target.value))}
              className="w-full accent-forest-600"
            />
          </div>

          <div className="space-y-3">
            <button
              onClick={handleStart}
              disabled={selectedTypes.length === 0 || !regionCode}
              className="w-full py-3 rounded-xl bg-forest-600 hover:bg-forest-700 text-white font-semibold text-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Start Game
            </button>

            <button
              onClick={onProgress}
              className="w-full py-2.5 rounded-xl border-2 border-slate-300 hover:border-slate-400 text-slate-700 font-semibold transition-colors"
            >
              My Life List
            </button>
          </div>
        </div>
      </div>

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {showMap && (
        <MapRegionPicker
          onSelect={(code, name) => { setRegionCode(code); setRegionDisplayName(name); }}
          onClose={() => setShowMap(false)}
        />
      )}
    </div>
  );
}
