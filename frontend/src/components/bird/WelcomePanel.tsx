import { AccountPill } from '../ui/AccountPill';

interface Props {
  hasActiveQuestion: boolean;
  userEmail?:  string | null;
  onAuthClick?: () => void;
  onSignOut?:   () => void;
}

export function WelcomePanel({ hasActiveQuestion, userEmail, onAuthClick, onSignOut }: Props) {
  if (hasActiveQuestion) {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-slate-50 text-center px-8">
        <img src="/BurdySinging.png" alt="" className="h-12 w-auto mb-4 opacity-30" />
        <p className="text-slate-400 text-sm">Answer the question to reveal bird info</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-y-auto">
      <div className="flex-1 flex flex-col items-center justify-center px-8 py-10">
        <div className="w-full max-w-[34rem]">

          <h1 className="text-3xl font-bold text-slate-800 leading-tight text-center">BirdyGurdy</h1>
          <p className="text-sm text-slate-500 mt-1 text-center">by Three Corner Orchard Technology</p>

          <ul className="mt-6 space-y-3">
            {[
              { icon: '🧠', text: 'Adaptive learning — birds are introduced gradually, with most common birds first, and the quiz adjusts to your pace as you build mastery.' },
              { icon: '📍', text: 'Region-based sightings — your quiz pool comes from real eBird observations in your area, so you learn birds you\'ll actually encounter. If you use the map to select your region, the zoom level will determine scope: county, province/state, or country.' },
              { icon: '⚙️', text: 'Configurable — choose your region, bird families you care about, question types (song, photo...), observation window, and how many questions per round. Visit settings for more configurability options.' },
            ].map(({ icon, text }) => (
              <li key={icon} className="flex items-start gap-3">
                <div className="shrink-0 w-20 flex justify-end">
                  <span className="text-xl leading-snug">{icon}</span>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">{text}</p>
              </li>
            ))}
            <li className="flex items-start gap-3">
              <div className="shrink-0 w-20 flex justify-end">
                <AccountPill userEmail={userEmail} onAuthClick={onAuthClick ?? (() => {})} onSignOut={onSignOut ?? (() => {})} dropdownAlign="right" compact />
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">Sign in to back up your progress and sync it across all your devices. Your learning history, favourites, and settings follow you everywhere.</p>
            </li>
          </ul>

          <div className="mt-8 pt-6 border-t border-slate-200">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Powered by</h2>
            <div className="flex flex-wrap gap-2 text-center justify-center">
              {[
                { label: 'eBird / Cornell Lab',          desc: 'Species lists & sightings' },
                { label: 'iNaturalist',                  desc: 'Bird photos' },
                { label: 'Macaulay Library',             desc: 'Bird photos' },
                { label: 'xeno-canto',                   desc: 'Bird songs & calls' },
                { label: 'Wikipedia / Wikimedia Commons', desc: 'Species info & photos' },
              ].map(({ label, desc }) => (
                <div key={label} className="flex flex-col bg-white border border-slate-200 rounded-lg px-3 py-2">
                  <span className="text-xs font-semibold text-slate-700">{label}</span>
                  <span className="text-[10px] text-slate-400">{desc}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col items-center mt-8 text-center">
            <img src="/BurdySinging.png" alt="" className="h-16 w-auto mb-3" />
            <p className="text-slate-500 text-sm">Start a quiz on the left to begin identifying birds.</p>
          </div>

        </div>
      </div>
    </div>
  );
}
