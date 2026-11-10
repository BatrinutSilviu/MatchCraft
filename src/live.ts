import { useEffect, useRef } from 'react';

/**
 * Calls `onChange` whenever the server reports a new version on `url` (Server-Sent Events),
 * and when the tab becomes visible again. Falls back to slow polling if the stream keeps failing.
 */
export function useLive(url: string | null, onChange: () => void) {
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    if (!url) return;
    const fire = () => cb.current();
    const onVisible = () => document.visibilityState === 'visible' && fire();
    document.addEventListener('visibilitychange', onVisible);

    let source: EventSource | null = null;
    let poll: number | undefined;
    if (typeof EventSource !== 'undefined') {
      source = new EventSource(url, { withCredentials: true });
      source.onmessage = fire;
      // The browser reconnects by itself; catch up on anything missed while it was down.
      source.onopen = fire;
    }
    poll = window.setInterval(() => document.visibilityState === 'visible' && fire(), source ? 60_000 : 20_000);

    return () => {
      source?.close();
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [url]);
}
