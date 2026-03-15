# BurdyGurdy — Technical Requirements

This document describes the agreed design of the adaptive learning system, key data structures, and configurable constants. It is the authoritative reference for implementation decisions.

---

## Glossary

| Term | Definition |
|---|---|
| **Learning Palette** | The set of all birds currently being actively learned. Includes birds at mastery levels 0, 1, and 2. |
| **Level 0** | "Just introduced" birds. Distractors are from different families (easy). A bird stays at level 0 until the user answers it correctly `MASTERY_ADVANCE_STREAK` times in a row. |
| **Level 1** | "Getting there" birds. Distractors are from the same family, different genus (medium). Advances to level 2 after `MASTERY_ADVANCE_STREAK` consecutive correct answers. |
| **Level 2** | "Almost mastered" birds. Distractors are from the same genus (hard). Graduates to the Mastered Palette after `GRADUATION_STREAK` consecutive correct answers. |
| **Mastered Palette** | All birds that have graduated from level 2. Grows indefinitely. Birds here appear less often, and appearance frequency decreases as the user's accuracy with them improves. |
| **Unseen Birds** | Regional birds that have never been introduced to the Learning Palette. Appear only as an occasional "wild card" question; getting one right does **not** promote it into the Learning Palette. |
| **Promotion** | The act of moving an unseen bird into level 0 of the Learning Palette. Triggered automatically when a level 0 bird advances to level 1, subject to capacity constraints. |
| **Graduation** | The act of moving a level 2 bird into the Mastered Palette. Triggered by `GRADUATION_STREAK` consecutive correct answers at level 2. |
| **Advancement event** | Any time a bird advances from one mastery level to the next (0→1, 1→2, or 2→mastered). |
| **Distractor** | A wrong-answer option in a multiple-choice question. |
| **Palette distractor preference** | Distractors are weighted to prefer birds currently in the Learning Palette, reinforcing active learning. |
| **Consecutive streak** | The number of consecutive correct answers for a specific (species, question type) pair at the current mastery level. Resets to 0 on any incorrect answer. Mastery level never decreases. |
| **Question type** | One of: `song`, `image`, `latin`, `family`. Mastery is tracked independently per question type per species. |
| **Favourited** | User-marked flag. Favourited birds stay at Learning Palette weight regardless of history status. |
| **Excluded** | User-marked flag. Excluded birds never appear in questions. |
| **Region** | An eBird region code (e.g. `US-WA`, `CA-ON`). Determines the pool of available species. |

---

## Key Constants

All constants live in `frontend/src/lib/adaptive.ts` unless noted. They are candidates for future tuning to improve user experience.

### Learning Palette Capacity

```typescript
INITIAL_LEVEL_0_SIZE = 3         // Birds in level 0 at first game start
MAX_LEVEL_0_SIZE = 10            // Maximum birds simultaneously in level 0
```

**Promotion rule:** When a level 0 bird advances to level 1, the system promotes the next most common unseen bird into level 0, provided:
- Current level 0 count < `MAX_LEVEL_0_SIZE`

If the total palette is at 30, no new birds are promoted (the user is working on enough at once).

### Mastery Progression

```typescript
MASTERY_ADVANCE_STREAK = 3       // Consecutive correct answers to advance level (0→1, 1→2)
GRADUATION_STREAK = 5            // Consecutive correct answers at level 2 to graduate to Mastered
```

Incorrect answers reset the consecutive streak but never reduce the mastery level.

### Frequency Weights

These control how likely a bird is to appear in any given question slot. All weights are relative.

```typescript
LEARNING_PALETTE_WEIGHT = 1.0    // All birds in levels 0, 1, and 2
MASTERED_WEIGHT_MAX = 1.0        // Weight when first entering Mastered Palette (or accuracy ≤ 95%)
MASTERED_WEIGHT_MIN = 0.5        // Floor weight for birds answered correctly at ~100%
MASTERED_ACCURACY_THRESHOLD = 0.95  // Accuracy below this keeps weight at MASTERED_WEIGHT_MAX
UNSEEN_WEIGHT = 0.01             // Birds never introduced to the Learning Palette
```

**Mastered weight formula:**

```
accuracy = correct / (correct + incorrect)   [for this species + question type]

masteredWeight = MASTERED_WEIGHT_MAX
               − (MASTERED_WEIGHT_MAX − MASTERED_WEIGHT_MIN)
               × clamp((accuracy − MASTERED_ACCURACY_THRESHOLD)
                       / (1 − MASTERED_ACCURACY_THRESHOLD), 0, 1)
```

Simplified (with default constant values):
```
masteredWeight = 1.0 − 0.5 × clamp((accuracy − 0.95) / 0.05, 0, 1)
```

Examples:
- 95% accuracy → weight 1.0 (full frequency)
- 97.5% accuracy → weight 0.75
- 99%+ accuracy → weight ~0.5 (minimum frequency)

**Favourited birds** always use `LEARNING_PALETTE_WEIGHT` regardless of mastery or accuracy.

### Distractors

```typescript
PALETTE_DISTRACTOR_WEIGHT = 10   // (in backend: quiz.ts) Palette birds are 10× more likely
                                  // to be chosen as distractors than non-palette birds
```

---

## Data Model

### `BirdProgress` (stored in IndexedDB via Dexie.js)

Primary key: `[speciesCode, questionType]`

| Field | Type | Description |
|---|---|---|
| `speciesCode` | `string` | eBird species code (e.g. `amecro`) |
| `questionType` | `QuestionType` | `song`, `image`, `latin`, or `family` |
| `comName` | `string` | Common name (cached for display) |
| `correct` | `number` | Total correct answers |
| `incorrect` | `number` | Total incorrect answers |
| `lastAsked` | `number` | Unix timestamp of last question |
| `weight` | `number` | Current sampling weight (see Frequency Weights) |
| `favourited` | `boolean` | User has requested to see this bird more often |
| `excluded` | `boolean` | User has requested to never see this bird again |
| `masteryLevel` | `number` | 0 = easy distractors, 1 = medium, 2 = hard |
| `consecutiveCorrect` | `number` | Streak at current mastery level (resets on wrong answer) |
| `inHistory` | `boolean` | `true` once the bird has graduated to the Mastered Palette |

Note: mastery is tracked independently per (species, questionType) pair. A bird can be at level 2 for `song` and level 0 for `latin` simultaneously.

---

## Adaptive Parameter Flow

Each time a quiz round is requested in adaptive mode, the frontend computes and sends the following to the backend:

```typescript
interface AdaptiveParams {
  weights: Record<string, number>    // key: "speciesCode:questionType", value: frequency weight
  masteryLevels: Record<string, number>  // key: "speciesCode:questionType", value: 0|1|2
  banned: string[]                   // excluded species codes
  paletteSpeciesCodes: string[]      // species currently in the Learning Palette (for distractor preference)
}
```

**No `maxPoolSize` limit is sent or used.** The backend considers ALL regional birds as question candidates. Birds with no weight entry are treated as unseen and given `UNSEEN_WEIGHT = 0.01`.

The backend:
1. Fetches all species recently observed in the region from eBird
2. Builds `(species, questionType)` candidate pairs for all species
3. Assigns each candidate a weight: from `weights` dict if present, otherwise `UNSEEN_WEIGHT`
4. Samples `count + buffer` candidates weighted-randomly without replacement
5. Generates questions (fetching audio/photos as needed)
6. Filters out any song/image questions where media couldn't be fetched
7. Returns first `count` results

---

## Promotion Logic

Promotion of unseen birds into level 0 is triggered in `recordAnswer` (frontend) whenever a level 0 bird's mastery advances to level 1.

Algorithm:
```
on level 0 → level 1 advancement for species S:
  level0Count   = count of distinct species in DB with masteryLevel = 0 AND inHistory = false
  totalPalette  = count of distinct species in DB with inHistory = false
  if level0Count < MAX_LEVEL_0_SIZE:
    nextUnseen = most common regional species not yet in DB (sorted by eBird commonness)
    create DB entry for nextUnseen with masteryLevel=0, weight=LEARNING_PALETTE_WEIGHT
```

The "most common regional species" ordering uses the same backyard-family-first, eBird-frequency-ranked sort already in use in `quiz.ts`.

> **Implementation note:** The frontend currently does not have access to the full regional species list (it only knows about species it has encountered). The promotion step will require the frontend to either cache the regional species order from the backend, or ask the backend to identify the next species to promote.

---

## Distractor Selection Rules

For a given target species at `masteryLevel`:

| Level | Distractor pool |
|---|---|
| 0 | Birds from a **different family** |
| 1 | Birds from the **same family, different genus** (falls back to same family if too few) |
| 2 | Birds from the **same genus** (falls back to same family + genus mix if too few) |

In all cases, palette birds are preferred as distractors (`PALETTE_DISTRACTOR_WEIGHT = 10`). If the preferred pool is exhausted, visually similar birds (same size class, overlapping colour terms) are used as fallback before resorting to fully random picks.

---

## Photo Sources

- **Quiz questions (image type):** Single photo fetched at question generation time from iNaturalist.
- **Reveal panel (post-answer):** Multiple photos fetched from iNaturalist observations API (up to 6 research-grade observations sorted by quality). Displayed in a navigable carousel.
- Cache TTL: 24 hours (in-memory, resets on server restart).

---

## API Dependencies

| Service | Purpose | Auth |
|---|---|---|
| eBird API v2 | Regional species lists, taxonomy, region lookup | API key (server-side only, in `backend/.env`) |
| xeno-canto API v2 | Bird song / call recordings | None required |
| iNaturalist API v1 | Bird photos | None required |
| OpenStreetMap Nominatim | Reverse geocoding for map region picker | None required (User-Agent required) |

---

## Implementation Status

| Feature | Status |
|---|---|
| Question types: song, image, latin, family | ✅ Done |
| Adaptive weighting (palette vs history) | ⚠️ Partially done — weights use old values (PALETTE=100, HISTORY=1, UNSEEN=1.0); need updating |
| Distractor difficulty scaling (levels 0/1/2) | ✅ Done |
| Mastery advancement and graduation | ✅ Done |
| Level 0 cap at 10 | ❌ Not enforced |
| Learning palette cap at 30 | ❌ Not enforced |
| Automatic promotion of unseen birds | ❌ Not implemented |
| Mastered weight decay (accuracy-based) | ❌ Not implemented (fixed at 1.0) |
| Unseen weight = 0.01 | ❌ Not implemented (defaults to 1.0) |
| Question pool = all regional birds | ❌ Currently capped at maxPoolSize=10 |
| Multi-photo reveal carousel | ✅ Done (UI); ⚠️ Photos API returns only 1 photo — fix in progress |
| Mastered tab in My Progress | ✅ Done |
| x/n distractor progress badge | ✅ Done |
| Favourites / Excluded | ✅ Done |
| Region picker (text + map) | ✅ Done |
| Desktop info panel | ❌ Not started |
