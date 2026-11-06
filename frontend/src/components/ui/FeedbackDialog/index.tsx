import { useState } from 'react';
import { FEEDBACK_CATEGORIES, FEEDBACK_MAX_LENGTH, buildFeedbackContext, validateFeedbackMessage } from '../../../lib/feedback';
import type { FeedbackCategory, FeedbackSource } from '../../../lib/feedback';
import { useFeedbackSubmit } from './useFeedbackSubmit';

interface Props {
  source:      FeedbackSource;
  userEmail?:  string | null;
  regionCode?: string;
  onClose:     () => void;
}

export function FeedbackDialog({ source, userEmail, regionCode, onClose }: Props) {
  const [category, setCategory]       = useState<FeedbackCategory | null>(null);
  const [message, setMessage]         = useState('');
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [touched, setTouched]         = useState(false);
  const { state, error, submit }      = useFeedbackSubmit();

  const validationError = validateFeedbackMessage(message);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (validationError || state === 'sending') return;
    submit({
      message:     message.trim(),
      category,
      source,
      notifyEmail: !!userEmail && notifyEmail,
      context:     buildFeedbackContext({ appVersion: __APP_VERSION__, regionCode, userAgent: navigator.userAgent }),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-sky-50 rounded-2xl shadow-xl w-full max-w-sm p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-slate-800">Send feedback</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none" aria-label="Close">✕</button>
        </div>

        {state === 'sent' ? (
          <div className="text-center py-4">
            <img src="/favicon.png" alt="" aria-hidden className="w-12 h-12 object-contain mx-auto mb-3" />
            <p className="text-sm font-semibold text-slate-800 mb-1">Thank you!</p>
            <p className="text-sm text-slate-600 mb-5">
              Your feedback has been sent. Every message is read, and we'll reply in your notifications
              {notifyEmail && userEmail ? ' and by email' : ''} if there's anything to follow up on.
            </p>
            <button
              onClick={onClose}
              className="w-full py-2.5 bg-forest-600 hover:bg-forest-700 text-white rounded-xl text-sm font-semibold transition-colors"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <p className="text-sm text-slate-600 mb-4 leading-snug">
              We'd love to hear from you! What do you like about BurdyGurdy? What frustrates you, or what
              would you change? Ideas, bug reports and questions are all welcome.
            </p>

            <div className="flex flex-wrap gap-1.5 mb-3">
              {FEEDBACK_CATEGORIES.map(c => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCategory(prev => prev === c.value ? null : c.value)}
                  className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors ${
                    category === c.value
                      ? 'bg-forest-600 border-forest-600 text-white'
                      : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            <textarea
              placeholder="Your message"
              value={message}
              onChange={e => setMessage(e.target.value.slice(0, FEEDBACK_MAX_LENGTH))}
              rows={5}
              autoFocus
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-forest-500"
            />
            <div className="flex justify-between mt-0.5 mb-3">
              <p className="text-xs text-red-500">{touched && validationError ? validationError : ''}</p>
              <p className="text-xs text-slate-400">{message.length}/{FEEDBACK_MAX_LENGTH}</p>
            </div>

            {userEmail && (
              <label className="flex items-start gap-2.5 cursor-pointer mb-4">
                <input
                  type="checkbox"
                  checked={notifyEmail}
                  onChange={e => setNotifyEmail(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-forest-600 shrink-0"
                />
                <span className="text-sm text-slate-700 leading-snug">
                  OK to email me a reply at <strong>{userEmail}</strong>
                </span>
              </label>
            )}

            {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 bg-sky-100 border border-sky-200 text-slate-700 rounded-xl text-sm hover:bg-sky-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={state === 'sending'}
                className="flex-1 py-2.5 bg-forest-600 hover:bg-forest-700 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {state === 'sending' ? 'Sending…' : 'Send'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
