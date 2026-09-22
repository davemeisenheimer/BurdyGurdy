/**
 * Pure rules for deciding what a photo lookup result means, so a failed lookup is never mistaken
 * for "this bird has no photos". Getting that wrong is expensive: a `noPhoto` question awards a
 * free correct answer and permanently marks the bird as mastered.
 */

/**
 * - ok:      the source answered (with photos or with a genuine "nothing here")
 * - failed:  the request errored (HTTP error, timeout, rate limit, bot-challenge page, ...)
 * - pending: still running when the attempt's time window closed
 * - blocked: a source known to be unavailable (e.g. Macaulay's bot challenge); excluded from the
 *            decision rather than counted as either an answer or a failure
 */
export type SourceState = 'ok' | 'failed' | 'pending' | 'blocked';

export interface SourceOutcome {
  name: string;
  state: SourceState;
  /** Set for failures caused by rate limiting or an active cooldown. */
  rateLimited?: boolean;
  reason?: string;
}

export interface AttemptAssessment {
  /** Every non-blocked source answered successfully. */
  complete: boolean;
  /** False when retrying immediately is pointless because every problem was rate limiting. */
  retryable: boolean;
  /** Human-readable descriptions of sources that failed or timed out, for logs. */
  problems: string[];
}

export function assessAttempt(sources: SourceOutcome[]): AttemptAssessment {
  const failed  = sources.filter(s => s.state === 'failed');
  const pending = sources.filter(s => s.state === 'pending');
  const complete = failed.length === 0 && pending.length === 0;
  const retryable = pending.length > 0 || failed.some(s => !s.rateLimited);
  const problems = [
    ...failed.map(s => `${s.name}: ${s.reason ?? 'failed'}`),
    ...pending.map(s => `${s.name}: still pending when the window closed`),
  ];
  return { complete, retryable: complete ? false : retryable, problems };
}

export type PhotoResultKind = 'photos' | 'confirmed-empty' | 'unavailable';

/**
 * - photos:          at least one photo was found
 * - confirmed-empty: no photos, and every available source answered successfully
 * - unavailable:     no photos, but at least one source failed or timed out, so we can't say
 */
export function classifyPhotoResult(hasPhotos: boolean, complete: boolean): PhotoResultKind {
  if (hasPhotos) return 'photos';
  return complete ? 'confirmed-empty' : 'unavailable';
}
