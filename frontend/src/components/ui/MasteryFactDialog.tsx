import { useEffect, useState } from 'react';
import { fetchFactForBird } from '../../lib/facts';
import type { FactResult } from '../../lib/facts';
import type { LevelUpEvent, QuestionType } from '../../types';

const TYPE_LABELS: Partial<Record<QuestionType, string>> = {
  image:  'images',
  song:   'songs',
  latin:  'Latin names',
  family: 'family names',
  order:  'order names',
  sono:   'spectrograms',
};

interface Props {
  event:   LevelUpEvent;
  onClose: () => void;
}

export function MasteryFactDialog({ event, onClose }: Props) {
  const [result, setResult]   = useState<FactResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchFactForBird(event.speciesCode)
      .then(setResult)
      .finally(() => setLoading(false));
  }, [event.speciesCode]);

  const typeLabel = TYPE_LABELS[event.questionType] ?? event.questionType;

  let intro = 'an interesting bird fact';
  if (result) {
    if (result.context === 'species') {
      intro = `an interesting fact about ${event.comName}`;
    } else if (result.context === 'family' && result.fact.familyNames[0]) {
      intro = `an interesting fact about birds in the ${result.fact.familyNames[0]} family`;
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden">

        {/* Header */}
        <div className="bg-forest-600 px-5 pt-5 pb-4">
          <p className="text-white/75 text-xs font-semibold uppercase tracking-wider mb-1">
            You mastered {typeLabel} for
          </p>
          <h2 className="text-white text-xl font-bold leading-tight">{event.comName}</h2>
        </div>

        {/* Fact body */}
        <div className="px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center h-20">
              <p className="text-sm text-slate-400">Loading…</p>
            </div>
          ) : result ? (
            <>
              <p className="text-xs text-slate-500 mb-3">As a reward, here is {intro}:</p>
              <p className="text-sm text-slate-700 leading-relaxed">{result.fact.factText}</p>
              {result.fact.sourceUrl && (
                <p className="text-[10px] text-slate-400 mt-2 truncate">{result.fact.sourceUrl}</p>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-500 text-center py-4">
              Well done - keep it up!
            </p>
          )}
        </div>

        {/* Favicon + button */}
        <div className="px-5 pb-5 flex flex-col items-center gap-3">
          <img src="/favicon.png" alt="" aria-hidden className="w-12 h-12 object-contain" />
          <button
            onClick={onClose}
            className="w-full py-2.5 bg-forest-600 hover:bg-forest-700 active:bg-forest-800 text-white rounded-xl text-sm font-semibold transition-colors"
          >
            Continue
          </button>
        </div>

      </div>
    </div>
  );
}
