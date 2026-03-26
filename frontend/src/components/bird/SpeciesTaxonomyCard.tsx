import type { SlideSpecies } from './types';

const IUCN_LABEL: Record<string, string> = {
  LC: 'Least Concern',        NT: 'Near Threatened',       VU: 'Vulnerable',
  EN: 'Endangered',           CR: 'Critically Endangered', EW: 'Extinct in the Wild',
  EX: 'Extinct',              DD: 'Data Deficient',        NE: 'Not Evaluated',
};

const IUCN_COLOR: Record<string, string> = {
  LC: 'bg-green-100 text-green-800',   NT: 'bg-lime-100 text-lime-800',
  VU: 'bg-amber-100 text-amber-800',   EN: 'bg-orange-100 text-orange-800',
  CR: 'bg-red-100 text-red-800',       EW: 'bg-purple-100 text-purple-800',
  EX: 'bg-slate-200 text-slate-600',   DD: 'bg-slate-100 text-slate-500',
};

interface Props {
  sp: SlideSpecies;
  conservationStatus?: { code: string; name: string } | null;
}

export function SpeciesTaxonomyCard({ sp, conservationStatus }: Props) {
  const cs      = conservationStatus;
  const csLabel = cs ? (IUCN_LABEL[cs.code] ?? cs.name) : null;
  const csColor = cs ? (IUCN_COLOR[cs.code] ?? 'bg-slate-100 text-slate-500') : null;

  return (
    <div className="space-y-1">
      <h2 className="text-2xl font-bold text-slate-900 leading-tight">{sp.comName}</h2>
      <p className="text-base italic text-slate-500">{sp.sciName}</p>
      <div className="flex flex-wrap items-center gap-1 pt-1 text-xs text-slate-500">
        <span className="bg-slate-100 px-2 py-0.5 rounded-full">Family: {sp.familyComName}</span>
      </div>
      {cs && csLabel && csColor && (
        <div className="pt-1">
          <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${csColor}`}>
            IUCN: {cs.code} — {csLabel}
          </span>
        </div>
      )}
    </div>
  );
}
