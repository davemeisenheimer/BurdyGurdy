import { useState } from 'react';
import type { LevelUpEvent, QuestionType } from '../../types';
import { MASTERY_ADVANCE_STREAK, GRADUATION_STREAK } from '../../lib/mastery';

const TYPE_LABELS: Partial<Record<QuestionType, string>> = {
  image: 'photo', song: 'song', sono: 'spectrogram',
  family: 'family', latin: 'Latin name', order: 'order',
  'image-latin': 'photo+Latin', 'song-latin': 'song+Latin', 'family-latin': 'family+Latin',
  'image-song': 'photo+song', 'sono-song': 'spectro+song', 'latin-song': 'Latin+song',
};

// Fast-track sets consecutiveCorrect=2, so GRADUATION_STREAK - 2 more are needed.
// Normal path from level 1: MASTERY_ADVANCE_STREAK (medium) + GRADUATION_STREAK (hard).
const FAST_TRACK_REMAINING  = GRADUATION_STREAK - 2;
const NORMAL_PATH_REMAINING = MASTERY_ADVANCE_STREAK + GRADUATION_STREAK;

interface Props {
  candidate: LevelUpEvent;
  /** accept=true when the user clicked Fast-track; always=true when the "always" checkbox was checked. */
  onConfirm: (accept: boolean, always: boolean) => void;
}

export function FastTrackDialog({ candidate, onConfirm }: Props) {
  const [always, setAlways] = useState(false);
  const typeLabel = TYPE_LABELS[candidate.questionType] ?? candidate.questionType;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
      <div className="bg-sky-50 rounded-2xl shadow-2xl ring-1 ring-black/5 w-full max-w-md p-6">
        <img src="/BurdyFasttrack_350.png" alt="" className="w-full rounded-xl mb-4" />
        <h2 className="text-lg font-bold text-slate-800 mb-2">You already know this bird!</h2>
        <p className="text-sm text-slate-600 mb-5">
          You identified <span className="font-medium">{candidate.comName}</span> correctly on
          your first {MASTERY_ADVANCE_STREAK} attempts. If you already know this bird, you can
          skip straight to hard {typeLabel} questions -
          just <span className="font-medium">{FAST_TRACK_REMAINING} more</span> consecutive
          correct to master it, instead of {NORMAL_PATH_REMAINING}.
        </p>
        <label className="flex items-center gap-3 cursor-pointer mb-6">
          <input
            type="checkbox"
            checked={always}
            onChange={e => setAlways(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 accent-forest-600"
          />
          <span className="text-sm text-slate-700">Always fast-track birds I ace on easy</span>
        </label>
        <div className="flex gap-3">
          <button
            onClick={() => onConfirm(false, false)}
            className="flex-1 px-4 py-2 bg-sky-100 border border-sky-200 text-slate-700 rounded-xl text-sm hover:bg-sky-200 transition-colors"
          >
            Normal Progress
          </button>
          <button
            onClick={() => onConfirm(true, always)}
            className="flex-1 px-4 py-2 bg-forest-600 hover:bg-forest-700 text-white rounded-xl text-sm font-semibold transition-colors"
          >
            Fast-track
          </button>
        </div>
      </div>
    </div>
  );
}
