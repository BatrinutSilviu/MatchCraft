import type { Match, Participant, Rules } from '../types';
import { standings } from '../engine/standings';

interface Props {
  title?: string;
  participants: Participant[];
  matches: Match[];
  rules: Rules;
  /** Number of top rows to highlight as qualifying. */
  qualify?: number;
}

export function StandingsTable({ title, participants, matches, rules, qualify = 0 }: Props) {
  const rows = standings(participants, matches, rules);
  const sets = rules.scoringMode === 'sets';
  const draws = !sets && rules.allowDraws;
  const abbrev = (rules.scoreLabel || 'Score').slice(0, 1).toUpperCase();

  return (
    <div className="card table-card">
      {title && <h3>{title}</h3>}
      <div className="table-scroll">
        <table className="standings">
          <thead>
            <tr>
              <th className="pos">#</th>
              <th className="name">Name</th>
              <th title="Played">P</th>
              <th title="Won">W</th>
              {draws && <th title="Drawn">D</th>}
              <th title="Lost">L</th>
              {sets && <th title={`${rules.setLabel}s won–lost`}>{rules.setLabel.slice(0, 1)}</th>}
              <th title={`${rules.scoreLabel} for–against`} className="hide-sm">{abbrev}F–{abbrev}A</th>
              <th title="Difference">+/-</th>
              <th title="Points" className="pts">Pts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={i < qualify ? 'qualify' : ''}>
                <td className="pos">{i + 1}</td>
                <td className="name">{r.name}</td>
                <td>{r.played}</td>
                <td>{r.won}</td>
                {draws && <td>{r.drawn}</td>}
                <td>{r.lost}</td>
                {sets && <td>{r.setsWon}–{r.setsLost}</td>}
                <td className="hide-sm">{r.scored}–{r.conceded}</td>
                <td>{r.diff > 0 ? `+${r.diff}` : r.diff}</td>
                <td className="pts">{r.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
