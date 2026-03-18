/**
 * Deduplicates observations and removes any whose speciesCode is not present
 * in the taxonomy map (e.g. hybrids, slashes, spuhs, issf).
 *
 * This prevents non-species eBird entries from entering the region cache
 * (and subsequently the victory condition) when they can never become quiz
 * questions (quiz.ts filters to taxMap entries via `.filter(s => s.tax)`).
 */
export function filterObservationsToKnownSpecies<T extends { speciesCode: string }>(
  observations: T[],
  taxMap: Map<string, unknown>,
): T[] {
  const seen = new Set<string>();
  return observations.filter(obs => {
    if (seen.has(obs.speciesCode)) return false;
    if (!taxMap.has(obs.speciesCode)) return false;
    seen.add(obs.speciesCode);
    return true;
  });
}
