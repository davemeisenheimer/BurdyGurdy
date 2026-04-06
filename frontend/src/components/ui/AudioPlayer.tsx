import { useEffect, useRef, useState } from 'react';
import { DEV_LOG_AUDIO_ERRORS } from '../../lib/devFlags';

interface Track {
  audioUrl: string;
  sonoUrl?: string;
}

interface Props {
  url: string;
  tracks?: Track[];  // paired audio+sono fallbacks; first entry should match url/sonoUrl
  sonoUrl?: string;
  onAudioUnavailable?: () => void;
}

const toHttps = (u?: string) => {
  if (!u) return u;
  if (u.startsWith('//')) return `https:${u}`;
  if (u.startsWith('http://')) return `https://${u.slice(7)}`;
  return u;
};

export function AudioPlayer({ url, tracks, sonoUrl, onAudioUnavailable }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const [activeSonoUrl, setActiveSonoUrl] = useState<string | undefined>(toHttps(sonoUrl));
  const [sonoLoaded, setSonoLoaded] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  // Normalise: if tracks provided use them, otherwise wrap the single url/sonoUrl
  const allTracks: Track[] = (tracks && tracks.length > 0
    ? tracks
    : [{ audioUrl: url, sonoUrl }]
  ).map(t => ({ ...t, sonoUrl: toHttps(t.sonoUrl) }));

  const trackIndexRef = useRef(0);
  // Held in a ref so JavaScriptCore can't GC the Image before it fires onload.
  const preloadImgRef = useRef<HTMLImageElement | null>(null);

  // Preload the spectrogram image off-DOM so iOS Safari's display:none restriction
  // doesn't prevent naturalWidth from being reported.
  useEffect(() => {
    if (!activeSonoUrl) { setSonoLoaded(false); return; }
    setSonoLoaded(false);
    let cancelled = false;
    const img = new Image();
    preloadImgRef.current = img;
    img.onload = () => { if (!cancelled) setSonoLoaded(true); };
    img.onerror = () => {
      if (cancelled) return;
      if (DEV_LOG_AUDIO_ERRORS) console.warn(`[AudioPlayer] spectrogram failed to load: ${activeSonoUrl}`);
      setActiveSonoUrl(undefined);
    };
    img.src = activeSonoUrl;
    return () => { cancelled = true; preloadImgRef.current = null; };
  }, [activeSonoUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    trackIndexRef.current = 0;
    audio.src = allTracks[0].audioUrl;
    audio.load(); // resets iOS error state
    setActiveSonoUrl(allTracks[0].sonoUrl);
    setSonoLoaded(false);
    setAudioError(false);
    // Defer play by one tick so load() fully processes before play() is attempted.
    // Calling play() synchronously after load() on iOS can silently fail and
    // cascade into the next question's audio session.
    const playTimer = setTimeout(() => { audio.play().catch(() => {}); }, 0);
    return () => {
      clearTimeout(playTimer);
      audio.pause();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // When retryKey increments the <audio> element is remounted (new DOM node, cleared iOS
  // session state).  Wire it up here, after the ref is refreshed by React.
  useEffect(() => {
    if (retryKey === 0) return; // skip initial mount — the url effect handles that
    const audio = audioRef.current;
    if (!audio) return;
    trackIndexRef.current = 0;
    audio.src = allTracks[0].audioUrl;
    audio.load();
    const playTimer = setTimeout(() => { audio.play().catch(() => {}); }, 0);
    return () => { clearTimeout(playTimer); audio.pause(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey]);

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
      onAudioUnavailable?.();
    }
  };

  const handleRetry = () => {
    // Increment retryKey to unmount/remount the <audio> element, clearing any stuck
    // iOS audio session state.  The retryKey useEffect re-wires src + play after mount.
    setAudioError(false);
    setPlaying(false);
    setSonoLoaded(false);
    setActiveSonoUrl(allTracks[0].sonoUrl);
    setRetryKey(k => k + 1);
  };

  const toggle = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play().catch(() => { setAudioError(true); onAudioUnavailable?.(); });
    }
  };

  // Always render the audio element so the ref stays valid.
  // key={retryKey} forces a genuine DOM remount on retry, clearing stuck iOS session state.
  const audioEl = (
    <audio
      key={retryKey}
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

        {/* Pause pill while playing audio */}
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
    return (
      <>
        <div className="w-full h-20 rounded-xl bg-slate-100 flex flex-col items-center justify-center gap-1 text-slate-500">
          <span>Unable to fetch audio</span>
          {retryKey === 0 && (
            <button
              onClick={handleRetry}
              className="px-4 py-2 rounded-full border border-slate-300 text-slate-500 hover:bg-slate-50 active:bg-slate-100 text-sm transition-colors"
            >
              ↺ Retry audio
            </button>
          )}
        </div>
      </>
    );
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
