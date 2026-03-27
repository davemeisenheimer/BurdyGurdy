import { useState, useEffect } from 'react';
import type { QuizConfig, QuestionType } from './types';
import { HomeScreen } from './components/screens/HomeScreen';
import { QuizScreen } from './components/screens/QuizScreen';
import { ResultScreen } from './components/screens/ResultScreen';
import { ProgressScreen } from './components/screens/ProgressScreen';
import { RecentProgressScreen } from './components/screens/RecentProgressScreen';
import { BirdInfoScreen } from './components/screens/BirdInfoScreen';
import { SettingsScreen } from './components/screens/SettingsScreen';
import { VictoryScreen } from './components/screens/VictoryScreen';
import { CurationPanel } from './components/panels/CurationPanel';
import { BirdInfoPanel } from './components/panels/BirdInfoPanel';
import { AuthPanel } from './components/panels/AuthPanel';
import { useQuiz } from './hooks/useQuiz';
import { loadSettings, saveSettings, loadQuizPrefs, saveQuizPrefs } from './lib/settings';
import type { AppSettings } from './lib/settings';
import { checkVictoryCondition, hasSeenVictory, markVictorySeen, getVictorySeen, mergeVictorySeen } from './lib/victory';
import { locateRegion, fetchBlockedPhotos } from './lib/api';
import type { LocateResult } from './lib/api';
import { db } from './lib/db';
import { supabase } from './lib/supabase';
import type { SupabaseUser } from './lib/supabase';
import { uploadProgress, downloadAndMerge, uploadSettings, downloadSettings, downloadUserBlockedPhotos, deleteAllUserBlockedPhotos, uploadUserBlockedPhoto, submitMediaReport, fetchAdminBlockedMedia, deleteCloudProgressRecords } from './lib/sync';
import { STRUGGLING_THRESHOLD } from './lib/adaptive';
import type { ReportErrorData } from './components/ui/ReportErrorModal';

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
      ...(prefs.groupId       ? { groupId: prefs.groupId }                                           : {}),
    };
  });
  const [geoPrompt, setGeoPrompt] = useState<LocateResult | null>(null);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [focusStruggling, setFocusStruggling] = useState(() => localStorage.getItem('birdygurdy_focus_struggling') === 'true');
  const [strugglingCount, setStrugglingCount] = useState(0);
  const [user, setUser]               = useState<SupabaseUser | null>(null);
  const [showAuth, setShowAuth]       = useState(false);
  const [showUploadPrompt, setShowUploadPrompt] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Recompute struggling count whenever question types or settings change (also runs on mount)
  useEffect(() => {
    const expandedTypes = expandQuestionTypes(config.questionTypes, settings);
    db.progress.toArray().then(records => {
      const struggling = new Set<string>();
      for (const r of records) {
        if (!expandedTypes.includes(r.questionType) || r.excluded) continue;
        const total = r.correct + r.incorrect;
        if (total >= 3 && r.correct / total < STRUGGLING_THRESHOLD) struggling.add(r.speciesCode);
      }
      setStrugglingCount(struggling.size);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.questionTypes, settings]);

  // Auto sign-out after 12 hours of inactivity
  const INACTIVITY_MS = 12 * 60 * 60 * 1000;
  const ACTIVITY_KEY  = 'lastActivity';
  useEffect(() => {
    const touch = () => localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
    const check = () => {
      const last = Number(localStorage.getItem(ACTIVITY_KEY) ?? Date.now());
      if (Date.now() - last > INACTIVITY_MS) supabase.auth.signOut();
    };
    let throttle: ReturnType<typeof setTimeout> | null = null;
    const onActivity = () => { if (!throttle) throttle = setTimeout(() => { touch(); throttle = null; }, 60_000); };
    touch();
    document.addEventListener('click',      onActivity);
    document.addEventListener('keydown',    onActivity);
    document.addEventListener('touchstart', onActivity);
    document.addEventListener('visibilitychange', check);
    return () => {
      document.removeEventListener('click',      onActivity);
      document.removeEventListener('keydown',    onActivity);
      document.removeEventListener('touchstart', onActivity);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  const handleQuizPrefsChange = (prefs: { questionTypes: QuizConfig['questionTypes']; mode: QuizConfig['mode']; questionsPerRound: number; groupId: string; regionCode: string }) => {
    const newPrefs = { questionTypes: prefs.questionTypes, mode: prefs.mode, questionsPerRound: prefs.questionsPerRound, groupId: prefs.groupId, regionCode: prefs.regionCode };
    saveQuizPrefs(newPrefs);
    setConfig(c => ({ ...c, ...newPrefs }));
    if (user) uploadSettings(user.id, settings, newPrefs, getVictorySeen()).catch(() => {});
  };

  const handleRegionChange = (code: string) => {
    setConfig(c => ({ ...c, regionCode: code }));
    const prefs = { ...loadQuizPrefs(), regionCode: code };
    saveQuizPrefs(prefs);
    if (user) uploadSettings(user.id, settings, prefs, getVictorySeen()).catch(() => {});
  };

  // On load, fetch server-side blocked photos and merge into local IndexedDB
  useEffect(() => {
    fetchBlockedPhotos()
      .then(urls => Promise.all(urls.map(url => db.blockedPhotos.put({ url }))))
      .catch(() => { /* non-fatal */ });
  }, []);

  // Auth: restore session on load and listen for changes
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      // When a session appears (OAuth redirect back), merge cloud data
      if (session?.user) {
        const userId = session.user.id;
        // Persist news opt-in set before an OAuth redirect
        const pendingNewsOptIn = localStorage.getItem('burdygurdy_news_opt_in');
        if (pendingNewsOptIn) {
          localStorage.removeItem('burdygurdy_news_opt_in');
          supabase.auth.updateUser({ data: { news_opt_in: true } }).catch(() => {});
        }
        downloadAndMerge(userId).then(async remoteCount => {
          if (remoteCount === 0) {
            const localCount = await db.progress.count();
            if (localCount > 0) setShowUploadPrompt(true);
          }
        }).catch(() => {});
        downloadSettings(userId).then(remote => {
          if (!remote) return;
          const mergedSettings = { ...loadSettings(), ...remote.appSettings };
          setSettings(mergedSettings);
          saveSettings(mergedSettings);
          const mergedPrefs = { ...loadQuizPrefs(), ...remote.quizPrefs };
          saveQuizPrefs(mergedPrefs);
          setConfig(c => ({
            ...c,
            ...(mergedPrefs.questionTypes     ? { questionTypes: mergedPrefs.questionTypes as QuizConfig['questionTypes'] } : {}),
            ...(mergedPrefs.mode              ? { mode: mergedPrefs.mode as QuizConfig['mode'] }                           : {}),
            ...(mergedPrefs.questionsPerRound != null ? { questionsPerRound: mergedPrefs.questionsPerRound }                : {}),
            ...(mergedPrefs.regionCode        ? { regionCode: mergedPrefs.regionCode }                                     : {}),
            ...(mergedPrefs.groupId           ? { groupId: mergedPrefs.groupId }                                           : {}),
          }));
          mergeVictorySeen(remote.victorySeen);
        }).catch(() => {});
        downloadUserBlockedPhotos(userId).catch(() => {});
        fetchAdminBlockedMedia().catch(() => {});
      }
    });
    return () => subscription.unsubscribe();
  }, []);

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

  const [screen, setScreen] = useState<'home' | 'quiz' | 'result' | 'progress' | 'settings' | 'victory' | 'recentprogress' | 'birdinfo'>('home');
  const [prevScreen, setPrevScreen] = useState<'progress' | 'recentprogress'>('progress');
  const [rightPanelTab, setRightPanelTab] = useState<'info' | 'curation'>('info');
  const [progressSelectedSpecies, setProgressSelectedSpecies] = useState<{ speciesCode: string; comName: string } | null>(null);
  const isAdmin = user?.user_metadata?.is_admin === true;
  const { state, currentQuestion, isCorrect, currentFavourited, currentExcluded, revealPhotos, revealRangeMapUrl, revealSightings, questionPhoto, questionPhotoFetching, roundLevelUps, isFirstEncounter, currentMastery, startQuiz, submitAnswer, toggleFavourite, toggleExcluded, nextQuestion, removeOptionalPhoto } = useQuiz(config, settings.randomizeQuestionPhotos, user?.id);

  // After each completed round, upload progress and refresh struggling count
  useEffect(() => {
    if (state.status !== 'complete') return;
    const expandedTypes = expandQuestionTypes(config.questionTypes, settings);
    db.progress.toArray().then(records => {
      const struggling = new Set<string>();
      for (const r of records) {
        if (!expandedTypes.includes(r.questionType) || r.excluded) continue;
        const total = r.correct + r.incorrect;
        if (total >= 3 && r.correct / total < STRUGGLING_THRESHOLD) struggling.add(r.speciesCode);
      }
      setStrugglingCount(struggling.size);
    });
    if (user) uploadProgress(user.id).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  const handleStart = async (newConfig: QuizConfig) => {
    const newPrefs = {
      questionTypes: newConfig.questionTypes,
      mode: newConfig.mode,
      questionsPerRound: newConfig.questionsPerRound,
      regionCode: newConfig.regionCode,
      groupId: newConfig.groupId,
    };
    saveQuizPrefs(newPrefs);
    if (user) uploadSettings(user.id, settings, newPrefs, getVictorySeen()).catch(() => {});
    const recentDays = RECENT_DAYS[settings.recentWindow];
    const fullConfig = { ...newConfig, recentDays };
    setConfig(fullConfig);
    setScreen('quiz');
    await startQuiz({
      ...fullConfig,
      questionTypes: expandQuestionTypes(fullConfig.questionTypes, settings),
      onlyStruggling: focusStruggling,
    });
  };

  const handleNext = () => {
    nextQuestion();
    if (state.status === 'complete') setScreen('result');
  };

  const handleClearBlockedPhotos = async () => {
    await db.blockedPhotos.clear();
    if (user) await deleteAllUserBlockedPhotos(user.id).catch(() => {});
  };

  const handleSaveSettings = (s: AppSettings) => {
    setSettings(s);
    saveSettings(s);
    if (user) uploadSettings(user.id, s, loadQuizPrefs(), getVictorySeen()).catch(() => {});
  };

  function detectService(url: string): string {
    if (url.includes('inaturalist.org'))  return 'iNaturalist';
    if (url.includes('macaulaylibrary.org')) return 'Macaulay Library';
    if (url.includes('xeno-canto.org'))   return 'xeno-canto';
    if (url.includes('wikimedia.org') || url.includes('wikipedia.org')) return 'Wikimedia Commons';
    return 'Unknown';
  }

  const handleReportError = (data: ReportErrorData & { mediaUrl: string; mediaType: 'photo' | 'audio'; speciesCode: string; comName: string }) => {
    if (!user) return;
    submitMediaReport({
      url: data.mediaUrl,
      mediaType: data.mediaType,
      service: detectService(data.mediaUrl),
      speciesCode: data.speciesCode,
      comName: data.comName,
      issueType: data.issueType,
      wrongBird: data.wrongBird || null,
      description: data.description || null,
    }).catch(() => {});
  };

  // When a round completes, check for victory before showing result screen
  useEffect(() => {
    if (state.status !== 'complete' || screen !== 'quiz') return;
    const expandedTypes = expandQuestionTypes(config.questionTypes, settings);
    checkVictoryCondition(config.regionCode, config.recentDays ?? 30, expandedTypes)
      .then(won => {
        if (won && !hasSeenVictory(settings.recentWindow, expandedTypes)) {
          markVictorySeen(settings.recentWindow, expandedTypes);
          if (user) uploadSettings(user.id, settings, loadQuizPrefs(), getVictorySeen()).catch(() => {});
          setScreen('victory');
        } else {
          setScreen('result');
        }
      })
      .catch(() => setScreen('result'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  const showFocusModeToggle = strugglingCount >= Math.round(config.questionsPerRound * 0.5);
  // Persist focus mode to localStorage
  useEffect(() => {
    localStorage.setItem('birdygurdy_focus_struggling', String(focusStruggling));
  }, [focusStruggling]);
  // Auto-disable focus mode when there are no longer enough struggling birds
  useEffect(() => {
    if (focusStruggling && !showFocusModeToggle) setFocusStruggling(false);
  }, [focusStruggling, showFocusModeToggle]);

  return (
    <div className="font-sans lg:flex lg:h-screen">

      {/* ── Right panel: desktop only ── */}
      {isDesktop && <div className="lg:flex lg:order-2 flex-col flex-1 border-l-2 border-slate-200 overflow-hidden">

        {isAdmin && settings.enableAdminFeatures && (
          <div className="shrink-0 flex border-b border-slate-200 bg-white">
            {(['info', 'curation'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setRightPanelTab(tab)}
                className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
                  rightPanelTab === tab
                    ? 'border-forest-600 text-forest-700 bg-forest-50'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                }`}
              >
                {tab === 'info' ? 'Bird Info' : 'Curation'}
              </button>
            ))}
          </div>
        )}

        {(!isAdmin || !settings.enableAdminFeatures || rightPanelTab === 'info') && (
          <BirdInfoPanel
            question={screen === 'quiz' && (state.status === 'active' || state.status === 'answered') ? currentQuestion : null}
            isAnswered={state.status === 'answered'}
            isCorrect={isCorrect}
            selectedAnswer={state.selectedAnswer}
            regionCode={config.regionCode}
            browseSpecies={isDesktop && ['progress', 'recentprogress'].includes(screen) ? progressSelectedSpecies : null}
            maxRecentSightings={settings.maxRecentSightings}
            autoScrollRelatedSpecies={settings.autoScrollRelatedSpecies}
            autoplayRevealAudio={settings.autoplayRevealAudio}
            userEmail={user?.email}
            onAuthClick={() => setShowAuth(true)}
            onSignOut={() => supabase.auth.signOut()}
          />
        )}

        {isAdmin && settings.enableAdminFeatures && rightPanelTab === 'curation' && (
          <div className="flex-1 min-h-0 overflow-hidden">
            <CurationPanel />
          </div>
        )}
      </div>}

      {/* ── Left panel: game (full width on mobile, constrained on desktop) ── */}
      <div className="lg:order-1 lg:w-[500px] lg:shrink-0 lg:overflow-y-auto">
      {screen === 'home' && (
        <HomeScreen
          initialConfig={config}
          isDesktop={isDesktop}
          onStart={handleStart}
          onProgress={() => setScreen('progress')}
          onSettings={() => setScreen('settings')}
          userEmail={user?.email}
          onAuthClick={() => setShowAuth(true)}
          onSignOut={() => supabase.auth.signOut()}
          onQuizPrefsChange={handleQuizPrefsChange}
        />
      )}

      {screen === 'progress' && (
        <ProgressScreen
          onBack={() => setScreen('home')}
          userId={user?.id}
          questionTypes={expandQuestionTypes(config.questionTypes, settings)}
          focusStruggling={focusStruggling}
          showFocusModeToggle={showFocusModeToggle}
          onToggleFocusStruggling={() => setFocusStruggling(f => !f)}
          onSelectBird={isDesktop
            ? setProgressSelectedSpecies
            : s => { setProgressSelectedSpecies(s); setPrevScreen('progress'); setScreen('birdinfo'); }}
        />
      )}

      {screen === 'settings' && (
        <SettingsScreen
          initialSettings={settings}
          onSave={handleSaveSettings}
          onBack={() => setScreen('home')}
          isDesktop={isDesktop}
          regionCode={config.regionCode}
          onRegionChange={handleRegionChange}
          onClearBlockedPhotos={handleClearBlockedPhotos}
          isAdmin={isAdmin}
          recentDays={RECENT_DAYS[settings.recentWindow ?? 'month']}
          questionTypes={expandQuestionTypes(config.questionTypes, settings)}
          focusStruggling={focusStruggling}
          showFocusModeToggle={showFocusModeToggle}
          strugglingCount={strugglingCount}
          onToggleFocusStruggling={() => setFocusStruggling(f => !f)}
          onProgressTrimmed={(deleted) => {
            if (user) {
              deleteCloudProgressRecords(user.id, deleted).catch(() => {});
              uploadProgress(user.id).catch(() => {});
            }
          }}
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
          questionPhotoFetching={questionPhotoFetching}
          isFirstEncounter={isFirstEncounter}
          currentMastery={currentMastery}
          showMediaInCarousel={!isDesktop}
          autoplayRevealAudio={settings.autoplayRevealAudio}
          onRemoveOptionalPhoto={removeOptionalPhoto}
          onAnswer={submitAnswer}
          onToggleFavourite={toggleFavourite}
          onToggleExcluded={toggleExcluded}
          onNext={handleNext}
          onReportError={user ? (data) => handleReportError({ ...data, speciesCode: currentQuestion.speciesCode, comName: currentQuestion.comName }) : undefined}
        />
      )}

      {screen === 'result' && (
        <ResultScreen
          score={state.score}
          config={config}
          questionTypes={expandQuestionTypes(config.questionTypes, settings)}
          levelUps={roundLevelUps}
          focusStruggling={focusStruggling}
          showFocusModeToggle={showFocusModeToggle}
          strugglingCount={strugglingCount}
          onToggleFocusStruggling={() => setFocusStruggling(f => !f)}
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
          onSelectBird={isDesktop
            ? setProgressSelectedSpecies
            : s => { setProgressSelectedSpecies(s); setPrevScreen('recentprogress'); setScreen('birdinfo'); }}
        />
      )}

      {screen === 'birdinfo' && progressSelectedSpecies && (
        <BirdInfoScreen
          speciesCode={progressSelectedSpecies.speciesCode}
          comName={progressSelectedSpecies.comName}
          regionCode={config.regionCode}
          maxRecentSightings={settings.maxRecentSightings}
          autoScrollRelatedSpecies={settings.autoScrollRelatedSpecies}
          onBack={() => setScreen(prevScreen)}
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

      {/* Auth panel */}
      {showAuth && (
        <AuthPanel
          onClose={() => setShowAuth(false)}
          onSignIn={() => {
            supabase.auth.getUser().then(({ data }) => {
              if (data.user) downloadAndMerge(data.user.id).catch(() => {});
            });
          }}
          onSignUp={() => {}}
        />
      )}

      {/* Upload local progress prompt — shown after a new registration */}
      {showUploadPrompt && user && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
            <p className="text-lg font-bold text-slate-800 mb-2">Upload your progress?</p>
            <p className="text-sm text-slate-500 mb-5">
              You have local progress saved on this device. Would you like to upload it to your new account so it's backed up and available on all your devices?
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={async () => {
                  await uploadProgress(user.id);
                  await uploadSettings(user.id, settings, loadQuizPrefs(), getVictorySeen());
                  const blocked = await db.blockedPhotos.toArray();
                  await Promise.all(blocked.map(p => uploadUserBlockedPhoto(user.id, p.url)));
                  setShowUploadPrompt(false);
                  setShowAuth(false);
                }}
                className="px-5 py-2 bg-forest-600 hover:bg-forest-700 text-white rounded-xl text-sm font-semibold"
              >
                Yes, upload
              </button>
              <button
                onClick={() => { setShowUploadPrompt(false); setShowAuth(false); }}
                className="px-5 py-2 border border-slate-300 text-slate-600 rounded-xl text-sm hover:bg-slate-50"
              >
                Start fresh
              </button>
            </div>
          </div>
        </div>
      )}

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
