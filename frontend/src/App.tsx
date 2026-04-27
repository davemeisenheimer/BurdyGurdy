import { useState, useEffect, useRef, useCallback } from 'react';
import type { QuizConfig } from './types';
import type { BirdProgress } from './types';
import { HomeScreen } from './components/screens/HomeScreen';
import { QuizScreen } from './components/screens/QuizScreen';
import { ResultScreen } from './components/screens/ResultScreen';
import { ProgressScreenLife } from './components/screens/ProgressScreenLife';
import { ProgressScreenRecent } from './components/screens/ProgressScreenRecent';
import { BirdInfoScreen } from './components/screens/BirdInfoScreen';
import { OnboardingWizard } from './components/screens/OnboardingWizard';
import { SettingsScreen } from './components/screens/SettingsScreen';
import { VictoryScreen } from './components/screens/VictoryScreen';
import { FriendsScreen } from './components/screens/FriendsScreen';
import { NotificationsScreen } from './components/screens/NotificationsScreen';
import { CurationPanel } from './components/panels/CurationPanel';
import { FactsCurationPanel } from './components/panels/FactsCurationPanel';
import { DatabasePanel } from './components/panels/DatabasePanel';
import { BirdInfoPanel } from './components/panels/BirdInfoPanel';
import { SightingsMapPanel } from './components/panels/SightingsMapPanel';
import { SightingsScreen } from './components/screens/SightingsScreen';
import { AuthPanel } from './components/panels/AuthPanel';
import { Toast } from './components/ui/Toast';
import { DialogGeneric } from './components/ui/DialogGeneric';
import { useQuiz } from './hooks/useQuiz';
import { useNotifications } from './hooks/useNotifications';
import { loadSettings, saveSettings, loadQuizPrefs, saveQuizPrefs, resetUserSettings, loadFocusStruggling, saveFocusStruggling, DEFAULTS as SETTINGS_DEFAULTS } from './lib/settings';
import type { AppSettings, QuizConfigPrefs } from './lib/settings';
import { checkVictoryCondition, hasSeenVictory, markVictorySeen, getVictorySeen, mergeVictorySeen, describeMastery, describeWindow } from './lib/victory';
import { locateRegion } from './services/remote/api';
import type { LocateResult, RegionalSighting, RecentSighting } from './services/remote/api';
import { db, switchToUserDb } from './lib/db';
import { supabase } from './lib/supabase';
import type { SupabaseUser } from './lib/supabase';
import { uploadProgress, downloadAndReplace, uploadSettings, downloadSettings, downloadUserBlockedPhotos, deleteAllUserBlockedPhotos, uploadUserBlockedPhoto, submitMediaReport, fetchAdminBlockedMedia, deleteCloudProgressRecords, uploadRegionSnapshot, downloadRegionSnapshot, getCloudUploadTime, getLocalSyncedAt, getNeedsUpload } from './services/remote/sync';
import { checkBirdsToExpire, expireOldMasteredBirds, backfillProgressTaxonomy } from './services/local/progress';
import { getRegionSpecies } from './services/local/region';
import { loadSnapshot, saveSnapshot, buildSnapshot, computeRegionUpdate } from './services/local/regionSnapshot';
import type { RegionUpdateInfo } from './services/local/regionSnapshot';
import { RegionUpdateDialog } from './components/ui/RegionUpdateDialog';
import { computeStrugglingCount } from './lib/struggling';
import { expandQuestionTypes } from './lib/questionTypes';
import type { ReportErrorData } from './components/ui/ReportErrorModal';
import { MasteryFactDialog } from './components/ui/MasteryFactDialog';
import { FastTrackDialog } from './components/ui/FastTrackDialog';
import { PasswordResetDialog } from './components/ui/PasswordResetDialog';
import { CloudSyncOverlay } from './components/ui/CloudSyncOverlay';
import type { LevelUpEvent } from './types';
import { markNotificationsRead } from './lib/notifications';
import { fetchFriendProgress, getReceivedPendingInvites, sendBeaconNotification } from './lib/friends';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const RECENT_DAYS: Record<'day' | 'week' | 'month', number> = { day: 1, week: 7, month: 30 };
const activityKey = (userId: string) => `lastActivity_${userId}`;

const DEFAULT_CONFIG: QuizConfig = {
  regionCode: 'CA-ON-OT',
  questionTypes: ['image'],
  mode: 'adaptive',
  questionsPerRound: 5,
  groupId: 'all',
  recentDays: 1,
};

// Capture the invite token from the URL into sessionStorage so it survives
// both React StrictMode remounts and Vite HMR module re-execution.
(() => {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('invite');
  if (token) {
    sessionStorage.setItem('pendingInvite', token);
    window.history.replaceState({}, '', window.location.pathname);
  }
})();

export default function App() {
  const [config, setConfig] = useState<QuizConfig>(DEFAULT_CONFIG);
  const [geoPrompt, setGeoPrompt] = useState<LocateResult | null>(null);
  const [settings, setSettings] = useState<AppSettings>({ ...SETTINGS_DEFAULTS });
  const [focusStruggling, setFocusStruggling] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [strugglingCount, setStrugglingCount] = useState(0);
  const [user, setUser]               = useState<SupabaseUser | null>(null);
  const [showAuth, setShowAuth]           = useState(false);
  const [wasAutoSignedOut, setWasAutoSignedOut] = useState(false);
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const userRef = useRef<SupabaseUser | null>(null);
  const [showUploadPrompt, setShowUploadPrompt] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  const [expiryDialog, setExpiryDialog] = useState<Array<{ speciesCode: string; comName: string }> | null>(null);
  const [pendingRegionUpdate, setPendingRegionUpdate] = useState<{
    info: RegionUpdateInfo;
    records: BirdProgress[];
    pendingConfig: QuizConfig;
  } | null>(null);
  const pendingStartConfigRef = useRef<QuizConfig | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem('burdygurdy_onboarding_complete'));
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);

  const [screen, setScreen] = useState<'home' | 'quiz' | 'result' | 'progress' | 'settings' | 'victory' | 'recentprogress' | 'birdinfo' | 'friends' | 'notifications' | 'friendprogress' | 'friendrecentprogress' | 'sightings'>(
    () => sessionStorage.getItem('pendingInvite') ? 'friends' : 'home',
  );
  const [selectedSighting, setSelectedSighting] = useState<RegionalSighting | null>(null);
  // All sightings loaded by SightingsScreen — lifted here so the map panel can access them.
  const [allSightings, setAllSightings] = useState<RegionalSighting[]>([]);
  const [prevScreen, setPrevScreen] = useState<'progress' | 'recentprogress' | 'friendprogress' | 'friendrecentprogress'>('progress');
  const [recentProgressBack, setRecentProgressBack] = useState<'result' | 'progress'>('result');
  const [lifeListBack, setLifeListBack] = useState<'home' | 'result'>('home');
  const [sightingsBack, setSightingsBack] = useState<typeof screen>('home');
  const [rightPanelTab, setRightPanelTab] = useState<'info' | 'curation' | 'facts' | 'database'>('info');
  const [progressSelectedSpecies, setProgressSelectedSpecies] = useState<{ speciesCode: string; comName: string } | null>(null);
  const [friendProgressRecords, setFriendProgressRecords] = useState<BirdProgress[]>([]);
  const [friendProgressName, setFriendProgressName]       = useState('');
  const [hasPendingInvites, setHasPendingInvites]         = useState(false);
  const [selectionPrefs, setSelectionPrefs] = useState<Pick<QuizConfigPrefs, 'selectionMode' | 'selectedSpeciesCodes' | 'selectedFamilies' | 'selectedOrders'>>({ selectionMode: 'all', selectedSpeciesCodes: [], selectedFamilies: [], selectedOrders: [] });
  const [syncVersion, setSyncVersion]           = useState(0);
  const [cloudSyncing, setCloudSyncing]         = useState(false);
  const cloudSyncingRef  = useRef(false);
  const quizActiveRef    = useRef(false);
  const accessTokenRef   = useRef<string | null>(null);
  const [masteryFactEvent, setMasteryFactEvent] = useState<LevelUpEvent | null>(null);
  const hasShownFactThisRoundRef = useRef(false);
  const prevGraduatedCountRef    = useRef(0);

  // Loads all per-user settings from IndexedDB and populates React state.
  // Called once on mount (via getSession) and again after every switchToUserDb
  // so that signing in or out immediately reflects the correct user's data.
  const initAppData = useCallback(async () => {
    const [s, prefs, focus] = await Promise.all([
      loadSettings(),
      loadQuizPrefs(),
      loadFocusStruggling(),
      getVictorySeen(),   // triggers one-time migration of birdygurdy_victories
      loadSnapshot(),     // triggers one-time migration of birdygurdy_region_snapshot
    ]);
    setSettings(s);
    setConfig({
      ...DEFAULT_CONFIG,
      recentDays: RECENT_DAYS[s.recentWindow ?? 'day'],
      ...(prefs.questionTypes     ? { questionTypes: prefs.questionTypes as QuizConfig['questionTypes'] } : {}),
      ...(prefs.mode              ? { mode: prefs.mode as QuizConfig['mode'] }                          : {}),
      ...(prefs.questionsPerRound != null ? { questionsPerRound: prefs.questionsPerRound }               : {}),
      ...(prefs.regionCode        ? { regionCode: prefs.regionCode }                                     : {}),
      ...(prefs.groupId           ? { groupId: prefs.groupId }                                           : {}),
    });
    setFocusStruggling(focus);
    setSelectionPrefs({
      selectionMode:        prefs.selectionMode        ?? 'all',
      selectedSpeciesCodes: prefs.selectedSpeciesCodes ?? [],
      selectedFamilies:     prefs.selectedFamilies     ?? [],
      selectedOrders:       prefs.selectedOrders       ?? [],
    });
    setIsInitialized(true);
    backfillProgressTaxonomy().catch(() => { /* non-fatal */ });
  }, []);

  const {
    notifications,
    setNotifications,
    hasUnread,
    setHasUnread,
    currentToast,
    setCurrentToast,
    sendFriendNotification,
    sendSessionNotification,
    performSignOut,
    sessionQuestionsRef,
    sessionRoundsRef,
    sessionMasteredRef,
    sessionInitialMasteredRef,
  } = useNotifications({ user, screen, onViewNotifications: () => setScreen('notifications') });

  const isAdmin = user?.user_metadata?.is_admin === true;
  const { state, currentQuestion, isCorrect, currentFavourited, currentExcluded, revealPhotos, revealRangeMapUrl, revealSightings, questionPhoto, questionPhotoFetching, roundLevelUps, roundNoLongerStruggling, isFirstEncounter, currentMastery, pendingFastTrack, startQuiz, submitAnswer, toggleFavourite, toggleExcluded, nextQuestion, confirmFastTrack, removeOptionalPhoto } = useQuiz(config, settings.randomizeQuestionPhotos, user?.id, settings.birderLevel, settings.alwaysFastTrack);

  // Reset mastery-fact tracking at the start of each new round
  useEffect(() => {
    if (state.status === 'loading') {
      hasShownFactThisRoundRef.current = false;
      prevGraduatedCountRef.current    = 0;
    }
  }, [state.status]);

  // Show mastery fact dialog the first time a bird graduates in a round
  useEffect(() => {
    const graduated = roundLevelUps.filter(e => e.graduated);
    if (graduated.length > prevGraduatedCountRef.current && !hasShownFactThisRoundRef.current) {
      setMasteryFactEvent(graduated[graduated.length - 1]);
      hasShownFactThisRoundRef.current = true;
    }
    prevGraduatedCountRef.current = graduated.length;
  }, [roundLevelUps]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Capture the Android "Add to home screen" prompt so we can trigger it on demand
  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setInstallPromptEvent(e as BeforeInstallPromptEvent); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Recompute struggling count whenever question types or settings change (also runs on mount)
  useEffect(() => {
    const expandedTypes = expandQuestionTypes(config.questionTypes, settings);
    db.progress.toArray()
      .then(records => { setStrugglingCount(computeStrugglingCount(records, expandedTypes)); })
      .catch(() => { /* DB may be mid-switch; re-runs when settings change */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.questionTypes, settings]);

  // Keep refs current so zero-dep closures (inactivity timer, visibility) always see latest values.
  useEffect(() => { userRef.current         = user; },         [user]);
  useEffect(() => { cloudSyncingRef.current = cloudSyncing; }, [cloudSyncing]);
  useEffect(() => {
    quizActiveRef.current = screen === 'quiz' && (state.status === 'active' || state.status === 'answered');
  }, [screen, state.status]);

  // Clear the modal and reset the inactivity timer when the user signs back in
  useEffect(() => {
    if (user) {
      setWasAutoSignedOut(false);
      localStorage.setItem(activityKey(user.id), String(Date.now()));
    }
  }, [user]);

  // Stable helper: apply downloaded cloud settings/prefs into local state.
  // Only uses stable React setters and module-level functions — safe to call
  // from any closure regardless of capture time.
  const applyCloudSettings = async (remote: Awaited<ReturnType<typeof downloadSettings>>) => {
    if (!remote) return;
    const [localSettings, localPrefs] = await Promise.all([loadSettings(), loadQuizPrefs()]);
    const mergedSettings = { ...localSettings, ...remote.appSettings };
    setSettings(mergedSettings);
    await saveSettings(mergedSettings);
    const mergedPrefs = { ...localPrefs, ...remote.quizPrefs };
    await saveQuizPrefs(mergedPrefs);
    setConfig(c => ({
      ...c,
      ...(mergedPrefs.questionTypes     ? { questionTypes: mergedPrefs.questionTypes as QuizConfig['questionTypes'] } : {}),
      ...(mergedPrefs.mode              ? { mode: mergedPrefs.mode as QuizConfig['mode'] }                           : {}),
      ...(mergedPrefs.questionsPerRound != null ? { questionsPerRound: mergedPrefs.questionsPerRound }                : {}),
      ...(mergedPrefs.regionCode        ? { regionCode: mergedPrefs.regionCode }                                     : {}),
      ...(mergedPrefs.groupId           ? { groupId: mergedPrefs.groupId }                                           : {}),
    }));
    setSelectionPrefs({
      selectionMode:        mergedPrefs.selectionMode        ?? 'all',
      selectedSpeciesCodes: mergedPrefs.selectedSpeciesCodes ?? [],
      selectedFamilies:     mergedPrefs.selectedFamilies     ?? [],
      selectedOrders:       mergedPrefs.selectedOrders       ?? [],
    });
    await mergeVictorySeen(remote.victorySeen);
  };

  // Three debounced inactivity timers — all reset on any user interaction.
  // Timers fire proactively between interactions (not on the next user action),
  // so sign-out and sync never interrupt a user gesture.
  //
  //   60 s  → background cloud sync (check for updates from other devices)
  //   5 min → send 'session' notification if the user played any rounds
  //  30 min → auto sign-out
  //
  // pagehide covers tab-close / navigate-away via sendBeacon.
  const INACTIVITY_MS  = 30 * 60 * 1000;
  const NOTIFY_IDLE_MS =  5 * 60 * 1000;
  const SYNC_IDLE_MS   =       60_000;
  useEffect(() => {
    const touch = () => {
      const u = userRef.current;
      if (u) localStorage.setItem(activityKey(u.id), String(Date.now()));
    };
    let throttle:    ReturnType<typeof setTimeout> | null = null;
    let syncTimer:   ReturnType<typeof setTimeout> | null = null;
    let notifyTimer: ReturnType<typeof setTimeout> | null = null;
    let signOutTimer: ReturnType<typeof setTimeout> | null = null;

    const doIdleSync = async () => {
      const u = userRef.current;
      if (!u || cloudSyncingRef.current) return;
      try {
        const cloudTs = await getCloudUploadTime(u.id).catch(() => null);
        if (cloudTs !== null) {
          const localTs = getLocalSyncedAt(u.id) ?? 0;
          if (localTs < cloudTs) {
            // Cloud is newer — abort quiz if active, then download.
            if (quizActiveRef.current) setScreen('home');
            setCloudSyncing(true);
            try {
              const count = await downloadAndReplace(u.id, cloudTs).catch(() => -1);
              if (count > 0) {
                setSyncVersion(v => v + 1);
                downloadSettings(u.id).then(applyCloudSettings).catch(() => {});
              }
            } finally {
              setCloudSyncing(false);
            }
          }
        }
      } catch { /* non-fatal */ }
    };

    const resetTimers = () => {
      if (syncTimer)    { clearTimeout(syncTimer);    syncTimer    = null; }
      if (notifyTimer)  { clearTimeout(notifyTimer);  notifyTimer  = null; }
      if (signOutTimer) { clearTimeout(signOutTimer); signOutTimer = null; }
      if (userRef.current) {
        syncTimer    = setTimeout(doIdleSync, SYNC_IDLE_MS);
        notifyTimer  = setTimeout(sendSessionNotification, NOTIFY_IDLE_MS);
        signOutTimer = setTimeout(() => { performSignOut(); setWasAutoSignedOut(true); }, INACTIVITY_MS);
      }
    };

    const onActivity = () => {
      if (!throttle) throttle = setTimeout(() => { touch(); throttle = null; }, 15_000);
      resetTimers();
    };

    const onPageHide = () => {
      if (sessionRoundsRef.current > 0 && accessTokenRef.current) {
        sendBeaconNotification('session', {
          questionsAnswered:  sessionQuestionsRef.current,
          roundsCompleted:    sessionRoundsRef.current,
          birdsMasteredCount: sessionMasteredRef.current,
        }, accessTokenRef.current);
      }
    };

    touch();
    resetTimers();
    document.addEventListener('click',      onActivity);
    document.addEventListener('keydown',    onActivity);
    document.addEventListener('touchstart', onActivity);
    document.addEventListener('scroll',     onActivity, { passive: true });
    window.addEventListener('pagehide',     onPageHide);
    return () => {
      if (syncTimer)    clearTimeout(syncTimer);
      if (notifyTimer)  clearTimeout(notifyTimer);
      if (signOutTimer) clearTimeout(signOutTimer);
      if (throttle)     clearTimeout(throttle);
      document.removeEventListener('click',      onActivity);
      document.removeEventListener('keydown',    onActivity);
      document.removeEventListener('touchstart', onActivity);
      document.removeEventListener('scroll',     onActivity);
      window.removeEventListener('pagehide',     onPageHide);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleQuizPrefsChange = async (prefs: { questionTypes: QuizConfig['questionTypes']; mode: QuizConfig['mode']; questionsPerRound: number; groupId: string; regionCode: string }) => {
    const existing = await loadQuizPrefs();
    const newPrefs = { ...existing, questionTypes: prefs.questionTypes, mode: prefs.mode, questionsPerRound: prefs.questionsPerRound, groupId: prefs.groupId, regionCode: prefs.regionCode };
    await saveQuizPrefs(newPrefs);
    setConfig(c => ({ ...c, ...newPrefs }));
    if (user) uploadSettings(user.id, settings, newPrefs, await getVictorySeen()).catch(() => {});
  };

  const handleSelectionChange = async (newSelectionPrefs: { selectionMode: 'all' | 'custom'; selectedSpeciesCodes: string[]; selectedFamilies: string[]; selectedOrders: string[] }) => {
    const existing = await loadQuizPrefs();
    await saveQuizPrefs({ ...existing, ...newSelectionPrefs });
    setSelectionPrefs(newSelectionPrefs);
  };

  const handleRegionChange = async (code: string) => {
    setConfig(c => ({ ...c, regionCode: code }));
    const prefs = { ...await loadQuizPrefs(), regionCode: code };
    await saveQuizPrefs(prefs);
    if (user) uploadSettings(user.id, settings, prefs, await getVictorySeen()).catch(() => {});
  };

  // On load, fetch admin-blocked media for all users (including guests)
  useEffect(() => {
    fetchAdminBlockedMedia().catch(() => { /* non-fatal */ });
  }, []);

  // Auth: restore session on load and listen for changes
  // Tracks the user ID that was active before each auth event so we can
  // distinguish a genuine new sign-in from a silent token refresh (both
  // fire SIGNED_IN in this version of the Supabase client).
  const prevAuthUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      // Seed the ref so the first SIGNED_IN/INITIAL_SESSION callback knows
      // whether the user was already authenticated on page load.
      prevAuthUserIdRef.current = data.session?.user?.id ?? null;
      switchToUserDb(data.session?.user?.id ?? null);
      setUser(data.session?.user ?? null);
      // Pre-raise the overlay so the UI never flashes enabled before INITIAL_SESSION fires.
      // The INITIAL_SESSION handler always calls setCloudSyncing(false) in its finally block.
      if (data.session?.user) setCloudSyncing(true);
      void initAppData();
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Switch DB first - all subsequent reads/writes go to the correct store.
      switchToUserDb(session?.user?.id ?? null);
      void initAppData();
      setUser(session?.user ?? null);
      // Password-reset link redirects back here — show the set-new-password dialog.
      if (event === 'PASSWORD_RECOVERY') { setShowPasswordReset(true); return; }
      // When a session appears (OAuth redirect back), merge cloud data
      if (session?.user) {
        const userId = session.user.id;
        // Persist news opt-in set before an OAuth redirect
        const pendingNewsOptIn = localStorage.getItem('burdygurdy_news_opt_in');
        if (pendingNewsOptIn) {
          localStorage.removeItem('burdygurdy_news_opt_in');
          supabase.auth.updateUser({ data: { news_opt_in: true } }).catch(() => {});
        }
        // Only download on app load or a genuine new sign-in.
        // TOKEN_REFRESHED and repeat SIGNED_IN (silent token refresh) must not
        // trigger a download — that fires on tab return and bypasses the
        // MIN_HIDDEN_MS guard in the visibility-change handler.
        const isInitialLoad   = event === 'INITIAL_SESSION';
        const isGenuineSignIn = event === 'SIGNED_IN' && prevAuthUserIdRef.current === null;
        if (isInitialLoad || isGenuineSignIn) {
          (async () => {
            const cloudTs = await getCloudUploadTime(userId).catch(() => null);
            setCloudSyncing(true);
            try {
              // Pass cloudTs so downloadAndReplace stamps localSyncedAt internally.
              const remoteCount = await downloadAndReplace(userId, cloudTs).catch(() => -1);
              if (remoteCount > 0) {
                setSyncVersion(v => v + 1);
              } else if (remoteCount === 0) {
                // No cloud records — offer to upload guest progress for the first user on this device
                const localCount = await db.progress.count();
                if (localCount > 0) {
                  const dbs = await indexedDB.databases().catch(() => [] as IDBDatabaseInfo[]);
                  const hasOtherAuth = dbs.some(
                    d => d.name?.startsWith('BirdyGurdyDB-') &&
                         d.name !== 'BirdyGurdyDB-guest' &&
                         d.name !== `BirdyGurdyDB-${userId}`,
                  );
                  if (!hasOtherAuth) setShowUploadPrompt(true);
                }
              }
            } finally {
              setCloudSyncing(false);
            }
          })().catch(() => {});
        }
        // Capture now - prevAuthUserIdRef will be updated before the promise resolves.
        const isNewSignIn = event === 'SIGNED_IN' && prevAuthUserIdRef.current === null;
        if (isInitialLoad || isGenuineSignIn) {
          downloadSettings(userId).then(async remote => {
            if (remote) {
              // Returning user with cloud settings - import prefs and skip the wizard.
              localStorage.setItem('burdygurdy_onboarding_complete', '1');
              setShowOnboarding(false);
              const [localSettings, localPrefs] = await Promise.all([loadSettings(), loadQuizPrefs()]);
              const mergedSettings = { ...localSettings, ...remote.appSettings };
              setSettings(mergedSettings);
              await saveSettings(mergedSettings);
              const mergedPrefs = { ...localPrefs, ...remote.quizPrefs };
              await saveQuizPrefs(mergedPrefs);
              setConfig(c => ({
                ...c,
                ...(mergedPrefs.questionTypes     ? { questionTypes: mergedPrefs.questionTypes as QuizConfig['questionTypes'] } : {}),
                ...(mergedPrefs.mode              ? { mode: mergedPrefs.mode as QuizConfig['mode'] }                           : {}),
                ...(mergedPrefs.questionsPerRound != null ? { questionsPerRound: mergedPrefs.questionsPerRound }                : {}),
                ...(mergedPrefs.regionCode        ? { regionCode: mergedPrefs.regionCode }                                     : {}),
                ...(mergedPrefs.groupId           ? { groupId: mergedPrefs.groupId }                                           : {}),
              }));
              setSelectionPrefs({
                selectionMode:        mergedPrefs.selectionMode        ?? 'all',
                selectedSpeciesCodes: mergedPrefs.selectedSpeciesCodes ?? [],
                selectedFamilies:     mergedPrefs.selectedFamilies     ?? [],
                selectedOrders:       mergedPrefs.selectedOrders       ?? [],
              });
              await mergeVictorySeen(remote.victorySeen);
            } else if (isNewSignIn) {
              // Brand-new user, no cloud settings anywhere - reset stale local prefs
              // (which may belong to a previous user on this device) and run the wizard.
              const freshSettings = await resetUserSettings();
              setSettings(freshSettings);
              setShowOnboarding(true);
            }
          }).catch(() => {});
          downloadUserBlockedPhotos(userId).catch(() => {});
          fetchAdminBlockedMedia().catch(() => {});
          downloadRegionSnapshot(userId).then(snap => { if (snap) saveSnapshot(snap); }).catch(() => {});
        }
        // Send login notification only on a genuine new sign-in - i.e. the user
        // was previously signed out.  Supabase also fires SIGNED_IN on silent
        // token refreshes (~hourly); checking prevAuthUserIdRef filters those out.
        if (event === 'SIGNED_IN' && prevAuthUserIdRef.current === null) {
          db.progress.toArray()
            .then(records => { sessionInitialMasteredRef.current = records.filter(r => r.isMastered).length; })
            .catch(() => {});
          sendFriendNotification('login', {}, session.access_token);
          // Reset session stats
          sessionQuestionsRef.current = 0;
          sessionRoundsRef.current = 0;
          sessionMasteredRef.current = 0;
        }
      }
      // Keep refs current so subsequent events see the correct previous state.
      accessTokenRef.current = session?.access_token ?? null;
      if (event === 'SIGNED_OUT') prevAuthUserIdRef.current = null;
      else if (session?.user)      prevAuthUserIdRef.current = session.user.id;
    });
    return () => subscription.unsubscribe();
  }, []);

  // Smart cross-device sync on visibility changes.
  //
  // On hide: if this device is current (localSyncedAt >= cloudTs), upload.
  //   If cloud is newer skip the upload — show handler will download on reactivation.
  //   If cloud check fails, attempt the upload anyway (uploadProgress sets needsUpload on failure).
  //
  // On show: if cloud is newer than our last sync, abort any in-progress quiz,
  //   download-replace, then refresh settings. Retry any pending upload otherwise.
  useEffect(() => {
    if (!user) return;
    const userId = user.id;
    const MIN_HIDDEN_MS = 50_000; // ignore brief tab switches
    let hiddenAt = 0;

    const handleHide = async () => {
      hiddenAt = Date.now();
      const cloudTs = await getCloudUploadTime(userId).catch(() => null);
      const localSyncedAt = getLocalSyncedAt(userId) ?? 0;
      if (cloudTs === null || localSyncedAt >= cloudTs) {
        // Can't check cloud, or we're current — upload (uploadProgress owns bookkeeping).
        await uploadProgress(userId).catch(() => {});
      }
      // If cloud is newer: skip upload so we don't overwrite a trim.
    };

    const handleShow = async () => {
      if (hiddenAt > 0 && Date.now() - hiddenAt < MIN_HIDDEN_MS) { hiddenAt = 0; return; }
      hiddenAt = 0;
      if (cloudSyncingRef.current) return;  // login or idle sync already in progress
      const cloudTs = await getCloudUploadTime(userId).catch(() => null);
      if (cloudTs !== null) {
        const localSyncedAt = getLocalSyncedAt(userId) ?? 0;
        if (localSyncedAt < cloudTs) {
          // Cloud is newer — abort quiz if active, then download.
          if (quizActiveRef.current) setScreen('home');
          setCloudSyncing(true);
          try {
            const count = await downloadAndReplace(userId, cloudTs).catch(() => -1);
            if (count > 0) {
              setSyncVersion(v => v + 1);
              downloadSettings(userId).then(applyCloudSettings).catch(() => {});
              return;
            }
          } finally {
            setCloudSyncing(false);
          }
        }
      }
      // Retry a pending upload (previous attempt failed or cloud check failed).
      if (getNeedsUpload(userId)) {
        await uploadProgress(userId).catch(() => {});
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') handleHide();
      else handleShow();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [user?.id]);

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
      () => { /* user denied or unavailable - non-fatal */ },
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After each completed round, upload progress, refresh struggling count, track session stats
  useEffect(() => {
    if (state.status !== 'complete') return;
    const expandedTypes = expandQuestionTypes(config.questionTypes, settings);
    db.progress.toArray()
      .then(records => {
        setStrugglingCount(computeStrugglingCount(records, expandedTypes));
        // Track newly mastered birds this session
        const currentMastered = records.filter(r => r.isMastered).length;
        sessionMasteredRef.current = Math.max(0, currentMastered - sessionInitialMasteredRef.current);
      })
      .catch(() => {});
    sessionRoundsRef.current += 1;
    if (user && config.mode !== 'random') {
      uploadProgress(user.id).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  const doStart = async (fullConfig: QuizConfig) => {
    setConfig(fullConfig);
    setScreen('quiz');
    await startQuiz({
      ...fullConfig,
      questionTypes: expandQuestionTypes(fullConfig.questionTypes, settings),
      onlyStruggling: focusStruggling,
    });
  };

  const handleStart = async (newConfig: QuizConfig) => {
    const existing = await loadQuizPrefs();
    const newPrefs = {
      ...existing,
      questionTypes: newConfig.questionTypes,
      mode: newConfig.mode,
      questionsPerRound: newConfig.questionsPerRound,
      regionCode: newConfig.regionCode,
      groupId: newConfig.groupId,
    };
    await saveQuizPrefs(newPrefs);
    if (user) uploadSettings(user.id, settings, newPrefs, await getVictorySeen()).catch(() => {});
    const fullConfig = { ...newConfig, recentDays: RECENT_DAYS[settings.recentWindow] };

    if (settings.expireMasteredBirds && newConfig.mode === 'adaptive') {
      const birds = await checkBirdsToExpire();
      if (birds.length > 0) {
        pendingStartConfigRef.current = fullConfig;
        setExpiryDialog(birds);
        return;
      }
    }

    // Check whether the region sightings window has changed since the last quiz
    if (newConfig.mode === 'adaptive') {
      const back = fullConfig.recentDays ?? 30;
      const currentSpecies = await getRegionSpecies(fullConfig.regionCode, back);
      const snapshot = await loadSnapshot();
      const snapshotMatches = snapshot?.regionCode === fullConfig.regionCode && snapshot?.back === back;
      if (!snapshotMatches) {
        // First run or region/back changed - save baseline silently
        const newSnap = buildSnapshot(fullConfig.regionCode, back, currentSpecies);
        void saveSnapshot(newSnap);
        if (user) uploadRegionSnapshot(user.id, newSnap).catch(() => {});
      } else {
        const updateInfo = computeRegionUpdate(currentSpecies, snapshot!);
        if (updateInfo) {
          const allRecords = await db.progress.toArray();
          setPendingRegionUpdate({ info: updateInfo, records: allRecords, pendingConfig: fullConfig });
          // Preload quiz questions while the dialog is open
          setConfig(fullConfig);
          startQuiz({
            ...fullConfig,
            questionTypes: expandQuestionTypes(fullConfig.questionTypes, settings),
            onlyStruggling: focusStruggling,
          });
          return;
        }
      }
    }

    await doStart(fullConfig);
  };

  const handleRegionUpdateDismiss = () => {
    if (!pendingRegionUpdate) return;
    const { pendingConfig } = pendingRegionUpdate;
    const back = pendingConfig.recentDays ?? 30;
    // currentSpecies is already cached in memory from handleStart; rebuild snapshot from it
    getRegionSpecies(pendingConfig.regionCode, back).then(currentSpecies => {
      const newSnap = buildSnapshot(pendingConfig.regionCode, back, currentSpecies);
      void saveSnapshot(newSnap);
      if (user) uploadRegionSnapshot(user.id, newSnap).catch(() => {});
    }).catch(() => {});
    setPendingRegionUpdate(null);
    setScreen('quiz');
  };

  const handleNext = () => {
    sessionQuestionsRef.current += 1;
    nextQuestion();
    if (state.status === 'complete') setScreen('result');
  };

  const handleClearBlockedPhotos = async () => {
    await db.blockedPhotos.clear();
    if (user) await deleteAllUserBlockedPhotos(user.id).catch(() => {});
  };

  const handleSaveSettings = async (s: AppSettings) => {
    setSettings(s);
    await saveSettings(s);
    if (user) uploadSettings(user.id, s, await loadQuizPrefs(), await getVictorySeen()).catch(() => {});
  };

  const handleUpdateSettings = (updates: Partial<AppSettings>) => {
    handleSaveSettings({ ...settings, ...updates });
  };

  const handleInstallApp = installPromptEvent ? async () => {
    await installPromptEvent.prompt();
    const { outcome } = await installPromptEvent.userChoice;
    if (outcome === 'accepted') setInstallPromptEvent(null);
  } : null;

  function detectService(url: string): string {
    if (url.includes('inaturalist.org'))  return 'iNaturalist';
    if (url.includes('macaulaylibrary.org')) return 'Macaulay Library';
    if (url.includes('xeno-canto.org'))   return 'xeno-canto';
    if (url.includes('wikimedia.org') || url.includes('wikipedia.org')) return 'Wikimedia Commons';
    return 'Unknown';
  }

  const handleReportError = (data: ReportErrorData & { mediaUrl: string; mediaType: 'photo' | 'audio'; speciesCode: string; comName: string }) => {
    submitMediaReport({
      url: data.mediaUrl,
      mediaType: data.mediaType,
      service: detectService(data.mediaUrl),
      speciesCode: data.speciesCode,
      comName: data.comName,
      issueType: data.issueType,
      wrongBird: data.wrongBird || null,
      description: data.description || null,
    }).catch(err => console.error('[report-media]', err));
  };

  // When a round completes, check for victory before showing result screen
  useEffect(() => {
    if (state.status !== 'complete' || screen !== 'quiz') return;
    const expandedTypes = expandQuestionTypes(config.questionTypes, settings);
    (async () => {
      const snapshot = await loadSnapshot();
      const snapshotKey = snapshot?.savedAt ?? new Date().toISOString();
      const won = await checkVictoryCondition(config.regionCode, config.recentDays ?? 30, expandedTypes);
      if (won && roundLevelUps.some(e => e.graduated) && !await hasSeenVictory(snapshotKey, expandedTypes)) {
        await markVictorySeen(snapshotKey, expandedTypes);
        sendFriendNotification('victory', {
          masteryDesc: describeMastery(expandedTypes),
          windowDesc: describeWindow(settings.recentWindow),
          regionCode: config.regionCode,
        });
        setScreen('victory');
      } else {
        setScreen('result');
      }
    })().catch(() => setScreen('result'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  const showFocusModeToggle = strugglingCount >= Math.round(config.questionsPerRound * 0.5);
  // Persist focus mode to IndexedDB (per-user store)
  useEffect(() => {
    void saveFocusStruggling(focusStruggling);
  }, [focusStruggling]);
  // Auto-disable focus mode when there are no longer enough struggling birds
  useEffect(() => {
    if (focusStruggling && !showFocusModeToggle) setFocusStruggling(false);
  }, [focusStruggling, showFocusModeToggle]);

  // Check for pending friend invites and subscribe to new ones in real-time
  useEffect(() => {
    if (!user?.email) { setHasPendingInvites(false); return; }
    getReceivedPendingInvites(user.email)
      .then(invites => setHasPendingInvites(invites.length > 0))
      .catch(() => {});

    const channel = supabase
      .channel(`friend_invites:${user.email}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'friend_invites', filter: `to_email=eq.${user.email}` },
        () => { setHasPendingInvites(true); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.email]);

  async function handleViewFriendLifeList(friendUserId: string, displayName: string) {
    const records = await fetchFriendProgress(friendUserId).catch(() => []);
    setFriendProgressRecords(records);
    setFriendProgressName(displayName);
    setScreen('friendprogress');
  }

  function handleSightingClick(
    s: RecentSighting,
    speciesCode: string, comName: string, sciName: string,
  ) {
    const regional: RegionalSighting = {
      speciesCode, comName, sciName,
      locName:         s.locName,
      obsDt:           s.obsDt,
      howMany:         s.howMany,
      lat:             s.lat,
      lng:             s.lng,
      subId:           null,
      userDisplayName: null,
    };
    setSelectedSighting(regional);
    setAllSightings([]);
    setSightingsBack(screen);
    setScreen('sightings');
  }

  if (!isInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <img src="/BurdyGurdyProgress.gif" alt="" className="h-16 w-auto" />
      </div>
    );
  }

  return (
    <div className="font-sans lg:flex lg:h-screen">
<Toast toast={currentToast} onDismiss={() => setCurrentToast(null)} />

      {showOnboarding && (
        <OnboardingWizard
          user={user}
          settings={settings}
          onUpdateSettings={handleUpdateSettings}
          onRegionDetected={handleRegionChange}
          onInstallApp={handleInstallApp}
          onComplete={() => { localStorage.setItem('burdygurdy_onboarding_complete', '1'); setShowOnboarding(false); }}
        />
      )}

      {wasAutoSignedOut && !user && (
        <DialogGeneric
          dialogId="inactivitySignOut"
          onConfirm={() => { setWasAutoSignedOut(false); setShowAuth(true); }}
          onCancel={() => setWasAutoSignedOut(false)}
        />
      )}

      {/* ── Right panel: desktop only ── */}
      {isDesktop && <div className="lg:flex lg:order-2 flex-col flex-1 border-l-2 border-slate-200 overflow-hidden">

        {isAdmin && settings.enableAdminFeatures && screen !== 'sightings' && (
          <div className="shrink-0 flex border-b border-slate-200 bg-white">
            {(['info', 'curation', 'facts', 'database'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setRightPanelTab(tab)}
                className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
                  rightPanelTab === tab
                    ? 'border-forest-600 text-forest-700 bg-forest-50'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                }`}
              >
                {tab === 'info' ? 'Bird Info' : tab === 'curation' ? 'Curation' : tab === 'facts' ? 'Facts' : 'Database'}
              </button>
            ))}
          </div>
        )}

        {screen === 'sightings' && (
          <div className="flex-1 min-h-0 overflow-hidden">
            <SightingsMapPanel
              allSightings={allSightings}
              selectedSighting={selectedSighting}
              regionCode={config.regionCode}
            />
          </div>
        )}

        {screen !== 'sightings' && (!isAdmin || !settings.enableAdminFeatures || rightPanelTab === 'info') && (
          <BirdInfoPanel
            question={screen === 'quiz' && (state.status === 'active' || state.status === 'answered') ? currentQuestion : null}
            isAnswered={state.status === 'answered'}
            isCorrect={isCorrect}
            selectedAnswer={state.selectedAnswer}
            regionCode={config.regionCode}
            browseSpecies={isDesktop && ['progress', 'recentprogress', 'friendprogress', 'friendrecentprogress'].includes(screen) ? progressSelectedSpecies : null}
            maxRecentSightings={settings.maxRecentSightings}
            autoScrollRelatedSpecies={settings.autoScrollRelatedSpecies}
            autoplayRevealAudio={settings.autoplayRevealAudio}
            userEmail={user?.email}
            onAuthClick={() => setShowAuth(true)}
            onSignOut={performSignOut}
            onSightingClick={handleSightingClick}
          />
        )}

        {screen !== 'sightings' && isAdmin && settings.enableAdminFeatures && rightPanelTab === 'curation' && (
          <div className="flex-1 min-h-0 overflow-hidden">
            <CurationPanel />
          </div>
        )}
        {screen !== 'sightings' && isAdmin && settings.enableAdminFeatures && rightPanelTab === 'facts' && (
          <div className="flex-1 min-h-0 overflow-hidden">
            <FactsCurationPanel />
          </div>
        )}
        {screen !== 'sightings' && isAdmin && settings.enableAdminFeatures && rightPanelTab === 'database' && (
          <div className="flex-1 min-h-0 overflow-hidden">
            <DatabasePanel />
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
          onSightings={() => { setSelectedSighting(null); setAllSightings([]); setScreen('sightings'); }}
          onSettings={() => setScreen('settings')}
          onFriends={() => { setScreen('friends'); setHasPendingInvites(false); }}
          hasPendingInvites={hasPendingInvites}
          onNotifications={() => setScreen('notifications')}
          hasUnreadNotifications={hasUnread}
          userEmail={user?.email}
          onAuthClick={() => setShowAuth(true)}
          onSignOut={performSignOut}
          onQuizPrefsChange={handleQuizPrefsChange}
          initialSelectionMode={selectionPrefs.selectionMode}
          initialSelectionPrefs={selectionPrefs}
          onSelectionChange={handleSelectionChange}
        />
      )}

      {screen === 'sightings' && (
        <SightingsScreen
          regionCode={config.regionCode}
          isDesktop={isDesktop}
          onBack={() => setScreen(sightingsBack)}
          onSightingsLoaded={setAllSightings}
          onSelectSighting={isDesktop ? setSelectedSighting : undefined}
          selectedSighting={selectedSighting}
        />
      )}

      {screen === 'progress' && (
        <ProgressScreenLife
          key={syncVersion}
          onBack={() => { setScreen(lifeListBack); setLifeListBack('home'); }}
          userId={user?.id}
          questionTypes={expandQuestionTypes(config.questionTypes, settings)}
          focusStruggling={focusStruggling}
          showFocusModeToggle={showFocusModeToggle}
          onToggleFocusStruggling={() => setFocusStruggling(f => !f)}
          onSelectBird={isDesktop
            ? setProgressSelectedSpecies
            : s => { setProgressSelectedSpecies(s); setPrevScreen('progress'); setScreen('birdinfo'); }}
          selectedSpeciesCode={isDesktop ? progressSelectedSpecies?.speciesCode : undefined}
          regionCode={config.regionCode}
          recentDays={config.recentDays ?? 30}
          onRecentProgress={() => { setRecentProgressBack('progress'); setScreen('recentprogress'); }}
          syncKey={syncVersion}
          onHistoryCleared={() => {
            setSelectionPrefs({ selectionMode: 'all', selectedSpeciesCodes: [], selectedFamilies: [], selectedOrders: [] });
          }}
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
            loadQuizPrefs().then(p => setSelectionPrefs({
              selectionMode:        p.selectionMode        ?? 'all',
              selectedSpeciesCodes: p.selectedSpeciesCodes ?? [],
              selectedFamilies:     p.selectedFamilies     ?? [],
              selectedOrders:       p.selectedOrders       ?? [],
            })).catch(() => {});
          }}
          user={user}
          onInstallApp={handleInstallApp}
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
          onSkip={nextQuestion}
          onReportError={(data) => handleReportError({ ...data, speciesCode: currentQuestion.speciesCode, comName: currentQuestion.comName })}
          onSightingClick={handleSightingClick}
        />
      )}

      {screen === 'result' && (
        <ResultScreen
          score={state.score}
          config={config}
          questionTypes={expandQuestionTypes(config.questionTypes, settings)}
          levelUps={roundLevelUps}
          noLongerStruggling={roundNoLongerStruggling}
          focusStruggling={focusStruggling}
          showFocusModeToggle={showFocusModeToggle}
          strugglingCount={strugglingCount}
          onToggleFocusStruggling={() => setFocusStruggling(f => !f)}
          onRestart={() => handleStart(config)}
          onHome={() => setScreen('home')}
          onRecentProgress={() => { setRecentProgressBack('result'); setScreen('recentprogress'); }}
          onLifeList={() => { setLifeListBack('result'); setScreen('progress'); }}
        />
      )}

      {screen === 'recentprogress' && (
        <ProgressScreenRecent
          regionCode={config.regionCode}
          recentDays={config.recentDays ?? 30}
          questionTypes={expandQuestionTypes(config.questionTypes, settings)}
          onBack={() => setScreen(recentProgressBack)}
          onSelectBird={isDesktop
            ? setProgressSelectedSpecies
            : s => { setProgressSelectedSpecies(s); setPrevScreen('recentprogress'); setScreen('birdinfo'); }}
          selectedSpeciesCode={isDesktop ? progressSelectedSpecies?.speciesCode : undefined}
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

      {screen === 'friends' && (
        <FriendsScreen
          userId={user?.id ?? null}
          userEmail={user?.email ?? null}
          onBack={() => { sessionStorage.removeItem('pendingInvite'); setScreen('home'); }}
          onViewFriendLifeList={handleViewFriendLifeList}
        />
      )}

      {screen === 'notifications' && (
        <NotificationsScreen
          notifications={notifications}
          onBack={() => setScreen('home')}
          onNotificationsRead={ids => {
            setNotifications(prev => prev.map(n => ids.includes(n.id) ? { ...n, read: true } : n));
            setHasUnread(false);
            markNotificationsRead(ids).catch(() => {});
          }}
          onDeleteNotifications={ids => {
            setNotifications(prev => prev.filter(n => !ids.includes(n.id)));
          }}
        />
      )}

      {screen === 'friendprogress' && (
        <ProgressScreenLife
          onBack={() => setScreen('friends')}
          userId={user?.id}
          questionTypes={expandQuestionTypes(config.questionTypes, settings)}
          focusStruggling={false}
          showFocusModeToggle={false}
          onToggleFocusStruggling={() => {}}
          onSelectBird={isDesktop ? setProgressSelectedSpecies : s => { setProgressSelectedSpecies(s); setPrevScreen('friendprogress'); setScreen('birdinfo'); }}
          selectedSpeciesCode={isDesktop ? progressSelectedSpecies?.speciesCode : undefined}
          regionCode={config.regionCode}
          recentDays={RECENT_DAYS[settings.recentWindow ?? 'month']}
          onRecentProgress={() => setScreen('friendrecentprogress')}
          overrideRecords={friendProgressRecords}
          friendDisplayName={friendProgressName}
        />
      )}

      {screen === 'friendrecentprogress' && (
        <ProgressScreenRecent
          regionCode={config.regionCode}
          recentDays={RECENT_DAYS[settings.recentWindow ?? 'month']}
          questionTypes={expandQuestionTypes(config.questionTypes, settings)}
          onBack={() => setScreen('friendprogress')}
          onSelectBird={isDesktop ? setProgressSelectedSpecies : s => { setProgressSelectedSpecies(s); setPrevScreen('friendrecentprogress'); setScreen('birdinfo'); }}
          selectedSpeciesCode={isDesktop ? progressSelectedSpecies?.speciesCode : undefined}
          overrideRecords={friendProgressRecords}
          friendDisplayName={friendProgressName}
        />
      )}
      </div>{/* end game column */}

      {/* Auth panel */}
      {showAuth && (
        <AuthPanel
          onClose={() => setShowAuth(false)}
          onSignIn={() => {}}
          onSignUp={() => {}}
        />
      )}

      {/* Upload local progress prompt - shown after a new registration */}
      {showUploadPrompt && user && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-sky-50 rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
            <p className="text-lg font-bold text-slate-800 mb-2">Upload your progress?</p>
            <p className="text-sm text-slate-500 mb-5">
              You have local progress saved on this device. Would you like to upload it to your new account so it's backed up and available on all your devices?
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={async () => {
                  await uploadProgress(user.id).catch(() => {});
                  await uploadSettings(user.id, settings, await loadQuizPrefs(), await getVictorySeen());
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
                className="px-5 py-2 bg-sky-100 border border-sky-200 text-slate-700 rounded-xl text-sm hover:bg-sky-200"
              >
                Start fresh
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Password reset dialog - shown when user returns via a reset email link */}
      {showPasswordReset && <PasswordResetDialog onClose={() => setShowPasswordReset(false)} />}

      {/* Cloud sync overlay - blocks interaction while downloading from cloud */}
      {cloudSyncing && <CloudSyncOverlay />}

      {/* Fast-track dialog - shown mid-quiz when user aces easy on their first attempt */}
      {pendingFastTrack && (
        <FastTrackDialog
          candidate={pendingFastTrack}
          onConfirm={(accept, always) => {
            confirmFastTrack(accept);
            if (accept && always) handleUpdateSettings({ alwaysFastTrack: true });
          }}
        />
      )}

      {/* Mastery fact dialog - shown mid-quiz the first time a bird graduates in a round */}
      {masteryFactEvent && (
        <MasteryFactDialog
          event={masteryFactEvent}
          onClose={() => setMasteryFactEvent(null)}
        />
      )}

      {/* Region sightings window update dialog */}
      {pendingRegionUpdate && (
        <RegionUpdateDialog
          info={pendingRegionUpdate.info}
          progressRecords={pendingRegionUpdate.records}
          questionTypes={expandQuestionTypes(pendingRegionUpdate.pendingConfig.questionTypes, settings)}
          onDismiss={handleRegionUpdateDismiss}
        />
      )}

      {/* Mastery expiry confirmation dialog */}
      {expiryDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-sky-50 rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-4">
            <div>
              <h2 className="text-lg font-bold text-slate-800 mb-2">Mastered birds expiring</h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                In your settings, you have chosen to expire mastered birds after 90 days. The following birds will be expired today:
              </p>
              <ul className="mt-2 mb-2 max-h-48 overflow-y-auto space-y-0.5">
                {expiryDialog.map(b => (
                  <li key={b.speciesCode} className="text-sm text-slate-700 font-medium">{b.comName}</li>
                ))}
              </ul>
              <p className="text-sm text-slate-600 leading-relaxed">
                This lets you be re-exposed to these birds at a higher frequency when they return to your region, and gives you the opportunity to stay on top of who is passing through or settling in for the season.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  const newSettings = { ...settings, expireMasteredBirds: false };
                  setSettings(newSettings);
                  saveSettings(newSettings);
                  const cfg = pendingStartConfigRef.current!;
                  pendingStartConfigRef.current = null;
                  setExpiryDialog(null);
                  doStart(cfg);
                }}
                className="flex-1 py-2.5 rounded-xl bg-sky-100 border border-sky-200 text-slate-700 font-medium text-sm hover:bg-sky-200 transition-colors"
              >
                Cancel - turn off expiry
              </button>
              <button
                onClick={async () => {
                  await expireOldMasteredBirds();
                  const cfg = pendingStartConfigRef.current!;
                  pendingStartConfigRef.current = null;
                  setExpiryDialog(null);
                  doStart(cfg);
                }}
                className="flex-1 py-2.5 rounded-xl bg-forest-600 hover:bg-forest-700 text-white font-semibold text-sm transition-colors"
              >
                OK, expire them
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
