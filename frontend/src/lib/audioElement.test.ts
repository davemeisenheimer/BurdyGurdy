import { describe, it, expect, vi } from 'vitest';
import { releaseAudioElement, restoreAudioSrc } from './audioElement';

/** Minimal element that tracks its src attribute like a real <audio>. */
function fakeAudio(initialSrc: string | null) {
  let src = initialSrc;
  return {
    pause:           vi.fn(),
    load:            vi.fn(),
    removeAttribute: vi.fn((name: string) => { if (name === 'src') src = null; }),
    getAttribute:    vi.fn((name: string) => (name === 'src' ? src : null)),
    setAttribute:    vi.fn((name: string, v: string) => { if (name === 'src') src = v; }),
  };
}

describe('restoreAudioSrc', () => {
  it('puts back a src removed by a StrictMode fake unmount (mount → release → remount)', () => {
    const audio = fakeAudio('/api/proxy/audio?url=a');
    releaseAudioElement(audio);
    expect(audio.getAttribute('src')).toBeNull();
    restoreAudioSrc(audio, '/api/proxy/audio?url=a');
    expect(audio.getAttribute('src')).toBe('/api/proxy/audio?url=a');
  });

  it('leaves an existing src alone', () => {
    const audio = fakeAudio('/api/proxy/audio?url=current');
    restoreAudioSrc(audio, '/api/proxy/audio?url=other');
    expect(audio.setAttribute).not.toHaveBeenCalled();
  });

  it('does nothing for an empty src or a missing element', () => {
    const audio = fakeAudio(null);
    restoreAudioSrc(audio, '');
    restoreAudioSrc(audio, undefined);
    expect(audio.setAttribute).not.toHaveBeenCalled();
    expect(() => restoreAudioSrc(null, '/x')).not.toThrow();
  });
});

describe('releaseAudioElement', () => {
  it('pauses, removes src, then reloads - in that order', () => {
    const calls: string[] = [];
    const audio = {
      pause:           vi.fn(() => { calls.push('pause'); }),
      removeAttribute: vi.fn((name: string) => { calls.push(`remove:${name}`); }),
      load:            vi.fn(() => { calls.push('load'); }),
    };
    releaseAudioElement(audio);
    expect(calls).toEqual(['pause', 'remove:src', 'load']);
  });

  it('ignores a null or undefined element', () => {
    expect(() => releaseAudioElement(null)).not.toThrow();
    expect(() => releaseAudioElement(undefined)).not.toThrow();
  });
});
