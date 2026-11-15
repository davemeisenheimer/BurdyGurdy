import { useEffect, useState } from 'react';
import { fetchIdTip, type IdTipParams } from '../../../services/remote/api';

export type IdTipStatus = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * Loads the AI ID tip for a wrong answer. Pass null when no tip is wanted (status stays 'idle').
 * A new request - or null - abandons any request still in flight.
 */
export function useIdTip(params: IdTipParams | null): { status: IdTipStatus; tip: string | null } {
  const [state, setState] = useState<{ status: IdTipStatus; tip: string | null }>({ status: 'idle', tip: null });

  const { speciesCode, comName, sciName, guess, photoUrl } = params ?? {};
  useEffect(() => {
    if (!speciesCode || !comName || !sciName || !guess || !photoUrl) {
      setState({ status: 'idle', tip: null });
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading', tip: null });
    fetchIdTip({ speciesCode, comName, sciName, guess, photoUrl }, controller.signal)
      .then(tip => { if (!controller.signal.aborted) setState({ status: 'ready', tip }); })
      .catch(() => { if (!controller.signal.aborted) setState({ status: 'failed', tip: null }); });
    return () => controller.abort();
  }, [speciesCode, comName, sciName, guess, photoUrl]);

  return state;
}
