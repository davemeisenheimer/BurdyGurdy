import { useEffect, useState, useRef } from 'react';
import type { QuizQuestion } from '../../types';
import { fetchBirdInfo } from '../../lib/api';
import type { BirdInfoData } from '../../lib/api';

interface Props {
  question:       QuizQuestion | null;
  isAnswered:     boolean;
  isCorrect:      boolean;
  selectedAnswer: string | null;
}

// ── IUCN conservation status ─────────────────────────────────────────────────

const IUCN_LABEL: Record<string, string> = {
  LC: 'Least Concern',
  NT: 'Near Threatened',
  VU: 'Vulnerable',
  EN: 'Endangered',
  CR: 'Critically Endangered',
  EW: 'Extinct in the Wild',
  EX: 'Extinct',
  DD: 'Data Deficient',
  NE: 'Not Evaluated',
};

const IUCN_COLOR: Record<string, string> = {
  LC: 'bg-green-100 text-green-800',
  NT: 'bg-lime-100 text-lime-800',
  VU: 'bg-amber-100 text-amber-800',
  EN: 'bg-orange-100 text-orange-800',
  CR: 'bg-red-100 text-red-800',
  EW: 'bg-purple-100 text-purple-800',
  EX: 'bg-slate-200 text-slate-600',
  DD: 'bg-slate-100 text-slate-500',
};

// ── Mini audio player ─────────────────────────────────────────────────────────

/** Full-height recording panel: sonogram fills space, controls pin to bottom. */
function RecordingPanel({ recordings }: { recordings: BirdInfoData['recordings'] }) {
  const [idx, setIdx]         = useState(0);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const rec = recordings[idx];

  useEffect(() => { setIdx(0); setPlaying(false); }, [recordings]);

  useEffect(() => {
    if (!audioRef.current) return;
    if (playing) audioRef.current.play().catch(() => setPlaying(false));
    else         audioRef.current.pause();
  }, [playing, idx]);

  if (recordings.length === 0) return null;

  return (
    <div className="flex flex-col h-full bg-slate-900 overflow-hidden">
      {/* Sonogram — expands to fill available space */}
      <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
        {rec.sonoUrl
          ? <img src={rec.sonoUrl} alt="Sonogram" className="w-full h-full object-cover" />
          : <span className="text-slate-500 text-xs">No sonogram</span>
        }
      </div>

      {/* Controls pinned to bottom */}
      <div className="shrink-0 flex items-center gap-1.5 px-2 py-2 bg-slate-800">
        {recordings.length > 1 && (
          <button
            onClick={() => { setPlaying(false); setIdx(i => (i - 1 + recordings.length) % recordings.length); }}
            className="w-6 h-6 rounded-full bg-slate-600 hover:bg-slate-500 flex items-center justify-center text-white text-sm"
          >‹</button>
        )}
        <button
          onClick={() => setPlaying(p => !p)}
          className="w-8 h-8 rounded-full bg-forest-600 hover:bg-forest-700 flex items-center justify-center text-white text-sm shadow"
        >
          {playing ? '⏸' : '▶'}
        </button>
        {recordings.length > 1 && (
          <button
            onClick={() => { setPlaying(false); setIdx(i => (i + 1) % recordings.length); }}
            className="w-6 h-6 rounded-full bg-slate-600 hover:bg-slate-500 flex items-center justify-center text-white text-sm"
          >›</button>
        )}
        <div className="flex-1 min-w-0 ml-1">
          {rec.type    && <p className="text-xs font-semibold text-slate-200 capitalize truncate">{rec.type}</p>}
          {rec.country && <p className="text-xs text-slate-400 truncate">{rec.country}</p>}
        </div>
        {recordings.length > 1 && (
          <span className="text-xs text-slate-400 shrink-0">{idx + 1}/{recordings.length}</span>
        )}
      </div>

      <audio ref={audioRef} src={rec.file} onEnded={() => setPlaying(false)} />
    </div>
  );
}

// ── Photo carousel ────────────────────────────────────────────────────────────

function PhotoCarousel({ photos, comName, wikiImageUrl }: { photos: BirdInfoData['photos']; comName: string; wikiImageUrl?: string | null }) {
  const all = [
    ...(photos.primary ? [photos.primary] : []),
    ...(wikiImageUrl && wikiImageUrl !== photos.primary ? [wikiImageUrl] : []),
    ...photos.optional,
  ].filter((url, i, arr) => arr.indexOf(url) === i); // deduplicate
  const [idx, setIdx] = useState(0);

  useEffect(() => setIdx(0), [photos]);

  if (all.length === 0) return null;

  return (
    <div className="relative bg-slate-900 h-full overflow-hidden">
      <img
        src={all[idx]}
        alt={comName}
        className="w-full h-full object-contain"
        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
      {all.length > 1 && (
        <>
          <button
            onClick={() => setIdx(i => (i - 1 + all.length) % all.length)}
            className="absolute left-1 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm"
          >‹</button>
          <button
            onClick={() => setIdx(i => (i + 1) % all.length)}
            className="absolute right-1 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm"
          >›</button>
          <span className="absolute bottom-1 right-1 bg-black/50 text-white text-xs px-1 py-0.5 rounded-full">
            {idx + 1}/{all.length}
          </span>
        </>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function BirdInfoPanel({ question, isAnswered, isCorrect, selectedAnswer }: Props) {
  const [info, setInfo]       = useState<BirdInfoData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isAnswered || !question) {
      setInfo(null);
      return;
    }
    setLoading(true);
    fetchBirdInfo(question.speciesCode, question.comName, question.sciName)
      .then(setInfo)
      .finally(() => setLoading(false));
  }, [question?.speciesCode, isAnswered]);

  // ── Idle / waiting state ──────────────────────────────────────────────────
  if (!isAnswered || !question) {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-slate-50 text-center px-8">
        <div className="text-5xl mb-4 opacity-30">🐦</div>
        <p className="text-slate-400 text-sm">
          {question ? 'Answer the question to reveal bird info' : 'Start a quiz to see bird info here'}
        </p>
      </div>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-slate-50">
        <p className="text-slate-400 text-sm">Loading bird info…</p>
      </div>
    );
  }

  const cs        = info?.conservationStatus;
  const csLabel   = cs ? (IUCN_LABEL[cs.code] ?? cs.name) : null;
  const csColor   = cs ? (IUCN_COLOR[cs.code] ?? 'bg-slate-100 text-slate-500') : null;

  const ebirdUrl   = `https://ebird.org/species/${question.speciesCode}`;
  const allAboutUrl = `https://www.allaboutbirds.org/guide/${question.sciName.replace(/ /g, '_')}`;
  const wikiUrl    = info?.wikipedia?.url ?? `https://en.wikipedia.org/wiki/${question.sciName.replace(/ /g, '_')}`;
  const inatUrl    = `https://www.inaturalist.org/taxa/search?q=${encodeURIComponent(question.sciName)}`;

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">

      {/* ── Answer result banner ── */}
      <div className={`shrink-0 px-4 py-2.5 border-b ${
        isCorrect ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'
      }`}>
        <p className={`text-sm font-semibold ${isCorrect ? 'text-green-700' : 'text-red-700'}`}>
          {isCorrect
            ? `✓ Correct — ${question.comName}`
            : `✗ You answered "${selectedAnswer}" — correct: ${question.comName}`}
        </p>
      </div>

      {/* ── Triptych: range map | sonogram+audio | photo carousel ── */}
      {(info?.photos || (info?.recordings?.length ?? 0) > 0 || info?.rangeMapUrl) && (
        <div className="shrink-0 flex gap-2 px-3 py-2 bg-white" style={{ height: '224px' }}>
          {/* Range map — left */}
          {info?.rangeMapUrl && (
            <div className="flex-1 min-w-0 overflow-hidden rounded-lg border border-stone-300 bg-white flex items-center p-1 gap-1.5">
              <div className="flex-1 min-w-0 flex items-center justify-center h-full">
                <img
                  src={info.rangeMapUrl}
                  alt={`${question.comName} range map`}
                  className="max-w-full max-h-full object-contain"
                />
              </div>
              {(info.rangeMapLegend?.length ?? 0) > 0 && (
                <div className="shrink-0 w-24 self-stretch flex flex-col rounded-lg border border-stone-300 bg-stone-50 px-2 py-1.5">
                  <p className="text-stone-500 font-semibold mb-1.5 leading-tight" style={{ fontSize: '0.6rem' }}>
                    Range legend:
                  </p>
                  <div className="flex-1 flex flex-col gap-0.5">
                    {info.rangeMapLegend.map(({ color, label }) => (
                      <div key={label} className="flex items-start gap-1">
                        <span className="shrink-0 mt-0.5 w-3 h-3 rounded-sm border border-stone-300" style={{ backgroundColor: color }} />
                        <span className="text-stone-600 leading-tight" style={{ fontSize: '0.62rem' }}>{label}</span>
                      </div>
                    ))}
                  </div>
                  <a href={ebirdUrl} target="_blank" rel="noopener noreferrer"
                    className="text-sky-600 hover:underline mt-1.5 leading-tight" style={{ fontSize: '0.6rem' }}>
                    Interactive map ↗
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Sonogram + audio — centre */}
          {(info?.recordings?.length ?? 0) > 0 && (
            <div className="flex-1 min-w-0 overflow-hidden rounded-lg border border-stone-300">
              <RecordingPanel recordings={info!.recordings} />
            </div>
          )}

          {/* Photo carousel — right */}
          {info?.photos && (
            <div className="flex-1 min-w-0 overflow-hidden rounded-lg border border-stone-300">
              <PhotoCarousel
                photos={info.photos}
                comName={question.comName}
                wikiImageUrl={info.wikipedia?.imageUrl}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Content card — fills remaining height, only the text scrolls ── */}
      <div className="flex-1 min-h-0 mx-3 mb-2 mt-1 rounded-xl border border-stone-300 flex flex-col overflow-hidden">

        {/* Species header — fixed */}
        <div className="shrink-0 px-5 pt-4 pb-3 space-y-1 border-b border-stone-100">
          <h2 className="text-2xl font-bold text-slate-900 leading-tight">{question.comName}</h2>
          <p className="text-base italic text-slate-500">{question.sciName}</p>
          <div className="flex flex-wrap items-center gap-1 pt-1 text-xs text-slate-500">
            <span className="bg-slate-100 px-2 py-0.5 rounded-full">Family: {question.familyComName}</span>
          </div>
          {cs && csLabel && csColor && (
            <div className="pt-1">
              <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${csColor}`}>
                IUCN: {cs.code} — {csLabel}
              </span>
            </div>
          )}
        </div>

        {/* Wikipedia extract — flex-grows and scrolls */}
        {info?.wikipedia?.extract && (
          <div className="flex-1 min-h-0 flex flex-col px-5 pt-3 pb-2">
            <h3 className="shrink-0 text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">About</h3>
            <div className="flex-1 min-h-0 overflow-y-auto pr-1">
              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                {info.wikipedia.extract}
              </p>
            </div>
            <a href={wikiUrl} target="_blank" rel="noopener noreferrer"
              className="shrink-0 inline-block mt-2 mb-1 text-xs text-sky-600 hover:underline">
              Read more on Wikipedia →
            </a>
          </div>
        )}

        {/* Range map fallback — only shown when no map image */}
        {!info?.rangeMapUrl && (
          <div className="shrink-0 px-5 py-3 border-t border-stone-100">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Range & Distribution</h3>
            <a href={`https://ebird.org/species/${question.speciesCode}`} target="_blank" rel="noopener noreferrer"
              className="text-sm text-sky-600 hover:underline">
              View interactive range map on eBird ↗
            </a>
          </div>
        )}

        {/* Quick links — always visible at the bottom */}
        <div className="shrink-0 px-5 py-3 border-t border-stone-100">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">More Information</h3>
          <div className="flex flex-wrap gap-2">
            {[
              { label: 'eBird',           href: ebirdUrl },
              { label: 'All About Birds', href: allAboutUrl },
              { label: 'Wikipedia',       href: wikiUrl },
              { label: 'iNaturalist',     href: inatUrl },
              { label: 'Audubon',         href: `https://www.audubon.org/field-guide/bird/${question.comName.toLowerCase().replace(/ /g, '-')}` },
              { label: 'Xeno-canto',      href: `https://xeno-canto.org/explore?query=${encodeURIComponent(question.sciName)}` },
            ].map(({ label, href }) => (
              <a key={label} href={href} target="_blank" rel="noopener noreferrer"
                className="text-xs px-3 py-1.5 rounded-full border border-slate-300 text-slate-600 hover:bg-slate-50 hover:border-slate-400 transition-colors">
                {label} ↗
              </a>
            ))}
          </div>
        </div>

      </div>{/* end content card */}
    </div>
  );
}
