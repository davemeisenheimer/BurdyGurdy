/**
 * Pure helpers for filtering xeno-canto recordings against a banned-URL set.
 * Extracted for unit testability - no I/O or randomness.
 */

import type { XCRecording } from '../services/xenocanto';
import { parseXCLength } from '../services/xenocanto';

/** Returns only recordings whose file URL is not in bannedUrls. */
export function filterRecordings(
  recordings: XCRecording[],
  bannedUrls: Set<string>,
): XCRecording[] {
  if (bannedUrls.size === 0) return recordings;
  return recordings.filter(r => !bannedUrls.has(r.file));
}

/**
 * Returns a weighted-random sample of `n` recordings without replacement.
 * Each recording's selection probability is proportional to 1/duration, so
 * shorter clips are favoured while longer clips remain in the pool. When all
 * clips are a similar length the result is effectively a fair shuffle.
 *
 * Recordings with no parseable duration are treated as 60 s (mid-weight).
 */
export function weightedSampleByDuration(
  recordings: XCRecording[],
  n: number,
): XCRecording[] {
  if (recordings.length <= n) return [...recordings];

  const FALLBACK_S = 60;
  const weights = recordings.map(r => {
    const dur = parseXCLength(r.length);
    return 1 / (isFinite(dur) && dur > 0 ? dur : FALLBACK_S);
  });

  const result: XCRecording[] = [];
  const remaining = [...recordings];
  const rem_weights = [...weights];

  while (result.length < n && remaining.length > 0) {
    const total = rem_weights.reduce((a, b) => a + b, 0);
    let rand = Math.random() * total;
    let idx = rem_weights.length - 1;
    for (let i = 0; i < rem_weights.length; i++) {
      rand -= rem_weights[i];
      if (rand <= 0) { idx = i; break; }
    }
    result.push(remaining.splice(idx, 1)[0]);
    rem_weights.splice(idx, 1);
  }

  return result;
}
