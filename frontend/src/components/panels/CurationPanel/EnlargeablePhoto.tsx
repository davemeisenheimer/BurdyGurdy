import { useState } from 'react';
import { createPortal } from 'react-dom';

/** A photo that opens full-screen when clicked. */
export function EnlargeablePhoto({ url, alt }: { url: string; alt: string }) {
  const [enlarged, setEnlarged] = useState(false);
  return (
    <>
      <div className="w-full rounded-lg bg-slate-800 cursor-zoom-in flex items-center justify-center" onClick={() => setEnlarged(true)} title="Click to enlarge">
        <img src={url} alt={alt} className="h-auto max-h-48 w-full object-contain" />
      </div>
      {enlarged && createPortal(
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center cursor-zoom-out p-4" onClick={() => setEnlarged(false)}>
          <img src={url} alt={alt} className="max-h-full max-w-full object-contain rounded-lg shadow-2xl" />
        </div>,
        document.body,
      )}
    </>
  );
}
