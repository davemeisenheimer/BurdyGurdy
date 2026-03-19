# BirdyGurdy — Requirements & Architecture

## Overview

BirdyGurdy is a bird identification quiz app. A React frontend talks to an Express/Node backend. The backend proxies eBird, xeno-canto, iNaturalist, and Wikipedia APIs and caches results. The frontend stores all learning progress in the browser's IndexedDB.

---

## Photo Curation
Enable the curation tab with:
localStorage.setItem('curationToken', 'your-token-here')

## Question Types

| Code | Prompt | Answer |
|---|---|---|
| `song` | Play audio | Pick common name |
| `image` | Show photo | Pick common name |
| `latin` | Show common name | Pick Latin name |
| `family` | Show common name | Pick family name |
| `order` | Show common name | Pick order name |
| `sono` | Show spectrogram | Pick common name |
| `image-latin` | Show photo | Pick Latin name |
| `song-latin` | Play audio | Pick Latin name |
| `family-latin` | Show family name | Pick Latin name |
| `image-song` | Show photo | Pick correct song |
| `sono-song` | Show spectrogram | Pick correct song |
| `latin-song` | Show Latin name | Pick correct song |

---

## Game Modes

### Random
All species recently observed in the region (last 30 days) plus historical species as fallback are eligible. Species are selected randomly with equal weight.

### Adaptive
New species are introduced progressively via a **Learning Palette** and a **promotion queue**. The player always works on a small active set of birds before new ones are introduced.

---

## Species Pool & Promotion Queue

### Recent species (primary pool)
Fetched from eBird `/data/obs/{regionCode}/recent` with `back=30` (last 30 days), max 200 results.

### Historical species (fallback)
Fetched from eBird `/product/spplist/{regionCode}` — every species ever recorded in the region, year-round with no seasonal constraint.

### Promotion queue order (most to least priority)
1. **Recent + common** — sighted in last 30 days, in backyard/top-100 ranking
2. **Recent + less common** — sighted in last 30 days, not in common ranking
3. **Historical + common** — ever recorded, in common ranking
4. **Historical + less common** — ever recorded, not in common ranking

Within each group, species are sorted by commonness rank (most common first). "Common" is determined by backyard private-location sighting frequency (last 7 days); falls back to eBird top-100 checklist frequency if backyard data is sparse.

The `/api/birds/region/:regionCode` response includes two derived flags per species:
- `isHistorical: boolean` — true if the species appears only in the all-time spplist, not in recent 30-day observations
- `isCommon: boolean` — true if the species appears in the backyard or top-100 checklist frequency rankings (commonRank < 9999)

The promotion queue is cached client-side for 7 days (`regionSpecies` IndexedDB table). **Clearing history resets the `promotionIndex` to 0**, restarting promotion from the top of the queue.

### Distractor selection (mastery-based)
| Mastery level | Distractor pool |
|---|---|
| 0 (new) | Different family entirely |
| 1 | Same family, different genus |
| 2+ (hard) | Same genus (falls back to same family if too few) |

Palette birds are 10x more likely to appear as distractors to reinforce active learning.

---

## Photo Sources

Photos are fetched from three sources in parallel with a timeout strategy (1s initial window, 500ms trailing window for stragglers):

1. **Macaulay Library** (eBird/Cornell) — `search.macaulaylibrary.org/api/v1/search`
2. **iNaturalist** — `api.inaturalist.org/v1/taxa`
3. **Wikipedia/Wikimedia Commons** — `en.wikipedia.org/api/rest_v1/page/media-list/{title}`

### Question photo selection (mastery-based)
| Mastery level | Source weighting |
|---|---|
| 0 (new) | Always eBird (fallback: iNat then Wiki) |
| 1 | 50% eBird / 50% iNat pool |
| 2+ | 40% eBird / 40% iNat / 20% split among Wiki photos |

### Photo filtering
- Questions: exclude range maps, diagrams, eggs, museum specimens (MHNT), IUCN graphics, icons, flags, silhouettes, feathers
- Wikipedia: require `original.source` URL (no `/thumb/` resizes); reject images with known width < 250px
- Blocked photos (user-dismissed) are filtered client-side from all carousels

### Attribution
Every photo carries a `credit` string displayed as a badge:
- Macaulay: `© {photographer} · Macaulay Library`
- iNaturalist: cleaned attribution string from `default_photo.attribution`
- Wikipedia: `© {Artist} · Wikimedia Commons · {LicenseShortName}`

---

## Info Panel (desktop only)

Shown to the right of the quiz on screens >= 1024px wide. Displays after an answer is submitted:

- **Answer banner** — correct/incorrect with the correct species name; when viewing a related species a "← Back to [bird]" link appears on the right
- **Triptych** — three fixed equal-width panels (each 1/3 of available space); missing panels are omitted and the remaining ones are centred:
  - *Range map* — Wikipedia range/distribution map with colour legend. Links to eBird interactive map.
  - *Sonogram + audio* — xeno-canto recording spectrogram with play/pause controls and prev/next recording navigation
  - *Related species carousel* — always present; shows primary photos of the correct species and its same-genus relatives (falls back to same-family if fewer than 2 genus matches). Candidates are filtered to recently-observed species plus historical species that are regionally common (`isCommon = true`), capping at 9 related species. Each slide has a full-width top badge ("Related species: Common name (Latin name)") and a "View info →" link (except the reference species). Clicking "View info →" replaces the panel body content (header, wiki, sightings, links) with that species' info. Navigation arrows fade in over 2 seconds once adjacent photos are loaded. Wraps around with an instant (non-animated) transition to avoid reverse-direction animation.
  - *Auto-scroll* — on first reveal the carousel scrolls through all slides once at 1.8 s/slide then stops on the reference species. Any user interaction cancels the auto-scroll. Configurable via Settings (desktop only, default on).
  - A frosted-glass overlay covers the triptych while the initial bird info is loading and fades away (700 ms) once the data arrives.
- **Species header** — common name, Latin name, family, IUCN conservation status; updates when viewing a related species
- **Recent sightings** — up to N cards (configurable in Settings, default 4, max 10) showing location name, coordinates, date, and count. Fetched from eBird `/data/obs/{regionCode}/recent/{speciesCode}`, cached 1 hour server-side. Updates when viewing a related species.
- **Wikipedia extract** — full intro text with styled section headings, scrollable; updates when viewing a related species
- **Quick links** — eBird, All About Birds, Wikipedia, iNaturalist, Audubon, Xeno-canto; update when viewing a related species

---

## Caching

### Server-side (in-memory TTL cache)
Lives for the lifetime of the backend process. A server restart clears it entirely.

| Data | TTL |
|---|---|
| eBird taxonomy | 24 hours |
| Regional species (recent obs, 30-day) | 1 hour |
| Backyard species ranking | 1 hour |
| Top-100 common species (7-day) | 24 hours |
| Historical species list (spplist) | 24 hours |
| Bird info (wiki, recordings, photos, conservation status) | 24 hours |
| Wikipedia photos | 7 days |
| Wikipedia range map | 7 days |
| Wikipedia range map legend | 7 days |
| Recent sightings (info panel cards) | 1 hour |
| Region search results | 1 hour |
| Reverse geocode (locate) | 24 hours |

**To clear server-side cache:**
```
POST /api/admin/cache-clear?token=<ADMIN_TOKEN>
```
Set `ADMIN_TOKEN` in the backend `.env` file. Example with curl:
```bash
curl -X POST "http://localhost:3001/api/admin/cache-clear?token=YOUR_TOKEN"
```

### Client-side (IndexedDB via Dexie + localStorage)
Persists across browser sessions indefinitely unless explicitly cleared.

| Store | Contents | Expires |
|---|---|---|
| `progress` (IndexedDB) | All quiz history — correct/incorrect counts, mastery levels, weights, streaks, favourite/excluded flags | Never (user-managed) |
| `regionSpecies` (IndexedDB) | Ordered promotion queue per region, including `promotionIndex` | 7 days (re-fetched from backend) |
| `blockedPhotos` (IndexedDB) | URLs of photos the user has dismissed from carousels | Never |
| `birdygurdy_settings` (localStorage) | App settings | Never |

**"Clear history" button** (Progress screen): clears the `progress` table and resets all `promotionIndex` values to 0. Does NOT clear `blockedPhotos`, `regionSpecies` queue data, or settings.

**To wipe all client-side data** (browser console):
```javascript
__bg_clearAll()
```
Clears all three IndexedDB tables and removes settings from localStorage. Reload the page after running.

---

## Settings

| Setting | Default | Description |
|---|---|---|
| Autoplay bird song on reveal | on | Play audio automatically when answer is revealed |
| Latin-answer questions | off | Add image-latin, song-latin, family-latin question variants |
| Song-answer questions | off | Add image-song, sono-song, latin-song question variants |
| Randomize question photos | on | Pick a random photo each time instead of always the primary |
| Auto-scroll related species | on | When the info panel opens, the related species carousel scrolls through once then stops. Desktop only. |
| Max recent sightings | 4 | Number of sighting cards in the info panel (0-10). Desktop only. |

---

## Key API Endpoints (Backend)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/birds/region/:regionCode` | Ordered species list for promotion queue |
| `GET` | `/api/birds/info/:speciesCode` | Full bird info (wiki, recordings, photos, conservation status) |
| `GET` | `/api/birds/photos/:speciesCode` | Photo set for reveal carousel |
| `GET` | `/api/birds/recent/:speciesCode?regionCode=&maxResults=` | Recent sightings for info panel cards |
| `GET` | `/api/birds/regions/search?q=` | Region search autocomplete |
| `GET` | `/api/birds/regions/locate?lat=&lng=&mapZoom=` | Reverse geocode coordinates to eBird region |
| `POST` | `/api/quiz/questions` | Generate a quiz round |
| `GET` | `/health` | Health check |
| `POST` | `/api/admin/cache-clear?token=` | Clear all server-side cache (requires ADMIN_TOKEN env var) |
