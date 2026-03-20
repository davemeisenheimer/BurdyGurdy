import { useState, useRef, useEffect } from 'react';

interface Props {
  userEmail?: string | null;
  onAuthClick: () => void;
  onSignOut: () => void;
  dropdownAlign?: 'left' | 'right';
  compact?: boolean;
}

export function AccountPill({ userEmail, onAuthClick, onSignOut, dropdownAlign = 'left', compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const pillClass = 'flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-slate-300 text-slate-500 hover:bg-slate-100 text-xs font-medium transition-colors';

  if (!userEmail) {
    return (
      <button onClick={onAuthClick} className={pillClass}>
        <span>🔑</span>
        <span>Sign in</span>
      </button>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)} className={pillClass}>
        <span>👤</span>
        {compact
          ? <span style={{ fontSize: '10px' }}>Sign out</span>
          : <span className="max-w-[100px] truncate">{userEmail.split('@')[0]}</span>
        }
      </button>
      {open && (
        <div className={`absolute top-full mt-1 z-50 bg-white rounded-xl shadow-lg border border-slate-200 py-2 min-w-[180px] ${dropdownAlign === 'right' ? 'right-0' : 'left-0'}`}>
          <p className="text-xs text-slate-400 px-3 pb-1.5 truncate">{userEmail}</p>
          <button
            onClick={() => { onSignOut(); setOpen(false); }}
            className="w-full text-left text-xs text-slate-600 hover:text-red-500 hover:bg-slate-50 px-3 py-1.5 transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
