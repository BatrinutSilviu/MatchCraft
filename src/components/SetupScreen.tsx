import { useCallback, useEffect, useState } from 'react';
import type { Participant, Tournament } from '../types';
import { api, liveUrl, type Registration } from '../api';
import { useLive } from '../live';
import { useStore, type Change } from '../store';
import { startTournament, validateDraft } from '../engine/generate';
import { uid } from '../engine/uid';
import { FORMAT_INFO } from '../sports';
import { FormatEditor } from './FormatEditor';

const reseed = (ps: Participant[]) => ps.map((p, i) => ({ ...p, seed: i + 1 }));
const bySeed = (t: Tournament) => [...t.participants].sort((a, b) => a.seed - b.seed);

export function shareUrl(shareId: string, route = 's') {
  return `${window.location.origin}${window.location.pathname}#/${route}/${shareId}`;
}

/** Organiser view while a tournament is collecting entries. */
export function SetupPanel({ t, onUpdate }: { t: Tournament; onUpdate: (c: Change) => Promise<boolean> }) {
  const { setShared, billing, showError } = useStore();
  const [regs, setRegs] = useState<Registration[]>([]);
  const [error, setError] = useState('');
  const [editFormat, setEditFormat] = useState(false);
  const [newName, setNewName] = useState('');
  const [copied, setCopied] = useState(false);
  const reg = t.registration ?? { open: false, capacity: 0 };
  const [capacity, setCapacity] = useState(reg.capacity);
  const [message, setMessage] = useState(reg.message ?? '');
  const noun = t.participantNoun.toLowerCase();

  const loadRegs = useCallback(() => {
    api.registrations(t.id).then((r) => setRegs(r.registrations)).catch(() => undefined);
  }, [t.id]);
  // Reload whenever the tournament changes, and on every live event: a waitlist sign-up
  // doesn't change the tournament itself.
  useEffect(loadRegs, [loadRegs, t.version]);
  useLive(liveUrl.tournament(t.id), loadRegs);

  const entries = bySeed(t);
  const entered = new Set(entries.map((p) => p.id));
  const emailOf = new Map(regs.map((r) => [r.participantId, r.email]));
  const waiting = regs.filter((r) => !entered.has(r.participantId));
  const freeCap = billing.enabled && !t.pro ? billing.freeParticipantLimit : Infinity;
  const effectiveCap = Math.min(reg.capacity || Infinity, freeCap);
  const url = t.shareId ? shareUrl(t.shareId) : '';

  const setParticipants = (fn: (ps: Participant[]) => Participant[]) =>
    void onUpdate((cur) => ({ ...cur, participants: reseed(fn([...cur.participants].sort((a, b) => a.seed - b.seed))) }));

  const move = (i: number, dir: -1 | 1) => setParticipants((ps) => {
    const j = i + dir;
    if (j < 0 || j >= ps.length) return ps;
    [ps[i], ps[j]] = [ps[j], ps[i]];
    return ps;
  });
  const rename = (id: string, name: string) => {
    const v = name.trim();
    if (!v || entries.some((p) => p.id !== id && p.name.toLowerCase() === v.toLowerCase())) return;
    setParticipants((ps) => ps.map((p) => (p.id === id ? { ...p, name: v } : p)));
  };
  const add = (name: string, id = uid()) => {
    const v = name.trim();
    if (!v) return;
    if (entries.some((p) => p.name.toLowerCase() === v.toLowerCase())) {
      setError(`“${v}” is already entered.`);
      return;
    }
    setError('');
    setParticipants((ps) => (ps.some((p) => p.id === id) ? ps : [...ps, { id, name: v, seed: ps.length + 1 }]));
  };
  const forget = async (r: Registration) => {
    try {
      await api.removeRegistration(t.id, r.id);
      loadRegs();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  const setOpen = async (open: boolean) => {
    if (open && !t.shareId) await setShared(t.id, true);
    void onUpdate((cur) => ({ ...cur, registration: { ...(cur.registration ?? { capacity: 0 }), open } }));
  };
  const saveDetails = () => void onUpdate((cur) => ({
    ...cur, registration: { ...(cur.registration ?? { open: false }), capacity: Math.max(0, capacity), message: message.trim() || undefined },
  }));
  const detailsDirty = capacity !== reg.capacity || message.trim() !== (reg.message ?? '');

  const startError = validateDraft({ ...t, participants: entries });
  const start = () => {
    if (startError) return setError(startError);
    if (!window.confirm(`Close sign-ups and generate the fixtures for ${entries.length} ${noun}s? Entries can’t be added after this.`)) return;
    void onUpdate((cur) => {
      const started = startTournament(cur);
      return typeof started === 'string' ? cur : started;
    });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked; the link is selectable.
    }
  };

  return (
    <div className="stack-lg">
      <section className="card stack">
        <div className="row wrap between">
          <div>
            <h3>{reg.open ? '🟢 Sign-ups are open' : '⏸ Sign-ups are closed'}</h3>
            <p className="muted small">
              {entries.length}{Number.isFinite(effectiveCap) ? ` of ${effectiveCap}` : ''} {noun}s entered
              {waiting.length ? ` · ${waiting.length} on the waitlist` : ''}
            </p>
          </div>
          <button className={`btn ${reg.open ? '' : 'btn-primary'}`} onClick={() => void setOpen(!reg.open)}>
            {reg.open ? 'Close sign-ups' : 'Open sign-ups'}
          </button>
        </div>
        {reg.open && url && (
          <div className="row">
            <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Sign-up link" />
            <button className="btn btn-primary btn-sm" onClick={copy}>{copied ? 'Copied!' : 'Copy link'}</button>
          </div>
        )}
        <div className="form-grid">
          <label className="field">
            <span>Maximum entries</span>
            <input type="number" min={0} value={capacity} onChange={(e) => setCapacity(Math.max(0, Number(e.target.value) || 0))} />
            <small className="muted">
              0 = no limit.{Number.isFinite(freeCap) ? ` Free tournaments stop at ${freeCap}; later sign-ups wait.` : ''}
            </small>
          </label>
          <label className="field span-2">
            <span>Note for players</span>
            <input value={message} maxLength={300} onChange={(e) => setMessage(e.target.value)} placeholder="Entry fee, dress code, where to meet…" />
          </label>
        </div>
        <div className="row end">
          <button className="btn btn-sm" disabled={!detailsDirty} onClick={saveDetails}>Save</button>
        </div>
      </section>

      <section className="stack-sm">
        <div className="row between wrap">
          <h3 className="section-title">Entries · seeding order</h3>
          <span className="muted small">Top of the list = top seed.</span>
        </div>
        <div className="card p-editor">
          <form className="p-add" onSubmit={(e) => { e.preventDefault(); add(newName); setNewName(''); }}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={`Add a ${noun} yourself`} aria-label={`New ${noun}`} />
            <button className="btn btn-primary" disabled={!newName.trim()}>Add</button>
          </form>
          {entries.length === 0 ? (
            <div className="p-empty">
              <span className="p-empty-icon">📝</span>
              <strong>No entries yet</strong>
              <span className="muted small">Share the sign-up link, or add {noun}s yourself.</span>
            </div>
          ) : (
            <ol className="p-list">
              {entries.map((p, i) => (
                <li key={p.id} className="p-row">
                  <span className={`p-seed ${i < 3 ? `top top-${i + 1}` : ''}`}>{i + 1}</span>
                  <div className="p-name">
                    <input defaultValue={p.name} key={p.name} onBlur={(e) => rename(p.id, e.target.value)} aria-label={`Seed ${i + 1} name`} />
                    {emailOf.get(p.id) && <small className="muted">{emailOf.get(p.id)}</small>}
                  </div>
                  <div className="p-actions">
                    <button type="button" className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                    <button type="button" className="icon-btn" onClick={() => move(i, 1)} disabled={i === entries.length - 1} aria-label="Move down">↓</button>
                    <button
                      type="button" className="icon-btn" aria-label={`Remove ${p.name}`}
                      title={emailOf.has(p.id) ? 'Move to the waitlist' : 'Remove'}
                      onClick={() => setParticipants((ps) => ps.filter((x) => x.id !== p.id))}
                    >✕</button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      {waiting.length > 0 && (
        <section className="stack-sm">
          <h3 className="section-title">Waitlist</h3>
          <div className="card stack-sm">
            {waiting.map((r) => (
              <div key={r.id} className="row between wrap waitlist-row">
                <div>
                  <strong>{r.name}</strong> <span className="muted small">{r.email}</span>
                  {r.note && <div className="muted small">“{r.note}”</div>}
                </div>
                <div className="row">
                  <button className="btn btn-sm" onClick={() => add(r.name, r.participantId)}>Enter</button>
                  <button className="btn btn-sm btn-ghost danger" onClick={() => void forget(r)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card stack">
        <div className="row between wrap">
          <div>
            <h3>Format: {FORMAT_INFO[t.format.kind].name}</h3>
            <p className="muted small">Pick the final format once you know how many {noun}s are in.</p>
          </div>
          <button className="btn btn-sm" onClick={() => setEditFormat(!editFormat)}>{editFormat ? 'Done' : 'Change'}</button>
        </div>
        {editFormat && <FormatEditor format={t.format} onChange={(format) => void onUpdate((cur) => ({ ...cur, format }))} />}
      </section>

      {error && <p className="error" role="alert">{error}</p>}
      <div className="card row wrap between start-bar">
        <span className={startError ? 'muted' : ''}>
          {startError ?? `Ready: ${entries.length} ${noun}s, ${FORMAT_INFO[t.format.kind].name.toLowerCase()}.`}
        </span>
        <button className="btn btn-primary btn-lg" disabled={Boolean(startError)} onClick={start}>Generate fixtures</button>
      </div>
    </div>
  );
}

/** What players see on the share link while sign-ups run. */
export function PublicSetup({ t, shareId, waitlist }: { t: Tournament; shareId: string; waitlist: number }) {
  const { billing } = useStore();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<'entered' | 'waitlist' | null>(null);
  const reg = t.registration;
  const noun = t.participantNoun.toLowerCase();
  const entries = bySeed(t);
  const freeCap = billing.enabled && !t.pro ? billing.freeParticipantLimit : 0;
  const cap = Math.min(reg?.capacity || Infinity, freeCap || Infinity);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setDone((await api.register(shareId, { name, email })).status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    }
    setBusy(false);
  };

  return (
    <div className="signup-grid">
      <section className="card stack">
        {done ? (
          <div className="stack-sm">
            <h2>{done === 'entered' ? '🎉 You’re in!' : '⏳ You’re on the waitlist'}</h2>
            <p className="muted">
              {done === 'entered'
                ? 'We emailed you a confirmation. Fixtures and times appear on this page once the organiser starts the tournament.'
                : 'It’s full right now. The organiser will add you if a spot opens up.'}
            </p>
            <button className="btn btn-sm" onClick={() => { setDone(null); setName(''); setEmail(''); }}>Sign up someone else</button>
          </div>
        ) : reg?.open ? (
          <form className="stack" onSubmit={submit}>
            <h2>Sign up</h2>
            {reg.message && <p className="signup-note">{reg.message}</p>}
            <label className="field">
              <span>{t.participantNoun} name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoComplete="off" />
            </label>
            <label className="field">
              <span>Your email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              <small className="muted">Only the organiser sees this.</small>
            </label>
            {error && <p className="error small" role="alert">{error}</p>}
            <button className="btn btn-primary btn-lg" disabled={busy || !name.trim() || !email.trim()}>
              {busy ? 'Signing up…' : entries.length >= cap ? 'Join the waitlist' : 'Sign up'}
            </button>
          </form>
        ) : (
          <div className="stack-sm">
            <h2>Sign-ups are closed</h2>
            <p className="muted">The organiser will publish the fixtures here soon.</p>
          </div>
        )}
      </section>
      <section className="card stack-sm">
        <h3>{entries.length}{Number.isFinite(cap) ? ` / ${cap}` : ''} {noun}s entered{waitlist ? ` · ${waitlist} waiting` : ''}</h3>
        {entries.length === 0 ? <p className="muted small">Be the first!</p> : (
          <ol className="entry-list">{entries.map((p) => <li key={p.id}>{p.name}</li>)}</ol>
        )}
      </section>
    </div>
  );
}
