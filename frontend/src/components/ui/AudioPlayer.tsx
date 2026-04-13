import { useEffect, useRef, useState } from 'react';
import { DEV_LOG_AUDIO_ERRORS } from '../../lib/devFlags';
import { SpectrogramPlayer } from './SpectrogramPlayer';
import { toProxyUrl } from '../../lib/audioProxy';

interface Track {
  audioUrl: string;
  sonoUrl?: string; // kept for type compatibility with QuizQuestion.audioTracks; unused here
}

interface Props {
  url: string;
  tracks?: Track[];
  onAudioUnavailable?: () => void;
  durationSeconds?: number;
}

export function AudioPlayer({ url, tracks, onAudioUnavailable, durationSeconds }: Props) {
  const audioRef      = useRef<HTMLAudioElement>(null);
  const trackIndexRef = useRef(0);

  const [playing,        setPlaying]        = useState(false);
  const [audioError,     setAudioError]     = useState(false);
  const [retryKey,       setRetryKey]       = useState(0);
  const [activeAudioUrl, setActiveAudioUrl] = useState(url);

  const allTracks: Track[] = tracks && tracks.length > 0 ? tracks : [{ audioUrl: url }];

  // Wire up audio when the question URL changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    trackIndexRef.current = 0;
    audio.src = toProxyUrl(allTracks[0].audioUrl);
    audio.load();
    setActiveAudioUrl(allTracks[0].audioUrl);
    setAudioError(false);
    const playTimer = setTimeout(() => { audio.play().catch(() => {}); }, 0);
    return () => { clearTimeout(playTimer); audio.pause(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Remount audio element on retry (clears stuck iOS session state)
  useEffect(() => {
    if (retryKey === 0) return;
    const audio = audioRef.current;
    if (!audio) return;
    trackIndexRef.current = 0;
    audio.src = toProxyUrl(allTracks[0].audioUrl);
    audio.load();
    setActiveAudioUrl(allTracks[0].audioUrl);
    const playTimer = setTimeout(() => { audio.play().catch(() => {}); }, 0);
    return () => { clearTimeout(playTimer); audio.pause(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey]);

  const handleError = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const failedUrl = allTracks[trackIndexRef.current]?.audioUrl;
    console.warn(`[AudioPlayer] track failed (retryKey=${retryKey}): ${failedUrl}`, audio.error);
    if (DEV_LOG_AUDIO_ERRORS) console.warn(`[AudioPlayer] track failed: ${failedUrl}`);
    const nextIndex = trackIndexRef.current + 1;
    if (nextIndex < allTracks.length) {
      trackIndexRef.current = nextIndex;
      const next = allTracks[nextIndex];
      audio.src = toProxyUrl(next.audioUrl);
      setActiveAudioUrl(next.audioUrl);
      audio.play().catch(() => {});
    } else {
      console.warn(`[AudioPlayer] all ${allTracks.length} track(s) failed`, allTracks.map(t => t.audioUrl));
      if (DEV_LOG_AUDIO_ERRORS) console.warn(`[AudioPlayer] all tracks failed`, allTracks.map(t => t.audioUrl));
      setAudioError(true);
      onAudioUnavailable?.();
    }
  };

  const handleRetry = () => {
    console.warn(`[AudioPlayer] retry #${retryKey + 1}`, allTracks.map(t => t.audioUrl));
    setAudioError(false);
    setPlaying(false);
    setRetryKey(k => k + 1);
  };

  const toggle = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play().catch(err => {
        console.warn('[AudioPlayer] play() rejected:', err);
        setAudioError(true);
        onAudioUnavailable?.();
      });
    }
  };

  return (
    <div className="w-full bg-slate-900 rounded-xl overflow-hidden select-none">
      {/* Audio element — src set imperatively; SpectrogramPlayer reads it via audioRef */}
      <audio
        key={retryKey}
        ref={audioRef}
        loop
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={handleError}
      />

      {/* Controls bar above spectrogram */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800">
        {durationSeconds !== undefined ? (
          <span className="bg-slate-700/80 text-white/70 text-xs px-3 py-1 rounded-full">
            Duration: {Math.round(durationSeconds)} seconds
          </span>
        ) : <span />}
        {playing && (
          <button
            onClick={toggle}
            className="flex items-center gap-1.5 bg-black/60 hover:bg-black/80 active:bg-black/90 rounded-full px-3 py-1 transition-colors"
            aria-label="Pause"
          >
            <span className="text-white text-xs font-medium">⏸ pause</span>
          </button>
        )}
      </div>

      {/* Spectrogram + position indicator */}
      <div className="relative cursor-pointer" onClick={toggle}>
        <div className="h-[140px] sm:h-[160px] flex flex-col">
          <SpectrogramPlayer
            audioUrl={activeAudioUrl}
            fillHeight
            className="flex-1"
            audioRef={audioRef}
            playing={playing}
            hideButton
          />
        </div>

        {/* AudioPlayer overlay — covers the spectrogram area */}
        <div className="absolute top-0 inset-x-0 h-[140px] sm:h-[160px]">
          <div
            className={`absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity duration-200 ${
              playing ? 'opacity-0 pointer-events-none' : 'opacity-100'
            }`}
          >
            {audioError ? (
              <div className="flex flex-col items-center gap-2" onClick={e => e.stopPropagation()}>
                <p className="text-white/80 text-sm">Unable to fetch audio</p>
                {retryKey === 0 && (
                  <button
                    onClick={handleRetry}
                    className="text-white/90 text-sm bg-black/60 hover:bg-black/80 active:bg-black/90 px-4 py-2 rounded-full transition-colors"
                  >
                    ↺ Retry audio
                  </button>
                )}
              </div>
            ) : (
              <div className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center text-2xl shadow-lg">
                ▶
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
