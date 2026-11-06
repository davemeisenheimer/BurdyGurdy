import { useEffect, useRef } from 'react';
import { releaseAudioElement, restoreAudioSrc } from '../lib/audioElement';

/**
 * Releases an <audio> element's download when the component unmounts.
 *
 * React detaches refs before unmount cleanups run, and the element may mount after the component
 * does (conditional rendering), so the last element seen is remembered on every render.
 *
 * `src` is the element's rendered src. It is re-applied if missing, because StrictMode's fake
 * unmount releases an element that React then keeps. Call this before any effect that plays the
 * element, so the src is back before play() runs.
 */
export function useReleaseAudioOnUnmount(ref: React.RefObject<HTMLAudioElement | null>, src?: string): void {
  const lastAudioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (ref.current) lastAudioRef.current = ref.current;
    restoreAudioSrc(ref.current, src);
  });
  useEffect(() => () => releaseAudioElement(lastAudioRef.current), []);
}
