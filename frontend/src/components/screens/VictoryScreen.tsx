import { BACKYARD_BIRDER_COUNT, AWARD_NAMES, describeMastery, describeWindow } from '../../lib/victory';
import type { AwardTier } from '../../lib/victory';
import type { QuestionType } from '../../types';

interface Props {
  awardTier: AwardTier;
  recentWindow: 'day' | 'week' | 'month';
  questionTypes: QuestionType[];
  onKeepPlaying: () => void;
  onHome: () => void;
}

interface TierContent {
  emoji: string;
  description: (windowLabel: string, masteryDesc: string) => string;
  whatsNext: string;
}

const TIER_CONTENT: Record<AwardTier, TierContent> = {
  firstStep: {
    emoji: '🐣',
    description: (_w, mastery) =>
      `You've identified your first bird by its ${mastery}. Every legend starts somewhere.`,
    whatsNext: `Master ${BACKYARD_BIRDER_COUNT - 1} more species to earn the Backyard Birder award.`,
  },
  backyardBirder: {
    emoji: '🏡',
    description: (_w, mastery) =>
      `You can reliably identify ${BACKYARD_BIRDER_COUNT} species by their ${mastery}. You're finding your wings.`,
    whatsNext: 'Master all common birds in your recent sightings window to earn the Patch Regular award.',
  },
  patchRegular: {
    emoji: '🌿',
    description: (window, mastery) =>
      `You've mastered all common birds spotted in your region ${window} by their ${mastery}.`,
    whatsNext: 'Master every bird in your recent sightings window to become a Local Legend.',
  },
  localLegend: {
    emoji: '🏆',
    description: (window, mastery) =>
      `You've mastered every bird spotted in your region ${window} by their ${mastery}.`,
    whatsNext: 'Work on historical birds — rare visitors and year-round residents — to become a Regional Champion.',
  },
  regionalChampion: {
    emoji: '👑',
    description: (_w, mastery) =>
      `You've mastered every bird ever recorded in your region by its ${mastery}. Remarkable!`,
    whatsNext: 'You\'ve reached the pinnacle of bird mastery for your region. Play on to stay sharp.',
  },
};

export function VictoryScreen({ awardTier, recentWindow, questionTypes, onKeepPlaying, onHome }: Props) {
  const { emoji, description, whatsNext } = TIER_CONTENT[awardTier];
  const masteryDesc  = describeMastery(questionTypes);
  const windowLabel  = describeWindow(recentWindow);
  const windowDesc   = { day: 'today', week: 'this past week', month: 'this past month' }[recentWindow];
  const isWindowTier = awardTier === 'patchRegular' || awardTier === 'localLegend' || awardTier === 'regionalChampion';

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center p-6 bg-gradient-to-b from-forest-50 to-white">
      <div className="w-full max-w-md text-center">

        <div className="text-7xl mb-6">{emoji}</div>

        <h1 className="text-3xl font-bold text-forest-700 mb-3">
          {AWARD_NAMES[awardTier]}!
        </h1>

        <p className="text-lg text-slate-700 mb-2">
          {description(windowLabel, masteryDesc)}
        </p>

        {awardTier !== 'regionalChampion' && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-8 text-left">
            <p className="text-sm font-semibold text-slate-700 mb-2">What's next?</p>
            <p className="text-sm text-slate-600">{whatsNext}</p>
          </div>
        )}

        {awardTier === 'regionalChampion' && (
          <p className="text-sm text-slate-500 mb-8">{whatsNext}</p>
        )}

        {(awardTier === 'localLegend' || awardTier === 'regionalChampion') && (
          <div className="bg-amber-50 rounded-2xl border border-amber-200 p-4 mb-8 text-left">
            <p className="text-sm font-semibold text-amber-800 mb-1">Keep your skills sharp</p>
            <p className="text-sm text-amber-700">
              Turn on <span className="font-medium">Expire mastered birds after 90 days</span> in Settings.
              Birds you haven't practiced in 3 months will cycle back into your quiz when they return to your area — keeping mastery seasonal and meaningful.
            </p>
          </div>
        )}

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
          {isWindowTier ? `Birds spotted ${windowDesc} · ` : ''}
          {masteryDesc}
        </p>

      </div>
    </div>
  );
}
