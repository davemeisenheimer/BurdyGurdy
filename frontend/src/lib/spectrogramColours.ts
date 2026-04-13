/**
 * Colour lookup table for spectrogram rendering.
 *
 * INFERNO_LUT is a 256-entry false-colour map derived from matplotlib's
 * "inferno" perceptual colour map (matplotlib BSD licence).
 *
 * Each entry maps an intensity bucket (0 = silence, 255 = peak) to [R, G, B].
 * The palette runs: black → dark purple → red-purple → orange → bright yellow.
 *
 * The table is built at module load time by linearly interpolating between
 * nine anchor points sampled from the original inferno data.
 */

const STOPS: [number, number, number][] = [
  [  0,   0,   4],  // t = 0.000 — near-black
  [ 51,   6, 128],  // t = 0.125 — dark purple
  [101,   7, 122],  // t = 0.250 — purple
  [146,  35,  85],  // t = 0.375 — red-purple
  [183,  70,  37],  // t = 0.500 — dark red
  [213, 117,   4],  // t = 0.625 — orange
  [235, 164,  12],  // t = 0.750 — orange-yellow
  [248, 217,  69],  // t = 0.875 — yellow
  [252, 255, 164],  // t = 1.000 — bright yellow-white
];

function buildLut(): Uint8Array {
  const lut = new Uint8Array(256 * 3);
  const n = STOPS.length - 1;
  for (let i = 0; i < 256; i++) {
    const t    = i / 255;
    const seg  = Math.min(n - 1, Math.floor(t * n));
    const frac = t * n - seg;
    const [r0, g0, b0] = STOPS[seg];
    const [r1, g1, b1] = STOPS[seg + 1];
    lut[i * 3]     = Math.round(r0 + (r1 - r0) * frac);
    lut[i * 3 + 1] = Math.round(g0 + (g1 - g0) * frac);
    lut[i * 3 + 2] = Math.round(b0 + (b1 - b0) * frac);
  }
  return lut;
}

export const INFERNO_LUT: Uint8Array = buildLut();
