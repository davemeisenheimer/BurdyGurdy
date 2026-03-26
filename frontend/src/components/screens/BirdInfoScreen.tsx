import { useEffect, useRef, useState } from 'react';
import { fetchRegionSpecies } from '../../lib/api';
import { useBirdInfo }            from '../../hooks/useBirdInfo';
import { AudioPanel }             from '../bird/AudioPanel';
import { RelatedSpeciesCarousel } from '../bird/RelatedSpeciesCarousel';
import { SpeciesTaxonomyCard }    from '../bird/SpeciesTaxonomyCard';
import { RecentSightings }        from '../bird/RecentSightings';
import { DescriptionText }        from '../bird/DescriptionText';
import { RangeMap }               from '../bird/RangeMap';
import { QuickLinks }             from '../bird/QuickLinks';
import type { SlideSpecies }      from '../bird/types';

interface Props {
  speciesCode:               string;
  comName:                   string;
  regionCode?:               string;
  maxRecentSightings?:       number;
  autoScrollRelatedSpecies?: boolean;
  onBack:                    () => void;
}

export function BirdInfoScreen({
  speciesCode, comName, regionCode,
  maxRecentSightings = 4, autoScrollRelatedSpecies = true,
  onBack,
}: Props) {
  const audioPauseRef = useRef<(() => void) | null>(null);

  // Resolve full SlideSpecies (sciName + familyComName) from region cache
  const [primarySpecies, setPrimarySpecies] = useState<SlideSpecies | null>(null);
  useEffect(() => {
    setPrimarySpecies(null);
    if (!regionCode) {
      setPrimarySpecies({ speciesCode, comName, sciName: '', familyComName: '' });
      return;
    }
    fetchRegionSpecies(regionCode).then(allSpecies => {
      const found = allSpecies.find(s => s.speciesCode === speciesCode);
      setPrimarySpecies({
        speciesCode,
        comName,
        sciName:       found?.sciName       ?? '',
        familyComName: found?.familyComName ?? '',
      });
    }).catch(() => setPrimarySpecies({ speciesCode, comName, sciName: '', familyComName: '' }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speciesCode, regionCode]);

  const [viewingSpecies, setViewingSpecies] = useState<SlideSpecies | null>(null);
  useEffect(() => { setViewingSpecies(null); }, [speciesCode]);

  const displaySpecies = viewingSpecies ?? primarySpecies;

  const { info, sightings, loading } = useBirdInfo(
    displaySpecies?.speciesCode ?? null,
    displaySpecies?.comName     ?? '',
    displaySpecies?.sciName     ?? '',
    regionCode,
    maxRecentSightings,
  );

  const ebirdUrl = displaySpecies ? `https://ebird.org/species/${displaySpecies.speciesCode}` : '';

  return (
    <div className="h-dvh flex flex-col bg-white">

      {/* Header */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-slate-200 bg-white">
        <button
          onClick={viewingSpecies ? () => setViewingSpecies(null) : onBack}
          className="text-slate-500 hover:text-slate-700 text-3xl leading-none"
          aria-label="Back"
        >
          ←
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-800 truncate">{displaySpecies?.comName ?? comName}</p>
          {viewingSpecies && primarySpecies && (
            <p className="text-xs text-slate-400 truncate">Tap ← to return to {primarySpecies.comName}</p>
          )}
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">

        {/* Related species carousel */}
        {primarySpecies && (
          <div className="h-[200px] relative border-b border-slate-100">
            <RelatedSpeciesCarousel
              referenceSpecies={primarySpecies}
              regionCode={regionCode}
              autoScrollEnabled={autoScrollRelatedSpecies}
              onViewSpecies={setViewingSpecies}
              onWillPlay={() => audioPauseRef.current?.()}
            />
          </div>
        )}

        {/* Range map */}
        {info?.rangeMapUrl && (
          <div className="h-[180px] border-b border-slate-100">
            <RangeMap
              rangeMapUrl={info.rangeMapUrl}
              legend={info.rangeMapLegend ?? []}
              ebirdUrl={ebirdUrl}
            />
          </div>
        )}

        {/* Audio */}
        {(info?.recordings?.length ?? 0) > 0 && (
          <div className="border-b border-slate-100">
            <AudioPanel recordings={info!.recordings} pauseRef={audioPauseRef} />
          </div>
        )}

        {/* Content — natural flow, parent scrolls */}
        {loading || primarySpecies === null ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-slate-400 text-sm">Loading bird info…</p>
          </div>
        ) : (
          <>
          {sightings.length > 0 && (
            <div className="px-[5px] pt-4">
              <RecentSightings sightings={sightings} variant="table" />
            </div>
          )}

          <div className="px-5 pt-4 pb-8 space-y-5">

            <SpeciesTaxonomyCard sp={displaySpecies!} conservationStatus={info?.conservationStatus} />

            {info?.wikipedia?.extract && (
              <DescriptionText
                extract={info.wikipedia.extract}
                wikiUrl={info.wikipedia.url ?? `https://en.wikipedia.org/wiki/${displaySpecies!.sciName.replace(/ /g, '_')}`}
              />
            )}

            {!info?.rangeMapUrl && (
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Range & Distribution</h3>
                <a href={ebirdUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-sky-600 hover:underline">
                  View interactive range map on eBird ↗
                </a>
              </div>
            )}

            <div className="pt-1">
              <QuickLinks sp={displaySpecies!} wikiUrl={info?.wikipedia?.url} />
            </div>

          </div>
          </>
        )}
      </div>
    </div>
  );
}
