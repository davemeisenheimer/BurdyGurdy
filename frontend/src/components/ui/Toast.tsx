import { useEffect, useState } from 'react';

export interface ToastData {
  id: string;
  message: string;
  /** If set, renders a tappable link label that calls onAction */
  actionLabel?: string;
  onAction?: () => void;
}

interface Props {
  toast: ToastData | null;
  onDismiss: () => void;
}

export function Toast({ toast, onDismiss }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!toast) { setVisible(false); return; }
    // Trigger slide-in on next tick
    const showTimer = setTimeout(() => setVisible(true), 10);
    // Auto-dismiss after 6s
    const hideTimer = setTimeout(() => { setVisible(false); setTimeout(onDismiss, 300); }, 6000);
    return () => { clearTimeout(showTimer); clearTimeout(hideTimer); };
  }, [toast?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!toast) return null;

  function dismiss() {
    setVisible(false);
    setTimeout(onDismiss, 300);
  }

  return (
    <div
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm
        bg-slate-800 text-white rounded-xl shadow-lg px-4 py-3 flex items-start gap-3
        transition-transform duration-300 ease-out
        ${visible ? 'translate-y-0' : '-translate-y-20 opacity-0'}`}
    >
      <p className="flex-1 text-sm leading-snug">
        {toast.message}
        {toast.actionLabel && toast.onAction && (
          <>
            {' '}
            <button
              onClick={() => { toast.onAction!(); dismiss(); }}
              className="underline font-medium"
            >
              {toast.actionLabel}
            </button>
          </>
        )}
      </p>
      <button onClick={dismiss} className="shrink-0 text-slate-400 hover:text-white text-lg leading-none mt-0.5">
        ×
      </button>
    </div>
  );
}
