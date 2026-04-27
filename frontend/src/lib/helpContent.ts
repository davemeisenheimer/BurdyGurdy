export interface HelpEntry {
  title: string;
  body: string[];
  imageUrl?: string;
}

export const HELP_CONTENT: Record<string, HelpEntry> = {
  // ── Home screen ────────────────────────────────────────────────────────────
  region: {
    title: 'Region',
    body: [
      'Your region determines which birds appear in your quiz. BirdyGurdy uses recent eBird sightings from your chosen area to build a pool of locally-occurring birds.',
      'You can type a place name, enter an eBird region code directly (e.g. CA-ON, US-WA, CR), or pick a region using the map.',
    ],
  },
  questionsPerRound: {
    title: 'Questions per Round',
    body: [
      'How many questions you answer before seeing your results summary.',
      'Shorter rounds are great for quick sessions; longer rounds give more variety and practice in one go.',
      'Another benefit of short rounds is that you might see birds you are attempting to master, or birds that you are struggling with, more often.'
    ],
  },
  questionTypes: {
    title: 'Question Types',
    body: [
      'Choose which kinds of questions appear in your quiz. You can enable any combination. Be aware that if you have only one question type set and you wish to switch to another, you must first select the new question type and then deselect the old one.',
      'Song/Call: listen to a recording and name the bird. Photo: identify from a picture. Latin Name: choose the correct scientific name. Bird Family and Bird Order test taxonomic knowledge. Spectrogram: identify the bird from a visual frequency graph of its call.',
      'Pro Tip: Using one question type at a time can allow you to focus and get to local legend victory quicker!'
    ],
  },
  birdGroup: {
    title: 'Bird Group',
    body: [
      'Filter the quiz to a specific birds. "All" includes every bird seen in your region, beginning with the most common.',
      'The Life List Selections option opens a view where you can manually select which birds to include in your quiz. This works '
      + 'best once you have mastered dozens of birds and have a few that you mix up and want to really drill down on.',
    ],
  },
  learningMode: {
    title: 'Learning Mode',
    body: [
      'Adaptive mode tracks your progress and focuses on birds you find difficult, while mastered birds get only occasional review to keep them fresh. '
      + 'In this mode a pedogogical algrorithm is applied to optimize your learning. For exampe, the game will: a) progress from more common backyard '
      + 'birds to less common species, b) increase the frequency of exposure to birds you are struggling with, c) only introduce new birds to the '
      + '"learning palette" as other birds are graduated through the palette levels.',
      'Random mode picks birds and question types with equal probability, ignoring your history. Your progress is not tracked in random mode. For example, '
      + 'birds you are quizzed on in random mode will not appear in your life list.',
    ],
  },

  // ── Settings screen ────────────────────────────────────────────────────────
  recentWindow: {
    title: 'Recent sightings window',
    body: [
      'Controls which birds are included in your local pool. Playing with a 1 day window is a nice way to stay on top of birds moving into '
      + 'your area as you sip your morning coffee.',
      '"Today" uses only birds reported in the last 24 hours for a hyper-local experience. "Past week" and "Past month" cast a wider net and '
      + 'include birds are seen less frequently or may have moved out of your area already.',
      'If you are in an area where there are a lot of reported sightings, the 1d window is the way to go. If you are in an area where there '
      + 'are\'t so many people reporting, then a longer window might give you the right experience.'
    ],
  },
  autoplayRevealAudio: {
    title: 'Autoplay bird song on reveal',
    body: [
      'Automatically plays the bird\'s song when the answer is revealed, so you can associate the sound with the species even on photo questions.',
    ],
  },
  latinAnswerQuestions: {
    title: 'Latin-answer questions',
    body: [
      'Adds question variants where you choose the correct Latin (scientific) name as the answer.',
      'Works alongside Photo, Song, and Family questions. Progress badges for these variants show an "L" suffix in your life list.',
    ],
  },
  songAnswerQuestions: {
    title: 'Song-answer questions',
    body: [
      'Adds question variants where you pick the correct bird song from multiple audio clips.',
      'Works alongside Photo, Spectrogram, and Latin questions. Progress badges for these variants show an "S" suffix.',
    ],
  },
  randomizeQuestionPhotos: {
    title: 'Randomize question photos',
    body: [
      'Picks a different photo each time a species appears as a question, rather than always using the primary photo.',
      'This helps you recognise birds across different poses, ages, and lighting conditions.',
    ],
  },
  expireMasteredBirds: {
    title: 'Expire mastered birds after 90 days',
    body: [
      'Ninety days after you master a bird, it re-enters the quiz question pool at level 2 - one step from re-mastery.',
      'This ensures long-term retention for birds you haven\'t seen in a while, without making you start from scratch. It also ensures '
      + 'that you will be alerted when these birds are next in your area as you will be presented with questions about these birds at '
      + 'a higher frequency and will see the recent sighting reports in the answer reveal screen.',
    ],
  },
  outdatedProgress: {
    title: 'Outdated progress',
    body: [
      'If you change your region or tighten your sightings window, some birds in your quiz history may no longer appear in your area.',
      'This removes their progress records so your quiz stays focused on birds you\'re likely to actually see today.',
    ],
  },
  autoScrollRelatedSpecies: {
    title: 'Auto-scroll related species',
    body: [
      'When the bird info panel opens, the related species carousel automatically scrolls through once to show you what\'s there, then stops.',
      'Turn this off if you find the motion distracting.',
    ],
  },
  maxRecentSightings: {
    title: 'Max recent sightings',
    body: [
      'How many recent eBird sightings are shown in the bird info panel when you reveal an answer.',
      'Set to 0 to hide the sightings section entirely.',
    ],
  },
  blockedPhotos: {
    title: 'Blocked photos',
    body: [
      'When you tap the remove button on a photo during a quiz, that photo is added to your personal block list and won\'t appear again.',
      'Use this button to clear the list and allow all previously blocked photos back.',
    ],
  },
  enableAdminFeatures: {
    title: 'Enable admin features',
    body: [
      'Shows the curation panel and report management tools in the right panel.',
      'Only visible to admin accounts.',
    ],
  },
  birderLevel: {
    title: 'Birder experience level',
    body: [
      'Sets the difficulty path for mastering new birds.',
      'Novice: The path to mastery progresses through easy, then medium, and finally difficult questions.',
      'Intermediate: The path to mastery will skip the easy questions.',
      'Advanced: The path to mastery will skip easy and medium difficulty questions.',
    ],
  },
  alwaysFastTrack: {
    title: 'Always fast-track birds I ace on easy',
    body: [
      'When enabled, any bird you identify correctly on all three of your first-ever attempts automatically '
      + 'skips medium difficulty and goes straigth to hard difficulty, without showing a confirmation dialog.',
      'At hard difficulty you need 5 consecutive correct answers to master a bird, but you start with a '
      + '2-answer head-start — so just 3 more correct in a row.',
      'You can turn this off at any time to return to the using the confirmation dialog, or to let birds '
      + 'follow the normal easy → medium → hard progression. Be aware that for photo questions you are missing '
      + 'the progression from single photo on easy to dual photos on medium and up to a dozen different photos '
      + 'on hard, which can make it harder to master the bird in the long run, even if you ace it on easy.',
    ],
  },
  mapScope: {
    title: 'Map scope',
    body: [
      'Determines which sightings are shown on the recent sightings map. The list of sightings includes only '
      + 'the most recent sighting for each species seen in the past 24 hours. By default, clicking on one of '
      + 'these sightings will show you its location on the map but the map is configurable:',
      'Latest selected: Shows only the most recent sighting for the species selected in the list.',
      'All for selected: Shows all sightings, in the past 24 hours, for the species selected. If you select '
      + 'a different item from the list in this mode, all of the dots are replaced to show all of the places '
      + 'where the newly selected species has been seen in the past 24 hours.',
      'All species: Shows the most recent sighting for all species seen in the past 24 hours. When you select '
      + 'a sighting from the list, it will be highlighted on the map and the sighting details will be shown in '
      + 'the info card, but the other dots on the map will continue to show the most recent sightings for all '
      + 'the other species seen in the past 24 hours.',
    ],
  },
};
