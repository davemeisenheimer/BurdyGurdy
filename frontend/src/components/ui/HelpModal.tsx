interface Props {
  onClose: () => void;
}

interface HelpSection {
  title: string;
  body: string;
}

const SECTIONS: HelpSection[] = [
  {
    title: 'Region',
    body: 'Search for any region by place name, or enter an eBird region code directly (e.g. US-WA for Washington State, CA-ON for Ontario, CR for Costa Rica). Questions will draw from birds recently observed in that region.',
  },
  {
    title: 'Question Types',
    body: 'Choose what kind of questions you want to practice. Song / Call plays a recording and asks you to name the bird. Photo shows a picture of the bird. Latin Name shows the scientific name. Bird Family shows the family name. You can mix and match — any combination is valid.',
  },
  {
    title: 'Bird Group',
    body: 'Narrow the question pool to a specific group of birds. Great if you are preparing for a particular habitat or trip. "All Birds" uses everything recently observed in your region.',
  },
  {
    title: 'Learning Mode',
    body: 'Adaptive mode introduces new birds gradually, seeding the question pool with new ones as the birds in the current pool are mastered. Questions for a given bird and question type will become more difficult as the user works towards mastery. The pool of birds in the question pool grows as the user eases into the game. Random mode picks questions evenly regardless of your history.',
  },
  {
    title: 'Ask More Often (★)',
    body: 'Available in adaptive mode after answering a question. If you have birds you are really keen to nail your identification for, use this to ensure they appear more often. The setting applies per bird per question type — you might choose to be asked about the robin\'s song more often but not the robin\'s Latin name.',
  },
  {
    title: 'Don\'t ask again',
    body: 'Available in adaptive mode after answering a question. If this bird is very easy for you, you can choose to eliminate it from the question pool. This setting is per question type: you can choose to not see a photo type question about this bird again, but still get questions relating to it\'s song, latin name, etc.',
  },
  {
    title: 'Questions per Round',
    body: 'How many questions appear in each round. Shorter rounds are great for quick practice; longer rounds give a more thorough workout.',
  },
  {
    title: 'Answer form',
    body: 'By default, the answer choices are common names for a bird. In the settings screen there are options, however, to have some questions for which the user must choose between latin names or songs when attempting to answer.',
  },
  {
    title: 'Distinguishing Features',
    body: 'BurdyGurdy\'s Adaptive Mode is designed to grow the user\'s knowledge by advancing from identification of the most common birds to less common birds as they continue playing the game. The birds presented are drawn from live data about birds observed in the chosen reason, so the game play is designed to be relevant to both the area and the time of year. If you play this game in January, you will see considerably different questions than if you play in June. The game is also designed to be highly configurable: If you want to be able to identify the birds you see at your feeder, you might only be interested in photo type questions but, if you are interested in birds in habitats with restricted visibility, then you might be more interested in song type questions. Likewise, if you are headed seaside, you might be interested in playing the game with just shorebirds. BurdyGurdy\'s Adaptive Mode gives you all of this flexibiilty.',
  },
];

export function HelpModal({ onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <h2 className="text-xl font-bold text-slate-800">How to Play</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="p-6 space-y-5">
          {SECTIONS.map(s => (
            <div key={s.title}>
              <h3 className="font-semibold text-slate-800 mb-1">{s.title}</h3>
              <p className="text-sm text-slate-600 leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
