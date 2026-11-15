import { useCallback, useState } from 'react';
import {
  validateMailoutDraft,
  confirmSendMessage,
  describeSendResult,
  pluralPeople,
  MAILOUT_SUBJECT_MAX,
} from '../../../lib/mailout';
import type { MailoutHistoryItem } from '../../../services/remote/mailout';
import { RichTextEditor } from './RichTextEditor';
import { useMailoutAdmin } from './useMailoutAdmin';

type Busy = null | 'preview' | 'test' | 'send';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function HistoryRow({ item }: { item: MailoutHistoryItem }) {
  const result = item.status === 'sending'
    ? 'Still sending, or interrupted'
    : `${item.sentCount ?? 0} sent${item.failedCount ? ` · ${item.failedCount} failed` : ''}`;
  return (
    <div className="bg-white rounded-lg border border-slate-200 px-3 py-2">
      <p className="text-sm font-medium text-slate-800 truncate" title={item.subject}>{item.subject}</p>
      <p className="text-[10px] text-slate-400">
        {formatDate(item.createdAt)}{item.sentByName ? ` · ${item.sentByName}` : ''} · {pluralPeople(item.recipientCount)} · {result}
      </p>
    </div>
  );
}

export function MailoutPanel() {
  const { recipientCount, history, loadError, reload, preview, sendTest, sendAll, uploadImage } = useMailoutAdmin();

  const [subject, setSubject]         = useState('');
  const [html, setHtml]               = useState('');
  const [isEmpty, setIsEmpty]         = useState(true);
  const [editorKey, setEditorKey]     = useState(0);
  const [busy, setBusy]               = useState<Busy>(null);
  const [message, setMessage]         = useState<{ text: string; isError: boolean } | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [uploading, setUploading]     = useState(0);

  const draftError = validateMailoutDraft(subject, isEmpty);
  // Sending mid-upload would go out without the image
  const blocked = busy !== null || uploading > 0;

  const handleUploadImage = useCallback(async (file: File) => {
    setUploading(n => n + 1);
    setMessage(null);
    try {
      return await uploadImage(file);
    } finally {
      setUploading(n => n - 1);
    }
  }, [uploadImage]);

  const handleImageError = useCallback((text: string) => setMessage({ text, isError: true }), []);

  const run = async (kind: Exclude<Busy, null>, action: () => Promise<string | void>) => {
    setBusy(kind);
    setMessage(null);
    try {
      const text = await action();
      if (text) setMessage({ text, isError: false });
    } catch (err) {
      setMessage({ text: (err as Error).message, isError: true });
    } finally {
      setBusy(null);
    }
  };

  const handlePreview = () => {
    if (previewHtml !== null) { setPreviewHtml(null); return; }
    run('preview', async () => { setPreviewHtml(await preview(subject, html)); });
  };

  const handleTest = () => run('test', async () => `Test email sent to ${await sendTest(subject, html)}.`);

  const handleSendAll = () => {
    if (recipientCount === null || recipientCount === 0) return;
    if (!window.confirm(confirmSendMessage(subject, recipientCount))) return;
    run('send', async () => {
      const result = await sendAll(subject, html);
      if (result.sentCount > 0) {
        setSubject('');
        setHtml('');
        setIsEmpty(true);
        setPreviewHtml(null);
        setEditorKey(k => k + 1);
      }
      return describeSendResult(result);
    });
  };

  const handleChange = (nextHtml: string, empty: boolean) => {
    setHtml(nextHtml);
    setIsEmpty(empty);
    setPreviewHtml(null); // stale once the message changes
  };

  return (
    <div className="h-full flex flex-col bg-slate-50">
      <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-white">
        <p className="text-sm text-slate-600">
          {recipientCount === null ? 'Counting recipients…' : `Sends to ${pluralPeople(recipientCount)} who opted in to news`}
        </p>
        <button onClick={reload} className="ml-auto text-xs text-slate-500 hover:text-slate-700" aria-label="Refresh">↻ Refresh</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loadError && <p className="text-sm text-red-500">{loadError}</p>}

        <div className="space-y-2">
          <input
            type="text"
            value={subject}
            onChange={e => { setSubject(e.target.value.slice(0, MAILOUT_SUBJECT_MAX)); setPreviewHtml(null); }}
            disabled={busy === 'send'}
            placeholder="Subject"
            aria-label="Subject"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest-500"
          />
          <RichTextEditor
            key={editorKey}
            onChange={handleChange}
            disabled={busy === 'send'}
            uploadImage={handleUploadImage}
            onImageError={handleImageError}
          />
          {uploading > 0 && <p className="text-xs text-slate-500">Uploading image…</p>}
          <p className="text-[10px] text-slate-400">
            Sent from noreply@burdygurdy.com. A footer with the opt-in reason and an unsubscribe link is added automatically.
            Paste, drop or insert images; select one and press Alt to describe it.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={handlePreview}
            disabled={blocked || (previewHtml === null && !!draftError)}
            className="text-xs px-3 py-1.5 border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50 bg-white disabled:opacity-50"
          >
            {busy === 'preview' ? 'Loading…' : previewHtml !== null ? 'Hide preview' : 'Preview email'}
          </button>
          <button
            onClick={handleTest}
            disabled={blocked || !!draftError}
            className="text-xs px-3 py-1.5 bg-sky-100 text-sky-700 hover:bg-sky-200 rounded-lg font-medium disabled:opacity-50"
          >
            {busy === 'test' ? 'Sending…' : 'Send test to me'}
          </button>
          <button
            onClick={handleSendAll}
            disabled={blocked || !!draftError || !recipientCount}
            className="text-xs px-3 py-1.5 bg-forest-600 hover:bg-forest-700 text-white rounded-lg font-semibold disabled:opacity-50"
          >
            {busy === 'send' ? 'Sending to everyone…' : 'Send to all'}
          </button>
        </div>

        {draftError && (subject || !isEmpty) && <p className="text-xs text-slate-500">{draftError}</p>}
        {message && <p className={`text-xs ${message.isError ? 'text-red-500' : 'text-forest-700'}`}>{message.text}</p>}

        {previewHtml !== null && (
          <div className="border border-slate-300 rounded-lg overflow-hidden bg-white">
            <p className="text-[10px] uppercase tracking-wider text-slate-400 px-3 py-1.5 border-b border-slate-200">
              Preview · {subject.trim()}
            </p>
            {/* sandbox with no permissions: the preview can't run scripts or navigate the app */}
            <iframe title="Email preview" srcDoc={previewHtml} sandbox="" className="w-full h-[420px]" />
          </div>
        )}

        <div className="space-y-2 pt-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Past mailouts</p>
          {history.length === 0
            ? <p className="text-sm text-slate-400">None yet.</p>
            : history.map(item => <HistoryRow key={item.id} item={item} />)}
        </div>
      </div>
    </div>
  );
}
