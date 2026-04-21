/**
 * Client-side spectrogram generation using the Web Audio API.
 *
 * Fetches the audio file, decodes it, runs a short-time Fourier transform
 * (STFT) over the PCM data, and renders the result as a frequency-vs-time
 * heatmap onto the provided canvas element.
 *
 * Why: xeno-canto spectrogram images are served behind Cloudflare bot
 * protection and cannot be loaded as <img> tags in a browser without a prior
 * xeno-canto session cookie. xeno-canto also blocks iframes. Generating from
 * the audio (which loads fine) is the only fully reliable approach.
 */

import { INFERNO_LUT } from './spectrogramColours';

const FFT_SIZE    = 1024;  // frequency resolution
const HOP_SIZE    = 256;   // 75% overlap — smoother time resolution
const MAX_DB_RANGE = 60;   // dynamic range shown (dB below peak)

// Hann window coefficients — precomputed once, shared across all calls
const HANN = Float32Array.from(
  { length: FFT_SIZE },
  (_, i) => 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1))),
);

/**
 * In-place radix-2 Cooley–Tukey FFT (decimation-in-time).
 * Both arrays must have length that is a power of 2.
 */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;

  // Bit-reversal permutation
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
          t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }

  // Butterfly passes
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let uRe = 1, uIm = 0;
      for (let k = 0; k < half; k++) {
        const idx  = i + k + half;
        const vRe  = re[idx] * uRe - im[idx] * uIm;
        const vIm  = re[idx] * uIm + im[idx] * uRe;
        re[idx]    = re[i + k] - vRe;
        im[idx]    = im[i + k] - vIm;
        re[i + k] += vRe;
        im[i + k] += vIm;
        const nu = uRe * wRe - uIm * wIm;
        uIm      = uRe * wIm + uIm * wRe;
        uRe      = nu;
      }
    }
  }
}

/** Raw FFT data returned by drawSpectrogram, used for zoom re-renders. */
export interface SpectrogramData {
  dbs: Float32Array;
  numFrames: number;
  maxBin: number;
  globalMax: number;
}

/**
 * Renders a time window of a computed spectrogram onto `canvas`.
 * startFrac and endFrac are fractions of the total audio duration [0, 1].
 * Calling with (0, 1) reproduces the full view.
 */
export function renderSpectrogramWindow(
  canvas: HTMLCanvasElement,
  data: SpectrogramData,
  startFrac: number,
  endFrac: number,
): void {
  const { dbs, numFrames, maxBin, globalMax } = data;
  const cw    = canvas.width;
  const ch    = canvas.height;
  const ctx2d = canvas.getContext('2d');
  if (!ctx2d) return;

  const floor   = globalMax - MAX_DB_RANGE;
  const range   = Math.max(globalMax - floor, 1);
  const imgData = ctx2d.createImageData(cw, ch);
  const d       = imgData.data;

  for (let x = 0; x < cw; x++) {
    const frameFrac  = startFrac + (x / cw) * (endFrac - startFrac);
    const frameIndex = Math.min(numFrames - 1, Math.floor(frameFrac * numFrames));
    for (let y = 0; y < ch; y++) {
      const binIndex   = Math.min(maxBin - 1, Math.floor((ch - 1 - y) * maxBin / ch));
      const intensity  = Math.pow(Math.max(0, (dbs[frameIndex * maxBin + binIndex] - floor) / range), 0.7);
      const pixelIndex = (y * cw + x) * 4;
      const lutIndex   = Math.round(intensity * 255) * 3;
      d[pixelIndex]     = INFERNO_LUT[lutIndex];
      d[pixelIndex + 1] = INFERNO_LUT[lutIndex + 1];
      d[pixelIndex + 2] = INFERNO_LUT[lutIndex + 2];
      d[pixelIndex + 3] = 255;
    }
  }
  ctx2d.putImageData(imgData, 0, 0);
}

/**
 * Fetches audio from `audioUrl`, decodes it, computes an STFT, renders the
 * full spectrogram onto `canvas`, and returns the raw FFT data so callers
 * can re-render sub-windows (zoom) without re-fetching.
 *
 * The canvas `width` and `height` must already be set to the desired drawing
 * resolution before calling. Rejects on network/decode failure or abort.
 */
export async function drawSpectrogram(
  audioUrl: string,
  canvas: HTMLCanvasElement,
  signal?: AbortSignal,
): Promise<SpectrogramData> {
  // Protocol-relative URLs need a scheme for fetch()
  const url = audioUrl.startsWith('//') ? `https:${audioUrl}` : audioUrl;

  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const arrayBuffer = await resp.arrayBuffer();
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const AudioCtx = window.AudioContext ?? (window as any).webkitAudioContext as typeof AudioContext;
  const actx = new AudioCtx();
  let decoded: AudioBuffer;
  try {
    decoded = await actx.decodeAudioData(arrayBuffer);
  } finally {
    void actx.close();
  }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  // Mix down to mono if stereo
  const ch0 = decoded.getChannelData(0);
  const ch1 = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : null;
  const samples: Float32Array = ch1
    ? Float32Array.from({ length: ch0.length }, (_, i) => (ch0[i] + ch1[i]) * 0.5)
    : ch0;

  const sampleRate = decoded.sampleRate;
  const numFrames  = Math.floor((samples.length - FFT_SIZE) / HOP_SIZE);
  if (numFrames <= 0) throw new Error('Audio too short to generate spectrogram');

  // Cap at 10 kHz — covers virtually all bird vocalizations
  const maxBin = Math.min(FFT_SIZE >> 1, Math.round(10_000 / (sampleRate / FFT_SIZE)));

  // ── STFT ─────────────────────────────────────────────────────────────────
  const re  = new Float32Array(FFT_SIZE);
  const im  = new Float32Array(FFT_SIZE);
  const dbs = new Float32Array(numFrames * maxBin);
  let globalMax = -Infinity;

  for (let f = 0; f < numFrames; f++) {
    const off = f * HOP_SIZE;
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = (samples[off + i] ?? 0) * HANN[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < maxBin; b++) {
      const mag = Math.sqrt(re[b] * re[b] + im[b] * im[b]);
      const db  = 20 * Math.log10(mag + 1e-9);
      dbs[f * maxBin + b] = db;
      if (db > globalMax) globalMax = db;
    }
  }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const data: SpectrogramData = { dbs, numFrames, maxBin, globalMax };
  renderSpectrogramWindow(canvas, data, 0, 1);
  return data;
}
