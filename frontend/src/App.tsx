import { useState, useEffect } from 'react';
import type { QuizConfig, QuestionType } from './types';
import { HomeScreen } from './components/screens/HomeScreen';
import { QuizScreen } from './components/screens/QuizScreen';
import { ResultScreen } from './components/screens/ResultScreen';
import { ProgressScreen } from './components/screens/ProgressScreen';
import { SettingsScreen } from './components/screens/SettingsScreen';
import { PhotoCurationPanel } from './components/panels/PhotoCurationPanel';
import { BirdInfoPanel } from './components/panels/BirdInfoPanel';
import { useQuiz } from './hooks/useQuiz';
import { loadSettings, saveSettings } from './lib/settings';
import type { AppSettings } from './lib/settings';

const DEFAULT_CONFIG: QuizConfig = {
  regionCode: 'CA-ON-OT',
  questionTypes: ['song', 'image', 'family'],
  mode: 'adaptive',
  questionsPerRound: 10,
  groupId: 'all',
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
  const [config, setConfig] = useState<QuizConfig>(DEFAULT_CONFIG);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  const [screen, setScreen] = useState<'home' | 'quiz' | 'result' | 'progress' | 'settings'>('home');
  const [rightPanel, setRightPanel] = useState<'curation' | 'info'>('info');
  const { state, currentQuestion, isCorrect, currentFavourited, currentExcluded, revealPhotos, questionPhotos, startQuiz, submitAnswer, toggleFavourite, toggleExcluded, nextQuestion, removeOptionalPhoto } = useQuiz(config, settings.randomizeQuestionPhotos);

  const handleStart = async (newConfig: QuizConfig) => {
    setConfig(newConfig);
    setScreen('quiz');
    await startQuiz({
      ...newConfig,
      questionTypes: expandQuestionTypes(newConfig.questionTypes, settings),
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

  // Sync screen with quiz state
  if (screen === 'quiz' && state.status === 'complete') {
    setScreen('result');
  }

  return (
    <div className="font-sans lg:flex lg:h-screen">

      {/* ── Right panel: desktop only ── */}
      <div className="hidden lg:flex lg:order-2 flex-col flex-1 border-l-2 border-slate-200 overflow-hidden">

        {/* Tab toggle — temporary, remove once curation is done */}
        <div className="shrink-0 flex border-b border-slate-200 bg-white">
          <button
            onClick={() => setRightPanel('curation')}
            className={`flex-1 py-2 text-xs font-semibold transition-colors ${
              rightPanel === 'curation'
                ? 'text-amber-700 border-b-2 border-amber-500 bg-amber-50'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Photo Curation
          </button>
          <button
            onClick={() => setRightPanel('info')}
            className={`flex-1 py-2 text-xs font-semibold transition-colors ${
              rightPanel === 'info'
                ? 'text-forest-700 border-b-2 border-forest-600 bg-forest-50'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Bird Info
          </button>
        </div>

        {rightPanel === 'curation' && <PhotoCurationPanel />}
        {rightPanel === 'info' && (
          <BirdInfoPanel
            question={currentQuestion}
            isAnswered={state.status === 'answered' || state.status === 'complete'}
            isCorrect={isCorrect}
            selectedAnswer={state.selectedAnswer}
          />
        )}
      </div>

      {/* ── Left panel: game (full width on mobile, constrained on desktop) ── */}
      <div className="lg:order-1 lg:w-[500px] lg:shrink-0 lg:overflow-y-auto">
      {screen === 'home' && (
        <HomeScreen
          initialConfig={config}
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
        />
      )}

      {screen === 'quiz' && state.status === 'loading' && (
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <div className="text-5xl mb-4 animate-bounce">🐦</div>
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
          questionPhotos={questionPhotos}
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
          onRestart={() => handleStart(config)}
          onHome={() => setScreen('home')}
        />
      )}
      </div>{/* end game column */}
    </div>
  );
}
