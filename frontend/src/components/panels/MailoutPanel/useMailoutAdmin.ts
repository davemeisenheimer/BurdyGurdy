import { useCallback, useEffect, useState } from 'react';
import {
  fetchRecipientCount,
  fetchMailoutHistory,
  previewMailout,
  sendTestMailout,
  sendMailout,
  uploadMailoutImage,
} from '../../../services/remote/mailout';
import type { MailoutHistoryItem } from '../../../services/remote/mailout';
import { describeMailoutError, imageDisplayWidth } from '../../../lib/mailout';
import { prepareImage } from './prepareImage';

/** Wraps a request so failures are logged and rethrown as a user-facing message. */
function withUserMessage<A extends unknown[], R>(tag: string, fallback: string, fn: (...args: A) => Promise<R>) {
  return async (...args: A): Promise<R> => {
    try {
      return await fn(...args);
    } catch (err) {
      console.error(`[mailout-admin] ${tag}:`, err);
      throw new Error(describeMailoutError(err, fallback));
    }
  };
}

const preview  = withUserMessage('preview', 'Could not build the preview.', previewMailout);
const sendTest = withUserMessage('test', 'The test email could not be sent.', sendTestMailout);
const sendToAll = withUserMessage('send', 'The mailout could not be sent.', sendMailout);
const upload    = withUserMessage('image', 'The image could not be uploaded.', uploadMailoutImage);

/** Checks, scales and uploads an image. Returns its URL and the width to show it at. */
async function uploadImage(file: File): Promise<{ src: string; width: number }> {
  const { blob, width } = await prepareImage(file);
  return { src: await upload(blob), width: imageDisplayWidth(width) };
}

/** Recipient count and history for the mailout panel, plus the send actions (which throw a message on failure). */
export function useMailoutAdmin() {
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [history, setHistory]               = useState<MailoutHistoryItem[]>([]);
  const [loadError, setLoadError]           = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoadError(null);
    const [countResult, historyResult] = await Promise.allSettled([fetchRecipientCount(), fetchMailoutHistory()]);
    if (countResult.status === 'fulfilled') setRecipientCount(countResult.value);
    if (historyResult.status === 'fulfilled') setHistory(historyResult.value);
    const failed = [countResult, historyResult].find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) {
      console.error('[mailout-admin] load:', failed.reason);
      setLoadError(describeMailoutError(failed.reason, 'Failed to load mailout details.'));
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const sendAll = useCallback(async (subject: string, html: string) => {
    try {
      return await sendToAll(subject, html);
    } finally {
      reload();
    }
  }, [reload]);

  return { recipientCount, history, loadError, reload, preview, sendTest, sendAll, uploadImage };
}
