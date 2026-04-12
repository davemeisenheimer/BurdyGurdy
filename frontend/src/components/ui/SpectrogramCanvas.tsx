import { useEffect, useRef, useState } from 'react';
import { drawSpectrogram } from '../../lib/spectrogram';

interface Props {
  audioUrl?: string;
  /** Fixed pixel height. Omit to let CSS control height (e.g. h-full). */
  height?: number;
  className?: string;
  /** Called when spectrogram generation finishes (success or error). */
  onReady?: () => void;
}

/**
 * Renders a spectrogram generated client-side from the audio at `audioUrl`.
 * Handles its own loading and error states.
 */
export function SpectrogramCanvas({ audioUrl, height, className, onReady }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audioUrl) { setStatus('idle'); return; }

    const controller = new AbortController();
    setStatus('loading');

    // Set canvas backing-store resolution to match its rendered size.
    // offsetWidth/Height are available after first layout (useEffect runs post-paint).
    canvas.width  = canvas.offsetWidth  || 800;
    canvas.height = canvas.offsetHeight || height || 120;

    // Route through our backend proxy — fetch() enforces CORS and xeno-canto
    // does not send Access-Control-Allow-Origin headers, so direct fetches are
    // blocked even though <audio> elements load the same URLs just fine.
    const normalized = audioUrl.startsWith('//') ? `https:${audioUrl}` : audioUrl;
    const fetchUrl   = `/api/proxy/audio?url=${encodeURIComponent(normalized)}`;

    drawSpectrogram(fetchUrl, canvas, controller.signal)
      .then(() => { if (!controller.signal.aborted) { setStatus('done');  onReady?.(); } })
      .catch(() => { if (!controller.signal.aborted) { setStatus('error'); onReady?.(); } });

    return () => controller.abort();
  }, [audioUrl, height]);

  return (
    <div
      className={`relative bg-slate-900 overflow-hidden ${className ?? ''}`}
      style={height !== undefined ? { height } : undefined}
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-xs text-slate-500 animate-pulse">Generating spectrogram…</span>
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-xs text-slate-600">Spectrogram unavailable</span>
        </div>
      )}
    </div>
  );
}
