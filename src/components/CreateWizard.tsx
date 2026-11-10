import { useMemo, useState } from 'react';
import type { FormatOptions, Rules, Tournament, TournamentDraft } from '../types';
import { SPORTS, getSport } from '../sports';
import { createTournament, validateDraft } from '../engine/generate';
import { formatMinutes } from '../engine/result';
import { uid } from '../engine/uid';
import { navigate, useStore } from '../store';
import { RulesEditor } from './RulesEditor';
import { ParticipantsEditor } from './ParticipantsEditor';
import { FormatEditor, defaultFormat } from './FormatEditor';

const STEPS = ['Sport', 'Format', 'Participants', 'Rules'] as const;


export function CreateWizard() {
  const { create, setShared, billing, auth } = useStore();
  const [signups, setSignups] = useState(false);
  const [capacity, setCapacity] = useState(16);
  const [signupNote, setSignupNote] = useState('');
  const [step, setStep] = useState(0);
  const [sportId, setSportId] = useState('');
  const [sportName, setSportName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [noun, setNoun] = useState('Team');
  const [name, setName] = useState('');
  const [format, setFormat] = useState<FormatOptions>(defaultFormat('league'));
  const [rules, setRules] = useState<Rules | null>(null);
  const [entries, setEntries] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const names = useMemo(() => entries.map((s) => s.trim()).filter(Boolean), [entries]);

  const pickSport = (id: string) => {
    const s = getSport(id);
    setSportId(id);
    setSportName(id === 'custom' ? '' : s.name);
    setEmoji(s.emoji);
    setNoun(s.participantNoun);
    setRules(structuredClone(s.rules));
    setFormat(defaultFormat(s.suggestedFormat));
    if (!name) setName(id === 'custom' ? '' : `${s.name} Cup`);
    setStep(1);
  };

  const draft = (): TournamentDraft => ({
    id: uid(),
    name: name.trim(),
    sportId,
    sportName: sportName.trim() || 'Custom sport',
    emoji: emoji || '✨',
    participantNoun: noun.trim() || 'Team',
    format,
    rules: rules!,
    participants: names.map((n, i) => ({ id: uid(), name: n, seed: i + 1 })),
  });

  const stepError = (): string => {
    if (step === 1) {
      if (!name.trim()) return 'Give your tournament a name.';
      if (!sportName.trim() && sportId === 'custom') return 'Name your sport.';
    }
    if (step >= 2) {
      if (billing.enabled && !(auth.status === 'in' && auth.user.plan === 'club') && names.length > billing.freeParticipantLimit) {
        return `Free tournaments can have up to ${billing.freeParticipantLimit} entries. Start with fewer, then upgrade the tournament from its Settings tab.`;
      }
      if (!signups) return validateDraft(draft()) ?? '';
      if (new Set(names.map((x) => x.toLowerCase())).size !== names.length) return `Each ${noun.toLowerCase() || 'team'} needs a unique name.`;
    }
    return '';
  };

  const next = async () => {
    const err = stepError();
    setError(err);
    if (err) return;
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      return;
    }
    setCreating(true);
    if (signups) {
      // Fixtures are generated later, once everyone has signed up.
      const now = Date.now();
      const t: Tournament = {
        ...draft(), phase: 'setup', matches: [], createdAt: now, updatedAt: now,
        registration: { open: true, capacity: Math.max(0, capacity), message: signupNote.trim() || undefined },
      };
      if (await create(t)) {
        await setShared(t.id, true);
        navigate(`/t/${t.id}`);
      }
    } else {
      const t = createTournament(draft());
      if (await create(t)) navigate(`/t/${t.id}`);
    }
    setCreating(false);
  };

  const shuffle = () => {
    const list = [...names];
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    setEntries(list);
  };

  const fillSample = () => {
    const count = format.kind === 'single' ? 2 : format.kind === 'groups' ? format.groupCount * 4 : 8;
    setEntries(Array.from({ length: count }, (_, i) => `${noun} ${i + 1}`));
  };

  const n = names.length;

  return (
    <div className="stack-lg wizard">
      <ol className="steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'current' : i < step ? 'done' : ''}>
            <button type="button" disabled={i > step || (i > 0 && !sportId)} onClick={() => { setError(''); setStep(i); }}>
              <span className="step-num">{i < step ? '✓' : i + 1}</span> <span className="step-label">{s}</span>
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section className="stack">
          <h1>What are you playing?</h1>
          <p className="muted">Each sport comes with sensible defaults. You can change every rule later in the setup.</p>
          <div className="sport-grid">
            {SPORTS.map((s) => (
              <button key={s.id} type="button" className={`sport-tile ${sportId === s.id ? 'selected' : ''}`} onClick={() => pickSport(s.id)}>
                <span className="sport-emoji">{s.emoji}</span>
                <span>{s.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="stack">
          <h1>Name & format</h1>
          <div className="card form-grid">
            <label className="field span-2">
              <span>Tournament name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Summer Cup 2026" autoFocus />
            </label>
            <label className="field">
              <span>Sport</span>
              <input value={sportName} onChange={(e) => setSportName(e.target.value)} placeholder="e.g. Kabaddi" />
            </label>
            <label className="field">
              <span>Icon</span>
              <input value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={4} />
            </label>
            <label className="field">
              <span>Competitors are called</span>
              <input value={noun} onChange={(e) => setNoun(e.target.value)} placeholder="Team" list="nouns" />
              <datalist id="nouns">
                {['Team', 'Player', 'Pair', 'Trio', 'Club', 'Crew'].map((x) => <option key={x} value={x} />)}
              </datalist>
            </label>
          </div>

          <FormatEditor format={format} onChange={setFormat} />
        </section>
      )}

      {step === 2 && (
        <section className="stack">
          <h1>{noun || 'Team'}s</h1>
          <p className="muted">
            The order is the seeding: put the strongest first so they meet later. Drag rows or use the arrows to reorder.
            {format.kind === 'single' && ' A single match needs exactly two.'}
          </p>
          <div className={`card stack-sm signup-toggle ${signups ? 'on' : ''}`}>
            <label className="field check">
              <input type="checkbox" checked={signups} onChange={(e) => setSignups(e.target.checked)} />
              <span><strong>Let {(noun || 'team').toLowerCase()}s sign up through a link</strong></span>
            </label>
            <p className="muted small">
              {signups
                ? 'You get a link to send round. Anyone you add below is entered too. Generate the fixtures when you’re ready.'
                : 'Collect entries online instead of typing them all in.'}
            </p>
            {signups && (
              <div className="form-grid">
                <label className="field">
                  <span>Maximum entries</span>
                  <input type="number" min={0} value={capacity} onChange={(e) => setCapacity(Math.max(0, Number(e.target.value) || 0))} />
                  <small className="muted">0 = no limit. Later sign-ups join a waitlist.</small>
                </label>
                <label className="field span-2">
                  <span>Note for players (optional)</span>
                  <input value={signupNote} maxLength={300} onChange={(e) => setSignupNote(e.target.value)} placeholder="e.g. Entry is €10 per team, pay on the day." />
                </label>
              </div>
            )}
          </div>
          <ParticipantsEditor entries={entries} onChange={setEntries} noun={noun || 'Team'} />
          <div className="row wrap">
            <span className="pill">{n} {(noun || 'team').toLowerCase()}{n === 1 ? '' : 's'}</span>
            <button type="button" className="btn btn-sm" onClick={shuffle} disabled={n < 2}>🎲 Shuffle seeding</button>
            <button type="button" className="btn btn-sm" onClick={fillSample}>Fill with placeholders</button>
            {n > 0 && <button type="button" className="btn btn-sm btn-ghost danger" onClick={() => setEntries([])}>Clear all</button>}
          </div>
          <FormatPreview format={format} count={n} minutes={rules?.matchMinutes} />
        </section>
      )}

      {step === 3 && rules && (
        <section className="stack">
          <h1>Rules</h1>
          <p className="muted">Defaults for {sportName || 'your sport'} are filled in. Change anything to match your house rules.</p>
          <RulesEditor rules={rules} onChange={setRules} />
        </section>
      )}

      {error && <p className="error" role="alert">{error}</p>}

      {step > 0 && (
        <div className="wizard-nav">
          <button type="button" className="btn" onClick={() => { setError(''); setStep(step - 1); }}>Back</button>
          <button type="button" className="btn btn-primary" onClick={next} disabled={creating}>
            {step === STEPS.length - 1 ? (signups ? 'Create & open sign-ups' : 'Create tournament') : 'Continue'}
          </button>
        </div>
      )}
    </div>
  );
}

function FormatPreview({ format, count, minutes }: { format: FormatOptions; count: number; minutes?: number }) {
  if (count < 2) return null;
  const rr = (n: number) => (n * (n - 1) / 2) * format.legs;
  let text = '';
  let matches = 0;
  switch (format.kind) {
    case 'single': matches = 1; text = '1 match.'; break;
    case 'league': matches = rr(count); text = `${rr(count)} matches over ${(count % 2 ? count : count - 1) * format.legs} rounds.`; break;
    case 'knockout': {
      let size = 1;
      while (size < count) size *= 2;
      matches = count - 1 + (format.thirdPlace ? 1 : 0);
      text = `${matches} matches, ${Math.log2(size)} rounds${size > count ? `, ${size - count} bye${size - count > 1 ? 's' : ''} for top seeds` : ''}.`;
      break;
    }
    case 'groups': {
      const g = format.groupCount;
      const sizes = Array.from({ length: g }, (_, i) => Math.floor(count / g) + (i < count % g ? 1 : 0));
      const q = g * format.advancePerGroup;
      matches = sizes.reduce((s, n) => s + rr(n), 0) + Math.max(0, q - 1) + (format.thirdPlace ? 1 : 0);
      text = `${g} groups of ${[...new Set(sizes)].join('–')}: ${sizes.reduce((s, n) => s + rr(n), 0)} group matches, then a ${q}-way knockout.`;
      break;
    }
    case 'swiss': matches = format.swissRounds * Math.floor(count / 2); text = `${format.swissRounds} rounds of ${Math.floor(count / 2)} matches${count % 2 ? ' plus a bye' : ''}.`; break;
  }
  const playing = minutes ? ` About ${formatMinutes(matches * minutes)} of playing time on one court.` : '';
  return <p className="preview">📐 {text}{playing}</p>;
}
