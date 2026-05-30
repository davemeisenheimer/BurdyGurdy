import { useState, useCallback, useEffect, useRef } from 'react';

function weightedPick<T>(candidates: Array<{ item: T; weight: number }>): T | null {
  if (candidates.length === 0) return null;
  const total = candidates.reduce((s, c) => s + c.weight, 0);
  if (total === 0) return null;
  let r = Math.random() * total;
  for (const c of candidates) { r -= c.weight; if (r <= 0) return c.item; }
  return candidates[candidates.length - 1].item;
}
import type { QuizQuestion, QuizConfig, AttributedPhoto, LevelUpEvent, NoLongerStrugglingEvent, BirderLevel } from '../types';
import { fetchQuizQuestions, fetchBirdPhotos, fetchBirdInfo, fetchRecentSightings } from '../services/remote/api';
import { loadQuizPrefs } from '../lib/settings';
import type { RecentSighting } from '../services/remote/api';
import { db } from '../lib/db';
import {
  recordAnswer, graduateNoAudio, graduateNoPhoto, setFavourite, getFavourited,
  setExcluded, getExcluded, getAdaptiveParams,
  maintainLevel0Palette, fastTrackToHard,
} from '../services/local/progress';
import { isStrugglingByWindow } from '../lib/struggling';
import { getRegionSpecies } from '../services/local/region';
import { uploadUserBlockedPhoto } from '../services/remote/sync';

export type QuizStatus = 'idle' | 'loading' | 'active' | 'answered' | 'complete' | 'error';

export interface QuizState {
  status: QuizStatus;
  questions: QuizQuestion[];
  currentIndex: number;
  selectedAnswer: string | null;
  score: { correct: number; total: number };
  error: string | null;
}

function birderLevelToInitialMastery(level?: BirderLevel): number {
  if (level === 'intermediate') return 1;
  if (level === 'advanced')     return 2;
  return 0;
}

export function useQuiz(config: QuizConfig, randomizeQuestionPhotos = false, userId?: string | null, birderLevel?: BirderLevel, alwaysFastTrack = false) {
  const [state, setState] = useState<QuizState>({
    status: 'idle',
    questions: [],
    currentIndex: 0,
    selectedAnswer: null,
    score: { correct: 0, total: 0 },
    error: null,
  });
  const [currentFavourited, setCurrentFavourited] = useState(false);
  const [currentExcluded, setCurrentExcluded]     = useState(false);
  const [revealPhotos, setRevealPhotos] = useState<{ primary: AttributedPhoto | null; optional: AttributedPhoto[] }>({ primary: null, optional: [] });
  const [revealRangeMapUrl, setRevealRangeMapUrl] = useState<string | null>(null);
  const [revealSightings, setRevealSightings] = useState<RecentSighting[]>([]);
  const [questionPhoto, setQuestionPhoto] = useState<{ questionId: string; photo: AttributedPhoto } | null>(null);
  const [questionPhotoFetching, setQuestionPhotoFetching] = useState(false);
  // Pre-fetched photo for the *next* question stored as a ref so it doesn't
  // overwrite the current question's photo state (which would corrupt the report URL).
  const prefetchedPhotoRef = useRef<{ questionId: string; photo: AttributedPhoto } | null>(null);
  const [roundLevelUps, setRoundLevelUps] = useState<LevelUpEvent[]>([]);
  const [roundNoLongerStruggling, setRoundNoLongerStruggling] = useState<NoLongerStrugglingEvent[]>([]);
  const [pendingFastTrack, setPendingFastTrack] = useState<LevelUpEvent | null>(null);
  const [isFirstEncounter, setIsFirstEncounter] = useState(false);
  const [currentMastery, setCurrentMastery] = useState<{ masteryLevel: number; consecutiveCorrect: number; isMastered: boolean; correct: number; incorrect: number } | null>(null);

  const currentQuestion = state.questions[state.currentIndex] ?? null;
  const nextQuestion_   = state.questions[state.currentIndex + 1] ?? null;
  const isCorrect =
    state.selectedAnswer !== null &&
    state.selectedAnswer === currentQuestion?.correctAnswer;

  // Sync favourite + excluded status when current question changes (adaptive only)
  useEffect(() => {
    setCurrentMastery(null);
    if (!currentQuestion || config.mode !== 'adaptive') {
      setCurrentFavourited(false);
      setCurrentExcluded(false);
      return;
    }
    getFavourited(currentQuestion.speciesCode, currentQuestion.type).then(setCurrentFavourited);
    getExcluded(currentQuestion.speciesCode, currentQuestion.type).then(setCurrentExcluded);
  }, [currentQuestion?.id, config.mode]);

  // Detect first encounter: seeded palette birds have lastAsked === 0 until first answer
  useEffect(() => {
    if (!currentQuestion || config.mode !== 'adaptive') {
      setIsFirstEncounter(false);
      return;
    }
    db.progress.get([currentQuestion.speciesCode, currentQuestion.type])
      .then(record => setIsFirstEncounter(!record || record.lastAsked === 0))
      .catch(() => setIsFirstEncounter(false));
  }, [currentQuestion?.id, config.mode]);

  // Preload the next question's image during the reveal state to avoid a flash on Next
  useEffect(() => {
    if (state.status !== 'answered' || !nextQuestion_?.imageUrl) return;
    const img = new Image();
    img.src = nextQuestion_.imageUrl;
  }, [state.status, nextQuestion_?.imageUrl]);

  // Pre-fetch and lock in the question photo before the question becomes active.
  // During 'answered': pre-fetch for the NEXT question into a ref so the current
  //   question's photo state is NOT overwritten (preserving the correct URL for reports).
  // During 'active': promote the pre-fetched photo if it matches, otherwise fetch.
  useEffect(() => {
    if (!randomizeQuestionPhotos) return;

    let isPrefetch = false;
    let targetQuestion: typeof currentQuestion | null = null;

    if (state.status === 'answered' && nextQuestion_) {
      targetQuestion = nextQuestion_;
      isPrefetch = true;
    } else if (state.status === 'active' && currentQuestion) {
      // Apply pre-fetched photo immediately if it matches the current question.
      if (prefetchedPhotoRef.current?.questionId === currentQuestion.id) {
        setQuestionPhoto(prefetchedPhotoRef.current);
        prefetchedPhotoRef.current = null;
        return;
      }
      if (questionPhoto?.questionId !== currentQuestion.id) {
        targetQuestion = currentQuestion;
      }
    }
    if (!targetQuestion) return;

    const q = targetQuestion;
    let cancelled = false;
    if (!isPrefetch) setQuestionPhotoFetching(true);
    (async () => {
      try {
        const { primary, optional } = await fetchBirdPhotos(q.speciesCode, q.comName, q.sciName, true);
        if (cancelled) return;
        const [blocked, adminBlocked, progressRecord] = await Promise.all([
          db.blockedPhotos.toArray(),
          db.adminBlockedMedia.toArray(),
          db.progress.get([q.speciesCode, q.type]),
        ]);
        if (cancelled) return;
        const blockedUserUrls  = new Set(blocked.map(b => b.url));
        const adminBlockedUrls = new Set(adminBlocked.filter(b => b.speciesCode === q.speciesCode).map(b => b.url));
        const isPhotoBlocked   = (url: string) => blockedUserUrls.has(url) || adminBlockedUrls.has(url);

        const inatPhoto     = primary                                                              && !isPhotoBlocked(primary.url)  ? primary     : null;
        const macaulayPhoto = optional.find(p => p.source === 'macaulay' && !isPhotoBlocked(p.url)) ?? null;
        const wikiPhotos    = optional.filter(p => p.source === 'wiki'   && !isPhotoBlocked(p.url));

        const mastery = progressRecord?.masteryLevel ?? 0;

        let selected: AttributedPhoto | null = null;
        if (mastery <= 0) {
          // Level 0: primary only
          selected = inatPhoto ?? macaulayPhoto ?? wikiPhotos[0] ?? null;
        } else if (mastery === 1) {
          // Level 1: 75% secondary, 25% primary
          selected = weightedPick([
            ...(macaulayPhoto ? [{ item: macaulayPhoto, weight: 3 }] : []),
            ...(inatPhoto     ? [{ item: inatPhoto,     weight: 1 }] : []),
          ]) ?? inatPhoto ?? macaulayPhoto ?? wikiPhotos[0] ?? null;
        } else {
          // Level 2+: 1/3 primary, 1/3 secondary, 1/3 Wiki (split equally among wiki photos)
          // Using weight=1 for primary and secondary and weight=1/N for each wiki photo gives
          // total weight=3, so P(primary)=1/3, P(secondary)=1/3, P(each wiki)=1/(3N).
          const wikiWeight = wikiPhotos.length > 0 ? 1 / wikiPhotos.length : 0;
          selected = weightedPick([
            ...(inatPhoto     ? [{ item: inatPhoto,     weight: 1         }] : []),
            ...(macaulayPhoto ? [{ item: macaulayPhoto, weight: 1         }] : []),
            ...wikiPhotos.map(p => ({ item: p,          weight: wikiWeight })),
          ]) ?? inatPhoto ?? macaulayPhoto ?? wikiPhotos[0] ?? null;
        }

        if (!cancelled) {
          if (isPrefetch) {
            if (selected) prefetchedPhotoRef.current = { questionId: q.id, photo: selected };
          } else {
            if (selected) setQuestionPhoto({ questionId: q.id, photo: selected });
            setQuestionPhotoFetching(false);
          }
        }
      } catch {
        if (!isPrefetch && !cancelled) setQuestionPhotoFetching(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuestion?.id, nextQuestion_?.id, state.status, randomizeQuestionPhotos]);

  // Fetch reveal photos and range map when the question changes.
  // Intentionally depends only on question id - NOT state.status - so answering
  // (active → answered) does not cancel an in-flight fetch.
  useEffect(() => {
    if (!currentQuestion) return;
    setRevealPhotos({ primary: null, optional: [] });
    setRevealRangeMapUrl(null);
    let cancelled = false;
    Promise.all([
      fetchBirdPhotos(currentQuestion.speciesCode, currentQuestion.comName, currentQuestion.sciName),
      fetchBirdInfo(currentQuestion.speciesCode, currentQuestion.comName, currentQuestion.sciName),
      config.regionCode ? fetchRecentSightings(currentQuestion.speciesCode, config.regionCode, 1) : Promise.resolve([]),
    ]).then(async ([{ primary, optional }, info, sightings]) => {
      if (cancelled) return;
      const [blocked, adminBlocked] = await Promise.all([
        db.blockedPhotos.toArray(),
        db.adminBlockedMedia.toArray(),
      ]);
      const blockedUserUrls  = new Set(blocked.map(b => b.url));
      const adminBlockedUrls = new Set(adminBlocked.filter(b => b.speciesCode === currentQuestion.speciesCode).map(b => b.url));
      const isPhotoBlocked   = (url: string) => blockedUserUrls.has(url) || adminBlockedUrls.has(url);
      setRevealPhotos({
        primary: primary && !isPhotoBlocked(primary.url) ? primary : null,
        optional: optional.filter(p => !isPhotoBlocked(p.url)),
      });
      setRevealRangeMapUrl(info?.rangeMapUrl ?? null);
      setRevealSightings(sightings);
    }).catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuestion?.id]);

  // Clear reveal data when returning to idle/loading (round reset)
  useEffect(() => {
    if (state.status === 'idle' || state.status === 'loading') {
      setRevealPhotos({ primary: null, optional: [] });
      setRevealRangeMapUrl(null);
      setRevealSightings([]);
    }
  }, [state.status]);

  const startQuiz = useCallback(async (overrideConfig?: QuizConfig) => {
    const cfg = overrideConfig ?? config;
    setState(s => ({ ...s, status: 'loading', error: null }));
    setRoundLevelUps([]);
    setRoundNoLongerStruggling([]);
    try {
      let weights = {};
      let masteryLevels = {};
      let banned: string[] = [];
      let paletteSpeciesCodes: string[] = [];
      let paletteKeys: string[] = [];
      let historyKeys: string[] = [];
      let strugglingKeys: string[] = [];

      const back = cfg.recentDays ?? 30;
      if (cfg.mode === 'adaptive') {
        if (cfg.onlyStruggling) {
          // Warm the region cache without promoting new birds into the learning palette
          await getRegionSpecies(cfg.regionCode, back);
        } else {
          // Seed initial palette and warm cache first; both use the same regionCode
          await maintainLevel0Palette(cfg.regionCode, cfg.questionTypes, back, birderLevelToInitialMastery(birderLevel));
        }
        const params = await getAdaptiveParams();
        weights             = params.weights;
        masteryLevels       = params.masteryLevels;
        banned              = params.banned;
        paletteSpeciesCodes = params.paletteSpeciesCodes;
        paletteKeys         = params.paletteKeys;
        historyKeys         = params.historyKeys;
        strugglingKeys      = params.strugglingKeys;

        if (cfg.onlyStruggling) {
          const allRecords = await db.progress.toArray();
          const strugglingSpecies = new Set(
            allRecords
              .filter(r => !r.excluded && (r.isMastered ?? false) && isStrugglingByWindow(r.recentAnswers ?? []))
              .map(r => r.speciesCode),
          );
          if (strugglingSpecies.size > 0) {
            // Filter weights/palette to struggling species only
            weights = Object.fromEntries(
              Object.entries(weights as Record<string, number>).filter(([k]) => strugglingSpecies.has(k.split(':')[0])),
            );
            paletteSpeciesCodes = paletteSpeciesCodes.filter(c => strugglingSpecies.has(c));
            paletteKeys    = paletteKeys.filter(k    => strugglingSpecies.has(k.split(':')[0]));
            historyKeys    = historyKeys.filter(k    => strugglingSpecies.has(k.split(':')[0]));
            strugglingKeys = strugglingKeys.filter(k => strugglingSpecies.has(k.split(':')[0]));
            // Non-struggling species are not added to banned: weights+level0Keys filtering already
            // prevents them from being chosen as question subjects, and keeping them in the pool
            // allows the backend to use them as distractors to fill out 4 answer options.
          }
        }
      } else {
        // Warm the region species cache in the background for non-adaptive modes
        getRegionSpecies(cfg.regionCode, back).catch(() => {/* non-fatal */});
      }

      const bannedAudioUrls = (await db.adminBlockedMedia.toArray())
        .filter(m => m.mediaType === 'audio')
        .map(m => m.url);

      // Resolve species filter for custom selection mode.
      let speciesFilter: string[] = [];
      {
        const prefs = await loadQuizPrefs();
        if (prefs.selectionMode === 'custom') {
          const selectedCodes    = new Set(prefs.selectedSpeciesCodes  ?? []);
          const selectedFamilies = new Set(prefs.selectedFamilies      ?? []);
          const selectedOrders   = new Set(prefs.selectedOrders        ?? []);
          if (selectedCodes.size > 0 || selectedFamilies.size > 0 || selectedOrders.size > 0) {
            const allRecords = await db.progress.toArray();
            const resolved = new Set<string>(selectedCodes);
            for (const r of allRecords) {
              if (selectedFamilies.size > 0 && r.familySciName && selectedFamilies.has(r.familySciName)) resolved.add(r.speciesCode);
              if (selectedOrders.size > 0   && r.order          && selectedOrders.has(r.order))           resolved.add(r.speciesCode);
            }
            speciesFilter = [...resolved];
          }
        }
      }

      const questions = await fetchQuizQuestions(
        cfg.regionCode,
        cfg.questionsPerRound,
        cfg.questionTypes,
        weights,
        cfg.groupId,
        masteryLevels,
        banned,
        paletteSpeciesCodes,
        cfg.recentDays ?? 30,
        paletteKeys,
        historyKeys,
        strugglingKeys,
        bannedAudioUrls,
        birderLevel,
        speciesFilter,
      );

      if (questions.length === 0) {
        setState(s => ({
          ...s, status: 'error',
          error: 'No questions could be generated for this combination of settings. Try a different region, bird group, or question type.',
        }));
        return;
      }
      setState({
        status: 'active',
        questions,
        currentIndex: 0,
        selectedAnswer: null,
        score: { correct: 0, total: 0 },
        error: null,
      });
    } catch (err: unknown) {
      const axiosData = (err as { response?: { data?: { detail?: string; ebirdResponse?: unknown } } })?.response?.data;
      const detail    = axiosData?.detail ?? 'Check your connection and region code.';
      const ebirdInfo = axiosData?.ebirdResponse ? ` (eBird: ${JSON.stringify(axiosData.ebirdResponse)})` : '';
      setState(s => ({ ...s, status: 'error', error: `Failed to load questions. ${detail}${ebirdInfo}` }));
    }
  }, [config]);

  const submitAnswer = useCallback(async (answer: string) => {
    // Capture question before setState to use in async logic below
    const q = state.questions[state.currentIndex];
    if (!q || state.status !== 'active') return;

    const correct = answer === q.correctAnswer;

    setState(s => ({
      ...s,
      status: 'answered',
      selectedAnswer: answer,
      score: {
        correct: s.score.correct + (correct ? 1 : 0),
        total: s.score.total + 1,
      },
    }));

    if (config.mode !== 'random') {
      if (q.noAudio) {
        const { levelUp, updatedMastery } = await graduateNoAudio(q.speciesCode, q.type, q.comName, q.familySciName);
        setRoundLevelUps(prev => [...prev, levelUp]);
        setCurrentMastery(updatedMastery);
      } else if (q.noPhoto) {
        const { levelUp, updatedMastery } = await graduateNoPhoto(q.speciesCode, q.type, q.comName, q.familySciName);
        setRoundLevelUps(prev => [...prev, levelUp]);
        setCurrentMastery(updatedMastery);
      } else {
        const { levelUp, noLongerStruggling, updatedMastery, advancedFromLevel0 } = await recordAnswer(q.speciesCode, q.type, correct, q.comName, birderLevelToInitialMastery(birderLevel), q.familySciName, q.familyComName, q.order, q.orderComName);
        if (levelUp) setRoundLevelUps(prev => [...prev, levelUp]);
        if (noLongerStruggling) setRoundNoLongerStruggling(prev => [...prev, noLongerStruggling]);
        setCurrentMastery(updatedMastery);
        if (advancedFromLevel0 && updatedMastery.incorrect === 0 && levelUp) {
          if (alwaysFastTrack) {
            await fastTrackToHard(q.speciesCode, q.type);
            setCurrentMastery(m => m ? { ...m, masteryLevel: 2, consecutiveCorrect: 2 } : m);
            setRoundLevelUps(prev => prev.map(e =>
              e.speciesCode === q.speciesCode && e.questionType === q.type && e.newLevel === 1
                ? { ...e, newLevel: 2 }
                : e,
            ));
          } else {
            setPendingFastTrack(levelUp);
          }
        }
      }
    }
  }, [state.questions, state.currentIndex, state.status, config]);

  const toggleFavourite = useCallback(async () => {
    if (!currentQuestion) return;
    const next = !currentFavourited;
    setCurrentFavourited(next);
    await setFavourite(currentQuestion.speciesCode, currentQuestion.type, next);
    // Mutually exclusive: turning on favourite clears excluded
    if (next && currentExcluded) {
      setCurrentExcluded(false);
      await setExcluded(currentQuestion.speciesCode, false);
    }
  }, [currentQuestion, currentFavourited, currentExcluded]);

  const toggleExcluded = useCallback(async () => {
    if (!currentQuestion) return;
    const next = !currentExcluded;
    setCurrentExcluded(next);
    await setExcluded(currentQuestion.speciesCode, next);
    // Mutually exclusive: turning on excluded clears favourite
    if (next && currentFavourited) {
      setCurrentFavourited(false);
      await setFavourite(currentQuestion.speciesCode, currentQuestion.type, false);
    }
  }, [currentQuestion, currentExcluded, currentFavourited]);

  const nextQuestion = useCallback(() => {
    setState(s => {
      const nextIndex = s.currentIndex + 1;
      if (nextIndex >= s.questions.length) return { ...s, status: 'complete' };
      return { ...s, status: 'active', currentIndex: nextIndex, selectedAnswer: null };
    });
  }, []);

  const confirmFastTrack = useCallback(async (accept: boolean) => {
    if (!pendingFastTrack) return;
    if (accept) {
      await fastTrackToHard(pendingFastTrack.speciesCode, pendingFastTrack.questionType);
      setCurrentMastery(m => m ? { ...m, masteryLevel: 2, consecutiveCorrect: 2 } : m);
      setRoundLevelUps(prev => prev.map(e =>
        e.speciesCode === pendingFastTrack.speciesCode &&
        e.questionType === pendingFastTrack.questionType &&
        e.newLevel === 1
          ? { ...e, newLevel: 2 }
          : e,
      ));
    }
    setPendingFastTrack(null);
  }, [pendingFastTrack]);

  const removeOptionalPhoto = useCallback(async (url: string) => {
    await db.blockedPhotos.put({ url });
    if (userId) uploadUserBlockedPhoto(userId, url).catch(() => {});
    setRevealPhotos(prev => ({ ...prev, optional: prev.optional.filter(u => u.url !== url) }));
  }, [userId]);

  return {
    state,
    currentQuestion,
    isCorrect,
    currentFavourited,
    currentExcluded,
    revealPhotos,
    revealRangeMapUrl,
    revealSightings,
    questionPhoto: questionPhoto !== null && questionPhoto.questionId === currentQuestion?.id ? questionPhoto.photo : null,
    questionPhotoFetching: questionPhoto?.questionId !== currentQuestion?.id && questionPhotoFetching,
    roundLevelUps,
    roundNoLongerStruggling,
    isFirstEncounter,
    currentMastery,
    pendingFastTrack,
    startQuiz,
    submitAnswer,
    toggleFavourite,
    toggleExcluded,
    nextQuestion,
    confirmFastTrack,
    removeOptionalPhoto,
  };
}
