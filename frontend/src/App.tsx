import { useState, useEffect } from 'react';
import type { QuizConfig, QuestionType } from './types';
import { HomeScreen } from './components/screens/HomeScreen';
import { QuizScreen } from './components/screens/QuizScreen';
import { ResultScreen } from './components/screens/ResultScreen';
import { ProgressScreen } from './components/screens/ProgressScreen';
import { RecentProgressScreen } from './components/screens/RecentProgressScreen';
import { SettingsScreen } from './components/screens/SettingsScreen';
import { VictoryScreen } from './components/screens/VictoryScreen';
// import { PhotoCurationPanel } from './components/panels/PhotoCurationPanel';
import { BirdInfoPanel } from './components/panels/BirdInfoPanel';
import { useQuiz } from './hooks/useQuiz';
import { loadSettings, saveSettings, loadQuizPrefs, saveQuizPrefs } from './lib/settings';
import type { AppSettings } from './lib/settings';
import { checkVictoryCondition, hasSeenVictory, markVictorySeen } from './lib/victory';
import { locateRegion } from './lib/api';
import type { LocateResult } from './lib/api';

const RECENT_DAYS: Record<'day' | 'week' | 'month', number> = { day: 1, week: 7, month: 30 };

const DEFAULT_CONFIG: QuizConfig = {
  regionCode: 'CA-ON-OT',
  questionTypes: ['song', 'image', 'family'],
  mode: 'adaptive',
  questionsPerRound: 10,
  groupId: 'all',
  recentDays: 30,
};

function expandQuestionTypes(types: QuestionType[], s: AppSettings): QuestionType[] {
  const result = [...types];
  if (s.includeLatinAnswerVariants) {
    if (types.includes('image'))  result.push('image-latin');
    if (types.includes('song'))   result.push('song-latin');
    if (types.includes('family')) result.push('family-latin');
  }
  if (s.includeSongAnswerVariants) {
    if (types.includes('image')) result.push('image-song');
    if (types.includes('sono'))  result.push('sono-song');
    if (types.includes('latin')) result.push('latin-song');
  }
  return result;
}

export default function App() {
  const [config, setConfig] = useState<QuizConfig>(() => {
    const prefs = loadQuizPrefs();
    return {
      ...DEFAULT_CONFIG,
      ...(prefs.questionTypes ? { questionTypes: prefs.questionTypes as QuizConfig['questionTypes'] } : {}),
      ...(prefs.mode          ? { mode: prefs.mode as QuizConfig['mode'] }                          : {}),
      ...(prefs.questionsPerRound != null ? { questionsPerRound: prefs.questionsPerRound }           : {}),
      ...(prefs.regionCode    ? { regionCode: prefs.regionCode }                                     : {}),
    };
  });
  const [geoPrompt, setGeoPrompt] = useState<LocateResult | null>(null);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  const handleRegionChange = (code: string) => {
    setConfig(c => ({ ...c, regionCode: code }));
    const prefs = loadQuizPrefs();
    saveQuizPrefs({ ...prefs, regionCode: code });
  };

  // On load, try to detect location and offer a region update if it differs from saved
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const result = await locateRegion(pos.coords.latitude, pos.coords.longitude, 10);
          setConfig(c => {
            if (result.regionCode !== c.regionCode) setGeoPrompt(result);
            return c;
          });
        } catch { /* non-fatal */ }
      },
      () => { /* user denied or unavailable — non-fatal */ },
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [screen, setScreen] = useState<'home' | 'quiz' | 'result' | 'progress' | 'settings' | 'victory' | 'recentprogress'>('home');
  // const [rightPanel, setRightPanel] = useState<'curation' | 'info'>('info');
  const { state, currentQuestion, isCorrect, currentFavourited, currentExcluded, revealPhotos, revealRangeMapUrl, revealSightings, questionPhoto, roundLevelUps, isFirstEncounter, currentMastery, startQuiz, submitAnswer, toggleFavourite, toggleExcluded, nextQuestion, removeOptionalPhoto } = useQuiz(config, settings.randomizeQuestionPhotos);

  const handleStart = async (newConfig: QuizConfig) => {
    saveQuizPrefs({
      questionTypes: newConfig.questionTypes,
      mode: newConfig.mode,
      questionsPerRound: newConfig.questionsPerRound,
      regionCode: newConfig.regionCode,
    });
    const recentDays = RECENT_DAYS[settings.recentWindow];
    const fullConfig = { ...newConfig, recentDays };
    setConfig(fullConfig);
    setScreen('quiz');
    await startQuiz({
      ...fullConfig,
      questionTypes: expandQuestionTypes(fullConfig.questionTypes, settings),
    });
  };

  const handleNext = () => {
    nextQuestion();
    if (state.status === 'complete') setScreen('result');
  };

  const handleSaveSettings = (s: AppSettings) => {
    setSettings(s);
    saveSettings(s);
  };

  // When a round completes, check for victory before showing result screen
  useEffect(() => {
    if (state.status !== 'complete' || screen !== 'quiz') return;
    const expandedTypes = expandQuestionTypes(config.questionTypes, settings);
    checkVictoryCondition(config.regionCode, config.recentDays ?? 30, expandedTypes)
      .then(won => {
        if (won && !hasSeenVictory(settings.recentWindow, expandedTypes)) {
          markVictorySeen(settings.recentWindow, expandedTypes);
          setScreen('victory');
        } else {
          setScreen('result');
        }
      })
      .catch(() => setScreen('result'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  return (
    <div className="font-sans lg:flex lg:h-screen">

      {/* ── Right panel: desktop only ── */}
      <div className="hidden lg:flex lg:order-2 flex-col flex-1 border-l-2 border-slate-200 overflow-hidden">

        {/* Photo Curation tab disabled — uncomment to re-enable */}
        {/* <div className="shrink-0 flex border-b border-slate-200 bg-white">
          <button onClick={() => setRightPanel('curation')} ...>Photo Curation</button>
          <button onClick={() => setRightPanel('info')} ...>Bird Info</button>
        </div>
        {rightPanel === 'curation' && <PhotoCurationPanel />} */}
        {(
          <BirdInfoPanel
            question={screen === 'quiz' && (state.status === 'active' || state.status === 'answered') ? currentQuestion : null}
            isAnswered={state.status === 'answered'}
            isCorrect={isCorrect}
            selectedAnswer={state.selectedAnswer}
            regionCode={config.regionCode}
            maxRecentSightings={settings.maxRecentSightings}
            autoScrollRelatedSpecies={settings.autoScrollRelatedSpecies}
            autoplayRevealAudio={settings.autoplayRevealAudio}
          />
        )}
      </div>

      {/* ── Left panel: game (full width on mobile, constrained on desktop) ── */}
      <div className="lg:order-1 lg:w-[500px] lg:shrink-0 lg:overflow-y-auto">
      {screen === 'home' && (
        <HomeScreen
          initialConfig={config}
          isDesktop={isDesktop}
          onStart={handleStart}
          onProgress={() => setScreen('progress')}
          onSettings={() => setScreen('settings')}
        />
      )}

      {screen === 'progress' && (
        <ProgressScreen onBack={() => setScreen('home')} />
      )}

      {screen === 'settings' && (
        <SettingsScreen
          initialSettings={settings}
          onSave={handleSaveSettings}
          onBack={() => setScreen('home')}
          isDesktop={isDesktop}
          regionCode={config.regionCode}
          onRegionChange={handleRegionChange}
        />
      )}

      {screen === 'quiz' && state.status === 'loading' && (
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <img src="/BurdyGurdyProgress.gif" alt="" className="h-16 w-auto mb-4 mx-auto" />
            <p className="text-slate-500">Loading birds...</p>
          </div>
        </div>
      )}

      {screen === 'quiz' && state.status === 'error' && (
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="text-center">
            <p className="text-red-600 font-medium mb-4">{state.error}</p>
            <button
              onClick={() => setScreen('home')}
              className="px-6 py-2 bg-forest-600 text-white rounded-lg"
            >
              Back to Home
            </button>
          </div>
        </div>
      )}

      {screen === 'quiz' && (state.status === 'active' || state.status === 'answered') && currentQuestion && (
        <QuizScreen
          question={currentQuestion}
          selectedAnswer={state.selectedAnswer}
          isCorrect={isCorrect}
          currentIndex={state.currentIndex}
          totalQuestions={state.questions.length}
          score={state.score}
          isAdaptive={config.mode === 'adaptive'}
          isFavourited={currentFavourited}
          isExcluded={currentExcluded}
          revealPhotos={revealPhotos}
          revealRangeMapUrl={revealRangeMapUrl}
          revealSightings={revealSightings}
          questionPhoto={questionPhoto}
          isFirstEncounter={isFirstEncounter}
          currentMastery={currentMastery}
          showMediaInCarousel={!isDesktop}
          autoplayRevealAudio={settings.autoplayRevealAudio}
          onRemoveOptionalPhoto={removeOptionalPhoto}
          onAnswer={submitAnswer}
          onToggleFavourite={toggleFavourite}
          onToggleExcluded={toggleExcluded}
          onNext={handleNext}
        />
      )}

      {screen === 'result' && (
        <ResultScreen
          score={state.score}
          config={config}
          questionTypes={expandQuestionTypes(config.questionTypes, settings)}
          levelUps={roundLevelUps}
          onRestart={() => handleStart(config)}
          onHome={() => setScreen('home')}
          onRecentProgress={() => setScreen('recentprogress')}
        />
      )}

      {screen === 'recentprogress' && (
        <RecentProgressScreen
          regionCode={config.regionCode}
          recentDays={config.recentDays ?? 30}
          questionTypes={expandQuestionTypes(config.questionTypes, settings)}
          onBack={() => setScreen('result')}
        />
      )}

      {screen === 'victory' && (
        <VictoryScreen
          recentWindow={settings.recentWindow}
          questionTypes={expandQuestionTypes(config.questionTypes, settings)}
          onKeepPlaying={() => handleStart(config)}
          onHome={() => setScreen('home')}
        />
      )}
      </div>{/* end game column */}

      {/* Geolocation prompt */}
      {geoPrompt && (
        <div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-white border-t border-slate-200 shadow-xl lg:left-auto lg:right-4 lg:bottom-4 lg:w-88 lg:rounded-xl lg:border lg:shadow-lg">
          <p className="text-sm font-semibold text-slate-800 mb-0.5">We detected your location</p>
          <p className="text-xs text-slate-500 mb-3">{geoPrompt.regionName}</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => { handleRegionChange(geoPrompt.regionCode); setGeoPrompt(null); }}
              className="px-3 py-1.5 bg-forest-600 text-white text-xs rounded-lg font-medium hover:bg-forest-700"
            >
              Use {geoPrompt.regionName}
            </button>
            {geoPrompt.broader && (
              <button
                onClick={() => { handleRegionChange(geoPrompt.broader!.code); setGeoPrompt(null); }}
                className="px-3 py-1.5 border border-slate-300 text-slate-700 text-xs rounded-lg hover:bg-slate-50"
              >
                Use {geoPrompt.broader.name}
              </button>
            )}
            <button
              onClick={() => setGeoPrompt(null)}
              className="px-3 py-1.5 text-slate-400 text-xs hover:text-slate-600"
            >
              Keep current
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
