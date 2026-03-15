# BurdyGurdy

A bird identification quiz app that teaches you to recognise birds by their songs, calls, photos, Latin names, and family relationships.

## How it works

### Question types

Each question presents one of four challenge types:

- **Song / Call** — Listen to a recording and identify the bird
- **Photo** — Look at a photo and identify the bird
- **Latin Name** — Match a scientific name to the common name
- **Bird Family** — Identify which bird family a species belongs to

You choose which question types to include before starting a round.

### Answering questions

Each question shows four options. After you answer, you see whether you were right, a photo of the bird (with multiple photos you can swipe through), its Latin name, family, and a link to its eBird species page.

### Learning modes

**Adaptive mode** (recommended) uses your answer history to focus on the birds and question types you find difficult. As you improve, the app gradually introduces more species and harder distractors. See [How the adaptive system works](#how-the-adaptive-system-works) below.

**Random mode** picks questions evenly from all birds recently observed in your region.

### Regions and bird groups

Set your region using an eBird region code (e.g. `CA-ON` for the province of Ontario, `CA-ON-OT` for the city of Ottawa, Ontario) or use the map picker to click your location. You can also narrow the quiz to a specific bird group (songbirds, waterfowl, raptors, etc.).

---

## How the adaptive system works

### Starting out

When you first play in adaptive mode, the app picks a small set of common backyard birds for your region and focuses entirely on those. Questions repeat these birds often so you can build a solid foundation before new species are introduced.

### Distractor difficulty

Wrong-answer options (distractors) start easy — birds from completely different families that look and sound nothing alike. As you consistently get a bird right, the distractors get harder:

1. **Easy** — birds from different families entirely
2. **Medium** — birds from the same family, different genus
3. **Hard** — birds from the same genus (easily confused species)

You need three consecutive correct answers at a given level to advance to the next.

### Introducing new species

As you get comfortable with your current set of birds, new species are gradually introduced. The app keeps roughly ten birds at the "just learning" stage at any time. When you've mastered one of those birds (five consecutive correct answers with hard distractors), it moves into a "well-known" group and a new species takes its place. The total number of birds you're actively working on grows over time, up to about thirty at once.

### Occasional wild cards

A very small fraction of questions (about 1 in 100) may feature a bird you've never been quizzed on before — just to keep things interesting. Getting this question right or wrong has no effect on whether that bird is formally introduced.

### Well-known birds

Birds you've thoroughly mastered still appear occasionally so you don't forget them. The better your track record with a species, the less frequently it appears — it makes way for birds you still need to learn. A species you can identify correctly almost every time will appear rarely; one you got right 95% of the time or less stays at normal frequency.

### Progress screen

The **My Progress** screen shows every bird you've been quizzed on, with accuracy stats per question type, current distractor difficulty level, and progress toward the next difficulty level. Birds you've fully mastered appear on a separate **Mastered** tab. You can also mark birds as favourites (to see them more often) or hide birds you never want to see again.

---

## Tech stack

- **Frontend**: React + TypeScript + Vite + Tailwind CSS
- **Backend**: Node.js + Express (TypeScript)
- **Bird data**: eBird API v2 (regional species lists, taxonomy)
- **Audio**: xeno-canto (bird song recordings)
- **Photos**: iNaturalist
- **Progress storage**: IndexedDB (browser-local, no account required)
- **Mobile**: Capacitor wrapper (planned)
