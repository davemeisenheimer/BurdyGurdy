/** The parts of HTMLAudioElement that releaseAudioElement needs (keeps it testable without a DOM). */
export type ReleasableAudio = Pick<HTMLMediaElement, 'pause' | 'removeAttribute' | 'load'>;

/**
 * Stops playback AND drops the element's network connection.
 *
 * pause() alone keeps the media download open: Chrome parks a paused (or even detached) media
 * element's request indefinitely. Our proxied audio shares the app's origin, and browsers allow
 * only ~6 HTTP/1.1 connections per origin, so a few parked downloads stall every later /api
 * request ("Stalled" in DevTools). Removing src and calling load() aborts the download.
 */
export function releaseAudioElement(audio: ReleasableAudio | null | undefined): void {
  if (!audio) return;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}

export type RestorableAudio = Pick<HTMLMediaElement, 'getAttribute' | 'setAttribute'>;

/**
 * Puts back a src that releaseAudioElement removed while the element was still in use.
 *
 * React StrictMode (dev) runs a fake unmount right after mount, so an unmount-time release strips
 * src from an element React then keeps. React won't re-apply an unchanged src prop, leaving the
 * element silent. Leaves a non-empty src alone.
 */
export function restoreAudioSrc(audio: RestorableAudio | null | undefined, src: string | null | undefined): void {
  if (!audio || !src) return;
  if (!audio.getAttribute('src')) audio.setAttribute('src', src);
}
