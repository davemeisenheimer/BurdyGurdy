import { useState, useCallback, useEffect } from 'react';
import type { QuizQuestion, QuizConfig } from '../types';
import { fetchQuizQuestions, fetchBirdPhotos } from '../lib/api';
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
  const [revealPhotos, setRevealPhotos] = useState<{ primary: string | null; optional: string[] }>({ primary: null, optional: [] });
  const [questionPhotos, setQuestionPhotos] = useState<{ primary: string | null; optional: string[] } | null>(null);

  const currentQuestion = state.questions[state.currentIndex] ?? null;
  const isCorrect =
    state.selectedAnswer !== null &&
    state.selectedAnswer === currentQuestion?.correctAnswer;

  // Sync favourite + excluded status when current question changes (adaptive only)
  useEffect(() => {
    if (!currentQuestion || config.mode !== 'adaptive') {
      setCurrentFavourited(false);
      setCurrentExcluded(false);
      return;
    }
    getFavourited(currentQuestion.speciesCode, currentQuestion.type).then(setCurrentFavourited);
    getExcluded(currentQuestion.speciesCode, currentQuestion.type).then(setCurrentExcluded);
  }, [currentQuestion?.id, config.mode]);

  // Eagerly fetch photos during question state (for secondary photos in questions)
  useEffect(() => {
    if (!randomizeQuestionPhotos || !currentQuestion || state.status !== 'active') {
      setQuestionPhotos(null);
      return;
    }
    let cancelled = false;
    fetchBirdPhotos(currentQuestion.speciesCode, currentQuestion.comName, currentQuestion.sciName)
      .then(async ({ primary, optional }) => {
        if (cancelled) return;
        const blocked = await db.blockedPhotos.toArray();
        const blockedSet = new Set(blocked.map(b => b.url));
        setQuestionPhotos({
          primary,
          optional: optional.filter(url => !blockedSet.has(url)),
        });
      })
      .catch(() => { if (!cancelled) setQuestionPhotos(null); });
    return () => { cancelled = true; };
  }, [currentQuestion?.id, state.status, randomizeQuestionPhotos]);

  // Fetch reveal photos when an answer is submitted; filter out user-blocked URLs
  useEffect(() => {
    if (state.status !== 'answered' || !currentQuestion) {
      setRevealPhotos({ primary: null, optional: [] });
      return;
    }
    fetchBirdPhotos(currentQuestion.speciesCode, currentQuestion.comName, currentQuestion.sciName)
      .then(async ({ primary, optional }) => {
        const blocked = await db.blockedPhotos.toArray();
        const blockedSet = new Set(blocked.map(b => b.url));
        setRevealPhotos({
          primary,
          optional: optional.filter(url => !blockedSet.has(url)),
        });
      })
      .catch(() => setRevealPhotos({ primary: null, optional: [] }));
  }, [state.status, currentQuestion?.id]);

  const startQuiz = useCallback(async (overrideConfig?: QuizConfig) => {
    const cfg = overrideConfig ?? config;
    setState(s => ({ ...s, status: 'loading', error: null }));
    try {
      let weights = {};
      let masteryLevels = {};
      let banned: string[] = [];
      let paletteSpeciesCodes: string[] = [];

      if (cfg.mode === 'adaptive') {
        // Seed initial palette and warm cache first; both use the same regionCode
        await maintainLevel0Palette(cfg.regionCode, cfg.questionTypes);
        const params = await getAdaptiveParams();
        weights             = params.weights;
        masteryLevels       = params.masteryLevels;
        banned              = params.banned;
        paletteSpeciesCodes = params.paletteSpeciesCodes;
      } else {
        // Warm the region species cache in the background for non-adaptive modes
        getRegionSpecies(cfg.regionCode).catch(() => {/* non-fatal */});
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

    const advancedFromLevel0 = await recordAnswer(q.speciesCode, q.type, correct, q.comName);
    if (advancedFromLevel0 && config.mode === 'adaptive') {
      checkAndPromote(config.regionCode, config.questionTypes).catch(() => {/* non-fatal */});
    }
  }, [state.questions, state.currentIndex, state.status, config]);

  const toggleFavourite = useCallback(async () => {
    if (!currentQuestion) return;
    const next = !currentFavourited;
    setCurrentFavourited(next);
    await setFavourite(currentQuestion.speciesCode, currentQuestion.type, next);
  }, [currentQuestion, currentFavourited]);

  const toggleExcluded = useCallback(async () => {
    if (!currentQuestion) return;
    const next = !currentExcluded;
    setCurrentExcluded(next);
    await setExcluded(currentQuestion.speciesCode, next);
  }, [currentQuestion, currentExcluded]);

  const nextQuestion = useCallback(() => {
    setState(s => {
      const nextIndex = s.currentIndex + 1;
      if (nextIndex >= s.questions.length) return { ...s, status: 'complete' };
      return { ...s, status: 'active', currentIndex: nextIndex, selectedAnswer: null };
    });
  }, []);

  const removeOptionalPhoto = useCallback(async (url: string) => {
    await db.blockedPhotos.put({ url });
    setRevealPhotos(prev => ({ ...prev, optional: prev.optional.filter(u => u !== url) }));
  }, []);

  return {
    state,
    currentQuestion,
    isCorrect,
    currentFavourited,
    currentExcluded,
    revealPhotos,
    questionPhotos,
    startQuiz,
    submitAnswer,
    toggleFavourite,
    toggleExcluded,
    nextQuestion,
    removeOptionalPhoto,
  };
}
