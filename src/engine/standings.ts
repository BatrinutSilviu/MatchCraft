import type { Match, Participant, Rules, Side, Tiebreaker } from '../types';

export interface Row {
  id: string;
  name: string;
  seed: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  scored: number;
  conceded: number;
  diff: number;
  setsWon: number;
  setsLost: number;
  points: number;
}

function emptyRow(p: Participant): Row {
  return {
    id: p.id, name: p.name, seed: p.seed,
    played: 0, won: 0, drawn: 0, lost: 0,
    scored: 0, conceded: 0, diff: 0, setsWon: 0, setsLost: 0, points: 0,
  };
}

function apply(row: Row, m: Match, side: Side, rules: Rules) {
  const r = m.result!;
  row.played++;
  if (m.bye) {
    row.won++;
    row.points += rules.pointsWin;
    return;
  }
  const other: Side = side === 'home' ? 'away' : 'home';
  if (r.sets) {
    row.setsWon += r[side];
    row.setsLost += r[other];
    for (const s of r.sets) {
      row.scored += s[side];
      row.conceded += s[other];
    }
  } else {
    row.scored += r[side];
    row.conceded += r[other];
  }
  row.diff = row.scored - row.conceded;
  if (r.winner === 'draw') {
    row.drawn++;
    row.points += rules.pointsDraw;
  } else if (r.winner === side) {
    row.won++;
    row.points += rules.pointsWin;
  } else {
    row.lost++;
    row.points += rules.pointsLoss;
  }
}

/** Tally completed matches played between the given participants. */
export function tally(
  participants: Participant[],
  matches: Match[],
  rules: Rules,
): Map<string, Row> {
  const rows = new Map(participants.map((p) => [p.id, emptyRow(p)]));
  for (const m of matches) {
    if (!m.result || m.result.walkover) continue;
    if (m.bye) {
      if (m.home && rows.has(m.home)) apply(rows.get(m.home)!, m, 'home', rules);
      continue;
    }
    if (!m.home || !m.away || !rows.has(m.home) || !rows.has(m.away)) continue;
    apply(rows.get(m.home)!, m, 'home', rules);
    apply(rows.get(m.away)!, m, 'away', rules);
  }
  return rows;
}

function metric(r: Row, c: Exclude<Tiebreaker, 'headToHead'>): number {
  switch (c) {
    case 'points': return r.points;
    case 'diff': return r.diff;
    case 'scored': return r.scored;
    case 'wins': return r.won;
    case 'setDiff': return r.setsWon - r.setsLost;
  }
}

/**
 * Order rows by the tiebreaker list. Whenever a criterion splits a tied block,
 * each smaller block is re-ranked from the top of the list, so head-to-head is
 * evaluated only among the sides that are actually still level.
 */
function split(rows: Row[], criteria: Tiebreaker[], all: Tiebreaker[], matches: Match[], rules: Rules): Row[] {
  if (rows.length <= 1) return rows;
  if (criteria.length === 0) return [...rows].sort((a, b) => a.seed - b.seed);
  const [c, ...rest] = criteria;
  let value: (r: Row) => number;
  if (c === 'headToHead') {
    const mini = tally(rows.map((r) => ({ id: r.id, name: r.name, seed: r.seed })), matches.filter((m) => !m.bye), rules);
    value = (r) => mini.get(r.id)!.points;
  } else {
    value = (r) => metric(r, c);
  }
  const buckets = new Map<number, Row[]>();
  for (const r of rows) {
    const v = value(r);
    if (!buckets.has(v)) buckets.set(v, []);
    buckets.get(v)!.push(r);
  }
  if (buckets.size === 1) return split(rows, rest, all, matches, rules);
  return [...buckets.entries()]
    .sort((a, b) => b[0] - a[0])
    .flatMap(([, block]) => split(block, all, all, matches, rules));
}

export function standings(participants: Participant[], matches: Match[], rules: Rules): Row[] {
  const rows = [...tally(participants, matches, rules).values()];
  const criteria = rules.tiebreakers.length ? rules.tiebreakers : (['points'] as Tiebreaker[]);
  return split(rows, criteria, criteria, matches, rules);
}
