export function CloudSyncOverlay() {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl px-10 py-8 flex flex-col items-center gap-4">
        {/* Cloud ↔ device sync icon */}
        <svg
          viewBox="0 0 64 40"
          className="w-16 h-10 text-forest-600"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          {/* Cloud body */}
          <path d="M50 32H18a10 10 0 0 1-2-19.8A14 14 0 0 1 44 16a8 8 0 0 1 6 16z" />
          {/* Down arrow */}
          <line x1="32" y1="20" x2="32" y2="36" />
          <polyline points="27 31 32 36 37 31" />
        </svg>

        <img
          src="/BurdyGurdyProgress.gif"
          alt="Syncing…"
          className="w-24 h-24 object-contain"
        />

        <p className="text-sm font-semibold text-slate-700">Syncing with cloud…</p>
      </div>
    </div>
  );
}
