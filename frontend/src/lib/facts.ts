import { supabase } from './supabase';
import type { BirdFact } from './adminSync';

export type FactContext = 'species' | 'family' | 'general';

export interface FactResult {
  fact:    BirdFact;
  context: FactContext;
}

function mapFact(r: Record<string, unknown>): BirdFact {
  return {
    id:           r.id           as string,
    factText:     r.fact_text    as string,
    sourceUrl:    r.source_url   as string | null,
    speciesCodes: (r.species_codes as string[] | null) ?? [],
    familyNames:  (r.family_names  as string[] | null) ?? [],
    isActive:     r.is_active    as boolean,
    createdAt:    r.created_at   as string,
  };
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Returns a fact to show when a bird is mastered.
 * Priority: species-specific → random from the full pool.
 * The returned context tells the caller how to describe the fact in the UI.
 */
export async function fetchFactForBird(speciesCode: string): Promise<FactResult | null> {
  // 1. Try species-specific match
  const { data: specific } = await supabase
    .from('bird_facts')
    .select('*')
    .eq('is_active', true)
    .contains('species_codes', [speciesCode]);

  if (specific && specific.length > 0) {
    return { fact: mapFact(pick(specific as Record<string, unknown>[])), context: 'species' };
  }

  // 2. Fall back to the full active pool (includes family-tagged and general facts)
  const { data: all } = await supabase
    .from('bird_facts')
    .select('*')
    .eq('is_active', true);

  if (!all || all.length === 0) return null;
  const fact = mapFact(pick(all as Record<string, unknown>[]));
  return { fact, context: 'general' };
}
