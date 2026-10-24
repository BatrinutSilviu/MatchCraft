import { useState } from 'react';
import type { Match, Result, Side, Tournament } from '../types';
import { buildResult, drawsAllowed, scoreWarning, setWarning, type ResultInput } from '../engine/result';
import { describeSource, groupLetter } from '../engine/progress';

interface Props {
  t: Tournament;
  m: Match;
  /** Omit for a read-only card. */
  onSave?: (result: Result | undefined) => void;
  showStage?: boolean;
  defaultOpen?: boolean;
}

function inputFrom(t: Tournament, r: Result | undefined): ResultInput {
  return {
    home: r && !r.sets ? String(r.home) : '',
    away: r && !r.sets ? String(r.away) : '',
    sets: Array.from({ length: t.rules.bestOf }, (_, i) => ({
      home: r?.sets?.[i] ? String(r.sets[i].home) : '',
      away: r?.sets?.[i] ? String(r.sets[i].away) : '',
    })),
    tiebreakWinner: r && !r.sets && r.winner !== 'draw' && r.home === r.away ? r.winner : '',
    decidedBy: r?.decidedBy ?? '',
  };
}

export function MatchCard({ t, m, onSave, showStage, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [input, setInput] = useState<ResultInput>(() => inputFrom(t, m.result));
  const [error, setError] = useState('');

  const name = (id: string | null, side: Side) =>
    id ? t.participants.find((p) => p.id === id)?.name ?? '?' : describeSource(t, side === 'home' ? m.homeSource : m.awaySource);

  const r = m.result;
  const ready = Boolean(m.home && m.away);
  const editable = ready && Boolean(onSave);
  const sideClass = (side: Side) => (!r ? '' : r.winner === side ? 'winner' : r.winner === 'draw' ? '' : 'loser');

  if (m.bye) {
    return (
      <div className="match bye">
        <div className="match-row">
          <span className="team">{name(m.home, 'home')}</span>
          <span className="pill">Bye · +{t.rules.pointsWin} pts</span>
        </div>
      </div>
    );
  }

  const toggle = () => {
    if (!editable) return;
    setInput(inputFrom(t, m.result));
    setError('');
    setOpen(!open);
  };

  const submit = () => {
    const res = buildResult(t.rules, m, input);
    if (typeof res === 'string') {
      setError(res);
      return;
    }
    onSave?.(res);
    setOpen(false);
  };

  const level = t.rules.scoringMode === 'score' && input.home.trim() !== '' && input.home === input.away && !drawsAllowed(t.rules, m);
  const warnings = t.rules.scoringMode === 'sets'
    ? input.sets
      .map((s, i) => (s.home && s.away ? setWarning(t.rules, { home: Number(s.home), away: Number(s.away) }, i) : null))
      .filter(Boolean)
    : [input.home.trim() && input.away.trim() ? scoreWarning(t.rules, Number(input.home), Number(input.away)) : null].filter(Boolean);

  const stageLabel = m.stage === 'group' && m.group !== undefined ? `Group ${groupLetter(m.group)}` : m.roundName;

  return (
    <div className={`match ${open ? 'open' : ''} ${ready ? '' : 'pending'}`}>
      <button type="button" className="match-row" onClick={toggle} disabled={!editable} aria-expanded={open}>
        {showStage && stageLabel && <span className="stage-tag">{stageLabel}</span>}
        <span className={`team home ${sideClass('home')}`}>{name(m.home, 'home')}</span>
        <span className="score">
          {r ? (
            <>
              <b className={sideClass('home')}>{r.home}</b>
              <span className="dash">–</span>
              <b className={sideClass('away')}>{r.away}</b>
            </>
          ) : (
            <span className="vs">{ready ? 'vs' : 'TBD'}</span>
          )}
        </span>
        <span className={`team away ${sideClass('away')}`}>{name(m.away, 'away')}</span>
      </button>
      {r && (r.sets || r.decidedBy || (r.home === r.away && r.winner !== 'draw')) && !open && (
        <div className="match-detail muted small">
          {r.sets?.map((s) => `${s.home}–${s.away}`).join(', ')}
          {r.winner !== 'draw' && r.home === r.away && !r.sets && (
            <>{name(r.winner === 'home' ? m.home : m.away, r.winner)} won{r.decidedBy ? ` on ${r.decidedBy.toLowerCase()}` : ''}</>
          )}
        </div>
      )}

      {open && (
        <div className="editor">
          {t.rules.scoringMode === 'score' ? (
            <div className="score-inputs">
              <input
                type="number" inputMode="decimal" min={0} step="any" aria-label={`${name(m.home, 'home')} ${t.rules.scoreLabel}`}
                value={input.home} autoFocus onChange={(e) => setInput({ ...input, home: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
              />
              <span className="muted">{t.rules.scoreLabel}</span>
              <input
                type="number" inputMode="decimal" min={0} step="any" aria-label={`${name(m.away, 'away')} ${t.rules.scoreLabel}`}
                value={input.away} onChange={(e) => setInput({ ...input, away: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
              />
            </div>
          ) : (
            <div className="sets-table" style={{ gridTemplateColumns: `minmax(0, 1fr) repeat(${t.rules.bestOf}, 3.2rem)` }}>
              <span />
              {input.sets.map((_, i) => <span key={i} className="small muted center">{t.rules.setLabel.slice(0, 1)}{i + 1}</span>)}
              {(['home', 'away'] as Side[]).map((side) => (
                <SetRow key={side} label={name(side === 'home' ? m.home : m.away, side)} side={side} input={input} setInput={setInput} onEnter={submit} />
              ))}
            </div>
          )}

          {level && (
            <div className="tiebreak">
              <span className="small">Level score. Who went through?</span>
              <div className="segmented small-seg">
                {(['home', 'away'] as Side[]).map((side) => (
                  <button key={side} type="button" className={input.tiebreakWinner === side ? 'active' : ''} onClick={() => setInput({ ...input, tiebreakWinner: side })}>
                    {name(side === 'home' ? m.home : m.away, side)}
                  </button>
                ))}
              </div>
              <input placeholder="How? e.g. Penalties, Overtime" value={input.decidedBy} onChange={(e) => setInput({ ...input, decidedBy: e.target.value })} />
            </div>
          )}

          {warnings.map((w) => <p key={w} className="warn small">⚠ {w}</p>)}
          {error && <p className="error small">{error}</p>}

          <div className="row end">
            {r && !r.walkover && (
              <button type="button" className="btn btn-sm btn-ghost danger" onClick={() => { onSave?.(undefined); setOpen(false); }}>
                Clear result
              </button>
            )}
            <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="btn btn-sm btn-primary" onClick={submit}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}

function SetRow({ label, side, input, setInput, onEnter }: {
  label: string; side: Side; input: ResultInput; setInput: (i: ResultInput) => void; onEnter: () => void;
}) {
  return (
    <>
      <span className="set-name">{label}</span>
      {input.sets.map((s, i) => (
        <input
          key={i} type="number" inputMode="numeric" min={0} value={s[side]} autoFocus={side === 'home' && i === 0}
          aria-label={`${label} set ${i + 1}`}
          onChange={(e) => {
            const sets = input.sets.map((x, j) => (j === i ? { ...x, [side]: e.target.value } : x));
            setInput({ ...input, sets });
          }}
          onKeyDown={(e) => e.key === 'Enter' && onEnter()}
        />
      ))}
    </>
  );
}
