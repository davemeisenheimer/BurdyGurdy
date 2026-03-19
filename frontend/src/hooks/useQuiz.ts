import { useState, useCallback, useEffect } from 'react';

function weightedPick<T>(candidates: Array<{ item: T; weight: number }>): T | null {
  if (candidates.length === 0) return null;
  const total = candidates.reduce((s, c) => s + c.weight, 0);
  if (total === 0) return null;
  let r = Math.random() * total;
  for (const c of candidates) { r -= c.weight; if (r <= 0) return c.item; }
  return candidates[candidates.length - 1].item;
}
import type { QuizQuestion, QuizConfig, AttributedPhoto, LevelUpEvent } from '../types';
import { fetchQuizQuestions, fetchBirdPhotos, fetchBirdInfo, fetchRecentSightings, blockPhoto } from '../lib/api';
import type { RecentSighting } from '../lib/api';
import { db } from '../lib/db';
import {
  recordAnswer, setFavourite, getFavourited,
  setExcluded, getExcluded, getAdaptiveParams,
  maintainLevel0Palette, checkAndPromote,
} from '../lib/adaptive';
import { getRegionSpecies } from '../lib/regionCache';

export type QuizStatus = 'idle' | 'loading' | 'active' | 'answered' | 'complete' | 'error';

export interface QuizState {
  status: QuizStatus;
  questions: QuizQuestion[];
  currentIndex: number;
  selectedAnswer: string | null;
  score: { correct: number; total: number };
  error: string | null;
}

export function useQuiz(config: QuizConfig, randomizeQuestionPhotos = false) {
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
  const [roundLevelUps, setRoundLevelUps] = useState<LevelUpEvent[]>([]);
  const [isFirstEncounter, setIsFirstEncounter] = useState(false);
  const [currentMastery, setCurrentMastery] = useState<{ masteryLevel: number; consecutiveCorrect: number; inHistory: boolean; correct: number; incorrect: number } | null>(null);

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
      .then(record => setIsFirstEncounter(record?.lastAsked === 0))
      .catch(() => setIsFirstEncounter(false));
  }, [currentQuestion?.id, config.mode]);

  // Preload the next question's image during the reveal state to avoid a flash on Next
  useEffect(() => {
    if (state.status !== 'answered' || !nextQuestion_?.imageUrl) return;
    const img = new Image();
    img.src = nextQuestion_.imageUrl;
  }, [state.status, nextQuestion_?.imageUrl]);

  // Pre-fetch and lock in the question photo before the question becomes active.
  // During 'answered': pre-fetch for the NEXT question so the pick is ready when it transitions to 'active'.
  // During 'active': fallback fetch for the CURRENT question (covers the first question of each round).
  useEffect(() => {
    if (!randomizeQuestionPhotos) return;

    let targetQuestion = null;
    if (state.status === 'answered' && nextQuestion_) {
      targetQuestion = nextQuestion_;
    } else if (state.status === 'active' && currentQuestion && questionPhoto?.questionId !== currentQuestion.id) {
      targetQuestion = currentQuestion;
    }
    if (!targetQuestion) return;

    const q = targetQuestion;
    let cancelled = false;
    (async () => {
      try {
        const { primary, optional } = await fetchBirdPhotos(q.speciesCode, q.comName, q.sciName, true);
        if (cancelled) return;
        const [blocked, progressRecord] = await Promise.all([
          db.blockedPhotos.toArray(),
          db.progress.get([q.speciesCode, q.type]),
        ]);
        if (cancelled) return;
        const blockedSet = new Set(blocked.map(b => b.url));

        const inatPhoto     = primary                                                           && !blockedSet.has(primary.url)  ? primary     : null;
        const macaulayPhoto = optional.find(p => p.source === 'macaulay' && !blockedSet.has(p.url)) ?? null;
        const wikiPhotos    = optional.filter(p => p.source === 'wiki'   && !blockedSet.has(p.url));

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

        if (selected && !cancelled) {
          setQuestionPhoto({ questionId: q.id, photo: selected });
        }
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuestion?.id, nextQuestion_?.id, state.status, randomizeQuestionPhotos]);

  // Fetch reveal photos and range map when the question changes.
  // Intentionally depends only on question id — NOT state.status — so answering
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
      const blocked = await db.blockedPhotos.toArray();
      const blockedSet = new Set(blocked.map(b => b.url));
      setRevealPhotos({
        primary,
        optional: optional.filter(p => !blockedSet.has(p.url)),
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
    try {
      let weights = {};
      let masteryLevels = {};
      let banned: string[] = [];
      let paletteSpeciesCodes: string[] = [];
      let level0SpeciesCodes: string[] = [];
      let historyKeys: string[] = [];

      const back = cfg.recentDays ?? 30;
      if (cfg.mode === 'adaptive') {
        // Seed initial palette and warm cache first; both use the same regionCode
        await maintainLevel0Palette(cfg.regionCode, cfg.questionTypes, back);
        const params = await getAdaptiveParams();
        weights             = params.weights;
        masteryLevels       = params.masteryLevels;
        banned              = params.banned;
        paletteSpeciesCodes = params.paletteSpeciesCodes;
        level0SpeciesCodes  = params.level0SpeciesCodes;
        historyKeys         = params.historyKeys;
      } else {
        // Warm the region species cache in the background for non-adaptive modes
        getRegionSpecies(cfg.regionCode, back).catch(() => {/* non-fatal */});
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
        level0SpeciesCodes,
        historyKeys,
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

    const { advancedFromLevel0, levelUp, updatedMastery } = await recordAnswer(q.speciesCode, q.type, correct, q.comName);
    if (levelUp) setRoundLevelUps(prev => [...prev, levelUp]);
    setCurrentMastery(updatedMastery);
    if (advancedFromLevel0 && config.mode === 'adaptive') {
      checkAndPromote(config.regionCode, config.questionTypes, config.recentDays ?? 30).catch(() => {/* non-fatal */});
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

  const removeOptionalPhoto = useCallback(async (url: string) => {
    await db.blockedPhotos.put({ url });
    blockPhoto(url).catch(() => { /* non-fatal if token not set or server unreachable */ });
    setRevealPhotos(prev => ({ ...prev, optional: prev.optional.filter(u => u.url !== url) }));
  }, []);

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
    roundLevelUps,
    isFirstEncounter,
    currentMastery,
    startQuiz,
    submitAnswer,
    toggleFavourite,
    toggleExcluded,
    nextQuestion,
    removeOptionalPhoto,
  };
}
