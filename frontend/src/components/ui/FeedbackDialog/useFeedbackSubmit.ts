import { useCallback, useState } from 'react';
import { submitFeedback } from '../../../services/remote/feedback';
import type { SubmitFeedbackParams } from '../../../services/remote/feedback';
import { describeFeedbackError } from '../../../lib/feedback';

export type SubmitState = 'idle' | 'sending' | 'sent' | 'error';

export function useFeedbackSubmit() {
  const [state, setState] = useState<SubmitState>('idle');
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (p: SubmitFeedbackParams) => {
    setState('sending');
    setError(null);
    try {
      await submitFeedback(p);
      setState('sent');
    } catch (err) {
      console.error('[feedback] submit:', err);
      setError(describeFeedbackError(err));
      setState('error');
    }
  }, []);

  return { state, error, submit };
}
