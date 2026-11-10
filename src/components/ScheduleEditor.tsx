import { useState } from 'react';
import type { ScheduleSettings, Tournament } from '../types';
import type { Change } from '../store';
import { applySchedule, clearSchedule, defaultSchedule, formatClock, scheduleEnd } from '../engine/schedule';

const LABELS = ['Court', 'Pitch', 'Field', 'Table', 'Board', 'Lane', 'Ring', 'Mat', 'Station'];

/** "Court 1".."Court n", unless the organiser typed their own names. */
function courtNames(label: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${label.trim() || 'Court'} ${i + 1}`);
}

function splitCourts(courts: string[]): { label: string; count: number; custom: string } {
  const m = courts[0]?.match(/^(.*) 1$/);
  const label = m?.[1] ?? 'Court';
  const generated = courtNames(label, courts.length);
  const isGenerated = courts.every((c, i) => c === generated[i]);
  return { label, count: courts.length, custom: isGenerated ? '' : courts.join(', ') };
}

/** Local "YYYY-MM-DDTHH:MM" for <input type="datetime-local">. */
const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function ScheduleEditor({ t, onUpdate }: { t: Tournament; onUpdate: (c: Change) => Promise<boolean> }) {
  const initial = t.schedule ?? defaultSchedule(t);
  const split = splitCourts(initial.courts);
  const [start, setStart] = useState(toLocalInput(initial.start));
  const [label, setLabel] = useState(split.label);
  const [count, setCount] = useState(split.count);
  const [custom, setCustom] = useState(split.custom);
  const [minutes, setMinutes] = useState(initial.matchMinutes);
  const [gap, setGap] = useState(initial.breakMinutes);
  const [error, setError] = useState('');
  const setup = t.phase === 'setup';
  const played = t.matches.some((m) => m.result && !m.bye);

  const settings = (): ScheduleSettings | null => {
    const startMs = new Date(start).getTime();
    if (Number.isNaN(startMs)) return setError('Pick a start date and time.'), null;
    const courts = custom.trim() ? custom.split(/[,\n]/).map((c) => c.trim()).filter(Boolean) : courtNames(label, count);
    if (!courts.length) return setError('Add at least one court.'), null;
    if (new Set(courts).size !== courts.length) return setError('Each court needs a different name.'), null;
    if (minutes < 1) return setError('Matches need a length.'), null;
    setError('');
    return { start: startMs, courts, matchMinutes: minutes, breakMinutes: Math.max(0, gap) };
  };

  const generate = () => {
    const s = settings();
    if (!s) return;
    void onUpdate((cur) => (cur.phase === 'setup' ? { ...cur, schedule: s } : applySchedule(cur, s)));
  };
  const end = scheduleEnd(t);

  return (
    <section className="card stack">
      <div>
        <h3>Schedule</h3>
        <p className="muted small">
          {setup
            ? 'Times and courts are assigned when you generate the fixtures.'
            : 'Every match gets a time and a place. Knockout matches wait for the matches that feed them; nobody plays twice at once.'}
        </p>
      </div>
      <div className="form-grid">
        <label className="field">
          <span>First match</span>
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="field">
          <span>Played on</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} list="court-labels" disabled={Boolean(custom.trim())} />
          <datalist id="court-labels">{LABELS.map((l) => <option key={l} value={l} />)}</datalist>
        </label>
        <label className="field">
          <span>How many at once</span>
          <input type="number" min={1} max={64} value={count} disabled={Boolean(custom.trim())} onChange={(e) => setCount(Math.min(64, Math.max(1, Number(e.target.value) || 1)))} />
        </label>
        <label className="field">
          <span>Minutes per match</span>
          <input type="number" min={1} value={minutes} onChange={(e) => setMinutes(Math.max(1, Number(e.target.value) || 1))} />
        </label>
        <label className="field">
          <span>Changeover (min)</span>
          <input type="number" min={0} value={gap} onChange={(e) => setGap(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <label className="field span-2">
          <span>Or name them yourself (optional)</span>
          <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Centre Court, Court 2, Back pitch" />
        </label>
      </div>
      {error && <p className="error small">{error}</p>}
      {end && !setup && <p className="muted small">Last match ends around {formatClock(end, true)}.</p>}
      <div className="row end wrap">
        {t.schedule && (
          <button className="btn btn-sm btn-ghost danger" onClick={() => void onUpdate(clearSchedule)}>Remove schedule</button>
        )}
        <button className="btn btn-primary btn-sm" onClick={generate}>
          {setup ? 'Save' : t.schedule ? (played ? 'Re-plan unplayed matches' : 'Re-plan schedule') : 'Create schedule'}
        </button>
      </div>
    </section>
  );
}
