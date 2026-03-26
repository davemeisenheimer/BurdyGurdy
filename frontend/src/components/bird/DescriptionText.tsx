import { Fragment } from 'react';

interface Props {
  extract: string;
  wikiUrl: string;
}

export function DescriptionText({ extract, wikiUrl }: Props) {
  return (
    <>
      {extract.split(/^(={1,3}[^=\n]+={1,3})$/m).map((chunk, i) => {
        const heading = chunk.match(/^={1,3}([^=\n]+)={1,3}$/);
        if (heading) {
          return (
            <h4 key={i} className="text-xs font-bold uppercase tracking-wider text-slate-400 mt-4 mb-1 border-b border-slate-200 pb-1">
              {heading[1].trim()}
            </h4>
          );
        }
        const body = chunk.trim();
        if (!body) return null;
        return i === 0 ? (
          <Fragment key={i}>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1 border-b border-slate-200 pb-1">About</h4>
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line mb-2">{body}</p>
          </Fragment>
        ) : (
          <p key={i} className="text-sm text-slate-700 leading-relaxed whitespace-pre-line mb-2">{body}</p>
        );
      })}
      <a href={wikiUrl} target="_blank" rel="noopener noreferrer"
        className="inline-block mt-2 mb-1 text-xs text-sky-600 hover:underline">
        Read more on Wikipedia →
      </a>
    </>
  );
}
