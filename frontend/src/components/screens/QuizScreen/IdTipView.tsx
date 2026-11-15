import type { AttributedPhoto } from '../../../types';
import type { IdTipStatus } from './useIdTip';
import { TipProgressBar } from './TipProgressBar';

interface Props {
  photo: AttributedPhoto;
  guess: string;
  status: IdTipStatus;
  tip: string | null;
  /** Opens the report dialog. Omitted when the player can't report (not signed in). */
  onReport?: () => void;
  /** True once this tip has been reported in this session. */
  reported?: boolean;
}

/** Shown in place of the reveal after a wrong photo answer: the question photo plus an AI tip about it. */
export function IdTipView({ photo, guess, status, tip, onReport, reported = false }: Props) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 relative flex items-center justify-center bg-slate-900 overflow-hidden">
        <img src={photo.url} alt="The question photo" className="max-h-full max-w-full object-contain" />
        {photo.credit && (
          <span className="absolute bottom-1 left-1 bg-black/50 text-white/60 text-[10px] px-1.5 py-0.5 rounded max-w-[93%] truncate">
            {photo.credit}
          </span>
        )}
      </div>
      <div className="shrink-0 px-4 pt-2.5 pb-2 border-t border-slate-100 max-h-[45%] overflow-y-auto">
        <p className="text-xs uppercase tracking-wider text-amber-600 font-semibold">💡 What to look for</p>
        <p className="text-xs text-slate-400 mt-0.5">You answered {guess}</p>
        {status === 'ready' && tip ? (
          <>
            <p className="text-sm text-slate-700 leading-snug mt-1.5">{tip}</p>
            <div className="flex items-baseline justify-between gap-2 mt-1.5">
              <p className="text-[10px] text-slate-400">AI-generated tip - it can make mistakes.</p>
              {reported ? (
                <span className="shrink-0 text-[11px] text-slate-400">Reported - thanks!</span>
              ) : onReport && (
                <button
                  type="button"
                  onClick={onReport}
                  className="shrink-0 text-[11px] text-sky-600 hover:underline cursor-pointer"
                >
                  Report error
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-400 mt-1.5 animate-pulse">Studying the photo…</p>
            <div className="mt-2.5 mb-0.5">
              <TipProgressBar />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
