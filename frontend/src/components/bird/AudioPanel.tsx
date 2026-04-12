import { useEffect, useState, useRef } from 'react';
import type { BirdInfoData } from '../../services/remote/api';
import { SpectrogramPlayer } from '../ui/SpectrogramPlayer';
import { toProxyUrl } from '../../lib/audioProxy';

interface Props {
  recordings:   BirdInfoData['recordings'];
  autoplay?:    boolean;
  pauseRef?:    React.MutableRefObject<(() => void) | null>;
  /** Fill the parent's height and show a placeholder when no sonogram is available.
   *  Use true for fixed-height containers (e.g. desktop triptych). Default false. */
  fillHeight?:  boolean;
}

export function AudioPanel({ recordings, autoplay = false, pauseRef, fillHeight = false }: Props) {
  const [idx, setIdx]         = useState(0);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const rec = recordings[idx];

  useEffect(() => { setIdx(0); setPlaying(autoplay); }, [recordings]);

  useEffect(() => {
    if (!pauseRef) return;
    pauseRef.current = () => { setPlaying(false); audioRef.current?.pause(); };
    return () => { pauseRef.current = null; };
  }, [pauseRef]);

  useEffect(() => {
    if (!audioRef.current) return;
    if (playing) audioRef.current.play().catch(() => setPlaying(false));
    else         audioRef.current.pause();
  }, [playing, idx]);

  // Pause on unmount so audio doesn't outlive the component
  useEffect(() => {
    return () => { audioRef.current?.pause(); };
  }, []);

  if (recordings.length === 0) return null;

  const togglePlaying = () => setPlaying(p => !p);

  return (
    <div className={`flex flex-col bg-slate-900 overflow-hidden ${fillHeight ? 'h-full' : ''}`}>
      {/* Audio element — src managed via toProxyUrl for Content-Length / seekable range */}
      <audio ref={audioRef} src={toProxyUrl(rec.file)} onEnded={() => setPlaying(false)} />

      {/* Spectrogram + position indicator + duration pill */}
      {(!!rec.file || fillHeight) && (
        <SpectrogramPlayer
          audioUrl={rec.file || undefined}
          audioRef={audioRef}
          playing={playing}
          onToggle={togglePlaying}
          fillHeight={fillHeight}
          height={fillHeight ? undefined : 140}
          className={fillHeight ? 'flex-1 min-h-0' : ''}
          hideButton
        />
      )}

      {/* Controls bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-800">
        {/* Left: recording info */}
        <div className="flex-1 min-w-0">
          {rec.type    && <p className="text-xs font-semibold text-slate-200 capitalize truncate">{rec.type}</p>}
          {rec.country && <p className="text-xs text-slate-400 truncate">{rec.country}</p>}
        </div>
        {/* Centre: nav + play */}
        <div className="shrink-0 flex items-center gap-1.5">
          {recordings.length > 1 && (
            <button onClick={() => { setPlaying(false); setIdx(i => (i - 1 + recordings.length) % recordings.length); }}
              className="w-6 h-6 rounded-full bg-slate-600 hover:bg-slate-500 flex items-center justify-center text-white text-sm">‹</button>
          )}
          <button onClick={togglePlaying}
            className="w-8 h-8 rounded-full bg-forest-600 hover:bg-forest-700 flex items-center justify-center text-white text-sm shadow">
            {playing ? '⏸' : '▶'}
          </button>
          {recordings.length > 1 && (
            <button onClick={() => { setPlaying(false); setIdx(i => (i + 1) % recordings.length); }}
              className="w-6 h-6 rounded-full bg-slate-600 hover:bg-slate-500 flex items-center justify-center text-white text-sm">›</button>
          )}
        </div>
        {/* Right: counter (balances left so buttons stay centred) */}
        <div className="flex-1 flex justify-end">
          {recordings.length > 1 && (
            <span className="text-xs text-slate-400">{idx + 1}/{recordings.length}</span>
          )}
        </div>
      </div>
    </div>
  );
}
