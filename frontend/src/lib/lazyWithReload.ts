import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';

/**
 * Wraps React.lazy with a one-shot reload on dynamic-import failure.
 *
 * After a new deployment the service worker (autoUpdate / skipWaiting) takes
 * over immediately.  Its precache only knows the new chunk hashes, so any
 * lazy chunk referenced by the still-running old page will 404/return the SPA
 * fallback HTML, causing a MIME-type error.  Reloading once gives the page the
 * new index.html with the correct chunk URLs.
 *
 * The sessionStorage guard prevents an infinite reload loop if the chunk is
 * genuinely missing for another reason.
 */
export function lazyWithReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() =>
    factory().catch(e => {
      if (!sessionStorage.getItem('chunkReloadAttempted')) {
        sessionStorage.setItem('chunkReloadAttempted', '1');
        window.location.reload();
        // Never resolves — the reload will happen before this matters.
        return new Promise<{ default: T }>(() => {});
      }
      // Already reloaded once; let the error bubble to an error boundary.
      throw e;
    }),
  );
}
