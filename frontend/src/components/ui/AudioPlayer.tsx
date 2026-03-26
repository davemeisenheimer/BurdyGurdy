import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DEV_LOG_AUDIO_ERRORS } from '../../lib/devFlags';

interface Track {
  audioUrl: string;
  sonoUrl?: string;
}

interface Props {
  url: string;
  tracks?: Track[];  // paired audio+sono fallbacks; first entry should match url/sonoUrl
  sonoUrl?: string;
}

const toHttps = (u?: string) => u?.startsWith('//') ? `https:${u}` : u;

export function AudioPlayer({ url, tracks, sonoUrl }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const [activeSonoUrl, setActiveSonoUrl] = useState<string | undefined>(toHttps(sonoUrl));
  const [sonoLoaded, setSonoLoaded] = useState(false);
  const preloadImgRef = useRef<HTMLImageElement>(null);

  // Normalise: if tracks provided use them, otherwise wrap the single url/sonoUrl
  const allTracks: Track[] = (tracks && tracks.length > 0
    ? tracks
    : [{ audioUrl: url, sonoUrl }]
  ).map(t => ({ ...t, sonoUrl: toHttps(t.sonoUrl) }));

  const trackIndexRef = useRef(0);

  useEffect(() => { setSonoLoaded(false); }, [activeSonoUrl]);

  // If the image was already in the browser cache when the preload img mounted,
  // onLoad fires before React can attach the handler and sonoLoaded stays false.
  // This layout effect catches that: it runs synchronously after every render and
  // sets sonoLoaded=true whenever the img is already complete.
  useLayoutEffect(() => {
    if (!sonoLoaded && preloadImgRef.current?.complete && preloadImgRef.current.naturalWidth > 0) {
      setSonoLoaded(true);
    }
  });

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    trackIndexRef.current = 0;
    audio.src = allTracks[0].audioUrl;
    setActiveSonoUrl(allTracks[0].sonoUrl);
    setSonoLoaded(false);
    setAudioError(false);
    audio.play().catch(() => { /* autoplay blocked — user can tap to start */ });
    return () => {
      audio.pause();
      audio.src = '';
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const handleError = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const failedUrl = allTracks[trackIndexRef.current]?.audioUrl;
    if (DEV_LOG_AUDIO_ERRORS) {
      console.warn(`[AudioPlayer] track failed: ${failedUrl}`);
    }
    const nextIndex = trackIndexRef.current + 1;
    if (nextIndex < allTracks.length) {
      trackIndexRef.current = nextIndex;
      const next = allTracks[nextIndex];
      audio.src = next.audioUrl;
      setActiveSonoUrl(next.sonoUrl);
      audio.play().catch(() => {});
    } else {
      if (DEV_LOG_AUDIO_ERRORS) {
        console.warn(`[AudioPlayer] all ${allTracks.length} track(s) failed for question — showing "Audio unavailable"`, allTracks.map(t => t.audioUrl));
      }
      setAudioError(true);
    }
  };

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
      onError={handleError}
    />
  );

  // ── Spectrogram layout — only shown once the image has loaded ───────────
  if (activeSonoUrl && sonoLoaded) {
    return (
      <div
        className="relative w-full min-h-[80px] rounded-xl overflow-hidden bg-slate-900 cursor-pointer select-none"
        onClick={toggle}
      >
        {audioEl}
        <img
          src={activeSonoUrl}
          alt="Song spectrogram"
          className="w-full block"
          draggable={false}
          onError={() => {
            if (DEV_LOG_AUDIO_ERRORS) console.warn(`[AudioPlayer] spectrogram failed to load: ${activeSonoUrl}`);
            setActiveSonoUrl(undefined);
          }}
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

  // ── Fallback: no spectrogram (or still loading) ─────────────────────────
  if (audioError) {
    return <p className="text-red-500 text-sm">Audio unavailable</p>;
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {audioEl}
      {/* Preload spectrogram silently; switches layout to spectrogram once loaded */}
      {activeSonoUrl && (
        <img
          ref={preloadImgRef}
          src={activeSonoUrl}
          alt=""
          className="hidden"
          onLoad={() => setSonoLoaded(true)}
          onError={() => {
            if (DEV_LOG_AUDIO_ERRORS) console.warn(`[AudioPlayer] spectrogram failed to load: ${activeSonoUrl}`);
            setActiveSonoUrl(undefined);
          }}
        />
      )}
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
