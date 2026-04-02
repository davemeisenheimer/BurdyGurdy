import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import type { SupabaseUser } from '../../lib/supabase';
import { locateRegion } from '../../services/remote/api';
import type { LocateResult } from '../../services/remote/api';
import type { AppSettings, BirderLevel } from '../../lib/settings';

interface Props {
  user:              SupabaseUser | null;
  settings:          AppSettings;
  onUpdateSettings:  (updates: Partial<AppSettings>) => void;
  onRegionDetected:  (code: string) => void;
  onComplete:        () => void;
  onInstallApp:      (() => Promise<void>) | null;
}

const isIOS       = /iPad|iPhone|iPod/.test(navigator.userAgent);
const isAndroid   = /Android/.test(navigator.userAgent);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
const isMobile    = isIOS || isAndroid;

type AccountMode = 'choose' | 'signin' | 'signup' | 'sent';
type GeoPhase    = 'idle' | 'loading' | 'result' | 'error';

const LEVELS: { level: BirderLevel; label: string; desc: string }[] = [
  { level: 'novice',       label: 'Novice',       desc: 'The path to mastery progresses through easy, then medium, and finally difficult questions.' },
  { level: 'intermediate', label: 'Intermediate', desc: 'The path to mastery will skip the easy questions.' },
  { level: 'advanced',     label: 'Advanced',     desc: 'The path to mastery will skip easy and medium difficulty questions.' },
];

export function OnboardingWizard({ user, settings, onUpdateSettings, onRegionDetected, onComplete, onInstallApp }: Props) {
  const [step, setStep]               = useState(0);
  const [privacyAgreed, setPrivacyAgreed] = useState(false);

  // Account step
  const [accountMode, setAccountMode] = useState<AccountMode>('choose');
  const [email, setEmail]             = useState('');
  const [password, setPassword]       = useState('');
  const [newsOptIn, setNewsOptIn]     = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError]     = useState<string | null>(null);

  // Birder level step
  const [birderLevel, setBirderLevel] = useState<BirderLevel>(settings.birderLevel ?? 'novice');
  const isReturningWithLevel          = !!user && settings.birderLevel !== undefined;

  // Geo step
  const [geoPhase, setGeoPhase]   = useState<GeoPhase>('idle');
  const [geoResult, setGeoResult] = useState<LocateResult | null>(null);

  // When settings sync in after login, update selected level
  useEffect(() => {
    if (settings.birderLevel) setBirderLevel(settings.birderLevel);
  }, [settings.birderLevel]);

  // Auto-advance from account step when user signs in
  useEffect(() => {
    if (user && step === 1) setStep(2);
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const advance = () => {
    if (step === 0) {
      setStep(user ? 2 : 1);
    } else if (step === 1) {
      setStep(2);
    } else if (step === 2) {
      if (user) onUpdateSettings({ birderLevel });
      setStep(3);
    } else if (step === 3) {
      isStandalone ? onComplete() : setStep(4);
    } else {
      onComplete();
    }
  };

  const back = () => {
    if (step === 2) setStep(user ? 0 : 1);
    else if (step > 0) setStep(step - 1);
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    if (accountMode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { setAuthError(error.message); setAuthLoading(false); return; }
      if (newsOptIn) supabase.auth.updateUser({ data: { news_opt_in: true } }).catch(() => {});
      // useEffect advances step when user state updates
    } else {
      const { error } = await supabase.auth.signUp({ email, password, options: { data: { news_opt_in: newsOptIn } } });
      if (error) { setAuthError(error.message); setAuthLoading(false); return; }
      setAccountMode('sent');
    }
    setAuthLoading(false);
  };

  const handleOAuth = async () => {
    setAuthLoading(true);
    if (newsOptIn) localStorage.setItem('burdygurdy_news_opt_in', '1');
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
    if (error) { setAuthError(error.message); setAuthLoading(false); }
  };

  const detectLocation = () => {
    if (!navigator.geolocation) {
      console.warn('[OnboardingWizard] navigator.geolocation not available');
      setGeoPhase('error');
      return;
    }
    setGeoPhase('loading');
    navigator.geolocation.getCurrentPosition(
      async pos => {
        try {
          const result = await locateRegion(pos.coords.latitude, pos.coords.longitude, 10);
          setGeoResult(result);
          setGeoPhase('result');
        } catch (err) {
          console.error('[OnboardingWizard] locateRegion API call failed:', err);
          setGeoPhase('error');
        }
      },
      (err) => {
        console.warn('[OnboardingWizard] geolocation error — code:', err.code, 'message:', err.message);
        setGeoPhase('error');
      },
    );
  };

  const dotIndex = step - 1; // 0-indexed for dots on steps 1–4

  return (
    <div className="fixed inset-0 z-50 bg-slate-50 flex flex-col overflow-hidden">

      {/* ── Step 0: Welcome ── */}
      {step === 0 && (
        <div className="flex flex-col flex-1 items-center justify-center px-6 py-10 overflow-y-auto">
          <div className="w-full max-w-md flex flex-col items-center">
            <img src="/favicon.png" alt="BurdyGurdy" className="w-20 h-20 rounded-2xl mb-4 shadow-md" />
            <h1 className="text-2xl font-bold text-slate-800 mb-1">Welcome to BurdyGurdy</h1>
            <p className="text-sm text-slate-500 text-center mb-6">Learn to identify birds by their songs, photos, and more.</p>

            <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-6 space-y-3 w-full">
              <h2 className="text-sm font-semibold text-slate-700">How it works</h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                BurdyGurdy quizzes you on birds that have actually been spotted in your local area. Every session draws from recent eBird sightings so you learn what you're likely to see outside.
              </p>
              <p className="text-sm text-slate-600 leading-relaxed">
                An adaptive algorithm tracks your progress. Birds you find difficult appear more often; once you master a bird it moves to occasional review. Your life list grows as you go.
              </p>
            </div>

            <label className="flex items-start gap-3 w-full mb-6 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={privacyAgreed}
                onChange={e => setPrivacyAgreed(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-slate-300 text-forest-600 focus:ring-forest-500"
              />
              <span className="text-sm text-slate-600 leading-snug">
                I agree to the{' '}
                <a href="/privacy.html" target="_blank" rel="noopener noreferrer" className="text-forest-600 hover:underline">privacy policy</a>
              </span>
            </label>

            <button
              onClick={advance}
              disabled={!privacyAgreed}
              className="w-full py-3 bg-forest-600 hover:bg-forest-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Get started →
            </button>
          </div>
        </div>
      )}

      {/* ── Steps 1–4 ── */}
      {step >= 1 && (
        <>
          {/* Header with back + dots */}
          <div className="shrink-0 flex items-center justify-between px-4 pt-5 pb-3 max-w-md mx-auto w-full">
            <button onClick={back} className="text-slate-400 hover:text-slate-600 text-2xl leading-none w-8">←</button>
            <div className="flex gap-2">
              {[0, 1, 2, 3].map(i => (
                <span key={i} className={`w-2 h-2 rounded-full transition-colors ${
                  i === dotIndex ? 'bg-forest-600' : i < dotIndex ? 'bg-forest-300' : 'bg-slate-200'
                }`} />
              ))}
            </div>
            <div className="w-8" />
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="max-w-md mx-auto px-4 pb-10">

              {/* ── Step 1: Account ── */}
              {step === 1 && (
                <div className="space-y-4">
                  <div>
                    <h2 className="text-xl font-bold text-slate-800 mb-1">Save your progress</h2>
                    <p className="text-sm text-slate-500">Your progress is saved locally on this device. Create a free account to:</p>
                  </div>
                  <ul className="space-y-2">
                    {[
                      'Sync your life list across multiple devices',
                      'Set your birder experience level',
                      'Connect with friends and see their progress',
                    ].map(item => (
                      <li key={item} className="flex items-start gap-2 text-sm text-slate-600">
                        <span className="text-forest-500 mt-0.5 shrink-0">✓</span>{item}
                      </li>
                    ))}
                  </ul>

                  {accountMode === 'choose' && (
                    <div className="space-y-3 pt-2">
                      <button onClick={() => setAccountMode('signup')} className="w-full py-3 bg-forest-600 hover:bg-forest-700 text-white font-semibold rounded-xl transition-colors">
                        Create a free account
                      </button>
                      <button onClick={() => setAccountMode('signin')} className="w-full py-3 border border-slate-300 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-colors">
                        I already have an account
                      </button>
                      <button onClick={advance} className="w-full py-2 text-sm text-slate-400 hover:text-slate-600 transition-colors">
                        Continue as guest
                      </button>
                    </div>
                  )}

                  {(accountMode === 'signin' || accountMode === 'signup') && (
                    <div className="space-y-3 pt-2">
                      <h3 className="font-semibold text-slate-700">{accountMode === 'signin' ? 'Sign in' : 'Create account'}</h3>
                      <button onClick={handleOAuth} disabled={authLoading} className="flex items-center justify-center gap-2 w-full px-4 py-2.5 border border-slate-300 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors">
                        <GoogleIcon /> Continue with Google
                      </button>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-px bg-slate-200" />
                        <span className="text-xs text-slate-400">or</span>
                        <div className="flex-1 h-px bg-slate-200" />
                      </div>
                      <form onSubmit={handleAuthSubmit} className="space-y-3">
                        <label className="flex items-start gap-2.5 cursor-pointer select-none">
                          <input type="checkbox" checked={newsOptIn} onChange={e => setNewsOptIn(e.target.checked)} className="mt-0.5 w-4 h-4 rounded border-slate-300 text-forest-600" />
                          <span className="text-xs text-slate-600 leading-snug">Receive occasional BurdyGurdy news and updates</span>
                        </label>
                        <input type="email" placeholder="Email" value={email} onChange={e => { setEmail(e.target.value); setAuthError(null); }} required className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-forest-500" />
                        <input type="password" placeholder="Password" value={password} onChange={e => { setPassword(e.target.value); setAuthError(null); }} required minLength={6} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-forest-500" />
                        {authError && <p className="text-red-500 text-xs">{authError}</p>}
                        <button type="submit" disabled={authLoading} className="w-full py-2.5 bg-forest-600 hover:bg-forest-700 text-white rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors">
                          {authLoading ? 'Please wait…' : accountMode === 'signin' ? 'Sign in' : 'Create account'}
                        </button>
                      </form>
                      <p className="text-center text-xs text-slate-500">
                        {accountMode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
                        <button onClick={() => { setAccountMode(accountMode === 'signin' ? 'signup' : 'signin'); setAuthError(null); }} className="text-forest-600 font-medium hover:underline">
                          {accountMode === 'signin' ? 'Sign up' : 'Sign in'}
                        </button>
                      </p>
                      <button onClick={() => { setAccountMode('choose'); setAuthError(null); }} className="w-full text-xs text-slate-400 hover:text-slate-600 text-center transition-colors">
                        ← Back to options
                      </button>
                    </div>
                  )}

                  {accountMode === 'sent' && (
                    <div className="text-center py-4 space-y-2">
                      <p className="text-slate-700 font-medium">Check your email</p>
                      <p className="text-sm text-slate-500">We sent a confirmation link to <strong>{email}</strong>. Click it to activate your account, then come back here.</p>
                      <button onClick={advance} className="mt-2 text-sm text-forest-600 font-medium hover:underline">
                        Continue as guest for now →
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ── Step 2: Birder level ── */}
              {step === 2 && (
                <div className="space-y-4">
                  <div>
                    <h2 className="text-xl font-bold text-slate-800 mb-1">Your experience level</h2>
                    <p className="text-sm text-slate-500">This affects how the quiz progresses through difficulty as you master birds.</p>
                    {isReturningWithLevel && (
                      <p className="text-xs text-forest-600 mt-1 font-medium">✓ Retrieved from your account</p>
                    )}
                  </div>

                  {!user && (
                    <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      Intermediate and advanced levels are available to registered users.{' '}
                      <button onClick={() => setStep(1)} className="font-semibold hover:underline">Create a free account →</button>
                    </div>
                  )}

                  <div className="space-y-2">
                    {LEVELS.map(({ level, label, desc }) => {
                      const locked = !user && level !== 'novice';
                      const selected = birderLevel === level && !locked;
                      return (
                        <button
                          key={level}
                          onClick={() => !locked && setBirderLevel(level)}
                          disabled={locked}
                          className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-colors ${
                            selected
                              ? 'border-forest-600 bg-forest-50'
                              : locked
                              ? 'border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed'
                              : 'border-slate-200 hover:border-forest-300 bg-white'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-0.5">
                            <p className="font-semibold text-sm text-slate-800">{label}</p>
                            {selected && <span className="text-forest-600 text-sm font-bold">✓</span>}
                            {locked && <span className="text-xs text-slate-400">Registered users only</span>}
                          </div>
                          <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
                        </button>
                      );
                    })}
                  </div>

                  <button onClick={advance} className="w-full py-3 bg-forest-600 hover:bg-forest-700 text-white font-semibold rounded-xl transition-colors">
                    Continue →
                  </button>
                </div>
              )}

              {/* ── Step 3: Location ── */}
              {step === 3 && (
                <div className="space-y-4">
                  <div>
                    <h2 className="text-xl font-bold text-slate-800 mb-1">Set your region</h2>
                    <p className="text-sm text-slate-500 leading-relaxed">
                      BurdyGurdy quizzes you on birds from your local area. Allow location access and we'll set your region automatically — you can always change it in settings.
                    </p>
                  </div>

                  {geoPhase === 'idle' && (
                    <div className="space-y-3">
                      <button onClick={detectLocation} className="w-full py-3 bg-forest-600 hover:bg-forest-700 text-white font-semibold rounded-xl transition-colors">
                        Allow location access
                      </button>
                      <button onClick={advance} className="w-full py-2 text-sm text-slate-400 hover:text-slate-600 transition-colors">
                        Not now
                      </button>
                    </div>
                  )}

                  {geoPhase === 'loading' && (
                    <p className="text-sm text-slate-400 text-center py-6">Detecting your location…</p>
                  )}

                  {geoPhase === 'result' && geoResult && (
                    <div className="space-y-3">
                      <p className="text-sm text-slate-600">We detected your location as:</p>
                      <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
                        <button
                          onClick={() => { onRegionDetected(geoResult.regionCode); advance(); }}
                          className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-forest-50 border border-forest-200 hover:bg-forest-100 transition-colors"
                        >
                          <span className="font-medium text-sm text-forest-800">{geoResult.regionName}</span>
                          <span className="text-xs text-forest-600 shrink-0 ml-2">Use this →</span>
                        </button>
                        {geoResult.broader && (
                          <button
                            onClick={() => { onRegionDetected(geoResult.broader!.code); advance(); }}
                            className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
                          >
                            <span className="text-sm text-slate-700">{geoResult.broader.name}</span>
                            <span className="text-xs text-slate-500 shrink-0 ml-2">Broader region →</span>
                          </button>
                        )}
                      </div>
                      <button onClick={advance} className="w-full py-2 text-sm text-slate-400 hover:text-slate-600 transition-colors">
                        Keep my current region
                      </button>
                    </div>
                  )}

                  {geoPhase === 'error' && (
                    <div className="space-y-3">
                      <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        Could not detect your location. You can set your region manually in settings.
                      </p>
                      <button onClick={detectLocation} className="w-full py-2.5 border border-slate-300 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">
                        Try again
                      </button>
                      <button onClick={advance} className="w-full py-2 text-sm text-slate-400 hover:text-slate-600 transition-colors">
                        Not now
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ── Step 4: Home screen ── */}
              {step === 4 && (
                <div className="space-y-4">
                  {!isMobile ? (
                    <>
                      <div>
                        <h2 className="text-xl font-bold text-slate-800 mb-1">Also on mobile</h2>
                        <p className="text-sm text-slate-500 leading-relaxed">
                          BurdyGurdy works great on your phone or tablet. Visit <strong>burdygurdy.com</strong> on your mobile browser, then add it to your home screen for a full-screen, app-like experience.
                        </p>
                      </div>
                      <button onClick={onComplete} className="w-full py-3 bg-forest-600 hover:bg-forest-700 text-white font-semibold rounded-xl transition-colors">
                        Let's play!
                      </button>
                    </>
                  ) : isAndroid ? (
                    <>
                      <div>
                        <h2 className="text-xl font-bold text-slate-800 mb-1">Add to your home screen</h2>
                        <p className="text-sm text-slate-500 leading-relaxed">
                          Install BurdyGurdy for a full-screen experience without the browser address bar — just like a native app.
                        </p>
                      </div>
                      {onInstallApp ? (
                        <div className="space-y-3">
                          <button onClick={async () => { await onInstallApp(); onComplete(); }} className="w-full py-3 bg-forest-600 hover:bg-forest-700 text-white font-semibold rounded-xl transition-colors">
                            Add to Home Screen
                          </button>
                          <button onClick={onComplete} className="w-full py-2 text-sm text-slate-400 hover:text-slate-600 transition-colors">
                            Not now
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <p className="text-sm text-slate-500 bg-white border border-slate-200 rounded-xl p-4">
                            Tap the browser menu <strong>⋮</strong> and select <strong>"Add to Home screen"</strong>.
                          </p>
                          <button onClick={onComplete} className="w-full py-3 bg-forest-600 hover:bg-forest-700 text-white font-semibold rounded-xl transition-colors">
                            Let's play!
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    /* iOS */
                    <>
                      <div>
                        <h2 className="text-xl font-bold text-slate-800 mb-1">Add to your home screen</h2>
                        <p className="text-sm text-slate-500 leading-relaxed">
                          Launching from your home screen gives a full-screen experience and removes the browser address bar.
                        </p>
                      </div>
                      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
                        {([
                          { icon: '⬆️', text: 'Tap the Share button at the bottom of Safari' },
                          { icon: '📲', text: 'Scroll down and tap "Add to Home Screen"' },
                          { icon: '✅', text: 'Tap "Add" to confirm' },
                        ] as const).map(({ icon, text }) => (
                          <div key={text} className="flex items-start gap-3">
                            <span className="text-xl shrink-0">{icon}</span>
                            <p className="text-sm text-slate-600 leading-relaxed">{text}</p>
                          </div>
                        ))}
                      </div>
                      <div className="space-y-3">
                        <button onClick={onComplete} className="w-full py-3 bg-forest-600 hover:bg-forest-700 text-white font-semibold rounded-xl transition-colors">
                          Done
                        </button>
                        <button onClick={onComplete} className="w-full py-2 text-sm text-slate-400 hover:text-slate-600 transition-colors">
                          Not now
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

            </div>
          </div>
        </>
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 33.1 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 19.7-8 19.7-20 0-1.3-.1-2.7-.1-4z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 15.1 18.9 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-1.9 13.5-5.1l-6.2-5.2C29.3 35.3 26.8 36 24 36c-5.2 0-9.6-2.9-11.3-7.1L6 34c3.3 6.3 9.9 10 18 10z"/>
      <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.9 2.4-2.5 4.4-4.6 5.8l6.2 5.2C40.8 35.5 44 30.2 44 24c0-1.3-.1-2.7-.4-4z"/>
    </svg>
  );
}
