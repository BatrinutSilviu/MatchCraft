import type { Rules, Tiebreaker } from '../types';
import { TIEBREAKER_LABELS } from '../sports';
import { formatMinutes } from '../engine/result';

const LENGTH_PRESETS = [10, 15, 20, 30, 45, 60, 90];

interface Props {
  rules: Rules;
  onChange: (r: Rules) => void;
  /** After matches exist, the scoring structure is fixed; only points and tiebreakers stay editable. */
  locked?: boolean;
}

const ALL_TIEBREAKERS = Object.keys(TIEBREAKER_LABELS) as Tiebreaker[];

export function RulesEditor({ rules, onChange, locked }: Props) {
  const set = <K extends keyof Rules>(key: K, value: Rules[K]) => onChange({ ...rules, [key]: value });
  const numberField = (key: 'pointsWin' | 'pointsDraw' | 'pointsLoss' | 'pointsPerSet' | 'decidingSetPoints' | 'targetScore', label: string, opts: { step?: number; disabled?: boolean; hint?: string } = {}) => (
    <label className="field">
      <span>{label}</span>
      <input
        type="number" step={opts.step ?? 1} min={0} value={rules[key] ?? 0} disabled={opts.disabled}
        onChange={(e) => set(key, Number(e.target.value) || 0)}
      />
      {opts.hint && <small className="muted">{opts.hint}</small>}
    </label>
  );

  const move = (i: number, dir: -1 | 1) => {
    const list = [...rules.tiebreakers];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    set('tiebreakers', list);
  };
  const unused = ALL_TIEBREAKERS.filter((t) => !rules.tiebreakers.includes(t));

  return (
    <div className="stack">
      <fieldset className="card stack" disabled={locked}>
        <legend>How a match is scored</legend>
        {locked && <p className="muted small">Locked once the tournament is created, so existing results stay valid.</p>}
        <div className="segmented">
          <button
            type="button" className={rules.scoringMode === 'score' ? 'active' : ''}
            onClick={() => set('scoringMode', 'score')}
          >
            Single score <small>goals, points, runs…</small>
          </button>
          <button
            type="button" className={rules.scoringMode === 'sets' ? 'active' : ''}
            onClick={() => set('scoringMode', 'sets')}
          >
            Sets / games <small>best of N</small>
          </button>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>Score unit</span>
            <input value={rules.scoreLabel} onChange={(e) => set('scoreLabel', e.target.value)} placeholder="Goals" />
          </label>
          {rules.scoringMode === 'sets' ? (
            <>
              <label className="field">
                <span>Set is called</span>
                <input value={rules.setLabel} onChange={(e) => set('setLabel', e.target.value)} placeholder="Set" />
              </label>
              <label className="field">
                <span>Best of</span>
                <select value={rules.bestOf} onChange={(e) => set('bestOf', Number(e.target.value))}>
                  {[1, 3, 5, 7, 9].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              {numberField('pointsPerSet', `${rules.scoreLabel || 'Points'} to win a ${rules.setLabel.toLowerCase() || 'set'}`, { hint: '0 = no fixed target' })}
              {numberField('decidingSetPoints', `Deciding ${rules.setLabel.toLowerCase() || 'set'} target`, { hint: '0 = same as others' })}
              <label className="field">
                <span>Must win by</span>
                <select value={rules.winBy} onChange={(e) => set('winBy', Number(e.target.value))}>
                  <option value={1}>1 (any lead)</option>
                  <option value={2}>2</option>
                </select>
              </label>
            </>
          ) : (
            <>
            {numberField('targetScore', `${rules.scoreLabel || 'Points'} to win`, { hint: 'First to this wins · 0 = no target' })}
            <label className="field check">
              <input type="checkbox" checked={rules.allowDraws} onChange={(e) => set('allowDraws', e.target.checked)} />
              <span>Draws allowed <small className="muted">(knockout matches always need a winner)</small></span>
            </label>
            </>
          )}
        </div>
      </fieldset>

      <fieldset className="card stack">
        <legend>Match length</legend>
        <p className="muted small">
          How long one match is planned to last. Used to estimate the schedule; it never stops you entering a score.
        </p>
        <div className="row wrap">
          <button type="button" className={`chip ${!rules.matchMinutes ? 'chip-on' : ''}`} onClick={() => set('matchMinutes', 0)}>
            No time limit
          </button>
          {LENGTH_PRESETS.map((m) => (
            <button type="button" key={m} className={`chip ${rules.matchMinutes === m ? 'chip-on' : ''}`} onClick={() => set('matchMinutes', m)}>
              {formatMinutes(m)}
            </button>
          ))}
          <label className="field inline length-custom">
            <input
              type="number" min={0} max={1440} value={rules.matchMinutes || ''} placeholder="Custom"
              aria-label="Match length in minutes"
              onChange={(e) => set('matchMinutes', Math.min(1440, Math.max(0, Math.round(Number(e.target.value) || 0))))}
            />
            <span className="muted small">min</span>
          </label>
        </div>
      </fieldset>

      <fieldset className="card stack">
        <legend>Table points</legend>
        <div className="form-grid three">
          {numberField('pointsWin', 'Win', { step: 0.5 })}
          {numberField('pointsDraw', 'Draw', { step: 0.5, disabled: rules.scoringMode === 'sets' || !rules.allowDraws })}
          {numberField('pointsLoss', 'Loss', { step: 0.5 })}
        </div>
      </fieldset>

      <fieldset className="card stack">
        <legend>Ranking order</legend>
        <p className="muted small">When sides are level, these decide who ranks higher, top to bottom. Seed is the final fallback.</p>
        <ol className="tb-list">
          {rules.tiebreakers.map((tb, i) => (
            <li key={tb}>
              <span className="tb-index">{i + 1}</span>
              <span className="grow">{TIEBREAKER_LABELS[tb]}</span>
              <button type="button" className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
              <button type="button" className="icon-btn" onClick={() => move(i, 1)} disabled={i === rules.tiebreakers.length - 1} aria-label="Move down">↓</button>
              <button type="button" className="icon-btn" onClick={() => set('tiebreakers', rules.tiebreakers.filter((x) => x !== tb))} aria-label="Remove">✕</button>
            </li>
          ))}
        </ol>
        {unused.length > 0 && (
          <div className="row wrap">
            {unused.map((tb) => (
              <button type="button" key={tb} className="chip" onClick={() => set('tiebreakers', [...rules.tiebreakers, tb])}>
                + {TIEBREAKER_LABELS[tb]}
              </button>
            ))}
          </div>
        )}
      </fieldset>
    </div>
  );
}
