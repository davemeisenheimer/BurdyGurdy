/** Pure logic for the curation tip library: filtering, grouping and sorting stored ID tips. */

export interface TipLibraryEntry {
  speciesCode:   string;
  guessKey:      string;
  photoUrl:      string;
  comName:       string;
  sciName:       string;
  guess:         string;
  tip:           string;
  model:         string;
  createdAt:     string;
  editedAt:      string | null;
  reportCount:   number;
  familyComName: string | null;
  familySciName: string | null;
  /** Position in eBird taxonomic order; null when the species isn't in the taxonomy. */
  taxonIndex:    number | null;
}

export type TipFilter = 'all' | 'ai' | 'edited' | 'reported';
export type TipSort = 'taxonomic' | 'az' | 'newest';

export function tipEntryKey(e: Pick<TipLibraryEntry, 'speciesCode' | 'guessKey' | 'photoUrl'>): string {
  return `${e.speciesCode}|${e.guessKey}|${e.photoUrl}`;
}

/** When the tip last changed: the curator edit if any, else when it was written. */
export function lastChanged(e: Pick<TipLibraryEntry, 'createdAt' | 'editedAt'>): string {
  return e.editedAt && e.editedAt > e.createdAt ? e.editedAt : e.createdAt;
}

/**
 * Keeps entries matching the filter and the search text. The search matches the correct bird's
 * common or scientific name and the guessed name, so "sharp-shinned" also finds tips written for
 * players who wrongly guessed Sharp-shinned Hawk.
 */
export function filterTipEntries(entries: TipLibraryEntry[], query: string, filter: TipFilter): TipLibraryEntry[] {
  const q = query.trim().toLowerCase();
  return entries.filter(e => {
    if (filter === 'ai' && e.editedAt) return false;
    if (filter === 'edited' && !e.editedAt) return false;
    if (filter === 'reported' && e.reportCount === 0) return false;
    if (!q) return true;
    return e.comName.toLowerCase().includes(q) || e.sciName.toLowerCase().includes(q) || e.guess.toLowerCase().includes(q);
  });
}

export interface SpeciesTips {
  speciesCode: string;
  comName:     string;
  sciName:     string;
  taxonIndex:  number | null;
  /** Most recently changed first. */
  tips:        TipLibraryEntry[];
}

export interface FamilyGroup {
  /** null collects species missing from the taxonomy ("Unknown family"). */
  familySciName: string | null;
  familyComName: string | null;
  species:       SpeciesTips[];
  tipCount:      number;
}

function byNewest(a: TipLibraryEntry, b: TipLibraryEntry): number {
  return lastChanged(b).localeCompare(lastChanged(a));
}

function groupBySpecies(entries: TipLibraryEntry[]): SpeciesTips[] {
  const map = new Map<string, SpeciesTips>();
  for (const e of entries) {
    const s = map.get(e.speciesCode) ?? { speciesCode: e.speciesCode, comName: e.comName, sciName: e.sciName, taxonIndex: e.taxonIndex, tips: [] };
    s.tips.push(e);
    map.set(e.speciesCode, s);
  }
  for (const s of map.values()) s.tips.sort(byNewest);
  return [...map.values()];
}

function byTaxon(a: SpeciesTips, b: SpeciesTips): number {
  if (a.taxonIndex !== null && b.taxonIndex !== null) return a.taxonIndex - b.taxonIndex;
  if (a.taxonIndex !== null) return -1;
  if (b.taxonIndex !== null) return 1;
  return a.comName.localeCompare(b.comName);
}

/** Species grouped under their family, both in eBird taxonomic order; unknown family last. */
export function buildTaxonomicGroups(entries: TipLibraryEntry[]): FamilyGroup[] {
  const species = groupBySpecies(entries).sort(byTaxon);
  const families = new Map<string, FamilyGroup>();
  for (const s of species) {
    const sample = s.tips[0];
    const key = sample.familySciName ?? '';
    const g = families.get(key) ?? { familySciName: sample.familySciName, familyComName: sample.familyComName, species: [], tipCount: 0 };
    g.species.push(s);
    g.tipCount += s.tips.length;
    families.set(key, g);
  }
  // Species are already in taxonomic order, so families appear in order of their first species,
  // which leaves the unknown family (whose species sort last) at the end.
  return [...families.values()];
}

/** Species A-Z by common name. */
export function buildAlphabetical(entries: TipLibraryEntry[]): SpeciesTips[] {
  return groupBySpecies(entries).sort((a, b) => a.comName.localeCompare(b.comName));
}

/** Individual tips, most recently written or edited first. */
export function sortNewest(entries: TipLibraryEntry[]): TipLibraryEntry[] {
  return [...entries].sort(byNewest);
}
