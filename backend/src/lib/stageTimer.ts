/**
 * Times named async steps of one request, so a slow or hung request can say which step it is stuck on.
 *
 *   const timer = createStageTimer();
 *   const [a, b] = await Promise.all([timer.track('eBird obs', getObs()), timer.track('taxonomy', getTax())]);
 *   if (timer.elapsed() > 3000) console.warn(`[quiz] slow: ${timer.summary()}`);
 */
export interface StageTimer {
  track<T>(name: string, promise: Promise<T>): Promise<T>;
  /** Wraps a synchronous-or-async block as a stage. */
  stage<T>(name: string, fn: () => Promise<T>): Promise<T>;
  /** Names of stages that have started but not settled. */
  pending(): string[];
  elapsed(): number;
  /** e.g. "total 4210ms - taxonomy 3900ms, eBird obs 120ms, photos 80ms (failed), recordings pending" */
  summary(): string;
}

interface StageRecord { name: string; start: number; ms?: number; failed?: boolean }

export function createStageTimer(now: () => number = Date.now): StageTimer {
  const t0 = now();
  const stages: StageRecord[] = [];

  const track = <T>(name: string, promise: Promise<T>): Promise<T> => {
    const rec: StageRecord = { name, start: now() };
    stages.push(rec);
    return promise.then(
      v => { rec.ms = now() - rec.start; return v; },
      e => { rec.ms = now() - rec.start; rec.failed = true; throw e; },
    );
  };

  return {
    track,
    stage: (name, fn) => track(name, fn()),
    pending: () => stages.filter(s => s.ms === undefined).map(s => s.name),
    elapsed: () => now() - t0,
    summary: () => {
      const parts = [...stages]
        .sort((a, b) => (b.ms ?? Infinity) - (a.ms ?? Infinity))
        .map(s => s.ms === undefined
          ? `${s.name} pending (${now() - s.start}ms)`
          : `${s.name} ${s.ms}ms${s.failed ? ' (failed)' : ''}`);
      return `total ${now() - t0}ms - ${parts.join(', ')}`;
    },
  };
}
