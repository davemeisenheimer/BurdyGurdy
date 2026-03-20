import { useEffect, useState, useRef } from 'react';
import type { QuizQuestion, AttributedPhoto } from '../../types';
import { fetchBirdInfo, fetchRecentSightings, fetchRegionSpecies, fetchBirdPhotos, fetchBirdAudio } from '../../lib/api';
import type { BirdInfoData, RecentSighting, CarouselRecording } from '../../lib/api';
import { AccountPill } from '../ui/AccountPill';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SlideSpecies {
  speciesCode: string;
  comName: string;
  sciName: string;
  familyComName: string;
}

type CarouselSlide = SlideSpecies & { kind: 'title' | 'photo' };

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
}

// ── IUCN conservation status ──────────────────────────────────────────────────

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

// ── RecordingPanel ────────────────────────────────────────────────────────────

function RecordingPanel({ recordings, autoplay = false, pauseRef }: {
  recordings: BirdInfoData['recordings'];
  autoplay?:  boolean;
  pauseRef?:  React.MutableRefObject<(() => void) | null>;
}) {
  const [idx, setIdx]         = useState(0);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const rec = recordings[idx];

  useEffect(() => { setIdx(0); setPlaying(autoplay); }, [recordings]);

  useEffect(() => {
    if (!pauseRef) return;
    pauseRef.current = () => { setPlaying(false); audioRef.current?.pause(); };
    return () => { pauseRef.current = null; };
  }, [pauseRef]);

  useEffect(() => {
    if (!audioRef.current) return;
    if (playing) audioRef.current.play().catch(() => setPlaying(false));
    else         audioRef.current.pause();
  }, [playing, idx]);

  // Pause on unmount so audio doesn't outlive the component
  useEffect(() => {
    return () => { audioRef.current?.pause(); };
  }, []);

  if (recordings.length === 0) return null;

  return (
    <div className="flex flex-col h-full bg-slate-900 overflow-hidden">
      <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
        {rec.sonoUrl
          ? <img src={rec.sonoUrl} alt="Sonogram" className="w-full h-full object-cover" />
          : <span className="text-slate-500 text-xs">No sonogram</span>
        }
      </div>
      <div className="shrink-0 flex items-center gap-1.5 px-2 py-2 bg-slate-800">
        {recordings.length > 1 && (
          <button onClick={() => { setPlaying(false); setIdx(i => (i - 1 + recordings.length) % recordings.length); }}
            className="w-6 h-6 rounded-full bg-slate-600 hover:bg-slate-500 flex items-center justify-center text-white text-sm">‹</button>
        )}
        <button onClick={() => setPlaying(p => !p)}
          className="w-8 h-8 rounded-full bg-forest-600 hover:bg-forest-700 flex items-center justify-center text-white text-sm shadow">
          {playing ? '⏸' : '▶'}
        </button>
        {recordings.length > 1 && (
          <button onClick={() => { setPlaying(false); setIdx(i => (i + 1) % recordings.length); }}
            className="w-6 h-6 rounded-full bg-slate-600 hover:bg-slate-500 flex items-center justify-center text-white text-sm">›</button>
        )}
        <div className="flex-1 min-w-0 ml-1">
          {rec.type    && <p className="text-xs font-semibold text-slate-200 capitalize truncate">{rec.type}</p>}
          {rec.country && <p className="text-xs text-slate-400 truncate">{rec.country}</p>}
        </div>
        {recordings.length > 1 && (
          <span className="text-xs text-slate-400 shrink-0">{idx + 1}/{recordings.length}</span>
        )}
      </div>
      <audio ref={audioRef} src={rec.file} onEnded={() => setPlaying(false)} />
    </div>
  );
}

// ── RelatedSpeciesCarousel ────────────────────────────────────────────────────

function RelatedSpeciesCarousel({
  referenceSpecies,
  regionCode,
  autoScrollEnabled = true,
  onViewSpecies,
  onWillPlay,
}: {
  referenceSpecies:   SlideSpecies;
  regionCode?:        string;
  autoScrollEnabled?: boolean;
  onViewSpecies:      (species: SlideSpecies) => void;
  onWillPlay?:        () => void;
}) {
  const [slides, setSlides]           = useState<CarouselSlide[]>([{ kind: 'title', ...referenceSpecies }]);
  const [photos, setPhotos]           = useState<Map<string, AttributedPhoto | null>>(new Map());
  const [fetchedCodes, setFetchedCodes] = useState<Set<string>>(
    () => new Set([referenceSpecies.speciesCode]),
  );
  const [imgLoadedUrls, setImgLoadedUrls] = useState<Set<string>>(new Set());
  const fetchingRef     = useRef<Set<string>>(new Set([referenceSpecies.speciesCode]));
  const genRef          = useRef(0);
  const [idx, setIdx]   = useState(0);
  const [animated, setAnimated]           = useState(true);
  const [autoScrolling, setAutoScrolling] = useState(false);
  const hasTriggeredRef = useRef(false);

  // Audio state
  const [recordings, setRecordings] = useState<Map<string, CarouselRecording[] | null>>(new Map());
  const fetchingAudioRef = useRef<Set<string>>(new Set());
  const [playingCode, setPlayingCode] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Navigate to a slide; wrapping is always instant (no reverse-direction animation)
  const navigateTo = (newIdx: number) => {
    const n      = slides.length;
    const isWrap = (newIdx === 0 && idx === n - 1) || (newIdx === n - 1 && idx === 0);
    if (isWrap) setAnimated(false);
    setIdx(newIdx);
  };

  // Re-enable animation one frame after an instant wrap so the next manual swipe animates
  useEffect(() => {
    if (animated) return;
    const t = requestAnimationFrame(() => requestAnimationFrame(() => setAnimated(true)));
    return () => cancelAnimationFrame(t);
  }, [animated]);

  const stopAutoScroll = () => setAutoScrolling(false);

  // Auto-scroll trigger: start once the first related species photo is ready
  useEffect(() => {
    if (!autoScrollEnabled || hasTriggeredRef.current || slides.length <= 1) return;
    if (!fetchedCodes.has(slides[1].speciesCode)) return;
    hasTriggeredRef.current = true;
    setAutoScrolling(true);
  }, [autoScrollEnabled, slides, fetchedCodes]);

  // Drive the auto-scroll — each idx change schedules the next step after 2800ms.
  // Scheduling is in an effect (not inside a state updater) so React StrictMode
  // double-invocation never spawns duplicate loops.
  useEffect(() => {
    if (!autoScrolling) return;
    const n = slides.length;
    const timer = setTimeout(() => {
      const next = (idx + 1) % n;
      if (next === 0) {
        setAutoScrolling(false);
        setAnimated(false); // instant wrap back to slide 0
        setIdx(0);
      } else {
        setIdx(next);
      }
    }, 2800);
    return () => clearTimeout(timer);
  }, [autoScrolling, idx, slides.length]);

  // Reset when reference species changes
  useEffect(() => {
    genRef.current++;
    stopAutoScroll();
    hasTriggeredRef.current = false;
    setAnimated(true);
    setSlides([{ kind: 'title', ...referenceSpecies }]);
    setPhotos(new Map());
    setFetchedCodes(new Set([referenceSpecies.speciesCode]));
    setImgLoadedUrls(new Set());
    fetchingRef.current = new Set([referenceSpecies.speciesCode]);
    setRecordings(new Map());
    fetchingAudioRef.current = new Set();
    setPlayingCode(null);
    audioRef.current?.pause();
    setIdx(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceSpecies.speciesCode]);

  // Build related species list from the regional species cache
  useEffect(() => {
    if (!regionCode) return;
    const gen = genRef.current;
    fetchRegionSpecies(regionCode).then(allSpecies => {
      if (genRef.current !== gen) return;
      const refCode  = referenceSpecies.speciesCode;
      const refGenus = referenceSpecies.sciName.split(' ')[0];

      // Candidates: recent species always included; historical only if regionally common
      const candidates = allSpecies.filter(s => !s.isHistorical || s.isCommon);

      let related = candidates.filter(s =>
        s.speciesCode !== refCode && s.sciName.split(' ')[0] === refGenus,
      );

      // Fallback to same family if fewer than 2 genus matches
      if (related.length < 2) {
        const refFam = allSpecies.find(s => s.speciesCode === refCode)?.familyComName
          ?? referenceSpecies.familyComName;
        related = candidates.filter(s =>
          s.speciesCode !== refCode && s.familyComName === refFam,
        );
      }

      setSlides([
        { kind: 'title' as const, ...referenceSpecies },
        ...related.slice(0, 9).map(s => ({
          kind:          'photo' as const,
          speciesCode:   s.speciesCode,
          comName:       s.comName,
          sciName:       s.sciName,
          familyComName: s.familyComName,
        })),
      ]);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceSpecies.speciesCode, regionCode]);

  // Lazy-fetch photos for current slide + 2 ahead
  useEffect(() => {
    const n   = slides.length;
    const gen = genRef.current;
    const toFetch = [...new Set([idx, (idx + 1) % n, (idx + 2) % n])];

    for (const i of toFetch) {
      const sp = slides[i];
      if (!sp || sp.kind === 'title' || fetchingRef.current.has(sp.speciesCode)) continue;
      fetchingRef.current.add(sp.speciesCode);
      const { speciesCode, comName, sciName } = sp;
      fetchBirdPhotos(speciesCode, comName, sciName)
        .then(({ primary }) => {
          if (genRef.current !== gen) return;
          setPhotos(prev => new Map(prev).set(speciesCode, primary));
          setFetchedCodes(prev => new Set(prev).add(speciesCode));
        })
        .catch(() => {
          if (genRef.current !== gen) return;
          setFetchedCodes(prev => new Set(prev).add(speciesCode));
        });
    }
  }, [idx, slides]);

  // Lazy-fetch audio for current slide + 2 ahead
  useEffect(() => {
    const n   = slides.length;
    const gen = genRef.current;
    const toFetch = [...new Set([idx, (idx + 1) % n, (idx + 2) % n])];

    for (const i of toFetch) {
      const sp = slides[i];
      if (!sp || sp.kind === 'title' || fetchingAudioRef.current.has(sp.speciesCode)) continue;
      fetchingAudioRef.current.add(sp.speciesCode);
      fetchBirdAudio(sp.sciName)
        .then(recs => {
          if (genRef.current !== gen) return;
          setRecordings(prev => new Map(prev).set(sp.speciesCode, recs.length > 0 ? recs : null));
        })
        .catch(() => {
          if (genRef.current !== gen) return;
          setRecordings(prev => new Map(prev).set(sp.speciesCode, null));
        });
    }
  }, [idx, slides]);

  // Stop audio when navigating away from the playing slide
  useEffect(() => {
    if (!playingCode) return;
    if (slides[idx]?.speciesCode !== playingCode) {
      audioRef.current?.pause();
      setPlayingCode(null);
    }
  }, [idx, slides, playingCode]);

  // Drive playback when playingCode changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!playingCode) { audio.pause(); return; }
    const recs = recordings.get(playingCode);
    if (!recs || recs.length === 0) { setPlayingCode(null); return; }
    const rec = recs[0];
    if (audio.src !== rec.file) audio.src = rec.file;
    audio.play().catch(() => setPlayingCode(null));
  }, [playingCode, recordings]);

  // Pause on unmount
  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const n         = slides.length;
  const prevCode  = slides[(idx - 1 + n) % n]?.speciesCode ?? '';
  const nextCode  = slides[(idx + 1) % n]?.speciesCode ?? '';
  const prevReady = fetchedCodes.has(prevCode);
  const nextReady = fetchedCodes.has(nextCode);

  return (
    <div className="relative bg-slate-900 h-full overflow-hidden">
      {/* Slide track — CSS-transform horizontal carousel */}
      <div
        className="flex h-full"
        style={{
          width: `${n * 100}%`,
          transform: `translateX(-${idx * (100 / n)}%)`,
          transition: animated ? 'transform 450ms ease-in-out' : 'none',
        }}
      >
        {slides.map((slide) => {
          const photo      = slide.kind === 'photo' ? (photos.get(slide.speciesCode) ?? null) : null;
          const imgVisible = photo?.url ? imgLoadedUrls.has(photo.url) : false;

          return (
            <div
              key={slide.speciesCode}
              className={`relative h-full shrink-0 ${slide.kind === 'title' ? 'bg-slate-800' : 'bg-slate-900'}`}
              style={{ width: `${100 / n}%` }}
            >
              {slide.kind === 'title' ? (
                <div className="flex flex-col items-center justify-center h-full px-4 text-center gap-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Related Species</p>
                  <p className="text-base font-bold text-white leading-tight mt-1">{slide.comName}</p>
                  <p className="text-xs italic text-slate-400">{slide.sciName}</p>
                  <p className="text-xs text-slate-500">{slide.familyComName}</p>
                  <p className="text-xs text-slate-400 mt-4 leading-relaxed">Scroll to see and compare related species →</p>
                </div>
              ) : (
                <>
                  {photo && (
                    <img
                      src={photo.url}
                      alt={slide.comName}
                      className={`w-full h-full object-contain transition-opacity duration-500 ${imgVisible ? 'opacity-100' : 'opacity-0'}`}
                      onLoad={() => setImgLoadedUrls(prev => new Set(prev).add(photo.url))}
                    />
                  )}
                  <div className="absolute inset-x-0 top-0 flex items-center bg-black/60 px-2 py-1.5 gap-2">
                    <span className="flex-1 min-w-0 text-xs text-white/80 font-semibold truncate">
                      {slide.comName} ({slide.sciName})
                    </span>
                    <button
                      onClick={() => { stopAutoScroll(); onViewSpecies(slide); }}
                      className="shrink-0 text-xs text-sky-300 hover:text-sky-200 whitespace-nowrap"
                    >
                      View info →
                    </button>
                  </div>
                  {(() => {
                    const recs = recordings.get(slide.speciesCode);
                    const isPlaying = playingCode === slide.speciesCode;
                    if (recs === undefined) return null; // not fetched yet
                    if (recs === null) return null;       // no recordings
                    return (
                      <button
                        onClick={e => { e.stopPropagation(); stopAutoScroll(); if (!isPlaying) onWillPlay?.(); setPlayingCode(isPlaying ? null : slide.speciesCode); }}
                        className="absolute bottom-1 left-1 flex items-center gap-1 bg-black/60 hover:bg-black/80 rounded-full px-2 py-0.5 text-white text-xs"
                        aria-label={isPlaying ? 'Pause song' : 'Play song'}
                      >
                        {isPlaying ? '⏸' : '♪'} {isPlaying ? 'pause' : recs[0].type ?? 'song'}
                      </button>
                    );
                  })()}
                  {photo?.credit && (
                    <span className="absolute bottom-1 right-1 bg-black/50 text-white/50 text-[10px] px-1.5 py-0.5 rounded max-w-[60%] truncate">
                      {photo.credit}
                    </span>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Nav arrows — fade in over 2s once adjacent slide photo is ready */}
      {n > 1 && (
        <>
          <button
            onClick={() => { stopAutoScroll(); navigateTo((idx - 1 + n) % n); }}
            className={`absolute left-1 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm transition-opacity duration-[2000ms] ${prevReady ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          >‹</button>
          <button
            onClick={() => { stopAutoScroll(); navigateTo((idx + 1) % n); }}
            className={`absolute right-1 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm transition-opacity duration-[2000ms] ${nextReady ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          >›</button>
          <span className="absolute top-8 right-1 bg-black/50 text-white text-xs px-1 py-0.5 rounded-full">
            {idx + 1}/{n}
          </span>
        </>
      )}
      <audio ref={audioRef} onEnded={() => setPlayingCode(null)} />
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseLocName(locName: string): { name: string; coords: string | null } {
  const bracketed = locName.match(/^(.+?)\s*\(\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\)\s*$/);
  if (bracketed) return { name: bracketed[1].trim(), coords: `${bracketed[2]}, ${bracketed[3]}` };
  const appended = locName.match(/^(.+?)\s+(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/);
  if (appended) return { name: appended[1].trim(), coords: `${appended[2]}, ${appended[3]}` };
  return { name: locName, coords: null };
}

function formatSightingDate(obsDt: string): string {
  const d = new Date(obsDt.replace(' ', 'T'));
  if (isNaN(d.getTime())) return obsDt;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function BirdInfoPanel({ question, isAnswered, isCorrect, selectedAnswer, regionCode, maxRecentSightings = 4, autoScrollRelatedSpecies = true, autoplayRevealAudio = false, userEmail, onAuthClick, onSignOut }: Props) {
  const mainAudioPauseRef = useRef<(() => void) | null>(null);

  const [questionInfo, setQuestionInfo]       = useState<BirdInfoData | null>(null);
  const [loading, setLoading]                 = useState(false);
  const [questionSightings, setQuestionSightings] = useState<RecentSighting[]>([]);

  const [viewingSpecies, setViewingSpecies]   = useState<SlideSpecies | null>(null);
  const [viewedInfo, setViewedInfo]           = useState<BirdInfoData | null>(null);
  const [viewedSightings, setViewedSightings] = useState<RecentSighting[]>([]);

  // Derived: which species' data to show in the panel body
  const info      = viewingSpecies ? viewedInfo      : questionInfo;
  const sightings = viewingSpecies ? viewedSightings : questionSightings;
  const sp: SlideSpecies | null = viewingSpecies ?? (question ? {
    speciesCode:   question.speciesCode,
    comName:       question.comName,
    sciName:       question.sciName,
    familyComName: question.familyComName,
  } : null);

  // Fetch info for the question species (runs on each new question)
  useEffect(() => {
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
  }, [question?.speciesCode, isAnswered]);

  // Fetch info for a related species (when user clicks "View info →")
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

  // ── Idle state ────────────────────────────────────────────────────────────
  if (!isAnswered || !question) {
    if (!question) {
      return (
        <div className="flex flex-col h-full bg-slate-50 overflow-y-auto">
          <div className="flex-1 flex flex-col items-center justify-center px-8 py-10">
          <div className="w-full max-w-[34rem]">

            {/* App title */}
            <h1 className="text-3xl font-bold text-slate-800 leading-tight text-center">BirdyGurdy</h1>
            <p className="text-sm text-slate-500 mt-1 text-center">by Three Corner Orchard Technology</p>

            {/* Feature bullets */}
            <ul className="mt-6 space-y-3">
              {[
                { icon: '🧠', text: 'Adaptive learning — birds are introduced gradually, with most common birds first, and the quiz adjusts to your pace as you build mastery.' },
                { icon: '📍', text: 'Region-based sightings — your quiz pool comes from real eBird observations in your area, so you learn birds you\'ll actually encounter. If you use the map to select your region, the zoom level will determine scope: county, province/state, or country.' },
                { icon: '⚙️', text: 'Configurable — choose your region, bird families you care about, question types (song, photo...), observation window, and how many questions per round. Visit settings for more configurability options.' },
              ].map(({ icon, text }) => (
                <li key={icon} className="flex items-start gap-3">
                  <div className="shrink-0 w-20 flex justify-end">
                    <span className="text-xl leading-snug">{icon}</span>
                  </div>
                  <p className="text-sm text-slate-600 leading-relaxed">{text}</p>
                </li>
              ))}
              <li className="flex items-start gap-3">
                <div className="shrink-0 w-20 flex justify-end">
                  <AccountPill userEmail={userEmail} onAuthClick={onAuthClick ?? (() => {})} onSignOut={onSignOut ?? (() => {})} dropdownAlign="right" compact />
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">Sign in to back up your progress and sync it across all your devices. Your learning history, favourites, and settings follow you everywhere.</p>
              </li>
            </ul>

            {/* Credits */}
            <div className="mt-8 pt-6 border-t border-slate-200">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Powered by</h2>
              <div className="flex flex-wrap gap-2 text-center justify-center">
                {[
                  { label: 'eBird / Cornell Lab', desc: 'Species lists & sightings' },
                  { label: 'iNaturalist',          desc: 'Bird photos' },
                  { label: 'Macaulay Library',     desc: 'Bird photos' },
                  { label: 'xeno-canto',           desc: 'Bird songs & calls' },
                  { label: 'Wikipedia / Wikimedia Commons', desc: 'Species info & photos' },
                ].map(({ label, desc }) => (
                  <div key={label} className="flex flex-col bg-white border border-slate-200 rounded-lg px-3 py-2">
                    <span className="text-xs font-semibold text-slate-700">{label}</span>
                    <span className="text-[10px] text-slate-400">{desc}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Bird icon + prompt */}
            <div className="flex flex-col items-center mt-8 text-center">
              <img src="/BurdySinging.png" alt="" className="h-16 w-auto mb-3" />
              <p className="text-slate-500 text-sm">Start a quiz on the left to begin identifying birds.</p>
            </div>

          </div>
        </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col h-full items-center justify-center bg-slate-50 text-center px-8">
        <img src="/BurdySinging.png" alt="" className="h-12 w-auto mb-4 opacity-30" />
        <p className="text-slate-400 text-sm">Answer the question to reveal bird info</p>
      </div>
    );
  }

  const cs      = info?.conservationStatus;
  const csLabel = cs ? (IUCN_LABEL[cs.code] ?? cs.name) : null;
  const csColor = cs ? (IUCN_COLOR[cs.code] ?? 'bg-slate-100 text-slate-500') : null;

  const ebirdUrl    = sp ? `https://ebird.org/species/${sp.speciesCode}` : '';
  const allAboutUrl = sp ? `https://www.allaboutbirds.org/guide/${sp.sciName.replace(/ /g, '_')}` : '';
  const wikiUrl     = info?.wikipedia?.url ?? (sp ? `https://en.wikipedia.org/wiki/${sp.sciName.replace(/ /g, '_')}` : '');
  const inatUrl     = sp ? `https://www.inaturalist.org/taxa/search?q=${encodeURIComponent(sp.sciName)}` : '';
  const audubonUrl  = sp ? `https://www.audubon.org/field-guide/bird/${sp.comName.toLowerCase().replace(/ /g, '-')}` : '';
  const xenoUrl     = sp ? `https://xeno-canto.org/explore?query=${encodeURIComponent(sp.sciName)}` : '';

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">

      {/* Answer result banner — always for the question species */}
      <div className={`shrink-0 flex items-center px-4 py-2.5 border-b ${isCorrect ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
        <p className={`flex-1 text-sm font-semibold ${isCorrect ? 'text-green-700' : 'text-red-700'}`}>
          {isCorrect
            ? `✓ Correct — ${question.comName}`
            : `✗ You answered "${selectedAnswer}" — correct: ${question.comName}`}
        </p>
        {viewingSpecies && (
          <button
            onClick={() => setViewingSpecies(null)}
            className="shrink-0 ml-3 text-xs text-sky-600 hover:text-sky-800 whitespace-nowrap"
          >
            ← Back to {question.comName}
          </button>
        )}
      </div>

      {/* ── Triptych ── */}
      <div className="shrink-0 relative flex justify-center gap-2 px-3 py-2 bg-white" style={{ height: '224px' }}>

        {/* Glass overlay while initial bird info is loading */}
        <div className={`absolute inset-0 z-10 bg-white/60 backdrop-blur-sm transition-opacity duration-700 pointer-events-none ${loading ? 'opacity-100' : 'opacity-0'}`} />

        {/* Range map — shown when the viewed species has one */}
        {info?.rangeMapUrl && (
          <div className="overflow-hidden rounded-lg border border-stone-300 bg-white flex items-center p-1 gap-1.5" style={{ width: 'calc((100% - 16px) / 3)' }}>
            <div className="flex-1 min-w-0 flex items-center justify-center h-full">
              <img
                src={info.rangeMapUrl}
                alt={`${sp?.comName} range map`}
                className="max-w-full max-h-full object-contain"
              />
            </div>
            {(info.rangeMapLegend?.length ?? 0) > 0 && (
              <div className="shrink-0 w-24 self-stretch flex flex-col rounded-lg border border-stone-300 bg-stone-50 px-2 py-1.5">
                <p className="text-stone-500 font-semibold mb-1.5 leading-tight" style={{ fontSize: '0.6rem' }}>
                  Range legend:
                </p>
                <div className="flex-1 flex flex-col gap-0.5">
                  {info.rangeMapLegend.map(({ color, label }, i) => (
                    <div key={`${i}-${label}`} className="flex items-start gap-1">
                      <span className="shrink-0 mt-0.5 w-3 h-3 rounded-sm border border-stone-300" style={{ backgroundColor: color }} />
                      <span className="text-stone-600 leading-tight" style={{ fontSize: '0.62rem' }}>{label}</span>
                    </div>
                  ))}
                </div>
                <a href={ebirdUrl} target="_blank" rel="noopener noreferrer"
                  className="text-sky-600 hover:underline mt-1.5 leading-tight" style={{ fontSize: '0.6rem' }}>
                  Interactive map ↗
                </a>
              </div>
            )}
          </div>
        )}

        {/* Sonogram + audio */}
        {(info?.recordings?.length ?? 0) > 0 && (
          <div className="overflow-hidden rounded-lg border border-stone-300" style={{ width: 'calc((100% - 16px) / 3)' }}>
            <RecordingPanel recordings={info!.recordings} autoplay={autoplayRevealAudio} pauseRef={mainAudioPauseRef} />
          </div>
        )}

        {/* Related species carousel — always visible once answered */}
        <div className="overflow-hidden rounded-lg border border-stone-300" style={{ width: 'calc((100% - 16px) / 3)' }}>
          <RelatedSpeciesCarousel
            referenceSpecies={{
              speciesCode:   question.speciesCode,
              comName:       question.comName,
              sciName:       question.sciName,
              familyComName: question.familyComName,
            }}
            regionCode={regionCode}
            autoScrollEnabled={autoScrollRelatedSpecies}
            onViewSpecies={setViewingSpecies}
            onWillPlay={() => mainAudioPauseRef.current?.()}
          />
        </div>
      </div>

      {/* ── Content card ── */}
      <div className="flex-1 min-h-0 mx-3 mb-2 mt-1 rounded-xl border border-stone-300 flex flex-col overflow-hidden">

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-slate-400 text-sm">Loading bird info…</p>
          </div>
        ) : viewingSpecies && !viewedInfo ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-slate-400 text-sm">Loading…</p>
          </div>
        ) : (
          <>
            {/* Species header */}
            <div className="shrink-0 px-5 pt-4 pb-3 border-b border-stone-100 flex items-start gap-4">
              <div className="shrink-0 space-y-1">
                <h2 className="text-2xl font-bold text-slate-900 leading-tight">{sp?.comName}</h2>
                <p className="text-base italic text-slate-500">{sp?.sciName}</p>
                <div className="flex flex-wrap items-center gap-1 pt-1 text-xs text-slate-500">
                  <span className="bg-slate-100 px-2 py-0.5 rounded-full">Family: {sp?.familyComName}</span>
                </div>
                {cs && csLabel && csColor && (
                  <div className="pt-1">
                    <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${csColor}`}>
                      IUCN: {cs.code} — {csLabel}
                    </span>
                  </div>
                )}
              </div>

              {sightings.length > 0 && (
                <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-center">Recent sightings</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {sightings.map((s, i) => {
                      const loc = parseLocName(s.locName);
                      const coords = s.lat != null && s.lng != null
                        ? `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`
                        : loc.coords;
                      return (
                        <div key={i} className="shrink-0 flex flex-col bg-sky-50 border border-sky-100 rounded-lg px-2.5 py-1.5">
                          <p className="text-xs font-medium text-slate-700 leading-tight whitespace-nowrap">{loc.name}</p>
                          <p className="text-[10px] text-slate-400 leading-tight whitespace-nowrap min-h-[1em]">{coords ?? ''}</p>
                          <div className="flex items-center gap-1 mt-auto pt-0.5">
                            <span className="text-[10px] text-slate-500 whitespace-nowrap">{formatSightingDate(s.obsDt)}</span>
                            {s.howMany != null && (
                              <span className="text-[10px] bg-sky-100 text-sky-700 px-1 rounded-full shrink-0">×{s.howMany}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Wikipedia extract */}
            {info?.wikipedia?.extract && (
              <div className="flex-1 min-h-0 flex flex-col px-5 pt-3 pb-2">
                <div className="flex-1 min-h-0 overflow-y-auto pr-1">
                  {info.wikipedia.extract.split(/^(={1,3}[^=\n]+={1,3})$/m).map((chunk, i) => {
                    const heading = chunk.match(/^={1,3}([^=\n]+)={1,3}$/);
                    if (heading) {
                      return (
                        <h4 key={i} className="text-xs font-bold uppercase tracking-wider text-slate-400 mt-4 mb-1 border-b border-slate-200 pb-1">
                          {heading[1].trim()}
                        </h4>
                      );
                    }
                    const body = chunk.trim();
                    if (!body) return null;
                    return i === 0 ? (
                      <>
                        <h4 key={`${i}-heading`} className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1 border-b border-slate-200 pb-1">About</h4>
                        <p key={i} className="text-sm text-slate-700 leading-relaxed whitespace-pre-line mb-2">{body}</p>
                      </>
                    ) : (
                      <p key={i} className="text-sm text-slate-700 leading-relaxed whitespace-pre-line mb-2">{body}</p>
                    );
                  })}
                </div>
                <a href={wikiUrl} target="_blank" rel="noopener noreferrer"
                  className="shrink-0 inline-block mt-2 mb-1 text-xs text-sky-600 hover:underline">
                  Read more on Wikipedia →
                </a>
              </div>
            )}

            {/* Range map fallback */}
            {!info?.rangeMapUrl && (
              <div className="shrink-0 px-5 py-3 border-t border-stone-100">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Range & Distribution</h3>
                <a href={ebirdUrl} target="_blank" rel="noopener noreferrer"
                  className="text-sm text-sky-600 hover:underline">
                  View interactive range map on eBird ↗
                </a>
              </div>
            )}

            {/* Quick links */}
            <div className="shrink-0 px-5 py-3 border-t border-stone-100">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">More Information</h3>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: 'eBird',           href: ebirdUrl },
                  { label: 'All About Birds', href: allAboutUrl },
                  { label: 'Wikipedia',       href: wikiUrl },
                  { label: 'iNaturalist',     href: inatUrl },
                  { label: 'Audubon',         href: audubonUrl },
                  { label: 'Xeno-canto',      href: xenoUrl },
                ].map(({ label, href }) => href ? (
                  <a key={label} href={href} target="_blank" rel="noopener noreferrer"
                    className="text-xs px-3 py-1.5 rounded-full border border-slate-300 text-slate-600 hover:bg-slate-50 hover:border-slate-400 transition-colors">
                    {label} ↗
                  </a>
                ) : null)}
              </div>
            </div>
          </>
        )}

      </div>{/* end content card */}
    </div>
  );
}
