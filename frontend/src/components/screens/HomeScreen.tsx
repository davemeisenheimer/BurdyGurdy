import { useState, useEffect } from 'react';
import type { QuizConfig, QuestionType, GameMode } from '../../types';
import { RegionSearch } from '../ui/RegionSearch';
import { BIRD_GROUPS } from '../../lib/birdGroups';
import { HelpModal } from '../ui/HelpModal';
import { MapRegionPicker } from '../ui/MapRegionPicker';
import { AccountPill } from '../ui/AccountPill';

interface Props {
  initialConfig: QuizConfig;
  isDesktop: boolean;
  onStart: (config: QuizConfig) => void;
  onProgress: () => void;
  onSettings: () => void;
  userEmail?: string | null;
  onAuthClick: () => void;
  onSignOut: () => void;
  onQuizPrefsChange: (prefs: { questionTypes: QuestionType[]; mode: GameMode; questionsPerRound: number; groupId: string; regionCode: string }) => void;
}

const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
  { value: 'song',   label: 'Song / Call' },
  { value: 'image',  label: 'Photo' },
  { value: 'latin',  label: 'Latin Name' },
  { value: 'family', label: 'Bird Family' },
  { value: 'order',  label: 'Bird Order' },
  { value: 'sono',   label: 'Spectrogram' },
];

export function HomeScreen({ initialConfig, isDesktop, onStart, onProgress, onSettings, userEmail, onAuthClick, onSignOut, onQuizPrefsChange }: Props) {
  const [regionCode, setRegionCode] = useState(initialConfig.regionCode);
  const [selectedTypes, setSelectedTypes] = useState<QuestionType[]>(initialConfig.questionTypes);
  const [mode, setMode] = useState<GameMode>(initialConfig.mode);
  const [questionsPerRound, setQuestionsPerRound] = useState(initialConfig.questionsPerRound);
  const [groupId, setGroupId] = useState(initialConfig.groupId ?? 'all');
  const [regionDisplayName, setRegionDisplayName] = useState<string | undefined>(undefined);
  const [showHelp, setShowHelp] = useState(false);
  const [showMap, setShowMap] = useState(false);

  // Sync local state when config is updated externally (e.g. cloud download on sign-in)
  useEffect(() => {
    setSelectedTypes(initialConfig.questionTypes);
    setMode(initialConfig.mode);
    setQuestionsPerRound(initialConfig.questionsPerRound);
    setGroupId(initialConfig.groupId ?? 'all');
    if (isDesktop) setRegionCode(initialConfig.regionCode);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConfig]);

  const notify = (patch: Partial<{ questionTypes: QuestionType[]; mode: GameMode; questionsPerRound: number; groupId: string; regionCode: string }>) => {
    onQuizPrefsChange({
      questionTypes: selectedTypes, mode, questionsPerRound, groupId, regionCode,
      ...patch,
    });
  };

  const toggleType = (type: QuestionType) => {
    const next = selectedTypes.includes(type)
      ? selectedTypes.length > 1 ? selectedTypes.filter(t => t !== type) : selectedTypes
      : [...selectedTypes, type];
    setSelectedTypes(next);
    notify({ questionTypes: next });
  };

  const handleStart = () => {
    onStart({ regionCode: isDesktop ? regionCode : initialConfig.regionCode, questionTypes: selectedTypes, mode, questionsPerRound, groupId });
  };

  return (
    <div className="h-dvh overflow-y-auto flex flex-col p-3 sm:p-6">
      <div className="w-full max-w-md mx-auto flex flex-col flex-1 min-h-0">

        {/* Header */}
        <div className="text-center relative pb-4 shrink-0">
          <button
            onClick={() => setShowHelp(true)}
            className="absolute right-0 top-0 w-8 h-8 rounded-full border border-slate-300 text-slate-500 hover:bg-slate-100 text-sm font-semibold"
            aria-label="Help"
          >
            ?
          </button>
          <div className="absolute left-0 top-0">
            <AccountPill userEmail={userEmail} onAuthClick={onAuthClick} onSignOut={onSignOut} />
          </div>
          <button
            onClick={onSettings}
            className="absolute right-10 top-0 w-8 h-8 rounded-full border border-slate-300 text-slate-500 hover:bg-slate-100 text-sm"
            aria-label="Settings"
          >
            ⚙
          </button>
          <img src="/BurdyNotebook.png" alt="" className="h-16 w-auto mx-auto" />
          <h1 className="text-4xl font-bold text-forest-800">BurdyGurdy</h1>
          <p className="text-slate-500 mt-2">Learn the birds that make sense</p>
        </div>

        {/* Card — grows to fill remaining height; sections flex apart */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col flex-1 px-6 py-6">

          {/* Region — desktop only; mobile sets region in Settings */}
          {isDesktop && (<>
          <div className="shrink-0">
            <label className="block text-sm font-semibold text-slate-700 mb-1">Region</label>
            <div className="flex gap-2">
              <div className="flex-1">
                <RegionSearch value={regionCode} onChange={c => { setRegionCode(c); setRegionDisplayName(undefined); notify({ regionCode: c }); }} displayName={regionDisplayName} />
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
          <div className="flex-1 min-h-4" />
          </>)}

          {/* Question types */}
          <div className="shrink-0">
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
          <div className="flex-1 min-h-4" />

          {/* Bird group */}
          <div className="shrink-0">
            <label className="block text-sm font-semibold text-slate-700 mb-2">Bird Group</label>
            <div className="grid grid-cols-3 gap-2">
              {BIRD_GROUPS.map(g => (
                <button
                  key={g.id}
                  onClick={() => { setGroupId(g.id); notify({ groupId: g.id }); }}
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
          <div className="flex-1 min-h-4" />

          {/* Mode */}
          <div className="shrink-0">
            <label className="block text-sm font-semibold text-slate-700 mb-2">Learning Mode</label>
            <div className="flex gap-2">
              {(['adaptive', 'random'] as GameMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => { setMode(m); notify({ mode: m }); }}
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
          <div className="flex-1 min-h-4" />

          {/* Questions per round */}
          <div className="shrink-0">
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              Questions per Round: <span className="text-forest-700">{questionsPerRound}</span>
            </label>
            <input
              type="range"
              min={5}
              max={25}
              step={5}
              value={questionsPerRound}
              onChange={e => { const v = Number(e.target.value); setQuestionsPerRound(v); notify({ questionsPerRound: v }); }}
              className="w-full accent-forest-600"
            />
          </div>
          <div className="flex-1 min-h-4" />

          {/* Buttons */}
          <div className="shrink-0 space-y-3">
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

      <p className="text-center text-xs text-slate-400 py-3">
        <a href="/privacy.html" target="_blank" rel="noopener noreferrer" className="hover:text-slate-600 underline">Privacy Policy</a>
      </p>

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {isDesktop && showMap && (
        <MapRegionPicker
          onSelect={(code, name) => { setRegionCode(code); setRegionDisplayName(name); notify({ regionCode: code }); }}
          onClose={() => setShowMap(false)}
        />
      )}
    </div>
  );
}
