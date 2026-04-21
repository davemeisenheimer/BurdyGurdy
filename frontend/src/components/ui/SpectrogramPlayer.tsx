import { useEffect, useRef, useState, useCallback } from 'react';
import { SpectrogramCanvas } from './SpectrogramCanvas';
import { useAudioProgress } from '../../hooks/useAudioProgress';
import { toProxyUrl } from '../../lib/audioProxy';

interface Props {
  audioUrl?: string;
  height?: number;
  /** Let CSS control the canvas height (e.g. inside a flex-1 container). */
  fillHeight?: boolean;
  className?: string;
  /** Known duration in seconds — shown immediately before the hook resolves it. */
  durationHint?: number;
  /** Suppress the built-in play/pause pill (callers that provide their own controls). */
  hideButton?: boolean;

  // ── Controlled mode ───────────────────────────────────────────────────────
  // Provide audioRef (+ playing + onToggle) to take over audio management.
  // SpectrogramPlayer will only handle the visual: canvas, position line,
  // duration pill, and (optionally) the play/pause pill.
  audioRef?: React.RefObject<HTMLAudioElement | null>;
  playing?: boolean;
  onToggle?: (e: React.MouseEvent) => void;
}

// Maximum time to wait for spectrogram generation before auto-playing anyway.
const AUTOPLAY_TIMEOUT_MS = 6_000;

export function SpectrogramPlayer({
  audioUrl, height = 140, fillHeight = false, className,
  durationHint, hideButton = false,
  audioRef: externalRef, playing: externalPlaying, onToggle: externalToggle,
}: Props) {
  const isControlled = externalRef !== undefined;

  // Own audio ref + play state (uncontrolled mode only)
  const internalRef     = useRef<HTMLAudioElement>(null);
  const [internalPlaying, setInternalPlaying] = useState(false);

  const effectiveRef     = isControlled ? externalRef : internalRef;
  const effectivePlaying = isControlled ? (externalPlaying ?? false) : internalPlaying;
  const effectiveToggle  = isControlled
    ? (externalToggle ?? (() => {}))
    : (e: React.MouseEvent) => {
        e.stopPropagation();
        const audio = internalRef.current;
        if (!audio) return;
        if (internalPlaying) audio.pause();
        else audio.play().catch(() => {});
      };

  const { progress, displayDuration } = useAudioProgress(effectiveRef, audioUrl);

  const [zoomWindow, setZoomWindow] = useState<[number, number]>([0, 1]);
  const onZoomChange = useCallback((w: [number, number]) => setZoomWindow(w), []);

  // Reset zoom window tracking when the audio changes
  useEffect(() => { setZoomWindow([0, 1]); }, [audioUrl]);

  // Uncontrolled: autoplay after spectrogram renders, with a fallback timeout
  const startAudio = () => { internalRef.current?.play().catch(() => {}); };

  useEffect(() => {
    if (isControlled) return;
    const fallback = setTimeout(startAudio, AUTOPLAY_TIMEOUT_MS);
    return () => {
      clearTimeout(fallback);
      internalRef.current?.pause();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl, isControlled]);

  // Prefer the known hint until the hook resolves the actual duration
  const shownDuration = durationHint !== undefined ? Math.round(durationHint) : displayDuration;

  return (
    <div className={`${fillHeight ? 'flex flex-col' : ''} ${className ?? ''}`}>

      {/* Own audio element — uncontrolled mode only */}
      {!isControlled && audioUrl && (
        <audio
          ref={internalRef}
          src={toProxyUrl(audioUrl)}
          loop
          onPlay={() => setInternalPlaying(true)}
          onPause={() => setInternalPlaying(false)}
        />
      )}

      {/* Canvas area */}
      <div
        className={`relative overflow-hidden ${fillHeight ? 'flex-1 min-h-0' : ''}`}
        style={!fillHeight ? { height } : undefined}
      >
        <SpectrogramCanvas
          audioUrl={audioUrl}
          className="w-full h-full"
          onReady={isControlled ? undefined : startAudio}
          onZoomChange={onZoomChange}
        />

        {/* Playback position line — adjusted for zoom window */}
        {(() => {
          const [zStart, zEnd] = zoomWindow;
          const adj = (progress - zStart) / (zEnd - zStart);
          if (adj < 0 || adj > 1) return null;
          return (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-cyan-400 pointer-events-none"
              style={{ left: `calc(${adj * 100}% - 1px)` }}
            />
          );
        })()}

        {/* Duration pill */}
        {shownDuration !== null && (
          <span className="absolute top-2 right-2 bg-slate-700/80 text-white/70 text-xs px-3 py-1 rounded-full">
            Duration: {shownDuration} seconds
          </span>
        )}

        {/* Built-in play/pause pill */}
        {!hideButton && (
          <button
            onClick={effectiveToggle}
            className="absolute bottom-2 right-2 flex items-center gap-1.5 bg-black/60 hover:bg-black/80 active:bg-black/90 rounded-full px-3 py-1 transition-colors"
            aria-label={effectivePlaying ? 'Pause' : 'Play'}
          >
            <span className="text-white text-xs font-medium">
              {effectivePlaying ? '⏸ pause' : '▶ play'}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
