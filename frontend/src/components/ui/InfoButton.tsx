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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="font-bold text-slate-800 mb-3">{title}</h3>
            {imageUrl && (
              <img src={imageUrl} alt={title} className="w-full rounded-lg mb-3 object-cover" />
            )}
            <div className="space-y-2">
              {body.map((para, i) => (
                <p key={i} className="text-sm text-slate-600 leading-relaxed">{para}</p>
              ))}
            </div>
            <button
              onClick={() => setOpen(false)}
              className="mt-5 text-sm text-slate-500 hover:text-slate-700"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
