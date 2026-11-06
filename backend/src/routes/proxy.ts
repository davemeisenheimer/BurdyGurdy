import { Router } from 'express';
import type { Response } from 'express';
import axios from 'axios';

const router = Router();

// axios's `timeout` only covers waiting for the upstream response headers. Once a stream is being
// piped, abort if the upstream sends nothing for this long.
const STREAM_IDLE_MS = 15_000;

/**
 * Pipes an upstream stream to the client and guarantees the response ends: tears down the upstream
 * download when the client disconnects, on an upstream error mid-stream, or when the upstream stalls.
 * Without this a stalled or abandoned transfer holds a browser connection open indefinitely - and
 * browsers allow only ~6 HTTP/1.1 connections per origin.
 *
 * A pause caused by the CLIENT not reading (Chrome deliberately parks media it has buffered enough
 * of) is not a stall: cutting it would break playback, since xeno-canto can't resume mid-file.
 */
function pipeWithLimits(
  upstream: NodeJS.ReadableStream & { destroy: (err?: Error) => void },
  controller: AbortController,
  res: Response,
  label: string,
  url: string,
): void {
  const t0 = Date.now();
  let bytes = 0;
  let settled = false;

  const finish = (problem?: string) => {
    if (settled) return;
    settled = true;
    clearTimeout(idleTimer);
    if (problem) {
      console.warn(`[${label}] ${problem} after ${Date.now() - t0}ms, ${bytes} bytes - ${url}`);
      controller.abort();
      upstream.destroy();
      res.destroy();
    }
  };

  let idleTimer: ReturnType<typeof setTimeout>;
  const armIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (settled) return;
      if (res.writableNeedDrain) { armIdleTimer(); return; } // client-side pause, not an upstream stall
      finish(`upstream sent no data for ${STREAM_IDLE_MS}ms`);
    }, STREAM_IDLE_MS);
  };
  armIdleTimer();

  upstream.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    if (!settled) armIdleTimer();
  });
  upstream.on('error', err => finish(`upstream stream error: ${(err as Error).message}`));
  res.on('finish', () => finish());
  // Client went away (navigated, src cleared, tab closed) before we finished: stop downloading.
  // (res 'close', not req 'close' - the latter fires once the request body is read, in Node 16+.)
  res.on('close', () => {
    if (!res.writableFinished && !settled) {
      settled = true;
      clearTimeout(idleTimer);
      controller.abort();
      upstream.destroy();
    }
  });

  upstream.pipe(res);
}

/**
 * GET /api/proxy/sono?url=<encoded-xeno-canto-url>
 *
 * Proxies spectrogram images from xeno-canto.org through our backend so that
 * Cloudflare's bot-detection challenge (which blocks direct <img> loads in
 * browser contexts without a prior xeno-canto session cookie) is bypassed.
 * Server-to-server fetches with browser-like headers pass through without a
 * JS challenge.
 *
 * Responds with Cache-Control: public, max-age=604800 so the browser and
 * service worker cache the image for 7 days.
 */
router.get('/sono', async (req, res) => {
  const url = req.query.url as string;

  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid url' });
  }

  // Security: only proxy xeno-canto.org spectrogram URLs
  if (!parsed.hostname.endsWith('xeno-canto.org')) {
    return res.status(403).json({ error: 'URL not allowed' });
  }

  const controller = new AbortController();
  try {
    const upstream = await axios.get<NodeJS.ReadableStream & { destroy: (err?: Error) => void }>(url, {
      responseType: 'stream',
      signal: controller.signal,
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer':         'https://xeno-canto.org/',
        'Accept':          'image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 10_000,
    });

    const contentType = upstream.headers['content-type'] ?? 'unknown';
    console.log(`[proxy/sono] upstream ${upstream.status} content-type: ${contentType} - ${url}`);

    if (!contentType.startsWith('image/')) {
      console.error(`[proxy/sono] upstream returned non-image content (Cloudflare challenge?)`);
      return res.status(502).json({ error: 'Upstream did not return an image' });
    }

    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=604800');
    res.set('X-Content-Type-Options', 'nosniff');
    pipeWithLimits(upstream.data, controller, res, 'proxy/sono', url);
  } catch (err) {
    const e = err as { response?: { status: number } };
    console.error(`[proxy/sono] failed to fetch ${url} - HTTP ${e.response?.status ?? 'no response'}:`, (err as Error).message);
    res.status(502).json({ error: 'Failed to fetch spectrogram' });
  }
});

/**
 * GET /api/proxy/audio?url=<encoded-xeno-canto-url>
 *
 * Proxies xeno-canto audio files so the browser's fetch() can retrieve them
 * for Web Audio API decoding (spectrogram generation).  fetch() enforces CORS
 * and xeno-canto does not send Access-Control-Allow-Origin headers, so
 * direct fetch() calls are blocked even though <audio> elements load fine.
 * Server-side fetches have no CORS restrictions.
 */
router.get('/audio', async (req, res) => {
  const url = req.query.url as string;

  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid url' });
  }

  if (!parsed.hostname.endsWith('xeno-canto.org')) {
    return res.status(403).json({ error: 'URL not allowed' });
  }

  const controller = new AbortController();
  // Client gave up before xeno-canto even responded: cancel the upstream request too.
  const abortIfClientGone = () => { if (!res.headersSent) controller.abort(); };
  res.on('close', abortIfClientGone);
  try {
    const upstream = await axios.get<NodeJS.ReadableStream & { destroy: (err?: Error) => void }>(url, {
      responseType: 'stream',
      signal: controller.signal,
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer':         'https://xeno-canto.org/',
        'Accept':          'audio/mpeg,audio/*;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      maxRedirects: 5,
      timeout: 15_000,
    });

    console.log(`[proxy/audio] upstream ${upstream.status} content-type: ${upstream.headers['content-type'] ?? 'unknown'} - ${url}`);
    res.set('Content-Type', upstream.headers['content-type'] ?? 'audio/mpeg');
    res.set('Cache-Control', 'public, max-age=604800');
    // Pass Content-Length so the browser can estimate seekable range (needed for
    // VBR MP3s that report duration=Infinity until fully buffered).
    if (upstream.headers['content-length']) {
      res.set('Content-Length', upstream.headers['content-length']);
    }
    res.off('close', abortIfClientGone);
    pipeWithLimits(upstream.data, controller, res, 'proxy/audio', url);
  } catch (err) {
    res.off('close', abortIfClientGone);
    if (axios.isCancel(err)) return; // client disconnected before upstream answered
    const e = err as { response?: { status: number } };
    console.error(`[proxy/audio] failed ${url} - HTTP ${e.response?.status ?? 'no response'}:`, (err as Error).message);
    res.status(502).json({ error: 'Failed to fetch audio' });
  }
});

export default router;
