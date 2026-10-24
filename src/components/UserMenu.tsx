import { useEffect, useRef, useState } from 'react';
import type { User } from '../api';
import { useStore } from '../store';

export function UserMenu({ user }: { user: User }) {
  const { logout } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button className="avatar" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Account menu">
        {(user.name || user.email).slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div className="menu-pop card">
          <div>
            <strong>{user.name}</strong>
            <div className="muted small">{user.email}</div>
          </div>
          <button className="btn btn-sm" onClick={logout}>Log out</button>
        </div>
      )}
    </div>
  );
}
