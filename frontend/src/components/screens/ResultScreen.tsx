import type { QuizConfig } from '../../types';

interface Props {
  score: { correct: number; total: number };
  config: QuizConfig;
  onRestart: () => void;
  onHome: () => void;
}

export function ResultScreen({ score, config, onRestart, onHome }: Props) {
  const pct = Math.round((score.correct / score.total) * 100);
  const emoji = pct >= 80 ? '🎉' : pct >= 60 ? '🙂' : '💪';

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md text-center">
        <div className="text-6xl mb-4">{emoji}</div>
        <h2 className="text-3xl font-bold text-slate-800 mb-2">Round Complete</h2>
        <p className="text-slate-500 mb-8">
          Region: <span className="font-medium">{config.regionCode}</span>
        </p>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 mb-6">
          <div className="text-6xl font-bold text-forest-700 mb-2">{pct}%</div>
          <div className="text-slate-500 text-lg">
            {score.correct} correct out of {score.total}
          </div>
        </div>

        <div className="space-y-3">
          <button
            onClick={onRestart}
            className="w-full py-3 rounded-xl bg-forest-600 hover:bg-forest-700 text-white font-semibold text-lg transition-colors"
          >
            Play Again
          </button>
          <button
            onClick={onHome}
            className="w-full py-3 rounded-xl border-2 border-slate-300 hover:border-slate-400 text-slate-700 font-semibold text-lg transition-colors"
          >
            Change Settings
          </button>
        </div>
      </div>
    </div>
  );
}
