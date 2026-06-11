import { useEffect, useState, useRef } from 'react';
import type { AttributedPhoto } from '../../types';
import { fetchRegionSpecies, fetchBirdPhotos, fetchBirdAudio } from '../../services/remote/api';
import type { CarouselRecording } from '../../services/remote/api';
import { db } from '../../lib/db';
import type { SlideSpecies } from './types';

type CarouselSlide = SlideSpecies & { kind: 'title' | 'photo' };

interface Props {
  referenceSpecies:    SlideSpecies;
  regionCode?:         string;
  autoScrollEnabled?:  boolean;
  showReferencePhoto?: boolean;
  onViewSpecies:       (species: SlideSpecies) => void;
  onWillPlay?:         () => void;
}

export function RelatedSpeciesCarousel({
  referenceSpecies,
  regionCode,
  autoScrollEnabled = true,
  showReferencePhoto = false,
  onViewSpecies,
  onWillPlay,
}: Props) {
  const [slides, setSlides]             = useState<CarouselSlide[]>([{ kind: 'title', ...referenceSpecies }]);
  const [photos, setPhotos]             = useState<Map<string, AttributedPhoto | null>>(new Map());
  const [fetchedCodes, setFetchedCodes] = useState<Set<string>>(() => new Set([referenceSpecies.speciesCode]));
  const [imgLoadedUrls, setImgLoadedUrls] = useState<Set<string>>(new Set());
  const fetchingRef      = useRef<Set<string>>(new Set([referenceSpecies.speciesCode]));
  const genRef           = useRef(0);
  const [idx, setIdx]    = useState(0);
  const [animated, setAnimated]           = useState(true);
  const [autoScrolling, setAutoScrolling] = useState(false);
  const hasTriggeredRef  = useRef(false);

  // All non-blocked photos of the subject bird (browse mode only)
  const [subjectPhotos, setSubjectPhotos]   = useState<AttributedPhoto[]>([]);
  // Toggle: 'related' = current carousel, 'photos' = all subject bird photos
  const [photoMode, setPhotoMode]           = useState<'related' | 'photos'>('photos');
  const [photoIdx,  setPhotoIdx]            = useState(0);

  useEffect(() => {
    if (!showReferencePhoto) { setSubjectPhotos([]); return; }
    setSubjectPhotos([]);
    const { speciesCode, comName, sciName } = referenceSpecies;
    Promise.all([
      fetchBirdPhotos(speciesCode, comName, sciName),
      db.blockedPhotos.toArray(),
      db.adminBlockedMedia.filter(r => r.speciesCode === speciesCode).toArray(),
    ]).then(([{ primary, optional }, blocked, adminBlocked]) => {
      const blockedUrls = new Set([...blocked.map(b => b.url), ...adminBlocked.map(b => b.url)]);
      const all = [primary, ...(optional ?? [])].filter((p): p is AttributedPhoto => !!p && !blockedUrls.has(p.url));
      setSubjectPhotos(all);
    }).catch(() => { setSubjectPhotos([]); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showReferencePhoto, referenceSpecies.speciesCode]);

  const containerRef                    = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Audio state
  const [recordings, setRecordings]  = useState<Map<string, CarouselRecording[] | null>>(new Map());
  const fetchingAudioRef = useRef<Set<string>>(new Set());
  const [playingCode, setPlayingCode] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Listen mode
  const [listenMode, setListenMode]   = useState(false);
  const listenModeRef  = useRef(false);
  const listenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearListenTimer = () => {
    if (listenTimerRef.current !== null) {
      clearTimeout(listenTimerRef.current);
      listenTimerRef.current = null;
    }
  };

  const stopListenMode = () => {
    clearListenTimer();
    setListenMode(false);
    listenModeRef.current = false;
  };

  const startListenMode = () => {
    if (slides.length <= 1) return;
    setAutoScrolling(false);
    setAnimated(true);
    setListenMode(true);
    listenModeRef.current = true;
    setIdx(1);
    // Call play() synchronously inside the gesture handler so iOS Safari allows it
    const firstSlide = slides[1];
    if (firstSlide && firstSlide.kind !== 'title' && audioRef.current) {
      const recs = recordings.get(firstSlide.speciesCode);
      if (recs && recs.length > 0) {
        const rec = recs[0];
        if (audioRef.current.src !== rec.file) audioRef.current.src = rec.file;
        audioRef.current.play().catch(() => {});
      }
    }
  };

  // Navigate to a slide; wrapping is always instant (no reverse-direction animation)
  const navigateTo = (newIdx: number) => {
    const n      = slides.length;
    const isWrap = (newIdx === 0 && idx === n - 1) || (newIdx === n - 1 && idx === 0);
    if (isWrap) setAnimated(false);
    setIdx(newIdx);
  };

  // Re-enable animation one frame after an instant wrap
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

  // Drive the auto-scroll
  useEffect(() => {
    if (!autoScrolling) return;
    const n = slides.length;
    const timer = setTimeout(() => {
      const next = (idx + 1) % n;
      if (next === 0) {
        setAutoScrolling(false);
        setAnimated(false);
        setIdx(0);
      } else {
        setIdx(next);
      }
    }, 2800);
    return () => clearTimeout(timer);
  }, [autoScrolling, idx, slides.length]);

  // Drive listen mode: advances through each photo slide playing its audio
  useEffect(() => {
    if (!listenMode) return;
    const slide = slides[idx];
    if (!slide || slide.kind === 'title') return;

    const code = slide.speciesCode;
    const recs = recordings.get(code);
    const n    = slides.length;

    const advance = () => {
      if (!listenModeRef.current) return;
      clearListenTimer();
      audioRef.current?.pause();
      setPlayingCode(null);
      const next = idx + 1;
      if (next >= n) {
        setListenMode(false);
        listenModeRef.current = false;
        setAnimated(false);
        setIdx(0);
      } else {
        setIdx(next);
      }
    };

    clearListenTimer();

    if (recs === undefined) {
      // Still fetching — wait up to 5 s then advance
      listenTimerRef.current = setTimeout(advance, 5000);
    } else if (recs === null || recs.length === 0) {
      // No audio available — pause 2 s so the user can see the bird, then advance
      listenTimerRef.current = setTimeout(advance, 2000);
    } else {
      // Play audio; 30 s fallback in case onEnded never fires
      setPlayingCode(code);
      listenTimerRef.current = setTimeout(advance, 30000);
    }

    return clearListenTimer;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listenMode, idx, recordings, slides.length]);

  // Reset when reference species changes
  useEffect(() => {
    genRef.current++;
    stopAutoScroll();
    stopListenMode();
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
    setPhotoMode('photos');
    setPhotoIdx(0);
    setSubjectPhotos([]);
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

      let related = allSpecies.filter(s =>
        s.speciesCode !== refCode && s.sciName.split(' ')[0] === refGenus,
      );

      if (related.length < 9) {
        const refFam = allSpecies.find(s => s.speciesCode === refCode)?.familyComName
          ?? referenceSpecies.familyComName;
        const familyFill = allSpecies.filter(s =>
          s.speciesCode !== refCode &&
          s.familyComName === refFam &&
          s.sciName.split(' ')[0] !== refGenus,
        ).slice(0, 9 - related.length);
        related = [...related, ...familyFill];
      }

      setSlides([
        { kind: 'title' as const, ...referenceSpecies },
        ...related.map(s => ({
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
      Promise.all([
        fetchBirdPhotos(speciesCode, comName, sciName),
        db.blockedPhotos.toArray(),
        db.adminBlockedMedia.filter(r => r.speciesCode === speciesCode).toArray(),
      ]).then(([{ primary, optional }, blocked, adminBlocked]) => {
        if (genRef.current !== gen) return;
        const blockedUrls = new Set([
          ...blocked.map(b => b.url),
          ...adminBlocked.map(b => b.url),
        ]);
        const photo = [primary, ...(optional ?? [])].find(p => p && !blockedUrls.has(p.url)) ?? null;
        setPhotos(prev => new Map(prev).set(speciesCode, photo));
        setFetchedCodes(prev => new Set(prev).add(speciesCode));
      }).catch(() => {
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

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (isFullscreen) document.exitFullscreen().catch(() => {});
    else containerRef.current.requestFullscreen().catch(() => {});
  };

  const n        = slides.length;
  const prevCode = slides[(idx - 1 + n) % n]?.speciesCode ?? '';
  const nextCode = slides[(idx + 1) % n]?.speciesCode ?? '';
  const prevReady = fetchedCodes.has(prevCode);
  const nextReady = fetchedCodes.has(nextCode);

  const listenButton = (
    <button
      onClick={startListenMode}
      className="flex items-center gap-1.5 bg-black/60 hover:bg-black/80 text-white text-xs rounded-full px-3 py-1.5 transition-colors"
    >
      ♪ Listen to related species
    </button>
  );

  // ── Photos mode: all subject bird photos ──────────────────────────────────
  if (showReferencePhoto && photoMode === 'photos') {
    const total     = subjectPhotos.length;
    const allSlides = total + 1; // 0 = title card, 1..N = photos
    const isTitle   = photoIdx === 0;
    const photo     = !isTitle ? (subjectPhotos[photoIdx - 1] ?? null) : null;
    const visible   = photo?.url ? imgLoadedUrls.has(photo.url) : false;
    return (
      <div ref={containerRef} className="relative bg-slate-800 h-full overflow-hidden">
        {isTitle ? (
          <div className="flex flex-col items-center justify-center h-full px-4 text-center gap-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Bird Photos</p>
            <p className="text-base font-bold text-white leading-tight mt-1">{referenceSpecies.comName}</p>
            {total > 0
              ? <p className="text-xs text-slate-400 mt-1">{total} photo{total !== 1 ? 's' : ''}</p>
              : <p className="text-xs text-slate-400 mt-1">Loading…</p>
            }
            <button
              onClick={() => { setPhotoMode('related'); setPhotoIdx(0); }}
              className="mt-3 flex items-center gap-1 bg-black/60 hover:bg-black/80 text-white text-xs rounded-full px-3 py-1.5 transition-colors"
            >
              Switch to related species
            </button>
          </div>
        ) : (
          photo && (
            <img
              key={photo.url}
              src={photo.url}
              alt={referenceSpecies.comName}
              className={`w-full h-full object-contain transition-opacity duration-500 ${visible ? 'opacity-100' : 'opacity-0'}`}
              onLoad={() => setImgLoadedUrls(prev => new Set(prev).add(photo.url))}
            />
          )
        )}
        {!isTitle && photo?.credit && (
          <span className="absolute bottom-1 right-1 bg-black/50 text-white/50 text-[10px] px-1.5 py-0.5 rounded max-w-[60%] truncate">
            {photo.credit}
          </span>
        )}
        {allSlides > 1 && (
          <>
            <button
              onClick={() => setPhotoIdx(i => (i - 1 + allSlides) % allSlides)}
              className="absolute left-1 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm"
            >‹</button>
            <button
              onClick={() => setPhotoIdx(i => (i + 1) % allSlides)}
              className="absolute right-1 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm"
            >›</button>
            {!isTitle && (
              <span className="absolute top-8 right-1 bg-black/50 text-white text-xs px-1 py-0.5 rounded-full">
                {photoIdx}/{total}
              </span>
            )}
          </>
        )}
        <button
          onClick={toggleFullscreen}
          className="absolute top-1 left-1 z-10 bg-black/50 hover:bg-black/70 text-white text-xs rounded px-1.5 py-0.5"
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >{isFullscreen ? '✕' : '⛶'}</button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative bg-slate-900 h-full overflow-hidden">
      {/* Slide track */}
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
                showReferencePhoto ? (
                  // Browse mode: text-only mode switcher card
                  <div className="flex flex-col items-center justify-center h-full px-4 text-center gap-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Related Species</p>
                    {n > 1
                      ? <p className="text-xs text-slate-400 mt-4 leading-relaxed">Scroll to compare →</p>
                      : <p className="text-xs text-slate-400 mt-4 leading-relaxed">No related species photos to show</p>
                    }
                    {n > 1 && !listenMode && (
                      <div className="mt-2">{listenButton}</div>
                    )}
                    {subjectPhotos.length > 0 && !listenMode && (
                      <button
                        onClick={() => { stopAutoScroll(); setPhotoMode('photos'); setPhotoIdx(0); }}
                        className="mt-2 flex items-center gap-1 bg-black/60 hover:bg-black/80 text-white text-xs rounded-full px-3 py-1.5 transition-colors"
                      >
                        📷 Switch to bird photos
                      </button>
                    )}
                  </div>
                ) : (
                  // Quiz mode: unchanged
                  <div className="flex flex-col items-center justify-center h-full px-4 text-center gap-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Related Species</p>
                    <p className="text-base font-bold text-white leading-tight mt-1">{slide.comName}</p>
                    <p className="text-xs italic text-slate-400">{slide.sciName}</p>
                    <p className="text-xs text-slate-500">{slide.familyComName}</p>
                    <p className="text-xs text-slate-400 mt-4 leading-relaxed">Scroll to see and compare related species →</p>
                    {n > 1 && !listenMode && (
                      <div className="mt-2">{listenButton}</div>
                    )}
                  </div>
                )
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
                      onClick={() => { stopAutoScroll(); stopListenMode(); onViewSpecies(slide); }}
                      className="shrink-0 text-xs text-sky-300 hover:text-sky-200 whitespace-nowrap"
                    >
                      View info →
                    </button>
                  </div>
                  {(() => {
                    const recs = recordings.get(slide.speciesCode);
                    const isPlaying = playingCode === slide.speciesCode;
                    if (recs === undefined) return null;
                    if (recs === null) return null;
                    return (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          stopAutoScroll();
                          stopListenMode();
                          const audio = audioRef.current;
                          if (!audio) return;
                          if (isPlaying) {
                            audio.pause();
                            setPlayingCode(null);
                          } else {
                            onWillPlay?.();
                            const rec = recs[0];
                            if (audio.src !== rec.file) audio.src = rec.file;
                            audio.play().catch(() => setPlayingCode(null));
                            setPlayingCode(slide.speciesCode);
                          }
                        }}
                        className="absolute bottom-1 left-1 flex items-center gap-1 bg-black/60 hover:bg-black/80 rounded-full px-2 py-0.5 text-white text-xs"
                        aria-label={isPlaying ? 'Pause song' : 'Play song'}
                      >
                        {isPlaying ? '⏸' : '♪'} {isPlaying ? 'pause' : recs[0].type ?? 'song'}
                      </button>
                    );
                  })()}
                  {/* Listen mode indicator + stop button */}
                  {listenMode && (
                    <div className="absolute bottom-1 right-1 flex items-center gap-1">
                      <span className="bg-black/60 text-white/80 text-[10px] px-2 py-0.5 rounded-full animate-pulse">
                        ♪ listening…
                      </span>
                      <button
                        onClick={() => stopListenMode()}
                        className="bg-black/60 hover:bg-black/80 text-white text-[10px] px-2 py-0.5 rounded-full transition-colors"
                      >
                        stop
                      </button>
                    </div>
                  )}
                  {photo?.credit && !listenMode && (
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

      {/* Nav arrows */}
      {n > 1 && (
        <>
          <button
            onClick={() => { stopAutoScroll(); stopListenMode(); navigateTo((idx - 1 + n) % n); }}
            className={`absolute left-1 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm transition-opacity duration-[2000ms] ${prevReady ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          >‹</button>
          <button
            onClick={() => { stopAutoScroll(); stopListenMode(); navigateTo((idx + 1) % n); }}
            className={`absolute right-1 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm transition-opacity duration-[2000ms] ${nextReady ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          >›</button>
          <span className="absolute top-8 right-1 bg-black/50 text-white text-xs px-1 py-0.5 rounded-full">
            {idx + 1}/{n}
          </span>
        </>
      )}
      <audio
        ref={audioRef}
        onEnded={() => {
          setPlayingCode(null);
          if (listenModeRef.current) {
            clearListenTimer();
            const next = idx + 1;
            if (next >= slides.length) {
              setListenMode(false);
              listenModeRef.current = false;
              setAnimated(false);
              setIdx(0);
            } else {
              setIdx(next);
            }
          }
        }}
      />
      <button
        onClick={toggleFullscreen}
        className="absolute top-1 left-1 z-10 bg-black/50 hover:bg-black/70 text-white text-xs rounded px-1.5 py-0.5"
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
      >{isFullscreen ? '✕' : '⛶'}</button>
    </div>
  );
}
