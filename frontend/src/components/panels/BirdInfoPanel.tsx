import { useEffect, useState, useRef } from 'react';
import type { QuizQuestion } from '../../types';
import { fetchBirdInfo, fetchRecentSightings, fetchRegionSpecies } from '../../services/remote/api';
import type { BirdInfoData, RecentSighting } from '../../services/remote/api';
import { WelcomePanel }          from '../bird/WelcomePanel';
import { AnswerBanner }          from '../bird/AnswerBanner';
import { AudioPanel }            from '../bird/AudioPanel';
import { RelatedSpeciesCarousel } from '../bird/RelatedSpeciesCarousel';
import { SpeciesTaxonomyCard }   from '../bird/SpeciesTaxonomyCard';
import { RecentSightings }       from '../bird/RecentSightings';
import { DescriptionText }       from '../bird/DescriptionText';
import { RangeMap }              from '../bird/RangeMap';
import { QuickLinks }            from '../bird/QuickLinks';
import { BirdSearchInput }       from '../bird/BirdSearchInput';
import type { SlideSpecies }     from '../bird/types';
import { describeUpstreamError, type UpstreamErrorPayload } from '../../lib/upstreamErrorMessages';

const INFO_FALLBACK = "Couldn't load info for this bird right now. Please try again.";

function describeInfoError(err: unknown): string {
  const payload = (err as { response?: { data?: UpstreamErrorPayload } })?.response?.data;
  return describeUpstreamError(payload, INFO_FALLBACK);
}

interface Props {
  question:            QuizQuestion | null;
  isAnswered:          boolean;
  isCorrect:           boolean;
  selectedAnswer:      string | null;
  regionCode?:                string;
  maxRecentSightings?:        number;
  autoScrollRelatedSpecies?:  boolean;
  autoplayRevealAudio?:       boolean;
  userEmail?:                 string | null;
  onAuthClick?:               () => void;
  onSignOut?:                 () => void;
  browseSpecies?: { speciesCode: string; comName: string } | null;
  /** Called when a blue sighting tile is clicked - navigate to sightings map. */
  onSightingClick?: (sighting: RecentSighting, speciesCode: string, comName: string, sciName: string) => void;
}

export function BirdInfoPanel({
  question, isAnswered, isCorrect, selectedAnswer,
  regionCode, maxRecentSightings = 4, autoScrollRelatedSpecies = true,
  autoplayRevealAudio = false, userEmail, onAuthClick, onSignOut, browseSpecies, onSightingClick,
}: Props) {
  const mainAudioPauseRef = useRef<(() => void) | null>(null);

  const [questionInfo, setQuestionInfo]           = useState<BirdInfoData | null>(null);
  const [questionInfoError, setQuestionInfoError] = useState<string | null>(null);
  const [loading, setLoading]                     = useState(false);
  const [questionSightings, setQuestionSightings] = useState<RecentSighting[]>([]);

  const [viewingSpecies, setViewingSpecies]   = useState<SlideSpecies | null>(null);
  const [viewedInfo, setViewedInfo]           = useState<BirdInfoData | null>(null);
  const [viewedInfoError, setViewedInfoError] = useState<string | null>(null);
  const [viewedSightings, setViewedSightings] = useState<RecentSighting[]>([]);

  const [browseResolved, setBrowseResolved] = useState<SlideSpecies | null>(null);

  // Resolve sciName/familyComName for browse mode
  useEffect(() => {
    if (!browseSpecies) { setBrowseResolved(null); return; }
    setLoading(true);
    setViewingSpecies(null);
    setViewedInfo(null);
    setViewedSightings([]);
    if (!regionCode) {
      setBrowseResolved({ speciesCode: browseSpecies.speciesCode, comName: browseSpecies.comName, sciName: '', familyComName: '' });
      return;
    }
    fetchRegionSpecies(regionCode).then(allSpecies => {
      const found = allSpecies.find(s => s.speciesCode === browseSpecies.speciesCode);
      setBrowseResolved({
        speciesCode:   browseSpecies.speciesCode,
        comName:       browseSpecies.comName,
        sciName:       found?.sciName       ?? '',
        familyComName: found?.familyComName ?? '',
        familySciName: found?.familySciName,
        order:         found?.order,
        orderComName:  found?.orderComName,
      });
    }).catch(() => setBrowseResolved({ speciesCode: browseSpecies.speciesCode, comName: browseSpecies.comName, sciName: '', familyComName: '' }));
  }, [browseSpecies?.speciesCode, regionCode]);

  // Fetch info when browse species resolves
  useEffect(() => {
    if (!browseResolved) return;
    setLoading(true);
    setQuestionInfo(null);
    setQuestionInfoError(null);
    setQuestionSightings([]);
    fetchBirdInfo(browseResolved.speciesCode, browseResolved.comName, browseResolved.sciName)
      .then(data => { setQuestionInfo(data); setLoading(false); })
      .catch((err: unknown) => { setQuestionInfoError(describeInfoError(err)); setLoading(false); });
    if (regionCode && maxRecentSightings > 0) {
      // Sightings here are a small supplementary strip - fall back to empty on
      // failure rather than blocking the rest of the panel. See SightingsScreen
      // for the dedicated sightings view's error handling.
      fetchRecentSightings(browseResolved.speciesCode, regionCode, maxRecentSightings)
        .then(setQuestionSightings)
        .catch(() => {});
    }
  }, [browseResolved?.speciesCode]);

  // Fetch info for the answered quiz question
  useEffect(() => {
    if (browseResolved) return;
    if (!isAnswered || !question) {
      setQuestionInfo(null);
      setQuestionInfoError(null);
      setQuestionSightings([]);
      setViewingSpecies(null);
      setViewedInfo(null);
      setViewedInfoError(null);
      setViewedSightings([]);
      return;
    }
    setLoading(true);
    setQuestionInfoError(null);
    fetchBirdInfo(question.speciesCode, question.comName, question.sciName)
      .then(data => { setQuestionInfo(data); setLoading(false); })
      .catch((err: unknown) => { setQuestionInfoError(describeInfoError(err)); setLoading(false); });
    if (regionCode && maxRecentSightings > 0) {
      fetchRecentSightings(question.speciesCode, regionCode, maxRecentSightings)
        .then(setQuestionSightings)
        .catch(() => {});
    }
  }, [question?.speciesCode, isAnswered, !!browseResolved]);

  // Fetch info for a related species clicked in the carousel
  useEffect(() => {
    if (!viewingSpecies) return;
    let cancelled = false;
    setViewedInfoError(null);
    fetchBirdInfo(viewingSpecies.speciesCode, viewingSpecies.comName, viewingSpecies.sciName)
      .then(data => { if (!cancelled) setViewedInfo(data); })
      .catch((err: unknown) => { if (!cancelled) setViewedInfoError(describeInfoError(err)); });
    if (regionCode && maxRecentSightings > 0) {
      fetchRecentSightings(viewingSpecies.speciesCode, regionCode, maxRecentSightings)
        .then(data => { if (!cancelled) setViewedSightings(data); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [viewingSpecies?.speciesCode]);

  // ── Idle ──────────────────────────────────────────────────────────────────
  if (!browseResolved && (!isAnswered || !question)) {
    return (
      <WelcomePanel
        hasActiveQuestion={!!question}
        userEmail={userEmail}
        onAuthClick={onAuthClick}
        onSignOut={onSignOut}
        onSelectBird={s => setBrowseResolved(s)}
      />
    );
  }

  // Derived display state
  const info      = viewingSpecies ? viewedInfo      : questionInfo;
  const infoError = viewingSpecies ? viewedInfoError : questionInfoError;
  const sightings = viewingSpecies ? viewedSightings : questionSightings;
  const primarySpecies: SlideSpecies = browseResolved ?? {
    speciesCode:   question!.speciesCode,
    comName:       question!.comName,
    sciName:       question!.sciName,
    familyComName: question!.familyComName,
    familySciName: question!.familySciName,
    order:         question!.order,
    orderComName:  question!.orderComName,
  };
  const sp: SlideSpecies = viewingSpecies ?? primarySpecies;

  const ebirdUrl = `https://ebird.org/species/${sp.speciesCode}`;
  const contentLoading = loading || (viewingSpecies !== null && viewedInfo === null && viewedInfoError === null);

  const bannerLabel = browseResolved
    ? browseResolved.comName
    : isCorrect
      ? `✓ Correct - ${question!.comName}`
      : `✗ You answered "${selectedAnswer}" - correct: ${question!.comName}`;
  const bannerVariant = browseResolved ? 'neutral' : isCorrect ? 'correct' : 'incorrect';
  const primaryName   = (browseResolved ?? question)!.comName;

  // ── Answered / browse ─────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">

      <AnswerBanner
        label={bannerLabel}
        variant={bannerVariant}
        backLabel={viewingSpecies ? `← Back to ${primaryName}` : (!browseSpecies && browseResolved) ? '← Search results' : undefined}
        onBack={viewingSpecies ? () => setViewingSpecies(null) : (!browseSpecies && browseResolved) ? () => setBrowseResolved(null) : undefined}
      />

      {/* ── Triptych ── */}
      <div className="shrink-0 relative flex justify-center gap-2 px-3 py-2 bg-white" style={{ height: '224px' }}>

        {/* Glass overlay while loading */}
        <div className={`absolute inset-0 z-10 bg-white/60 backdrop-blur-sm transition-opacity duration-700 pointer-events-none ${loading ? 'opacity-100' : 'opacity-0'}`} />

        {info?.rangeMapUrl && (
          <div className="overflow-hidden rounded-lg border border-stone-300 bg-white p-1" style={{ width: 'calc((100% - 16px) / 3)' }}>
            <RangeMap
              rangeMapUrl={info.rangeMapUrl}
              legend={info.rangeMapLegend ?? []}
              ebirdUrl={ebirdUrl}
            />
          </div>
        )}

        {(info?.recordings?.length ?? 0) > 0 && (
          <div className="overflow-hidden rounded-lg border border-stone-300" style={{ width: 'calc((100% - 16px) / 3)' }}>
            <AudioPanel recordings={info!.recordings} autoplay={autoplayRevealAudio} pauseRef={mainAudioPauseRef} fillHeight />
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-stone-300" style={{ width: 'calc((100% - 16px) / 3)' }}>
          <RelatedSpeciesCarousel
            referenceSpecies={sp}
            regionCode={regionCode}
            autoScrollEnabled={autoScrollRelatedSpecies}
            showReferencePhoto={!!browseResolved}
            onViewSpecies={setViewingSpecies}
            onWillPlay={() => mainAudioPauseRef.current?.()}
          />
        </div>
      </div>

      {/* ── Content card ── */}
      <div className="flex-1 min-h-0 mx-3 mb-2 mt-1 rounded-xl border border-stone-300 flex flex-col overflow-hidden">
        {contentLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-slate-400 text-sm">Loading bird info…</p>
          </div>
        ) : infoError ? (
          <div className="flex-1 flex items-center justify-center px-6">
            <p className="text-sm text-red-500 text-center">{infoError}</p>
          </div>
        ) : (
          <>
            {/* Taxonomy + sightings row */}
            <div className="shrink-0 px-5 pt-4 pb-3 border-b border-stone-100 flex items-start gap-4">
              <div className="shrink-0">
                <SpeciesTaxonomyCard sp={sp} conservationStatus={info?.conservationStatus} />
              </div>
              <div className="flex-1 min-w-0">
                <RecentSightings
                  sightings={sightings}
                  onSightingClick={onSightingClick
                    ? s => onSightingClick(s, sp.speciesCode, sp.comName, sp.sciName)
                    : undefined}
                />
              </div>
            </div>

            {/* Wikipedia extract - scrollable within the fixed-height card */}
            {info?.wikipedia?.extract && (
              <div className="flex-1 min-h-0 flex flex-col px-5 pt-3 pb-2">
                <div className="flex-1 min-h-0 overflow-y-auto pr-1">
                  <DescriptionText
                    extract={info.wikipedia.extract}
                    wikiUrl={info.wikipedia.url ?? `https://en.wikipedia.org/wiki/${sp.sciName.replace(/ /g, '_')}`}
                  />
                </div>
              </div>
            )}

            {/* Range map fallback when no triptych map */}
            {!info?.rangeMapUrl && (
              <div className="shrink-0 px-5 py-3 border-t border-stone-100">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Range & Distribution</h3>
                <a href={ebirdUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-sky-600 hover:underline">
                  View interactive range map on eBird ↗
                </a>
              </div>
            )}

            {/* Quick links */}
            <div className="shrink-0 px-5 py-3 border-t border-stone-100">
              <div className="flex flex-wrap gap-2 items-start">
                <QuickLinks sp={sp} wikiUrl={info?.wikipedia?.url} />
                <BirdSearchInput onSelect={setViewingSpecies} className="flex-1 min-w-[160px]" />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
