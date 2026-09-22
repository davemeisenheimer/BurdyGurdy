/**
 * Full-screen "working on it" overlay shown between pressing Play (or Play Again) and the quiz or
 * region-update dialog appearing. Covers the whole screen so stray extra presses hit the overlay.
 */
export function StartingOverlay() {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <div className="bg-sky-50 rounded-2xl shadow-2xl px-10 py-8 flex flex-col items-center gap-4">
        <img
          src="/BurdyGurdyProgress.gif"
          alt=""
          className="w-24 h-24 object-contain"
        />
        <p className="text-sm font-semibold text-slate-700">Checking for new birds…</p>
      </div>
    </div>
  );
}
