import { useState } from 'react';
import type { AppSettings, BirderLevel } from '../../lib/settings';
import type { QuestionType } from '../../types';
import type { SupabaseUser } from '../../lib/supabase';
import { RegionSearch } from '../ui/RegionSearch';
import { MapRegionPicker } from '../ui/MapRegionPicker';
import { TrimProgressDialog } from '../ui/TrimProgressDialog';
import { FocusModeToggle } from '../ui/FocusModeToggle';
import { HelpInfo } from '../ui/HelpInfo';

const isIOS        = /iPad|iPhone|iPod/.test(navigator.userAgent);
const isAndroid    = /Android/.test(navigator.userAgent);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches;

interface Props {
  initialSettings: AppSettings;
  onSave: (s: AppSettings) => void;
  onBack: () => void;
  isDesktop: boolean;
  regionCode?: string;
  onRegionChange?: (code: string) => void;
  onClearBlockedPhotos?: () => void;
  isAdmin?: boolean;
  recentDays?: number;
  questionTypes?: QuestionType[];
  onProgressTrimmed?: (deleted: Array<{ speciesCode: string; questionType: string }>) => void;
  focusStruggling?: boolean;
  showFocusModeToggle?: boolean;
  strugglingCount?: number;
  onToggleFocusStruggling?: () => void;
  user?: SupabaseUser | null;
  onInstallApp?: (() => Promise<void>) | null;
}

interface ToggleRowProps {
  label: string;
  infoId: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

function ToggleRow({ label, infoId, checked, onChange }: ToggleRowProps) {
  return (
    <label className="flex items-center justify-between gap-4 px-5 py-4 cursor-pointer">
      <div className="flex items-center gap-2 min-w-0">
        <HelpInfo id={infoId} />
        <p className="font-medium text-slate-800 text-sm">{label}</p>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="w-5 h-5 accent-forest-600 cursor-pointer shrink-0"
      />
    </label>
  );
}

const BIRDER_LEVELS: { level: BirderLevel; label: string; desc: string }[] = [
  { level: 'novice',       label: 'Novice',       desc: 'Progresses through easy, medium, then difficult questions.' },
  { level: 'intermediate', label: 'Intermediate', desc: 'Skips the easy questions.' },
  { level: 'advanced',     label: 'Advanced',     desc: 'Skips easy and medium difficulty questions.' },
];

export function SettingsScreen({ initialSettings, onSave, onBack, isDesktop, regionCode, onRegionChange, onClearBlockedPhotos, isAdmin, recentDays, questionTypes, onProgressTrimmed, focusStruggling, showFocusModeToggle, strugglingCount, onToggleFocusStruggling, user, onInstallApp }: Props) {
  const [settings, setSettings] = useState(initialSettings);
  const [regionDisplayName, setRegionDisplayName] = useState<string | undefined>(undefined);
  const [showMap, setShowMap] = useState(false);
  const [showTrimDialog, setShowTrimDialog] = useState(false);
  const [pendingLevel, setPendingLevel] = useState<BirderLevel | null>(null);

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    onSave(next);
  };

  return (
    <div className="min-h-dvh flex flex-col">
      <div className="sticky top-0 z-10 bg-slate-50 px-3 sm:px-6 pt-3 sm:pt-6 pb-4 border-b border-slate-200">
        <div className="w-full max-w-md mx-auto flex items-center gap-4">
          <button onClick={onBack} className="text-slate-500 hover:text-slate-700 text-5xl leading-none">←</button>
          <h1 className="text-2xl font-bold text-slate-800">Settings</h1>
        </div>
      </div>
      <div className="px-3 sm:px-6 pt-5 pb-6">
      <div className="w-full max-w-md mx-auto">

        {showFocusModeToggle && onToggleFocusStruggling && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 mt-4">
            <FocusModeToggle enabled={focusStruggling ?? false} onToggle={onToggleFocusStruggling} strugglingCount={strugglingCount ?? 0} />
          </div>
        )}

        {/* Region - mobile only; desktop sets region on the home screen */}
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
            <div className="flex items-center gap-2 mb-1">
              <HelpInfo id="recentWindow" />
              <p className="font-medium text-slate-800 text-sm">Recent sightings window</p>
            </div>
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
            infoId="autoplayRevealAudio"
            checked={settings.autoplayRevealAudio}
            onChange={v => update('autoplayRevealAudio', v)}
          />
          <ToggleRow
            label="Latin-answer questions"
            infoId="latinAnswerQuestions"
            checked={settings.includeLatinAnswerVariants}
            onChange={v => update('includeLatinAnswerVariants', v)}
          />
          <ToggleRow
            label="Song-answer questions"
            infoId="songAnswerQuestions"
            checked={settings.includeSongAnswerVariants}
            onChange={v => update('includeSongAnswerVariants', v)}
          />
          <ToggleRow
            label="Randomize question photos"
            infoId="randomizeQuestionPhotos"
            checked={settings.randomizeQuestionPhotos}
            onChange={v => update('randomizeQuestionPhotos', v)}
          />
          <ToggleRow
            label="Expire mastered birds after 90 days"
            infoId="expireMasteredBirds"
            checked={settings.expireMasteredBirds ?? false}
            onChange={v => update('expireMasteredBirds', v)}
          />
          {isDesktop && (
            <ToggleRow
              label="Auto-scroll related species"
              infoId="autoScrollRelatedSpecies"
              checked={settings.autoScrollRelatedSpecies ?? true}
              onChange={v => update('autoScrollRelatedSpecies', v)}
            />
          )}
          {isDesktop && (
            <label className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="flex items-center gap-2">
                <HelpInfo id="maxRecentSightings" />
                <p className="font-medium text-slate-800 text-sm">Max recent sightings</p>
              </div>
              <input
                type="number"
                min={0}
                max={10}
                value={settings.maxRecentSightings ?? 4}
                onChange={e => update('maxRecentSightings', Math.min(10, Math.max(0, parseInt(e.target.value) || 0)))}
                className="w-14 text-center border border-slate-300 rounded-lg px-2 py-1 text-sm text-slate-800 shrink-0"
              />
            </label>
          )}
        </div>

        {/* Birder level - signed-in users only */}
        {user && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 mt-4">
            <div className="flex items-center gap-2 mb-3">
              <HelpInfo id="birderLevel" />
              <p className="font-medium text-slate-800 text-sm">Birder experience level</p>
            </div>
            <div className="space-y-2">
              {BIRDER_LEVELS.map(({ level, label, desc }) => (
                <button
                  key={level}
                  onClick={() => {
                    if ((settings.birderLevel ?? 'novice') !== level) setPendingLevel(level);
                  }}
                  className={`w-full text-left px-3 py-2.5 rounded-xl border-2 transition-colors ${
                    (settings.birderLevel ?? 'novice') === level
                      ? 'border-forest-600 bg-forest-50'
                      : 'border-slate-200 hover:border-forest-300 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-sm text-slate-800">{label}</p>
                    {(settings.birderLevel ?? 'novice') === level && <span className="text-forest-600 text-sm font-bold">✓</span>}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Birder level change confirmation dialog */}
        {pendingLevel && (() => {
          const newLevelInfo = BIRDER_LEVELS.find(l => l.level === pendingLevel)!;
          const newBirdMsg =
            pendingLevel === 'intermediate' ? 'New birds added to your quiz will skip easy questions and start at medium difficulty.' :
            pendingLevel === 'advanced'     ? 'New birds added to your quiz will skip easy and medium questions and start at difficult questions.' :
                                             'New birds added to your quiz will start from the beginning with easy questions.';
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
              <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-sm p-6">
                <p className="font-semibold text-slate-800 text-base mb-3">Change to {newLevelInfo.label}?</p>
                <p className="text-sm text-slate-600 mb-2">Your birds already in progress will not be affected - they'll continue from their current difficulty level.</p>
                <p className="text-sm text-slate-600 mb-6">{newBirdMsg}</p>
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => setPendingLevel(null)}
                    className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => { update('birderLevel', pendingLevel); setPendingLevel(null); }}
                    className="px-4 py-2 text-sm font-medium text-white bg-forest-600 rounded-xl hover:bg-forest-700 transition-colors"
                  >
                    Confirm
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
        
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 mt-4">
          <div className="flex items-center gap-2 mb-3">
            <HelpInfo id="blockedPhotos" />
            <p className="font-medium text-slate-800 text-sm">Blocked photos</p>
          </div>
          <button
            onClick={onClearBlockedPhotos}
            className="text-xs px-3 py-1.5 border border-red-300 text-red-500 rounded-lg hover:bg-red-50 transition-colors"
          >
            Clear my blocked photos
          </button>
        </div>

        {regionCode && recentDays != null && questionTypes && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 mt-4">
            <div className="flex items-center gap-2 mb-3">
              <HelpInfo id="outdatedProgress" />
              <p className="font-medium text-slate-800 text-sm">Outdated progress</p>
            </div>
            <button
              onClick={() => setShowTrimDialog(true)}
              className="text-xs px-3 py-1.5 border border-red-300 text-red-500 rounded-lg hover:bg-red-50 transition-colors"
            >
              Trim outdated progress…
            </button>
          </div>
        )}

        {/* Home screen install - mobile only, not already standalone */}
        {(isIOS || isAndroid) && !isStandalone && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 mt-4">
            <p className="font-medium text-slate-800 text-sm mb-1">Add to home screen</p>
            <p className="text-xs text-slate-500 mb-3">
              Launching from your home screen gives a full-screen experience without the browser address bar.
            </p>
            {isAndroid && onInstallApp ? (
              <button
                onClick={onInstallApp}
                className="text-xs px-3 py-1.5 border border-forest-300 text-forest-700 rounded-lg hover:bg-forest-50 transition-colors"
              >
                Add to Home Screen
              </button>
            ) : isIOS ? (
              <div className="space-y-2">
                {[
                  'Tap the Share button ⬆️ at the bottom of Safari',
                  'Tap "Add to Home Screen"',
                  'Tap "Add" to confirm',
                ].map((step, i) => (
                  <p key={i} className="text-xs text-slate-600 flex gap-2">
                    <span className="text-slate-400 shrink-0">{i + 1}.</span>{step}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">Tap the browser menu ⋮ and select "Add to Home screen".</p>
            )}
          </div>
        )}

        {isAdmin && (
          <div className="bg-amber-50 rounded-2xl shadow-sm border border-amber-200 divide-y divide-amber-100 mt-4">
            <div className="px-5 py-3">
              <p className="text-xs font-bold uppercase tracking-wider text-amber-700 mb-0.5">Admin</p>
              <p className="text-xs text-amber-600">Only visible to you.</p>
            </div>
            <ToggleRow
              label="Enable admin features"
              infoId="enableAdminFeatures"
              checked={settings.enableAdminFeatures ?? false}
              onChange={v => update('enableAdminFeatures', v)}
            />
          </div>
        )}
      </div>
      <p className="text-center text-xs text-slate-400 pt-2 pb-4">v{__APP_VERSION__}</p>
      </div>
      {showMap && onRegionChange && (
        <MapRegionPicker
          onSelect={(code, name) => { onRegionChange(code); setRegionDisplayName(name); setShowMap(false); }}
          onClose={() => setShowMap(false)}
        />
      )}
      {showTrimDialog && regionCode && recentDays != null && questionTypes && (
        <TrimProgressDialog
          regionCode={regionCode}
          recentDays={recentDays}
          questionTypes={questionTypes}
          onClose={() => setShowTrimDialog(false)}
          onTrimmed={(deleted) => { onProgressTrimmed?.(deleted); }}
        />
      )}
    </div>
  );
}
