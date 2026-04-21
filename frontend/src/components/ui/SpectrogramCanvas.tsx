import { useEffect, useRef, useState, useCallback } from 'react';
import { drawSpectrogram, renderSpectrogramWindow, type SpectrogramData } from '../../lib/spectrogram';

interface Props {
  audioUrl?: string;
  /** Fixed pixel height. Omit to let CSS control height (e.g. h-full). */
  height?: number;
  className?: string;
  /** Called when spectrogram generation finishes (success or error). */
  onReady?: () => void;
  /** Called whenever the visible zoom window changes, as [startFrac, endFrac]. */
  onZoomChange?: (window: [number, number]) => void;
}

const MIN_ZOOM_FRAC = 0.05;  // can't show less than 5% of audio at once
const ZOOM_STEP     = 1.4;   // zoom factor per scroll tick

/**
 * Renders a spectrogram generated client-side from the audio at `audioUrl`.
 * Supports mouse-wheel zoom (desktop) and pinch-to-zoom (mobile), plus drag
 * to pan when zoomed. Double-click or the reset button returns to full view.
 */
export function SpectrogramCanvas({ audioUrl, height, className, onReady, onZoomChange }: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dataRef      = useRef<SpectrogramData | null>(null);

  // Mirror of zoomWindow in a ref so imperative event handlers read current value.
  const zoomWindowRef    = useRef<[number, number]>([0, 1]);
  const isDragging       = useRef(false);
  const hasDragged       = useRef(false);
  const dragStartX       = useRef(0);
  const dragStartWindow  = useRef<[number, number]>([0, 1]);
  const lastPinchDist    = useRef<number | null>(null);
  const lastPinchMidFrac = useRef<number>(0.5);

  const [status, setStatus]         = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [zoomWindow, setZoomWindow] = useState<[number, number]>([0, 1]);

  const isZoomed  = zoomWindow[1] - zoomWindow[0] < 0.999;
  const zoomRatio = Math.round(10 / (zoomWindow[1] - zoomWindow[0])) / 10;

  // Keep ref in sync for event handlers
  useEffect(() => { zoomWindowRef.current = zoomWindow; }, [zoomWindow]);

  // Reset zoom and clear stored data when the audio changes
  useEffect(() => {
    dataRef.current = null;
    setZoomWindow([0, 1]);
  }, [audioUrl]);

  // Re-render whenever the zoom window changes (skip [0,1] — already drawn by drawSpectrogram)
  useEffect(() => {
    if (!isZoomed || !canvasRef.current || !dataRef.current || status !== 'done') return;
    renderSpectrogramWindow(canvasRef.current, dataRef.current, zoomWindow[0], zoomWindow[1]);
  }, [zoomWindow, isZoomed, status]);

  // Notify parent of zoom window changes (e.g. so SpectrogramPlayer can adjust position line)
  useEffect(() => {
    onZoomChange?.(zoomWindow);
  }, [zoomWindow, onZoomChange]);

  // Main: fetch audio, compute FFT, draw full spectrogram
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audioUrl) { setStatus('idle'); return; }

    const controller = new AbortController();
    setStatus('loading');

    // Set canvas backing-store resolution to match its rendered size.
    canvas.width  = canvas.offsetWidth  || 800;
    canvas.height = canvas.offsetHeight || height || 120;

    const normalized = audioUrl.startsWith('//') ? `https:${audioUrl}` : audioUrl;
    const fetchUrl   = `/api/proxy/audio?url=${encodeURIComponent(normalized)}`;

    drawSpectrogram(fetchUrl, canvas, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        dataRef.current = data;
        setStatus('done');
        onReady?.();
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setStatus('error');
        onReady?.();
      });

    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl, height]);

  // ── Zoom helpers ──────────────────────────────────────────────────────────

  const applyZoom = useCallback((cursorFrac: number, factor: number) => {
    setZoomWindow(([start, end]) => {
      const width    = end - start;
      const newWidth = Math.min(1, Math.max(MIN_ZOOM_FRAC, width / factor));
      const pivot    = start + cursorFrac * width;      // audio fraction under the cursor
      let newStart   = pivot - cursorFrac * newWidth;
      newStart       = Math.max(0, Math.min(1 - newWidth, newStart));
      return [newStart, newStart + newWidth] as [number, number];
    });
  }, []);

  const resetZoom = useCallback(() => {
    setZoomWindow([0, 1]);
    if (canvasRef.current && dataRef.current) {
      renderSpectrogramWindow(canvasRef.current, dataRef.current, 0, 1);
    }
  }, []);

  // ── Mouse wheel (must be non-passive to call preventDefault) ─────────────

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!dataRef.current) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      applyZoom(frac, e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [applyZoom]);

  // ── Touch: pinch-to-zoom + single-finger pan ──────────────────────────────

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (!dataRef.current) return;
      if (e.touches.length === 2) {
        isDragging.current = false;
        lastPinchDist.current = Math.hypot(
          e.touches[1].clientX - e.touches[0].clientX,
          e.touches[1].clientY - e.touches[0].clientY,
        );
        const rect = el.getBoundingClientRect();
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        lastPinchMidFrac.current = Math.max(0, Math.min(1, (midX - rect.left) / rect.width));
      } else if (e.touches.length === 1) {
        isDragging.current    = true;
        hasDragged.current    = false;
        dragStartX.current    = e.touches[0].clientX;
        dragStartWindow.current = zoomWindowRef.current;
        lastPinchDist.current = null;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!dataRef.current) return;
      if (e.touches.length === 2 && lastPinchDist.current !== null) {
        e.preventDefault();
        const dist   = Math.hypot(
          e.touches[1].clientX - e.touches[0].clientX,
          e.touches[1].clientY - e.touches[0].clientY,
        );
        const factor = dist / lastPinchDist.current;
        lastPinchDist.current = dist;
        applyZoom(lastPinchMidFrac.current, factor);
      } else if (e.touches.length === 1 && isDragging.current) {
        const [start, end] = dragStartWindow.current;
        const width = end - start;
        if (width >= 0.999) return;   // not zoomed — let the page scroll
        e.preventDefault();
        hasDragged.current = true;
        const rect      = el.getBoundingClientRect();
        const deltaFrac = (e.touches[0].clientX - dragStartX.current) / rect.width;
        let newStart    = start - deltaFrac;
        newStart        = Math.max(0, Math.min(1 - width, newStart));
        setZoomWindow([newStart, newStart + width]);
      }
    };

    const onTouchEnd = () => {
      isDragging.current    = false;
      lastPinchDist.current = null;
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove',  onTouchMove,  { passive: false });
    el.addEventListener('touchend',   onTouchEnd);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove',  onTouchMove);
      el.removeEventListener('touchend',   onTouchEnd);
    };
  }, [applyZoom]);

  // ── Mouse drag to pan ─────────────────────────────────────────────────────

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!dataRef.current) return;
    const [start, end] = zoomWindowRef.current;
    if (end - start >= 0.999) return;   // not zoomed, nothing to pan
    isDragging.current   = true;
    hasDragged.current   = false;
    dragStartX.current   = e.clientX;
    dragStartWindow.current = zoomWindowRef.current;
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const [start, end] = dragStartWindow.current;
      const width     = end - start;
      const rect      = containerRef.current.getBoundingClientRect();
      const deltaFrac = (e.clientX - dragStartX.current) / rect.width;
      if (Math.abs(deltaFrac) > 0.005) hasDragged.current = true;
      let newStart = start - deltaFrac;
      newStart     = Math.max(0, Math.min(1 - width, newStart));
      setZoomWindow([newStart, newStart + width]);
    };
    const onMouseUp = () => { isDragging.current = false; };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup',   onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup',   onMouseUp);
    };
  }, []);

  // Suppress click propagation after a drag (prevents AudioPlayer play/pause toggle)
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (hasDragged.current) {
      e.stopPropagation();
      hasDragged.current = false;
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className={`relative bg-slate-900 overflow-hidden select-none ${
        status === 'done' ? (isZoomed ? 'cursor-grab' : 'cursor-zoom-in') : ''
      } ${className ?? ''}`}
      style={height !== undefined ? { height } : undefined}
      onMouseDown={onMouseDown}
      onClickCapture={onClickCapture}
      onDoubleClick={resetZoom}
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
      {isZoomed && (
        <button
          className="absolute top-2 left-2 bg-slate-700/80 hover:bg-slate-600/80 text-white/70 text-xs px-2 py-0.5 rounded-full transition-colors"
          onClick={e => { e.stopPropagation(); resetZoom(); }}
          onMouseDown={e => e.stopPropagation()}
        >
          {zoomRatio}× · reset
        </button>
      )}
    </div>
  );
}
