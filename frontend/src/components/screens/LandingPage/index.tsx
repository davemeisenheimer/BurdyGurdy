import { Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../../../lib/supabase';
import { AuthPanel } from '../../panels/AuthPanel';
import { AccountPill } from '../../ui/AccountPill';
import pkg from '../../../../package.json';

const ADSENSE_CLIENT = 'ca-pub-1052431386062730';
const ADSENSE_SLOT   = '1826086125';

// ── Slide data ────────────────────────────────────────────────────────────────

const FEATURES = [
  { icon: '📍', title: 'Your Local Birds',  body: 'Powered by real eBird sightings - practice the species you\'ll actually encounter outside.' },
  { icon: '🧠', title: 'Adaptive Learning', body: 'The algorithm tracks every answer and focuses on the birds you find hardest. Get better, faster.' },
  { icon: '🎵', title: 'Six Ways to Learn', body: 'Photo, song, spectrogram, Latin name, family, and order questions build complete recognition.' },
];

type Slide =
  | { kind: 'hero' }
  | { kind: 'features' }
  | { kind: 'single'; src: string; caption: string }
  | { kind: 'triple'; src1: string; src2: string; src3: string; caption: string };

const DESKTOP_SLIDES: Slide[] = [
  { kind: 'hero' },
  { kind: 'features' },
  { kind: 'triple', src1: '/HomeScreen.png', src2: '/QuestionMobile.jpg', src3: '/AnswerRevealMobile.jpg', caption: 'Set your region - identify the bird - reveal the answer' },
  { kind: 'single', src: '/AnswerRevealBirdInfo.jpg', caption: 'Rich bird info, range maps, and recent sightings on every answer' },
  { kind: 'single', src: '/LifeListBirdInfo.jpg',     caption: 'Track your progress - see every species you\'ve mastered' },
  { kind: 'single', src: '/SightingsMap.png',         caption: 'See recent local sightings on a map for every bird you study' },
];

const MOBILE_SLIDES: Slide[] = [
  { kind: 'hero' },
  { kind: 'features' },
  { kind: 'single', src: '/HomeScreen.png',           caption: 'Set your region and dive in' },
  { kind: 'single', src: '/QuestionMobile.jpg',       caption: 'Identify the bird from a photo, song, spectrogram, and more' },
  { kind: 'single', src: '/AnswerRevealMobile.jpg',   caption: 'Check the answer and learn about the species' },
  { kind: 'single', src: '/LifeListMobile.png',       caption: 'Track your progress across all local species' },
  { kind: 'single', src: '/SightingsListMobile.png',  caption: 'Browse recent local sightings by species' },
  { kind: 'single', src: '/SightingsMapMobile.png',   caption: 'See where each species has been spotted near you' },
  { kind: 'single', src: '/AnswerRevealBirdInfo.jpg', caption: 'The desktop version offers rich bird info all in one screen.' },
];

const SLIDE_MS_DESKTOP = 4500;
const SLIDE_MS_MOBILE  = 6500;

// ── Unified slideshow ─────────────────────────────────────────────────────────

interface SlideshowProps {
  user: User | null;
  displayName: string;
  onSignInClick: () => void;
}

function UnifiedSlideshow({ user, displayName, onSignInClick }: SlideshowProps) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused]        = useState(false);
  const [lightboxSrc, setLightbox] = useState<string | null>(null);
  const [isMobile, setIsMobile]    = useState(() => window.innerWidth < 1024);
  const pausedRef     = useRef(false);
  const slidesLenRef  = useRef(0);

  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const slides = isMobile ? MOBILE_SLIDES : DESKTOP_SLIDES;
  slidesLenRef.current = slides.length;

  // Reset to first slide when switching between desktop and mobile slide sets
  useEffect(() => { setIdx(0); }, [isMobile]);

  // Mobile scrolls right-to-left; desktop drops in from above
  const captionAnim = isMobile
    ? 'captionScroll 7s ease-in-out forwards'
    : 'captionDrop 3.2s ease-in-out forwards';

  const slideMs = isMobile ? SLIDE_MS_MOBILE : SLIDE_MS_DESKTOP;

  useEffect(() => {
    const t = setInterval(() => {
      if (!pausedRef.current) setIdx(i => (i + 1) % slidesLenRef.current);
    }, slideMs);
    return () => clearInterval(t);
  }, [isMobile]);

  useEffect(() => {
    if (!lightboxSrc) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxSrc]);

  const slide = slides[idx] ?? slides[0];

  return (
    <>
    <div
      className="h-full flex flex-col"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Slide content */}
      <div className="flex-1 relative overflow-hidden">

        {slide.kind === 'hero' && (
          <div key="hero" className="absolute inset-0 flex flex-col justify-center items-center text-center gap-6 p-8 animate-fade-in">
            <img src="/BurdyNotebook.png" alt="BurdyGurdy mascot" className="w-28 h-28 object-contain drop-shadow-lg" />
            <div>
              <h1 className="text-5xl font-extrabold tracking-tight">BurdyGurdy</h1>
              <p className="mt-2 text-xl text-slate-600">Learn the birds you live with</p>
              <p className="mt-1 text-xs text-slate-400">v{pkg.version}</p>
            </div>
            <p className="text-slate-500 text-sm leading-relaxed max-w-sm">
              A free bird identification game using real eBird sightings from your area.
              Learn local birds by photo, song, spectrogram, and more - at your own pace.
            </p>
            {user ? (
              <p className="text-slate-500 text-sm">
                Signed in as <span className="text-slate-900 font-medium">{displayName}</span>
                {' · '}
                <button onClick={() => supabase.auth.signOut()} className="text-slate-400 hover:text-slate-600 underline">
                  Sign out
                </button>
              </p>
            ) : (
              <p className="text-slate-500 text-sm max-w-sm">
                Play without an account, or{' '}
                <button onClick={onSignInClick} className="text-sky-600 hover:text-sky-700 underline">
                  sign in
                </button>
                {' '}to save your progress and sync across devices.
              </p>
            )}
          </div>
        )}

        {slide.kind === 'features' && (
          <div key="features" className="absolute inset-0 flex flex-col justify-center items-center gap-5 p-8 animate-fade-in">
            {FEATURES.map(f => (
              <div key={f.title} className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-5 flex gap-4 items-start">
                <span className="text-3xl leading-none flex-shrink-0">{f.icon}</span>
                <div>
                  <h3 className="font-bold text-slate-900 mb-1">{f.title}</h3>
                  <p className="text-slate-600 text-sm leading-relaxed">{f.body}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {slide.kind === 'single' && (
          <img
            key={slide.src}
            src={slide.src}
            alt={slide.caption}
            className="absolute inset-0 w-full h-full object-contain animate-fade-in cursor-zoom-in"
            onClick={() => setLightbox(slide.src)}
          />
        )}

        {slide.kind === 'triple' && (
          <div key="triple" className="absolute inset-0 flex items-start justify-center gap-5 p-4 animate-fade-in">
            <img src={slide.src1} alt="Home screen"          className="h-full w-auto cursor-zoom-in" onClick={() => setLightbox(slide.src1)} />
            <img src={slide.src2} alt="Question screen"      className="h-full w-auto cursor-zoom-in" onClick={() => setLightbox(slide.src2)} />
            <img src={slide.src3} alt="Answer reveal screen" className="h-full w-auto cursor-zoom-in" onClick={() => setLightbox(slide.src3)} />
          </div>
        )}

        {(slide.kind === 'single' || slide.kind === 'triple') && (
          <div
            key={`caption-${idx}`}
            className="absolute bottom-10 left-0 right-0 text-center pointer-events-none"
            style={{ animation: captionAnim }}
          >
            <span
              className="text-2xl font-bold text-white whitespace-nowrap"
              style={{ textShadow: '0 2px 12px rgba(0,0,0,0.8), 0 0 40px rgba(0,0,0,0.5)' }}
            >
              {slide.caption}
            </span>
          </div>
        )}

      </div>

      {/* Dot navigation */}
      <div className="flex-shrink-0 flex justify-center gap-2 pb-4">
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={() => setIdx(i)}
            aria-label={`Slide ${i + 1}`}
            className={`rounded-full transition-all duration-300 ${
              i === idx ? 'bg-slate-700 w-5 h-2' : 'bg-slate-300 hover:bg-slate-500 w-2 h-2'
            }`}
          />
        ))}
      </div>
    </div>

    {/* Lightbox */}
    {lightboxSrc && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-6"
        onClick={() => setLightbox(null)}
      >
        <img
          src={lightboxSrc}
          alt="Full size"
          className="max-w-full max-h-full object-contain"
          onClick={e => e.stopPropagation()}
        />
        <button
          onClick={() => setLightbox(null)}
          className="absolute top-4 right-4 text-white text-3xl leading-none hover:text-slate-300 transition-colors"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
    )}
    </>
  );
}

// ── AdSense ───────────────────────────────────────────────────────────────────

function AdUnit() {
  useEffect(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({});
    } catch { /* not loaded */ }
  }, []);
  return (
    <ins
      className="adsbygoogle"
      style={{ display: 'block', width: '100%', height: '90px' }}
      data-ad-client={ADSENSE_CLIENT}
      data-ad-slot={ADSENSE_SLOT}
      data-ad-format="horizontal"
    />
  );
}

// ── Landing page ──────────────────────────────────────────────────────────────

export function LandingPage() {
  const [user, setUser]         = useState<User | null>(null);
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_evt, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const displayName =
    (user?.user_metadata?.full_name as string | undefined)
    ?? user?.email?.split('@')[0]
    ?? '';

  return (
    <div className="min-h-screen text-slate-900 flex flex-col" style={{ backgroundColor: '#CAD3CA' }}>

      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-b border-slate-300 px-6 py-2.5 flex items-center justify-between" style={{ backgroundColor: '#b8c4b8' }}>
        <div className="flex items-center gap-5">
          <a
            href="https://ko-fi.com/burdygurdy"
            target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
          >
            <img src="/CoffeeIcon.png" alt="" className="w-5 h-5 object-contain" />
            Help out
          </a>
          <a
            href="https://www.facebook.com/profile.php?id=61571984930004"
            target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
          >
            <img src="/FacebookIcon.png" alt="" className="w-5 h-5 object-contain" />
            Follow
          </a>
        </div>
        <AccountPill
          userEmail={user?.email}
          onAuthClick={() => setShowAuth(true)}
          onSignOut={() => supabase.auth.signOut()}
          dropdownAlign="right"
        />
      </div>

      {/* ── Full-width slideshow ──────────────────────────────────────────────── */}
      {/* Explicit height so h-full works inside — flex-1 on a min-h-screen parent resolves to 0 */}
      <div className="overflow-hidden flex flex-col pt-6" style={{ height: 'clamp(650px, calc(100vh - 500px), 1100px)' }}>
        <UnifiedSlideshow
          user={user}
          displayName={displayName}
          onSignInClick={() => setShowAuth(true)}
        />
      </div>

      {/* ── Play button ──────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex justify-center py-5">
        <Link
          to="/game"
          className="bg-green-600 hover:bg-green-500 active:bg-green-700 text-white font-bold text-xl px-14 py-4 rounded-2xl shadow-lg transition-colors select-none"
        >
          ▶&nbsp; Play for Free
        </Link>
      </div>

      {/* ── AdSense ──────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 w-full max-w-4xl mx-auto px-6 py-3 overflow-hidden" style={{ maxHeight: '114px' }}>
        <div className="overflow-hidden" style={{ height: '90px' }}>
          <AdUnit />
        </div>
      </div>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer className="flex-shrink-0 px-6 py-4 border-t border-slate-300 text-center" style={{ backgroundColor: '#b8c4b8' }}>
        <a href="/privacy.html" className="text-slate-400 hover:text-slate-600 text-xs transition-colors">
          Privacy Policy
        </a>
      </footer>

      {showAuth && (
        <AuthPanel
          onClose={() => setShowAuth(false)}
          onSignIn={() => setShowAuth(false)}
          onSignUp={() => setShowAuth(false)}
        />
      )}

    </div>
  );
}
