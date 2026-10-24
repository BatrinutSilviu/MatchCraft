import { useState } from 'react';
import type { Tournament } from '../types';
import { useStore, type Change } from '../store';
import { RulesEditor } from './RulesEditor';
import { Organisers } from './Organisers';

interface Props {
  t: Tournament;
  onUpdate: (change: Change) => Promise<boolean>;
  /** Called after the tournament is deleted or the user leaves it. */
  onLeave: () => void;
}

export function Settings({ t, onUpdate, onLeave }: Props) {
  const { remove } = useStore();
  const [name, setName] = useState(t.name);
  const [names, setNames] = useState(() => Object.fromEntries(t.participants.map((p) => [p.id, p.name])));
  const [confirming, setConfirming] = useState(false);
  const isOwner = t.role !== 'editor';

  const dirty = name !== t.name || t.participants.some((p) => (names[p.id] ?? p.name) !== p.name);

  const saveNames = () => {
    void onUpdate((cur) => ({
      ...cur,
      name: name.trim() || cur.name,
      participants: cur.participants.map((p) => ({ ...p, name: names[p.id]?.trim() || p.name })),
    }));
  };

  const exportJson = () => {
    const { shareId: _s, version: _v, role: _r, ownerName: _o, ...data } = t;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${t.name.replace(/[^\w-]+/g, '-').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="stack-lg settings">
      <Organisers t={t} onLeft={onLeave} />

      <section className="card stack">
        <h3>Names</h3>
        <label className="field">
          <span>Tournament</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="names-grid">
          {[...t.participants].sort((a, b) => a.seed - b.seed).map((p) => (
            <label key={p.id} className="field inline">
              <span className="seed">#{p.seed}</span>
              <input value={names[p.id] ?? p.name} onChange={(e) => setNames({ ...names, [p.id]: e.target.value })} />
            </label>
          ))}
        </div>
        <div className="row end">
          <button className="btn btn-primary btn-sm" disabled={!dirty} onClick={saveNames}>Save names</button>
        </div>
      </section>

      <section className="stack">
        <h3>Rules</h3>
        <RulesEditor rules={t.rules} locked onChange={(rules) => void onUpdate((cur) => ({ ...cur, rules }))} />
      </section>

      <section className="card row wrap between">
        <button className="btn" onClick={exportJson}>⬇ Export JSON</button>
        {isOwner && (confirming ? (
          <div className="row">
            <span className="small">Delete for everyone, for good?</span>
            <button className="btn btn-sm" onClick={() => setConfirming(false)}>Keep</button>
            <button className="btn btn-sm btn-danger" onClick={async () => { await remove(t.id); onLeave(); }}>Delete</button>
          </div>
        ) : (
          <button className="btn btn-ghost danger" onClick={() => setConfirming(true)}>Delete tournament</button>
        ))}
      </section>
    </div>
  );
}
