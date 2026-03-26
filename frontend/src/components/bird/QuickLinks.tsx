import type { SlideSpecies } from './types';

interface Props {
  sp:       SlideSpecies;
  wikiUrl?: string;
}

export function QuickLinks({ sp, wikiUrl }: Props) {
  const ebirdUrl    = `https://ebird.org/species/${sp.speciesCode}`;
  const allAboutUrl = `https://www.allaboutbirds.org/guide/${sp.sciName.replace(/ /g, '_')}`;
  const resolvedWikiUrl = wikiUrl ?? `https://en.wikipedia.org/wiki/${sp.sciName.replace(/ /g, '_')}`;
  const inatUrl     = `https://www.inaturalist.org/taxa/search?q=${encodeURIComponent(sp.sciName)}`;
  const audubonUrl  = `https://www.audubon.org/field-guide/bird/${sp.comName.toLowerCase().replace(/ /g, '-')}`;
  const xenoUrl     = `https://xeno-canto.org/explore?query=${encodeURIComponent(sp.sciName)}`;

  const links = [
    { label: 'eBird',           href: ebirdUrl },
    { label: 'All About Birds', href: allAboutUrl },
    { label: 'Wikipedia',       href: resolvedWikiUrl },
    { label: 'iNaturalist',     href: inatUrl },
    { label: 'Audubon',         href: audubonUrl },
    { label: 'Xeno-canto',      href: xenoUrl },
  ];

  return (
    <>
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">More Information</h3>
      <div className="flex flex-wrap gap-2">
        {links.map(({ label, href }) => (
          <a key={label} href={href} target="_blank" rel="noopener noreferrer"
            className="text-xs px-3 py-1.5 rounded-full border border-slate-300 text-slate-600 hover:bg-slate-50 hover:border-slate-400 transition-colors">
            {label} ↗
          </a>
        ))}
      </div>
    </>
  );
}
