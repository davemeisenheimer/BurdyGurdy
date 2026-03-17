import type { QuestionType } from '../../types';
import { describeMastery, describeWindow } from '../../lib/victory';

interface Props {
  recentWindow: 'day' | 'week' | 'month';
  questionTypes: QuestionType[];
  onKeepPlaying: () => void;
  onHome: () => void;
}

export function VictoryScreen({ recentWindow, questionTypes, onKeepPlaying, onHome }: Props) {
  const windowLabel = { day: 'today', week: 'this past week', month: 'this past month' }[recentWindow];
  const masteryDesc = describeMastery(questionTypes);
  const windowDesc = describeWindow(recentWindow);

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center p-6 bg-gradient-to-b from-forest-50 to-white">
      <div className="w-full max-w-md text-center">

        <div className="text-7xl mb-6">🏆</div>

        <h1 className="text-3xl font-bold text-forest-700 mb-3">
          Local Legend!
        </h1>

        <p className="text-lg text-slate-700 mb-2">
          You've mastered every bird spotted in your region {windowLabel}.
        </p>
        <p className="text-sm text-slate-500 mb-8">
          You can identify them all by their {masteryDesc}.
        </p>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-8 text-left">
          <p className="text-sm font-semibold text-slate-700 mb-2">What's next?</p>
          <p className="text-sm text-slate-600">
            By continuing, you'll practice birds found in your region throughout the year — first the more common ones, then the rarer ones. Your progress carries over.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <button
            onClick={onKeepPlaying}
            className="w-full py-3 px-6 bg-forest-600 hover:bg-forest-700 text-white font-semibold rounded-xl transition-colors"
          >
            Keep Playing
          </button>
          <button
            onClick={onHome}
            className="w-full py-3 px-6 bg-white hover:bg-slate-50 text-slate-600 font-medium rounded-xl border border-slate-200 transition-colors"
          >
            Back to Home
          </button>
        </div>

        <p className="text-xs text-slate-400 mt-6">
          Birds spotted {windowDesc} · {questionTypes.length === 1 ? '1 question type' : `${questionTypes.length} question types`}
        </p>
      </div>
    </div>
  );
}
