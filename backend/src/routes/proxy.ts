import { Router } from 'express';
import axios from 'axios';

const router = Router();

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

  try {
    const upstream = await axios.get<NodeJS.ReadableStream>(url, {
      responseType: 'stream',
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer':         'https://xeno-canto.org/',
        'Accept':          'image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 10_000,
    });

    const contentType = upstream.headers['content-type'] ?? 'unknown';
    console.log(`[proxy/sono] upstream ${upstream.status} content-type: ${contentType} — ${url}`);

    if (!contentType.startsWith('image/')) {
      console.error(`[proxy/sono] upstream returned non-image content (Cloudflare challenge?)`);
      return res.status(502).json({ error: 'Upstream did not return an image' });
    }

    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=604800');
    res.set('X-Content-Type-Options', 'nosniff');
    upstream.data.pipe(res);
  } catch (err) {
    const e = err as { response?: { status: number } };
    console.error(`[proxy/sono] failed to fetch ${url} — HTTP ${e.response?.status ?? 'no response'}:`, (err as Error).message);
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

  try {
    const upstream = await axios.get<NodeJS.ReadableStream>(url, {
      responseType: 'stream',
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer':         'https://xeno-canto.org/',
        'Accept':          'audio/mpeg,audio/*;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      maxRedirects: 5,
      timeout: 15_000,
    });

    console.log(`[proxy/audio] upstream ${upstream.status} content-type: ${upstream.headers['content-type'] ?? 'unknown'} — ${url}`);
    res.set('Content-Type', upstream.headers['content-type'] ?? 'audio/mpeg');
    res.set('Cache-Control', 'public, max-age=604800');
    // Pass Content-Length so the browser can estimate seekable range (needed for
    // VBR MP3s that report duration=Infinity until fully buffered).
    if (upstream.headers['content-length']) {
      res.set('Content-Length', upstream.headers['content-length']);
    }
    upstream.data.pipe(res);
  } catch (err) {
    const e = err as { response?: { status: number } };
    console.error(`[proxy/audio] failed ${url} — HTTP ${e.response?.status ?? 'no response'}:`, (err as Error).message);
    res.status(502).json({ error: 'Failed to fetch audio' });
  }
});

export default router;
