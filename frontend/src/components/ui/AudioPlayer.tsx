import { useEffect, useRef, useState } from 'react';

interface Props {
  url: string;
  sonoUrl?: string;
}

export function AudioPlayer({ url, sonoUrl }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [audioError, setAudioError] = useState(false);

  // Auto-play on mount / new question; silently swallow rejection (browser autoplay policy)
  // so the spectrogram + play button still shows when autoplay is blocked.
  // Manage src imperatively so cleanup can safely release the resource via src='' + load()
  // without racing with React's prop update.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.src = url;
    setAudioError(false);
    audio.play().catch(() => { /* autoplay blocked — user can tap to start */ });
    return () => {
      audio.pause();
      audio.src = ''; // releases source reference; avoid load() here as it fires an async error event
    };
  }, [url]);

  const toggle = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play().catch(() => setAudioError(true));
    }
  };

  // Always render the audio element so the ref stays valid
  const audioEl = (
    <audio
      ref={audioRef}
      loop
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onError={() => setAudioError(true)}
    />
  );

  // ── Spectrogram layout ──────────────────────────────────────────────────
  if (sonoUrl) {
    return (
      <div
        className="relative w-full rounded-xl overflow-hidden bg-slate-900 cursor-pointer select-none"
        onClick={toggle}
      >
        {audioEl}
        <img
          src={sonoUrl}
          alt="Song spectrogram"
          className="w-full block"
          draggable={false}
        />

        {/* Overlay shown when not playing */}
        <div
          className={`absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity duration-200 ${
            playing ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
        >
          {audioError ? (
            <span className="text-white/80 text-sm bg-black/50 px-3 py-1 rounded-full">
              Audio unavailable
            </span>
          ) : (
            <div className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center text-2xl shadow-lg">
              ▶
            </div>
          )}
        </div>

        {/* Pause pill while playing */}
        {playing && (
          <button
            onClick={toggle}
            className="absolute bottom-2 right-2 flex items-center gap-1.5 bg-black/60 hover:bg-black/80 rounded-full px-3 py-1 transition-colors"
            aria-label="Pause"
          >
            <span className="text-white text-xs font-medium">⏸ pause</span>
          </button>
        )}
      </div>
    );
  }

  // ── Fallback: no spectrogram ────────────────────────────────────────────
  if (audioError) {
    return <p className="text-red-500 text-sm">Audio unavailable</p>;
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {audioEl}
      <button
        onClick={toggle}
        className="w-20 h-20 rounded-full bg-forest-600 hover:bg-forest-700 text-white flex items-center justify-center text-3xl shadow-lg transition-colors"
        aria-label={playing ? 'Pause bird song' : 'Play bird song'}
      >
        {playing ? '⏸' : '▶'}
      </button>
      <p className="text-sm text-slate-500">{playing ? 'Playing…' : 'Tap to play'}</p>
    </div>
  );
}
