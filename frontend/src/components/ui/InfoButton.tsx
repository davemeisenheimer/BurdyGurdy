import { useState } from 'react';

interface Props {
  title: string;
  body: string[];
  imageUrl?: string;
}

export function InfoButton({ title, body, imageUrl }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(true); }}
        className="w-4 h-4 rounded-full border border-sky-500 text-sky-600 hover:bg-sky-50 hover:border-sky-600 text-xs font-semibold leading-none flex items-center justify-center shrink-0"
        aria-label={`About: ${title}`}
      >
        i
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <h3 className="font-bold text-slate-800">{title}</h3>
              <button
                onClick={() => setOpen(false)}
                className="ml-4 shrink-0 w-7 h-7 rounded-full border border-sky-500 bg-slate-100 hover:bg-sky-50 text-sky-600 hover:text-sky-700 flex items-center justify-center text-base leading-[0] transition-colors"
                aria-label="Close"
              >
                <span className="-translate-y-px">×</span>
              </button>
            </div>
            <div className="space-y-2">
              <img
                src="/BurdyNotebook.png"
                alt="BurdyGurdy"
                className="float-left w-16 h-auto mr-3 mb-1 rounded-lg"
              />
              {imageUrl && (
                <img src={imageUrl} alt={title} className="w-full rounded-lg mb-3 object-cover" />
              )}
              {body.map((para, i) => (
                <p key={i} className="text-sm text-slate-600 leading-relaxed">{para}</p>
              ))}
              <div className="clear-both" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
