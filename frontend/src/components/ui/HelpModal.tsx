import { useState } from 'react';

// ── FAQ rich-text block types ─────────────────────────────────────────────────

type Block =
  | { type: 'p';   text: string }
  | { type: 'ul';  items: string[] }
  | { type: 'ol';  items: string[] }
  | { type: 'img'; src: string; alt: string };

interface FaqEntry {
  question: string;
  answer: Block[];
}

// ── FAQ content ───────────────────────────────────────────────────────────────

const FAQS: FaqEntry[] = [
  {
    question: 'Why am I not seeing any recently sighted birds in my region?',
    answer: [
      { type: 'p', text: 'The app defaults to a recent sightings window of 1 day. If you live in a remote region where there aren\'t many people reporting their sightings, you may need to broaden that window.' },
      { type: 'ul', items: [
        'Broaden the sightings window to 7 days or 30 days in the settings.',
        'You may also have set your region to a very local level. Try broadening it - for example, from city or county level up to state or province.',
      ]},
    ],
  },
  {
    question: 'Why does it seem like I\'m always at 0/3 or 0/5 questions asked?',
    answer: [
      { type: 'p', text: 'While learning a bird, a wrong answer at any level (easy, medium, or hard) resets your streak to 0. You must answer correctly in a row to advance:' },
      { type: 'ul', items: [
        '3 correct in a row to graduate from Easy and Medium levels.',
        '5 correct in a row to graduate from Hard to Mastered.',
      ]},
    ],
  },
  {
    question: 'What makes the questions harder on medium and hard levels?',
    answer: [
      { type: 'p', text: 'Both the images shown and the answer choices change as you advance:' },
      { type: 'ol', items: [
        'Easy - only the primary reference photo is used; answer options are completely random.',
        'Medium - a primary or secondary image is chosen randomly; answer options are birds from the same family.',
        'Hard - up to a dozen images and 6 or more audio clips can be shown; answer options are all from the same genus where possible.',
      ]},
      { type: 'p', text: 'Note: for some genera and families there aren\'t many closely related birds, so hard-level options may still be relatively easy to distinguish.' },
    ],
  },
  {
    question: 'I mastered a lot of birds and stopped getting re-exposed to them as they return to my region. How do I fix this?',
    answer: [
      { type: 'p', text: 'Two settings can help:' },
      { type: 'ol', items: [
        'Expire birds after 90 days - requires you to remaster birds on a seasonal basis. Birds that last migrated through your region 3 months ago will reappear as birds to master the next time they pass through.',
        'Trim outdated progress - a button in the settings panel that resets any birds not in your current recent sightings window back to unmastered. Birds that are mastered and still in your window remain mastered.',
      ]},
    ],
  },
  {
    question: 'I switched from Novice to Advanced (or Intermediate) but I\'m still seeing easy and medium level questions.',
    answer: [
      { type: 'p', text: 'Switching levels only affects new birds introduced into the learning palette. Any birds already in your learning palette must be advanced through the levels based on the old setting.' },
      { type: 'p', text: 'When you switch to Advanced, any newly introduced birds will start at the Hard level and require only 5 correct answers in a row to be considered mastered.' },
    ],
  },
  {
    question: 'What are blocked photos?',
    answer: [
      { type: 'p', text: 'There are two kinds of blocked photos:' },
      { type: 'ul', items: [
        'User-blocked - when you don\'t want a particular photo to appear in quizzes, click the ✕ on the photo to remove it from your pool. It will no longer show up in questions or in the photo carousel for that bird.',
        'Admin-blocked - photos flagged through error reports and reviewed by an administrator. When blocked by an admin, the photo is removed for all users, meaning your report helps improve the app for everyone.',
      ]},
      { type: 'p', text: 'In most cases, reporting an error is the better option. In the answer reveal screen, a "Report error" link appears inside the correct answer button. Use it to flag photos or audio clips that show the wrong bird, are poor quality, or are otherwise confusing. Photos of nests or eggs are interesting but may simply be blocked for quiz questions while remaining visible in info panels.' },
    ],
  },
  {
    question: 'What is the "Report error" link I see in the answer reveal screen?',
    answer: [
      { type: 'p', text: 'The "Report error" link appears in the correct answer button on every reveal screen. Click it to report media that is incorrect, poor quality, or confusing.' },
      { type: 'p', text: 'An administrator will review the report and can block that media from future questions, or from both questions and information panels like the photo carousel. Blocking applies to all users, so your report directly improves the quality of the app for everyone.' },
    ],
  },
  {
    question: 'Can the mobile app show me info about the birds I\'m seeing?',
    answer: [
      { type: 'p', text: 'Yes. The full info panel shown on desktop browsers can\'t be displayed the same way on smaller screens, but a dedicated info screen is available on mobile:' },
      { type: 'ol', items: [
        'Go to your life list.',
        'Tap any bird to open its info screen, which shows similar information to the desktop panel.',
        'From inside that screen, scroll to the bottom to find a search input where you can look up any other bird in the world.',
      ]},
    ],
  },
];

// ── Help sections ─────────────────────────────────────────────────────────────

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
    body: 'Choose what kind of questions you want to practice. Song / Call plays a recording and asks you to name the bird. Photo shows a picture of the bird. Latin Name shows the scientific name. Bird Family shows the family name. You can mix and match - any combination is valid.',
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
    body: 'Available in adaptive mode after answering a question. If you have birds you are really keen to nail your identification for, use this to ensure they appear more often. The setting applies per bird per question type - you might choose to be asked about the robin\'s song more often but not the robin\'s Latin name.',
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

// ── Block renderer ────────────────────────────────────────────────────────────

function RenderBlocks({ blocks }: { blocks: Block[] }) {
  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        if (block.type === 'p') {
          return <p key={i} className="text-sm text-slate-600 leading-relaxed">{block.text}</p>;
        }
        if (block.type === 'ul') {
          return (
            <ul key={i} className="list-disc list-outside pl-4 space-y-0.5">
              {block.items.map((item, j) => (
                <li key={j} className="text-sm text-slate-600 leading-relaxed">{item}</li>
              ))}
            </ul>
          );
        }
        if (block.type === 'ol') {
          return (
            <ol key={i} className="list-decimal list-outside pl-4 space-y-0.5">
              {block.items.map((item, j) => (
                <li key={j} className="text-sm text-slate-600 leading-relaxed">{item}</li>
              ))}
            </ol>
          );
        }
        if (block.type === 'img') {
          return (
            <img
              key={i}
              src={block.src}
              alt={block.alt}
              className="w-full rounded-lg object-cover"
            />
          );
        }
        return null;
      })}
    </div>
  );
}

// ── FAQ accordion item ────────────────────────────────────────────────────────

function FaqItem({ entry }: { entry: FaqEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-slate-100 last:border-0">
      <button
        className="w-full flex items-start justify-between gap-3 py-3 text-left"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className="text-sm font-medium text-slate-700 leading-snug">{entry.question}</span>
        <span className="text-slate-400 text-xs mt-0.5 shrink-0">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="pb-3">
          <RenderBlocks blocks={entry.answer} />
        </div>
      )}
    </div>
  );
}

// ── FAQ section (collapsed by default) ───────────────────────────────────────

function FaqSection() {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden mb-5">
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className="font-semibold text-slate-800 text-sm">Frequently Asked Questions</span>
        <span className="text-slate-400 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4">
          {FAQS.map((entry, i) => (
            <FaqItem key={i} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

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
        <div className="p-6">
          <FaqSection />
          <div className="space-y-5">
            {SECTIONS.map(s => (
              <div key={s.title}>
                <h3 className="font-semibold text-slate-800 mb-1">{s.title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
