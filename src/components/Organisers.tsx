import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Tournament } from '../types';
import { api, type Members } from '../api';
import { useStore } from '../store';

/** Owner plus co-organisers; the owner can invite, cancel invites, and remove people. */
export function Organisers({ t, onLeft }: { t: Tournament; onLeft: () => void }) {
  const { auth, forget, showError } = useStore();
  const [data, setData] = useState<Members | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [formError, setFormError] = useState('');
  const me = auth.status === 'in' ? auth.user : null;
  const isOwner = t.role !== 'editor';

  const load = useCallback(() => {
    api.members(t.id).then(setData).catch((e: Error) => showError(e.message));
  }, [t.id, showError]);
  useEffect(load, [load]);

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    setNotice('');
    try {
      await api.invite(t.id, email);
      setNotice(`Invitation sent to ${email.trim()}.`);
      setEmail('');
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      load();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  const leave = async () => {
    if (!me) return;
    try {
      await api.removeMember(t.id, me.id);
      forget(t.id);
      onLeft();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  return (
    <section className="card stack">
      <div className="stack-sm">
        <h3>Organisers</h3>
        <p className="muted small">Co-organisers can enter scores and change settings. Only the owner can invite people or delete the tournament.</p>
      </div>

      {!data ? <div className="loading small-loading" aria-label="Loading" /> : (
        <ul className="people">
          <li>
            <span className="avatar static">{data.owner.name.slice(0, 1).toUpperCase()}</span>
            <div className="grow">
              <strong>{data.owner.name}{data.owner.id === me?.id && ' (you)'}</strong>
              <div className="muted small">{data.owner.email}</div>
            </div>
            <span className="pill">Owner</span>
          </li>
          {data.members.map((m) => (
            <li key={m.id}>
              <span className="avatar static">{m.name.slice(0, 1).toUpperCase()}</span>
              <div className="grow">
                <strong>{m.name}{m.id === me?.id && ' (you)'}</strong>
                <div className="muted small">{m.email}</div>
              </div>
              {isOwner ? (
                <button className="btn btn-sm btn-ghost danger" onClick={() => run(() => api.removeMember(t.id, m.id))}>Remove</button>
              ) : m.id === me?.id ? (
                <button className="btn btn-sm btn-ghost danger" onClick={leave}>Leave</button>
              ) : <span className="pill">Co-organiser</span>}
            </li>
          ))}
          {data.invites.map((i) => (
            <li key={i.id} className="invited">
              <span className="avatar static ghost">✉</span>
              <div className="grow">
                <strong>{i.email}</strong>
                <div className="muted small">Invitation pending</div>
              </div>
              {isOwner && (
                <div className="row">
                  <button className="btn btn-sm btn-ghost" onClick={() => run(() => api.invite(t.id, i.email))}>Resend</button>
                  <button className="btn btn-sm btn-ghost danger" onClick={() => run(() => api.cancelInvite(t.id, i.id))}>Cancel</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {isOwner && (
        me && !me.emailVerified ? (
          <p className="muted small">Confirm your email address (see the banner at the top) to invite co-organisers.</p>
        ) : (
          <form className="stack-sm" onSubmit={invite}>
            <div className="row invite-row">
              <input
                type="email" required placeholder="Co-organiser’s email" value={email}
                onChange={(e) => setEmail(e.target.value)} aria-label="Co-organiser’s email"
              />
              <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Invite'}</button>
            </div>
            {formError && <p className="error small">{formError}</p>}
            {notice && <p className="success small">✓ {notice}</p>}
          </form>
        )
      )}
    </section>
  );
}
