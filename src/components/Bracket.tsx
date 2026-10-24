import type { Match, Tournament } from '../types';
import { describeSource, isByeMatch } from '../engine/progress';

export function Bracket({ t, onPick }: { t: Tournament; onPick?: (m: Match) => void }) {
  const ko = t.matches.filter((m) => m.stage === 'knockout');
  const main = ko.filter((m) => !m.isThirdPlace);
  const third = ko.find((m) => m.isThirdPlace);
  const rounds = [...new Set(main.map((m) => m.round))].sort((a, b) => a - b);

  return (
    <div className="bracket-wrap">
      <div className="bracket">
        {rounds.map((r) => {
          const ms = main.filter((m) => m.round === r).sort((a, b) => a.order - b.order);
          return (
            <div key={r} className="bracket-round">
              <div className="bracket-title">{ms[0]?.roundName}</div>
              <div className="bracket-matches">
                {ms.map((m) => <BracketMatch key={m.id} t={t} m={m} onPick={onPick} />)}
              </div>
            </div>
          );
        })}
      </div>
      {third && (
        <div className="bracket-third">
          <div className="bracket-title">Third place</div>
          <BracketMatch t={t} m={third} onPick={onPick} />
        </div>
      )}
    </div>
  );
}

function BracketMatch({ t, m, onPick }: { t: Tournament; m: Match; onPick?: (m: Match) => void }) {
  const bye = isByeMatch(m);
  const r = m.result;
  const line = (side: 'home' | 'away') => {
    const id = m[side];
    const label = id ? t.participants.find((p) => p.id === id)?.name : describeSource(t, side === 'home' ? m.homeSource : m.awaySource);
    const state = !r || r.walkover ? (r?.winner === side ? 'winner' : '') : r.winner === side ? 'winner' : 'loser';
    return (
      <div className={`b-line ${state} ${id ? '' : 'tbd'}`}>
        <span className="b-name">{label}</span>
        <span className="b-score">{r && !r.walkover ? r[side] : ''}</span>
      </div>
    );
  };
  const playable = Boolean(m.home && m.away) && !bye && Boolean(onPick);
  return (
    <button type="button" className={`b-match ${bye ? 'is-bye' : ''}`} disabled={!playable} onClick={() => onPick?.(m)}>
      {line('home')}
      {line('away')}
    </button>
  );
}
