import { useEffect, useRef, useState } from 'react';

/** Persists resolved audio durations across mounts so the position indicator
 *  is available immediately on second and subsequent plays of the same URL. */
const durationCache = new Map<string, number>();

/**
 * Tracks playback progress [0–1] and resolved duration (seconds) for an audio element.
 * Falls back to seekable.end() and loop-back detection for VBR MP3s that report Infinity duration.
 * Caches the resolved duration by URL so subsequent plays start with a known duration.
 *
 * @param audioRef  Ref to the HTMLAudioElement being tracked.
 * @param resetKey  Reset progress/duration when this value changes (pass the audio URL or index).
 */
export function useAudioProgress(
  audioRef: React.RefObject<HTMLAudioElement | null>,
  resetKey: unknown,
): { progress: number; displayDuration: number | null } {
  const rafRef     = useRef(0);
  const maxTimeRef = useRef(0);
  const estDurRef  = useRef(0);
  const [progress,        setProgress]        = useState(0);
  const [displayDuration, setDisplayDuration] = useState<number | null>(
    () => typeof resetKey === 'string' ? (durationCache.get(resetKey) ?? null) : null,
  );

  useEffect(() => {
    const cached = typeof resetKey === 'string' ? (durationCache.get(resetKey) ?? null) : null;
    setProgress(0);
    setDisplayDuration(cached);
    maxTimeRef.current = 0;
    estDurRef.current  = 0;

    const tick = () => {
      const a = audioRef.current;
      if (a) {
        // Resolve best-known duration:
        //  1. Native a.duration (Infinity for VBR MP3s without XING header)
        //  2. seekable.end() — browser estimates from Content-Length + byte ranges
        //  3. estDurRef — learned via loop-back detection
        let dur = a.duration;
        if (!isFinite(dur) && a.seekable.length > 0) {
          dur = a.seekable.end(a.seekable.length - 1);
        }
        if (!isFinite(dur) && estDurRef.current > 0) {
          dur = estDurRef.current;
        }

        const ct = a.currentTime;

        // Loop-back detection: currentTime dropping below our running peak means
        // the track looped — record the peak as the estimated duration.
        if (ct < maxTimeRef.current - 1 && maxTimeRef.current > 1) {
          estDurRef.current  = maxTimeRef.current;
          dur                = estDurRef.current;
          maxTimeRef.current = ct;
        } else {
          maxTimeRef.current = Math.max(maxTimeRef.current, ct);
        }

        if (isFinite(dur) && dur > 0) {
          if (typeof resetKey === 'string') durationCache.set(resetKey, Math.round(dur));
          setProgress(ct / dur);
          setDisplayDuration(Math.round(dur));
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  // resetKey is the only dep that should restart the loop; audioRef is stable
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  return { progress, displayDuration };
}
