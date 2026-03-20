import { useRef, useState } from 'react';

export type ReportIssueType = 'wrong_bird' | 'poor_quality' | 'confusing' | 'other';

export interface ReportErrorData {
  issueType:   ReportIssueType;
  wrongBird:   string;
  description: string;
}

interface Props {
  mediaType: 'photo' | 'audio';
  mediaUrl:  string;
  comName:   string;
  onSubmit:  (data: ReportErrorData) => void;
  onClose:   () => void;
}

const ISSUE_LABELS: Record<ReportIssueType, string> = {
  wrong_bird:   'Wrong bird — this media shows a different species',
  poor_quality: 'Poor quality — too blurry, noisy, or unclear',
  confusing:    'Confusing — unfair or misleading for a question',
  other:        'Other',
};

export function ReportErrorModal({ mediaType, mediaUrl, comName, onSubmit, onClose }: Props) {
  const [issueType, setIssueType]   = useState<ReportIssueType | null>(null);
  const [wrongBird, setWrongBird]   = useState('');
  const [description, setDescription] = useState('');
  const [playing, setPlaying]       = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const toggleAudio = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play().catch(() => {}); setPlaying(true); }
  };

  const handleSubmit = () => {
    if (!issueType) return;
    onSubmit({ issueType, wrongBird: wrongBird.trim(), description: description.trim() });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-slate-800">Report an error</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
        </div>

        {/* Media preview */}
        <div className="mb-3 rounded-xl overflow-hidden bg-slate-900 flex items-center justify-center h-28">
          {mediaType === 'photo' ? (
            <img src={mediaUrl} alt={comName} className="max-h-full max-w-full object-contain" />
          ) : (
            <>
              <button
                onClick={toggleAudio}
                className="w-12 h-12 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white text-xl"
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing ? '⏸' : '▶'}
              </button>
              <audio ref={audioRef} src={mediaUrl} onEnded={() => setPlaying(false)} />
            </>
          )}
        </div>

        <p className="text-xs text-slate-500 mb-4">
          Reporting {mediaType} for: <strong className="text-slate-700">{comName}</strong>
        </p>

        {/* Issue type */}
        <div className="space-y-2.5 mb-4">
          {(['wrong_bird', 'poor_quality', 'confusing', 'other'] as ReportIssueType[]).map(type => (
            <label key={type} className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="radio"
                name="issueType"
                checked={issueType === type}
                onChange={() => setIssueType(type)}
                className="mt-0.5 w-4 h-4 accent-forest-600 shrink-0"
              />
              <span className="text-sm text-slate-700 leading-snug">{ISSUE_LABELS[type]}</span>
            </label>
          ))}
        </div>

        {/* Wrong bird text input */}
        {issueType === 'wrong_bird' && (
          <input
            type="text"
            placeholder="Which bird do you think this is?"
            value={wrongBird}
            onChange={e => setWrongBird(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-forest-500"
          />
        )}

        {/* Description — available for all types */}
        <div className="mb-4">
          <textarea
            placeholder="Additional details (optional)"
            value={description}
            onChange={e => setDescription(e.target.value.slice(0, 240))}
            rows={2}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-forest-500"
          />
          <p className="text-xs text-slate-400 text-right mt-0.5">{description.length}/240</p>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2 border border-slate-300 rounded-xl text-sm text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!issueType}
            className="flex-1 py-2 bg-forest-600 hover:bg-forest-700 text-white rounded-xl text-sm font-medium disabled:opacity-40 transition-colors"
          >
            Send report
          </button>
        </div>
      </div>
    </div>
  );
}
