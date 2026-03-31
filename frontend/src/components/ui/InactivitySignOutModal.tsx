interface Props {
  onSignIn: () => void;
  onCancel: () => void;
}

export function InactivitySignOutModal({ onSignIn, onCancel }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-5">
        <div>
          <h2 className="text-lg font-bold text-slate-800 mb-2">Signed out</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            You were signed out due to inactivity. If you choose to cancel, you will be running
            in <span className="font-semibold">guest mode</span> and your progress will not be
            tracked on your account.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl border border-slate-300 text-slate-600 font-medium text-sm hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onSignIn}
            className="flex-1 py-2.5 rounded-xl bg-forest-600 hover:bg-forest-700 text-white font-semibold text-sm transition-colors"
          >
            Sign in
          </button>
        </div>
      </div>
    </div>
  );
}
