import { useState, type FormEvent } from 'react';
import { navigate, useStore } from '../store';

interface Props {
  mode: 'login' | 'signup';
  /** Route to continue to after signing in. */
  next?: string;
  note?: string;
  /** Prefilled email, e.g. from an invitation link. */
  email?: string;
}

export function AuthPage({ mode, next = '/', note, email: initialEmail = '' }: Props) {
  const { login, signup } = useStore();
  const [name, setName] = useState('');
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isSignup = mode === 'signup';
  const params = new URLSearchParams();
  if (next !== '/') params.set('next', next);
  if (initialEmail) params.set('email', initialEmail);
  const nextParam = params.size ? `?${params}` : '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (isSignup) await signup(name, email, password);
      else await login(email, password);
      navigate(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <form className="card stack auth-card" onSubmit={submit}>
        <div className="stack-sm">
          <h1>{isSignup ? 'Create your account' : 'Welcome back'}</h1>
          <p className="muted">
            {note ?? (isSignup ? 'Free. Your tournaments are saved and available on any device.' : 'Log in to see your tournaments.')}
          </p>
        </div>
        {isSignup && (
          <label className="field">
            <span>Your name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Alex" autoFocus />
          </label>
        )}
        <label className="field">
          <span>Email</span>
          <input
            type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            autoComplete="email" autoFocus={!isSignup && !initialEmail}
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password" required minLength={isSignup ? 8 : undefined} value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSignup ? 'new-password' : 'current-password'}
          />
          {isSignup ? <small className="muted">At least 8 characters.</small> : (
            <a className="link small forgot" href="#/forgot">Forgot password?</a>
          )}
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'One moment…' : isSignup ? 'Create account' : 'Log in'}
        </button>
        <p className="muted small center">
          {isSignup ? (
            <>Already have an account? <a className="link" href={`#/login${nextParam}`}>Log in</a></>
          ) : (
            <>New here? <a className="link" href={`#/signup${nextParam}`}>Create an account</a></>
          )}
        </p>
      </form>
    </div>
  );
}
