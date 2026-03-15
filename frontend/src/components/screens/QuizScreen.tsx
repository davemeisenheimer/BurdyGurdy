import { useEffect, useRef, useState } from 'react';
import type { QuizQuestion } from '../../types';
import { AudioPlayer } from '../ui/AudioPlayer';
import { AnswerOption } from '../ui/AnswerOption';
import { ProgressBar } from '../ui/ProgressBar';

interface Props {
  question: QuizQuestion;
  selectedAnswer: string | null;
  isCorrect: boolean;
  currentIndex: number;
  totalQuestions: number;
  score: { correct: number; total: number };
  isAdaptive: boolean;
  isFavourited: boolean;
  isExcluded: boolean;
  revealPhotos: { primary: string | null; optional: string[] };
  questionPhotos: { primary: string | null; optional: string[] } | null;
  showMediaInCarousel?: boolean;
  autoplayRevealAudio?: boolean;
  onRemoveOptionalPhoto: (url: string) => void;
  onAnswer: (answer: string) => void;
  onToggleFavourite: () => void;
  onToggleExcluded: () => void;
  onNext: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  song: 'Song / Call',
  latin: 'Latin Name',
  family: 'Bird Family',
  image: 'Photo',
  order: 'Bird Order',
  sono: 'Spectrogram',
  'image-latin': 'Photo → Latin',
  'song-latin': 'Song → Latin',
  'family-latin': 'Family → Latin',
  'image-song': 'Photo → Song',
  'sono-song': 'Spectrogram → Song',
  'latin-song': 'Latin → Song',
};

const PROMPTS: Record<string, string> = {
  song: 'Which bird is singing?',
  latin: 'Match the Latin name to a common name:',
  family: 'What bird family does this belong to?',
  image: 'Which bird is this?',
  order: 'What bird belongs to this order?',
  sono: 'Which bird made this sound?',
  'image-latin': 'What is the Latin name for this bird?',
  'song-latin': 'What is the Latin name of this singing bird?',
  'family-latin': 'What is the Latin name for a bird in this family?',
  'image-song': 'Which sound belongs to this bird?',
  'sono-song': 'Which call matches this spectrogram?',
  'latin-song': 'Which bird song belongs to this species?',
};

function getStimulusType(type: string): 'image' | 'song' | 'sono' | 'latin' | 'family' | 'order' {
  if (['image', 'image-latin', 'image-song'].includes(type)) return 'image';
  if (['song', 'song-latin'].includes(type)) return 'song';
  if (['sono', 'sono-song'].includes(type)) return 'sono';
  if (['latin', 'latin-song'].includes(type)) return 'latin';
  if (['family', 'family-latin'].includes(type)) return 'family';
  return 'order';
}

export function QuizScreen({
  question,
  selectedAnswer,
  isCorrect,
  currentIndex,
  totalQuestions,
  score,
  isAdaptive,
  isFavourited,
  isExcluded,
  revealPhotos,
  questionPhotos,
  showMediaInCarousel = true,
  autoplayRevealAudio = true,
  onRemoveOptionalPhoto,
  onAnswer,
  onToggleFavourite,
  onToggleExcluded,
  onNext,
}: Props) {
  const answered = selectedAnswer !== null;
  const stimType = getStimulusType(question.type);
  const isSongAnswer = (question.type as string).endsWith('-song');

  // Flat list for reveal carousel: primary first, then optional (dismissable), then spectrogram last
  const allRevealPhotos = [
    ...(revealPhotos.primary ? [{ url: revealPhotos.primary, isOptional: false, isSono: false }] : []),
    ...revealPhotos.optional.map(url => ({ url, isOptional: true, isSono: false })),
    ...(question.sonoUrl && showMediaInCarousel ? [{ url: question.sonoUrl, isOptional: false, isSono: true }] : []),
  ];

  // Randomly-selected photo for image questions (randomizeQuestionPhotos: picks from all available)
  const [questionDisplayPhoto, setQuestionDisplayPhoto] = useState<string | null>(question.imageUrl ?? null);
  useEffect(() => { setQuestionDisplayPhoto(question.imageUrl ?? null); }, [question.id]);
  useEffect(() => {
    if (!questionPhotos) return;
    const pool = [question.imageUrl, ...questionPhotos.optional].filter((u): u is string => !!u);
    if (pool.length > 1) setQuestionDisplayPhoto(pool[Math.floor(Math.random() * pool.length)]);
  }, [question.id, questionPhotos]);

  const [photoIdx, setPhotoIdx] = useState(0);
  useEffect(() => { setPhotoIdx(0); }, [question.id]);

  // Reveal-state audio
  const revealAudioRef = useRef<HTMLAudioElement>(null);
  const [revealPlaying, setRevealPlaying] = useState(false);
  useEffect(() => {
    revealAudioRef.current?.pause();
    setRevealPlaying(false);
  }, [question.id]);
  const toggleRevealAudio = () => {
    const audio = revealAudioRef.current;
    if (!audio) return;
    revealPlaying ? audio.pause() : audio.play().catch(() => {});
  };

  // Option audio (song-answer types)
  const optionAudioRef = useRef<HTMLAudioElement>(null);
  const [playingOptionUrl, setPlayingOptionUrl] = useState<string | null>(null);
  useEffect(() => {
    optionAudioRef.current?.pause();
    setPlayingOptionUrl(null);
  }, [question.id]);
  useEffect(() => {
    if (answered) {
      optionAudioRef.current?.pause();
      setPlayingOptionUrl(null);
    }
  }, [answered]);
  const handleOptionPlayToggle = (url: string) => {
    const audio = optionAudioRef.current;
    if (!audio) return;
    if (playingOptionUrl === url) {
      audio.pause();
      setPlayingOptionUrl(null);
    } else {
      audio.src = url;
      audio.play().catch(() => {});
      setPlayingOptionUrl(url);
    }
  };

  const currentRevealPhoto = allRevealPhotos[photoIdx] ?? null;

  const getOptionStatus = (option: string) => {
    if (!answered) return 'default';
    if (option === question.correctAnswer) return 'correct';
    if (option === selectedAnswer) return 'incorrect';
    return 'disabled';
  };

  return (
    <div className="flex flex-col h-dvh max-w-lg mx-auto w-full px-4 py-4 gap-3">

      {/* Hidden audio element for option playback */}
      {isSongAnswer && (
        <audio
          ref={optionAudioRef}
          onEnded={() => setPlayingOptionUrl(null)}
        />
      )}

      {/* Progress bar — fixed, never moves */}
      <div className="shrink-0 flex items-center gap-3">
        <ProgressBar current={currentIndex + 1} total={totalQuestions} />
        <span className="text-sm font-semibold text-slate-500 whitespace-nowrap">
          {score.correct}/{score.total}
        </span>
      </div>

      {/* Question / Reveal zone — fills all remaining space, content swaps on answer */}
      <div className="flex-1 min-h-0 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">

        {!answered ? (
          /* ── QUESTION STATE ── */
          stimType === 'image' ? (
            /* Photo question: single randomly-selected photo */
            <div className="relative h-full bg-slate-900 flex items-center justify-center">
              {questionDisplayPhoto && (
                <img
                  src={questionDisplayPhoto}
                  alt="Mystery bird"
                  className="max-h-full max-w-full object-contain"
                />
              )}
              <div className="absolute inset-x-0 bottom-0 px-5 py-4 bg-gradient-to-t from-black/70 to-transparent">
                <p className="text-xs uppercase tracking-wider text-white/70 font-semibold">{TYPE_LABELS[question.type]}</p>
                <h2 className="text-xl font-semibold text-white">{PROMPTS[question.type]}</h2>
              </div>
            </div>
          ) : stimType === 'sono' ? (
            /* Spectrogram question */
            <div className="relative h-full bg-slate-900 flex items-center justify-center">
              <img
                src={question.sonoUrl}
                alt="Song spectrogram"
                className="w-full object-contain"
              />
              <div className="absolute inset-x-0 bottom-0 px-5 py-4 bg-gradient-to-t from-black/70 to-transparent">
                <p className="text-xs uppercase tracking-wider text-white/70 font-semibold">{TYPE_LABELS[question.type]}</p>
                <h2 className="text-xl font-semibold text-white">{PROMPTS[question.type]}</h2>
              </div>
            </div>
          ) : (
            /* Text/audio stimulus */
            <div className="h-full flex flex-col px-5 pt-5 pb-4">
              <p className="shrink-0 text-xs uppercase tracking-wider text-slate-400 font-semibold mb-1">
                {TYPE_LABELS[question.type]}
              </p>
              <h2 className="shrink-0 text-xl font-semibold text-slate-800 mb-4">
                {PROMPTS[question.type]}
              </h2>
              <div className="flex-1 min-h-0 flex items-center justify-center px-5 pb-4">
                {stimType === 'song' && question.audioUrl && (
                  <AudioPlayer url={question.audioUrl} sonoUrl={question.sonoUrl} />
                )}
                {stimType === 'latin' && (
                  <span className="text-2xl italic text-slate-700 text-center px-2">
                    {question.sciName}
                  </span>
                )}
                {stimType === 'family' && (
                  <span className="text-xl text-slate-700 text-center px-2">
                    {question.familyComName}
                  </span>
                )}
                {stimType === 'order' && (
                  <span className="text-xl text-slate-700 text-center px-2">
                    {question.order}
                  </span>
                )}
              </div>
            </div>
          )
        ) : (
          /* ── REVEAL STATE ── */
          <div className="h-full flex flex-col">

            {/* Audio — mounts on reveal, autoPlays the bird song */}
            {showMediaInCarousel && question.audioUrl && (
              <audio
                ref={revealAudioRef}
                src={question.audioUrl}
                loop
                autoPlay={autoplayRevealAudio}
                onPlay={() => setRevealPlaying(true)}
                onPause={() => setRevealPlaying(false)}
              />
            )}

            {/* Status strip */}
            <div className={`shrink-0 px-5 py-3 border-b ${isCorrect ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
              <p className={`font-semibold ${isCorrect ? 'text-green-700' : 'text-red-700'}`}>
                {isCorrect ? '✓ Correct!' : `✗ The answer was ${question.correctAnswer}`}
              </p>
            </div>

            {/* Photo/spectrogram carousel */}
            {currentRevealPhoto && (
              <div className="flex-1 min-h-0 relative flex items-center justify-center bg-slate-900 overflow-hidden">
                <img
                  src={currentRevealPhoto.url}
                  alt={currentRevealPhoto.isSono ? 'Song spectrogram' : question.comName}
                  className={currentRevealPhoto.isSono ? 'w-full object-contain' : 'max-h-full max-w-full object-contain'}
                  onError={e => { (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }}
                />
                {/* Spectrogram label — top-right (sono slides are never dismissable, so no conflict with ✕) */}
                {currentRevealPhoto.isSono && (
                  <span className="absolute top-2 right-2 bg-black/60 text-white text-xs font-semibold px-2 py-0.5 rounded-full">
                    Spectrogram
                  </span>
                )}
                {/* Play/pause button for song audio */}
                {showMediaInCarousel && question.audioUrl && (
                  <button
                    onClick={toggleRevealAudio}
                    className="absolute top-2 left-2 bg-black/60 hover:bg-black/80 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm leading-none"
                    aria-label={revealPlaying ? 'Pause' : 'Play bird song'}
                  >{revealPlaying ? '⏸' : '▶'}</button>
                )}
                {/* Dismiss button for optional (observation) photos */}
                {currentRevealPhoto.isOptional && (
                  <button
                    onClick={() => {
                      onRemoveOptionalPhoto(currentRevealPhoto.url);
                      setPhotoIdx(i => Math.max(0, i - 1));
                    }}
                    className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white rounded-full w-7 h-7 flex items-center justify-center text-sm leading-none"
                    aria-label="Remove this photo"
                  >✕</button>
                )}
                {allRevealPhotos.length > 1 && (
                  <>
                    <button
                      onClick={() => setPhotoIdx(i => (i - 1 + allRevealPhotos.length) % allRevealPhotos.length)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full w-8 h-8 flex items-center justify-center text-lg leading-none"
                      aria-label="Previous photo"
                    >‹</button>
                    <button
                      onClick={() => setPhotoIdx(i => (i + 1) % allRevealPhotos.length)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full w-8 h-8 flex items-center justify-center text-lg leading-none"
                      aria-label="Next photo"
                    >›</button>
                    <span className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/50 text-white text-xs px-2 py-0.5 rounded-full">
                      {photoIdx + 1} / {allRevealPhotos.length}
                    </span>
                  </>
                )}
              </div>
            )}

            {/* Bird details — fixed height below photo */}
            <div className="shrink-0 px-4 py-3 border-t border-slate-100">
              <p className="font-semibold text-slate-800 leading-tight">{question.comName}</p>
              <p className="text-sm text-slate-500 mt-0.5">
                <span className="italic">{question.sciName}</span> · {question.familyComName}
              </p>
              <div className="flex items-center justify-between mt-2">
                <a
                  href={`https://ebird.org/species/${question.speciesCode}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-sky-600 hover:underline"
                >
                  View on eBird →
                </a>
                {isAdaptive && (
                  <div className="flex flex-col items-end gap-1">
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={isFavourited}
                        onChange={onToggleFavourite}
                        className="w-4 h-4 accent-amber-500 cursor-pointer"
                      />
                      <span className="text-sm font-medium text-slate-600">
                        {isFavourited ? '★ Ask more often' : '☆ Ask more often'}
                      </span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={isExcluded}
                        onChange={onToggleExcluded}
                        className="w-4 h-4 accent-red-500 cursor-pointer"
                      />
                      <span className="text-sm font-medium text-slate-500">
                        Don't show again
                      </span>
                    </label>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Answer options — fixed position, never move */}
      <div className="shrink-0 space-y-2">
        {question.options.map((opt, idx) => {
          const audioUrl = isSongAnswer ? (question.optionAudioUrls?.[idx] ?? undefined) : undefined;
          return (
            <AnswerOption
              key={opt}
              label={opt}
              status={getOptionStatus(opt)}
              onClick={() => onAnswer(opt)}
              audioUrl={audioUrl}
              isPlaying={!!audioUrl && playingOptionUrl === audioUrl}
              onPlayToggle={audioUrl ? () => handleOptionPlayToggle(audioUrl) : undefined}
              hideLabel={isSongAnswer && !answered}
            />
          );
        })}
      </div>

      {/* Next button — always occupies space; invisible until answered to prevent layout shift */}
      <button
        onClick={answered ? onNext : undefined}
        className={`shrink-0 w-full py-3 rounded-xl bg-forest-600 text-white font-semibold text-lg transition-all ${
          answered ? 'opacity-100 hover:bg-forest-700 cursor-pointer' : 'opacity-0 pointer-events-none'
        }`}
      >
        {currentIndex + 1 >= totalQuestions ? 'See Results' : 'Next Question'}
      </button>
    </div>
  );
}
