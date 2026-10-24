import { useEffect, useRef, useState } from 'react';
import type { Tournament } from '../types';
import { useStore } from '../store';

export function SharePanel({ t }: { t: Tournament }) {
  const { setShared } = useStore();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const url = t.shareId ? `${window.location.origin}${window.location.pathname}#/s/${t.shareId}` : '';

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    await setShared(t.id, enabled);
    setBusy(false);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked; the link is selectable in the input.
    }
  };

  return (
    <div className="menu" ref={ref}>
      <button className="btn" onClick={() => setOpen(!open)} aria-expanded={open}>
        🔗 Share
      </button>
      {open && (
        <div className="menu-pop card share-pop">
          <strong>Share with players & fans</strong>
          <p className="muted small">Anyone with the link can view results and tables. Only you can edit.</p>
          {t.shareId ? (
            <>
              <div className="row">
                <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Share link" />
                <button className="btn btn-primary btn-sm" onClick={copy}>{copied ? 'Copied!' : 'Copy'}</button>
              </div>
              <button className="btn btn-sm btn-ghost danger" disabled={busy} onClick={() => toggle(false)}>Turn off link</button>
            </>
          ) : (
            <button className="btn btn-primary" disabled={busy} onClick={() => toggle(true)}>
              {busy ? 'Creating…' : 'Create share link'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
