/**
 * Static content for all generic confirm dialogs.
 * Handlers (onConfirm, onCancel) are passed at the call site since they
 * close over component state and cannot live in a static data file.
 */

export interface DialogConfig {
  title: string;
  children: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Tailwind classes for the confirm button. Defaults to forest-600. */
  confirmClassName?: string;
}

export const DIALOGS: Record<string, DialogConfig> = {
  orderGroupWarning: {
    title: 'Bird Order questions require All Birds',
    confirmLabel: 'Play All Birds',
    children: (
      <p className="text-sm text-slate-600 leading-relaxed">
        Order questions need birds from multiple orders as answer options, so they can only
        be played with the <span className="font-semibold">All Birds</span> group selected.
      </p>
    ),
    // The second paragraph (mentioning the current group name) is injected via
    // the extraChildren prop on DialogGeneric since it contains dynamic content.
  },

  randomWarning: {
    title: 'Random mode',
    confirmLabel: 'OK, got it',
    confirmClassName: 'bg-sky-600 hover:bg-sky-700',
    children: (
      <>
        <p className="text-sm text-slate-600 leading-relaxed">
          In random mode your progress is <span className="font-semibold">not tracked</span>.
          Birds you answer correctly won't advance in your adaptive learning history, and
          nothing will be added to your Life List.
        </p>
        <p className="text-sm text-slate-600 leading-relaxed mt-2">
          Switch back to Adaptive at any time to resume tracking.
        </p>
      </>
    ),
  },

  inactivitySignOut: {
    title: 'Signed out',
    confirmLabel: 'Sign in',
    children: (
      <p className="text-sm text-slate-600 leading-relaxed">
        You were signed out due to inactivity. If you choose to cancel, you will be running
        in <span className="font-semibold">guest mode</span> and your progress will not be
        tracked on your account.
      </p>
    ),
  },
};
