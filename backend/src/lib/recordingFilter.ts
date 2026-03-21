/**
 * Pure helpers for filtering xeno-canto recordings against a banned-URL set.
 * Extracted for unit testability — no I/O or randomness.
 */

import type { XCRecording } from '../services/xenocanto';

/** Returns only recordings whose file URL is not in bannedUrls. */
export function filterRecordings(
  recordings: XCRecording[],
  bannedUrls: Set<string>,
): XCRecording[] {
  if (bannedUrls.size === 0) return recordings;
  return recordings.filter(r => !bannedUrls.has(r.file));
}
