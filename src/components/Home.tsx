import { useRef, useState } from 'react';
import { LEGACY_KEY, navigate, useStore } from '../store';
import { FORMAT_INFO } from '../sports';
import { champion, progress } from '../engine/progress';
import { uid } from '../engine/uid';
import type { Tournament } from '../types';

function readLegacy(): Tournament[] {
  try {
    return JSON.parse(localStorage.getItem(LEGACY_KEY) ?? '[]') as Tournament[];
  } catch {
    return [];
  }
}

const isTournament = (t: Partial<Tournament> | null): t is Tournament =>
  Boolean(t && t.matches && t.participants && t.rules && t.format);

export function Home() {
  const { auth, tournaments, loaded, create } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [legacy, setLegacy] = useState(readLegacy);
  const [importing, setImporting] = useState(false);
  const firstName = auth.status === 'in' ? auth.user.name.split(' ')[0] : '';

  const importFile = async (file: File) => {
    try {
      const t = JSON.parse(await file.text());
      if (!isTournament(t)) throw new Error('bad file');
      const id = uid();
      if (await create({ ...t, id, shareId: undefined, version: undefined, role: undefined, ownerName: undefined })) navigate(`/t/${id}`);
      setError('');
    } catch {
      setError('That file isn’t a Matchcraft tournament export.');
    }
  };

  const importLegacy = async () => {
    setImporting(true);
    for (const t of legacy.filter(isTournament)) {
      if (!(await create({ ...t, id: uid() }))) {
        setImporting(false);
        return;
      }
    }
    localStorage.removeItem(LEGACY_KEY);
    setLegacy([]);
    setImporting(false);
  };

  return (
    <div className="stack-lg">
      <div className="row wrap between">
        <h1>Hi {firstName} 👋</h1>
        <button className="btn btn-sm btn-ghost" onClick={() => fileRef.current?.click()}>Import file</button>
        <input
          ref={fileRef} type="file" accept="application/json" hidden
          onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])}
        />
      </div>
      {error && <p className="error">{error}</p>}

      {legacy.length > 0 && (
        <div className="card banner">
          <span>
            Found {legacy.length} tournament{legacy.length > 1 ? 's' : ''} saved in this browser before you had an account.
          </span>
          <div className="row">
            <button className="btn btn-sm btn-ghost" onClick={() => { localStorage.removeItem(LEGACY_KEY); setLegacy([]); }}>
              Dismiss
            </button>
            <button className="btn btn-sm btn-primary" disabled={importing} onClick={importLegacy}>
              {importing ? 'Importing…' : 'Add to my account'}
            </button>
          </div>
        </div>
      )}

      {!loaded ? (
        <div className="loading" aria-label="Loading" />
      ) : tournaments.length === 0 ? (
        <a href="#/new" className="card empty start-card">
          <span className="start-plus">+</span>
          <strong>Create your first tournament</strong>
          <span className="muted small">Pick a sport, add who’s playing, and you’re ready.</span>
        </a>
      ) : (
        <div className="grid-cards">
          <a href="#/new" className="card t-card new-card">
            <span className="start-plus">+</span>
            <strong>New tournament</strong>
          </a>
          {tournaments.map((t) => {
            const { done, total } = progress(t);
            const champ = champion(t);
            const champName = champ && t.participants.find((p) => p.id === champ)?.name;
            return (
              <a key={t.id} href={`#/t/${t.id}`} className="card t-card">
                <div className="t-card-head">
                  <span className="t-emoji">{t.emoji}</span>
                  <div>
                    <div className="t-name">{t.name}</div>
                    <div className="muted small">
                      {t.sportName} · {FORMAT_INFO[t.format.kind].name} · {t.participants.length} {t.participantNoun.toLowerCase()}s
                    </div>
                  </div>
                </div>
                {t.role === 'editor' && <div className="pill">👥 Co-organising with {t.ownerName}</div>}
                {champName ? (
                  <div className="pill pill-win">🏆 {champName}</div>
                ) : (
                  <div className="progress">
                    <div className="progress-bar" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
                    <span className="small muted">{done}/{total} matches played{t.shareId ? ' · 🔗 Shared' : ''}</span>
                  </div>
                )}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
