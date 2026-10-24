import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { navigate, useStore } from '../store';

const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');

export function ForgotPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      {sent ? (
        <div className="card stack auth-card center-text">
          <span className="big-icon">📬</span>
          <h1>Check your inbox</h1>
          <p className="muted">
            If there’s an account for <strong>{email}</strong>, we’ve sent a link to reset the password.
            It expires in an hour. Don’t forget to check spam.
          </p>
          <a href="#/login" className="btn">Back to log in</a>
        </div>
      ) : (
        <form className="card stack auth-card" onSubmit={submit}>
          <div className="stack-sm">
            <h1>Forgot your password?</h1>
            <p className="muted">Enter your email and we’ll send you a link to choose a new one.</p>
          </div>
          <label className="field">
            <span>Email</span>
            <input type="email" required autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
          <p className="muted small center"><a className="link" href="#/login">Back to log in</a></p>
        </form>
      )}
    </div>
  );
}

export function ResetPage({ token }: { token: string }) {
  const { signedIn } = useStore();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError('The passwords don’t match.');
    setBusy(true);
    setError('');
    try {
      const { user } = await api.resetPassword(token, password);
      signedIn(user);
      navigate('/');
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <form className="card stack auth-card" onSubmit={submit}>
        <div className="stack-sm">
          <h1>Choose a new password</h1>
          <p className="muted">You’ll be logged in, and signed out everywhere else.</p>
        </div>
        <label className="field">
          <span>New password</span>
          <input type="password" required minLength={8} autoFocus autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <small className="muted">At least 8 characters.</small>
        </label>
        <label className="field">
          <span>Repeat it</span>
          <input type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        {error && (
          <p className="error" role="alert">
            {error} {/expired|used/.test(error) && <a className="link" href="#/forgot">Send a new link</a>}
          </p>
        )}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
      </form>
    </div>
  );
}

export function VerifyPage({ token }: { token: string }) {
  const { auth, refreshUser } = useStore();
  const [state, setState] = useState<'working' | 'done' | string>('working');
  const started = useRef(false);

  useEffect(() => {
    // Tokens are single-use, so make sure React's dev double-effect doesn't spend it twice.
    if (started.current) return;
    started.current = true;
    api.verifyEmail(token)
      .then(() => {
        setState('done');
        return refreshUser();
      })
      .catch((e) => setState(message(e)));
  }, [token, refreshUser]);

  return (
    <div className="auth">
      <div className="card stack auth-card center-text">
        {state === 'working' ? (
          <div className="loading" aria-label="Confirming" />
        ) : state === 'done' ? (
          <>
            <span className="big-icon">✅</span>
            <h1>Email confirmed</h1>
            <p className="muted">Thanks! Your account is all set.</p>
            <a href="#/" className="btn btn-primary">{auth.status === 'in' ? 'Go to my tournaments' : 'Log in'}</a>
          </>
        ) : (
          <>
            <span className="big-icon">⚠️</span>
            <h1>That link didn’t work</h1>
            <p className="muted">{state}</p>
            <a href="#/" className="btn">{auth.status === 'in' ? 'Back to my tournaments' : 'Log in'}</a>
          </>
        )}
      </div>
    </div>
  );
}

/** Gentle, dismissible reminder shown to signed-in users who haven't confirmed their email. */
export function VerifyBanner({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'hidden'>('idle');
  const [error, setError] = useState('');
  if (state === 'hidden') return null;

  const resend = async () => {
    setState('sending');
    setError('');
    try {
      await api.resendVerification();
      setState('sent');
    } catch (e) {
      setError(message(e));
      setState('idle');
    }
  };

  return (
    <div className="verify-banner" role="status">
      <span>
        {state === 'sent'
          ? <>New link sent to <strong>{email}</strong>.</>
          : <>Please confirm your email: we sent a link to <strong>{email}</strong>.</>}
        {error && <span className="error"> {error}</span>}
      </span>
      <div className="row">
        {state !== 'sent' && (
          <button className="btn btn-sm" disabled={state === 'sending'} onClick={resend}>
            {state === 'sending' ? 'Sending…' : 'Resend link'}
          </button>
        )}
        <button className="icon-btn" aria-label="Hide" onClick={() => setState('hidden')}>✕</button>
      </div>
    </div>
  );
}
