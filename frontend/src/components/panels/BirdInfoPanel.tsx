import { useEffect, useState, useRef } from 'react';
import type { QuizQuestion } from '../../types';
import { fetchBirdInfo, fetchRecentSightings, fetchRegionSpecies } from '../../lib/api';
import type { BirdInfoData, RecentSighting } from '../../lib/api';
import { WelcomePanel }          from '../bird/WelcomePanel';
import { AnswerBanner }          from '../bird/AnswerBanner';
import { AudioPanel }            from '../bird/AudioPanel';
import { RelatedSpeciesCarousel } from '../bird/RelatedSpeciesCarousel';
import { SpeciesTaxonomyCard }   from '../bird/SpeciesTaxonomyCard';
import { RecentSightings }       from '../bird/RecentSightings';
import { DescriptionText }       from '../bird/DescriptionText';
import { RangeMap }              from '../bird/RangeMap';
import { QuickLinks }            from '../bird/QuickLinks';
import type { SlideSpecies }     from '../bird/types';

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
}

export function BirdInfoPanel({
  question, isAnswered, isCorrect, selectedAnswer,
  regionCode, maxRecentSightings = 4, autoScrollRelatedSpecies = true,
  autoplayRevealAudio = false, userEmail, onAuthClick, onSignOut, browseSpecies,
}: Props) {
  const mainAudioPauseRef = useRef<(() => void) | null>(null);

  const [questionInfo, setQuestionInfo]           = useState<BirdInfoData | null>(null);
  const [loading, setLoading]                     = useState(false);
  const [questionSightings, setQuestionSightings] = useState<RecentSighting[]>([]);

  const [viewingSpecies, setViewingSpecies]   = useState<SlideSpecies | null>(null);
  const [viewedInfo, setViewedInfo]           = useState<BirdInfoData | null>(null);
  const [viewedSightings, setViewedSightings] = useState<RecentSighting[]>([]);

  const [browseResolved, setBrowseResolved] = useState<SlideSpecies | null>(null);

  // Resolve sciName/familyComName for browse mode
  useEffect(() => {
    if (!browseSpecies) { setBrowseResolved(null); return; }
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
      });
    }).catch(() => setBrowseResolved({ speciesCode: browseSpecies.speciesCode, comName: browseSpecies.comName, sciName: '', familyComName: '' }));
  }, [browseSpecies?.speciesCode, regionCode]);

  // Fetch info when browse species resolves
  useEffect(() => {
    if (!browseResolved) return;
    setLoading(true);
    setQuestionInfo(null);
    setQuestionSightings([]);
    fetchBirdInfo(browseResolved.speciesCode, browseResolved.comName, browseResolved.sciName)
      .then(data => { setQuestionInfo(data); setLoading(false); })
      .catch(() => setLoading(false));
    if (regionCode && maxRecentSightings > 0) {
      fetchRecentSightings(browseResolved.speciesCode, regionCode, maxRecentSightings)
        .then(setQuestionSightings);
    }
  }, [browseResolved?.speciesCode]);

  // Fetch info for the answered quiz question
  useEffect(() => {
    if (browseResolved) return;
    if (!isAnswered || !question) {
      setQuestionInfo(null);
      setQuestionSightings([]);
      setViewingSpecies(null);
      setViewedInfo(null);
      setViewedSightings([]);
      return;
    }
    setLoading(true);
    fetchBirdInfo(question.speciesCode, question.comName, question.sciName)
      .then(data => { setQuestionInfo(data); setLoading(false); })
      .catch(() => setLoading(false));
    if (regionCode && maxRecentSightings > 0) {
      fetchRecentSightings(question.speciesCode, regionCode, maxRecentSightings)
        .then(setQuestionSightings);
    }
  }, [question?.speciesCode, isAnswered, !!browseResolved]);

  // Fetch info for a related species clicked in the carousel
  useEffect(() => {
    if (!viewingSpecies) return;
    let cancelled = false;
    fetchBirdInfo(viewingSpecies.speciesCode, viewingSpecies.comName, viewingSpecies.sciName)
      .then(data => { if (!cancelled) setViewedInfo(data); });
    if (regionCode && maxRecentSightings > 0) {
      fetchRecentSightings(viewingSpecies.speciesCode, regionCode, maxRecentSightings)
        .then(data => { if (!cancelled) setViewedSightings(data); });
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
      />
    );
  }

  // Derived display state
  const info      = viewingSpecies ? viewedInfo      : questionInfo;
  const sightings = viewingSpecies ? viewedSightings : questionSightings;
  const primarySpecies: SlideSpecies = browseResolved ?? {
    speciesCode:   question!.speciesCode,
    comName:       question!.comName,
    sciName:       question!.sciName,
    familyComName: question!.familyComName,
  };
  const sp: SlideSpecies = viewingSpecies ?? primarySpecies;

  const ebirdUrl = `https://ebird.org/species/${sp.speciesCode}`;
  const contentLoading = loading || (viewingSpecies !== null && viewedInfo === null);

  const bannerLabel = browseResolved
    ? browseResolved.comName
    : isCorrect
      ? `✓ Correct — ${question!.comName}`
      : `✗ You answered "${selectedAnswer}" — correct: ${question!.comName}`;
  const bannerVariant = browseResolved ? 'neutral' : isCorrect ? 'correct' : 'incorrect';
  const primaryName   = (browseResolved ?? question)!.comName;

  // ── Answered / browse ─────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">

      <AnswerBanner
        label={bannerLabel}
        variant={bannerVariant}
        backLabel={viewingSpecies ? `← Back to ${primaryName}` : undefined}
        onBack={viewingSpecies ? () => setViewingSpecies(null) : undefined}
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
            referenceSpecies={primarySpecies}
            regionCode={regionCode}
            autoScrollEnabled={autoScrollRelatedSpecies}
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
        ) : (
          <>
            {/* Taxonomy + sightings row */}
            <div className="shrink-0 px-5 pt-4 pb-3 border-b border-stone-100 flex items-start gap-4">
              <div className="shrink-0">
                <SpeciesTaxonomyCard sp={sp} conservationStatus={info?.conservationStatus} />
              </div>
              <div className="flex-1 min-w-0">
                <RecentSightings sightings={sightings} />
              </div>
            </div>

            {/* Wikipedia extract — scrollable within the fixed-height card */}
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
              <QuickLinks sp={sp} wikiUrl={info?.wikipedia?.url} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
