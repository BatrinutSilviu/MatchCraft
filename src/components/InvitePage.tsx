import { useEffect, useState } from 'react';
import { api, ApiError, type InvitePreview } from '../api';
import { navigate, useStore } from '../store';

export function InvitePage({ token }: { token: string }) {
  const { auth, logout, reloadAll, refreshUser } = useStore();
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const here = `/invite?token=${encodeURIComponent(token)}`;

  useEffect(() => {
    api.invitePreview(token).then(setInvite).catch((e: Error) => setError(e.message));
  }, [token]);

  const accept = async () => {
    setBusy(true);
    setError('');
    try {
      const { tournamentId } = await api.acceptInvite(token);
      await Promise.all([reloadAll(), refreshUser()]);
      navigate(`/t/${tournamentId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
      setBusy(false);
    }
  };

  if (!invite) {
    return (
      <div className="auth">
        <div className="card stack auth-card center-text">
          {error ? (
            <>
              <span className="big-icon">⚠️</span>
              <h1>Invitation unavailable</h1>
              <p className="muted">{error}</p>
              <a href="#/" className="btn">Go to Matchcraft</a>
            </>
          ) : <div className="loading" aria-label="Loading" />}
        </div>
      </div>
    );
  }

  const user = auth.status === 'in' ? auth.user : null;
  const wrongAccount = user && user.email.toLowerCase() !== invite.email.toLowerCase();
  const next = encodeURIComponent(here);
  const emailParam = encodeURIComponent(invite.email);

  return (
    <div className="auth">
      <div className="card stack auth-card center-text">
        <span className="big-icon">🤝</span>
        <h1>Help run {invite.tournamentName}</h1>
        <p className="muted">
          <strong>{invite.inviterName}</strong> invited <strong>{invite.email}</strong> to co-organise this
          tournament. You’ll be able to enter scores and change settings.
        </p>
        {error && <p className="error" role="alert">{error}</p>}

        {!user ? (
          <>
            <a className="btn btn-primary" href={`#/signup?next=${next}&email=${emailParam}`}>Create an account to accept</a>
            <a className="btn" href={`#/login?next=${next}&email=${emailParam}`}>I already have an account</a>
          </>
        ) : wrongAccount ? (
          <>
            <p className="warn small">
              You’re logged in as {user.email}. Log out and use {invite.email} to accept.
            </p>
            <button className="btn" onClick={async () => { await logout(); navigate(`/login?next=${next}&email=${emailParam}`); }}>
              Log out and switch account
            </button>
          </>
        ) : (
          <button className="btn btn-primary" disabled={busy} onClick={accept}>
            {busy ? 'Joining…' : 'Accept invitation'}
          </button>
        )}
      </div>
    </div>
  );
}
