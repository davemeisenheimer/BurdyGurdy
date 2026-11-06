import { useCallback, useEffect, useState } from 'react';
import { fetchFeedback, setFeedbackStatus, replyToFeedback } from '../../../services/remote/feedback';
import type { FeedbackItem } from '../../../services/remote/feedback';

export function useFeedbackAdmin() {
  const [items, setItems]     = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchFeedback());
    } catch (err) {
      console.error('[feedback-admin] load:', err);
      setError('Failed to load feedback.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const updateStatus = useCallback(async (id: string, status: 'new' | 'read') => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, status } : i));
    try {
      await setFeedbackStatus(id, status);
    } catch (err) {
      console.error('[feedback-admin] status:', err);
      reload();
    }
  }, [reload]);

  /** Sends a reply. Throws on failure so the caller can keep the draft. */
  const reply = useCallback(async (id: string, text: string) => {
    const { repliedAt, emailed } = await replyToFeedback(id, text);
    setItems(prev => prev.map(i => i.id === id ? { ...i, status: 'replied', adminReply: text.trim(), repliedAt } : i));
    return { emailed };
  }, []);

  return { items, loading, error, reload, updateStatus, reply };
}
