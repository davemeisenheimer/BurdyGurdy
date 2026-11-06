import { describe, it, expect } from 'vitest';
import { createStageTimer } from './stageTimer';

function fakeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('createStageTimer', () => {
  it('records each stage duration and sorts the summary slowest first', async () => {
    const clock = fakeClock();
    const timer = createStageTimer(clock.now);
    let resolveA!: (v: string) => void;
    let resolveB!: (v: number) => void;
    const a = timer.track('taxonomy', new Promise<string>(r => { resolveA = r; }));
    const b = timer.track('eBird obs', new Promise<number>(r => { resolveB = r; }));

    clock.advance(100); resolveB(1); await b;
    clock.advance(400); resolveA('x'); await a;

    expect(timer.pending()).toEqual([]);
    expect(timer.elapsed()).toBe(500);
    expect(timer.summary()).toBe('total 500ms - taxonomy 500ms, eBird obs 100ms');
  });

  it('reports stages still pending, with how long they have been running', async () => {
    const clock = fakeClock();
    const timer = createStageTimer(clock.now);
    void timer.track('recordings', new Promise(() => {}));
    const done = timer.track('photos', Promise.resolve(1));
    await done;
    clock.advance(2000);
    expect(timer.pending()).toEqual(['recordings']);
    expect(timer.summary()).toContain('recordings pending (2000ms)');
  });

  it('marks failed stages and rethrows the error', async () => {
    const clock = fakeClock();
    const timer = createStageTimer(clock.now);
    await expect(timer.stage('taxonomy', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(timer.summary()).toContain('taxonomy 0ms (failed)');
  });

  it('passes resolved values through', async () => {
    const timer = createStageTimer();
    await expect(timer.track('x', Promise.resolve(42))).resolves.toBe(42);
  });
});
