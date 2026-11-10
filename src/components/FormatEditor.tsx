import type { FormatKind, FormatOptions } from '../types';
import { FORMAT_INFO } from '../sports';

export const defaultFormat = (kind: FormatKind): FormatOptions => ({
  kind, legs: 1, groupCount: 2, advancePerGroup: 2, thirdPlace: false, swissRounds: 5,
});

/** Format tiles plus the options that belong to the chosen format. */
export function FormatEditor({ format, onChange }: { format: FormatOptions; onChange: (f: FormatOptions) => void }) {
  const setF = <K extends keyof FormatOptions>(k: K, v: FormatOptions[K]) => onChange({ ...format, [k]: v });
  return (
    <>
      <div className="format-grid">
        {(Object.keys(FORMAT_INFO) as FormatKind[]).map((k) => (
          <button key={k} type="button" className={`format-tile ${format.kind === k ? 'selected' : ''}`} onClick={() => setF('kind', k)}>
            <span className="format-icon">{FORMAT_INFO[k].icon}</span>
            <strong>{FORMAT_INFO[k].name}</strong>
            <small className="muted">{FORMAT_INFO[k].blurb}</small>
          </button>
        ))}
      </div>

      {format.kind !== 'single' && (
        <div className="card form-grid">
          {(format.kind === 'league' || format.kind === 'groups') && (
            <label className="field">
              <span>Each pair plays</span>
              <select value={format.legs} onChange={(e) => setF('legs', Number(e.target.value) as 1 | 2)}>
                <option value={1}>Once</option>
                <option value={2}>Twice (home & away)</option>
              </select>
            </label>
          )}
          {format.kind === 'groups' && (
            <>
              <label className="field">
                <span>Groups</span>
                <input type="number" min={1} max={16} value={format.groupCount} onChange={(e) => setF('groupCount', Math.max(1, Number(e.target.value) || 1))} />
              </label>
              <label className="field">
                <span>Advance per group</span>
                <input type="number" min={1} value={format.advancePerGroup} onChange={(e) => setF('advancePerGroup', Math.max(1, Number(e.target.value) || 1))} />
              </label>
            </>
          )}
          {(format.kind === 'knockout' || format.kind === 'groups') && (
            <label className="field check">
              <input type="checkbox" checked={format.thirdPlace} onChange={(e) => setF('thirdPlace', e.target.checked)} />
              <span>Play a third-place match</span>
            </label>
          )}
          {format.kind === 'swiss' && (
            <label className="field">
              <span>Rounds</span>
              <input type="number" min={1} value={format.swissRounds} onChange={(e) => setF('swissRounds', Math.max(1, Number(e.target.value) || 1))} />
            </label>
          )}
        </div>
      )}
    </>
  );
}
