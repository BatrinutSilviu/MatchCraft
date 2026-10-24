import { describe, expect, it } from 'vitest';
import type { Match, Participant, Result, Tournament, TournamentDraft } from '../types';
import { getSport } from '../sports';
import { createTournament, groupQualifiers, roundRobin, seedOrder } from './generate';
import { champion, isByeMatch, recompute } from './progress';
import { standings } from './standings';
import { canAdvanceSwiss, nextSwissRound } from './swiss';
import { buildResult, formatMinutes, scoreWarning } from './result';

const people = (n: number): Participant[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, seed: i + 1 }));

function draft(sportId: string, kind: TournamentDraft['format']['kind'], n: number, extra: Partial<TournamentDraft['format']> = {}): TournamentDraft {
  const sport = getSport(sportId);
  return {
    id: 't', name: 'Test', sportId, sportName: sport.name, emoji: sport.emoji, participantNoun: sport.participantNoun,
    rules: sport.rules, participants: people(n),
    format: { kind, legs: 1, groupCount: 2, advancePerGroup: 2, thirdPlace: false, swissRounds: 3, ...extra },
  };
}

function setResult(t: Tournament, id: string, result: Result): Tournament {
  return recompute({ ...t, matches: t.matches.map((m) => (m.id === id ? { ...m, result } : m)) });
}

/** Lower seed number always wins. */
function playAll(t: Tournament, filter: (m: Match) => boolean = () => true): Tournament {
  for (let guard = 0; guard < 100; guard++) {
    const m = t.matches.find((x) => filter(x) && !x.result && x.home && x.away);
    if (!m) return t;
    const seed = (id: string) => t.participants.find((p) => p.id === id)!.seed;
    t = setResult(t, m.id, { home: 2, away: 1, winner: seed(m.home!) < seed(m.away!) ? 'home' : 'away' });
  }
  return t;
}

describe('round robin', () => {
  it('pairs everyone exactly once per leg', () => {
    for (const n of [2, 3, 4, 5, 8, 9]) {
      const rounds = roundRobin(people(n).map((p) => p.id), 1);
      const pairs = rounds.flat().map(([a, b]) => [a, b].sort().join());
      expect(pairs.length).toBe((n * (n - 1)) / 2);
      expect(new Set(pairs).size).toBe(pairs.length);
      for (const r of rounds) {
        const ids = r.flat();
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });
  it('double round robin swaps home and away', () => {
    expect(roundRobin(['a', 'b', 'c', 'd'], 2).flat()).toHaveLength(12);
  });
});

describe('knockout', () => {
  it('uses standard seeding', () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });
  it('gives byes to top seeds and the top seed wins', () => {
    const t = createTournament(draft('tennis', 'knockout', 6, { thirdPlace: true }));
    const byes = t.matches.filter(isByeMatch);
    expect(byes).toHaveLength(2);
    expect(byes.every((m) => m.result?.walkover)).toBe(true);
    expect(new Set(byes.map((m) => m.home))).toEqual(new Set(['p1', 'p2']));
    const done = playAll(t);
    expect(champion(done)).toBe('p1');
    const third = done.matches.find((m) => m.isThirdPlace)!;
    expect(new Set([third.home, third.away])).toEqual(new Set(['p3', 'p4']));
  });
  it('clears downstream results when an earlier result changes', () => {
    let t = playAll(createTournament(draft('tennis', 'knockout', 4)));
    expect(champion(t)).toBe('p1');
    const semi = t.matches.find((m) => m.round === 1 && (m.home === 'p1' || m.away === 'p1'))!;
    t = setResult(t, semi.id, { home: 0, away: 2, winner: semi.home === 'p1' ? 'away' : 'home' });
    const final = t.matches.find((m) => m.roundName === 'Final')!;
    expect(final.result).toBeUndefined();
    expect([final.home, final.away]).toContain('p4');
  });
});

describe('groups + knockout', () => {
  it('avoids same-group first-round matches', () => {
    const entries = groupQualifiers(3, 2);
    const order = seedOrder(8);
    for (let i = 0; i < 8; i += 2) {
      const a = entries[order[i] - 1];
      const b = entries[order[i + 1] - 1];
      if (a?.type === 'group' && b?.type === 'group') expect(a.group).not.toBe(b.group);
    }
  });
  it('fills the bracket once groups finish', () => {
    let t = createTournament(draft('football', 'groups', 8));
    expect(t.groups!.map((g) => g.length)).toEqual([4, 4]);
    const ko = () => t.matches.filter((m) => m.stage === 'knockout' && m.round === 1);
    expect(ko().every((m) => !m.home && !m.away)).toBe(true);
    t = playAll(t, (m) => m.stage === 'group');
    expect(ko().every((m) => m.home && m.away)).toBe(true);
    t = playAll(t);
    expect(champion(t)).toBe('p1');
  });
});

describe('standings', () => {
  it('applies head-to-head among tied sides', () => {
    const d = draft('football', 'league', 3);
    let t = createTournament(d);
    const find = (a: string, b: string) => t.matches.find((m) => [m.home, m.away].sort().join() === [a, b].sort().join())!;
    const res = (m: Match, winner: string, hs: number, as: number): Result =>
      ({ home: m.home === winner ? hs : as, away: m.home === winner ? as : hs, winner: m.home === winner ? 'home' : 'away' });
    // Everyone wins once; p3 has the best goal difference, but tiebreakers are points then h2h (cycle) then diff.
    t = setResult(t, find('p1', 'p2').id, res(find('p1', 'p2'), 'p1', 1, 0));
    t = setResult(t, find('p2', 'p3').id, res(find('p2', 'p3'), 'p2', 1, 0));
    t = setResult(t, find('p1', 'p3').id, res(find('p1', 'p3'), 'p3', 5, 0));
    expect(standings(t.participants, t.matches, t.rules).map((r) => r.id)).toEqual(['p3', 'p2', 'p1']);
  });
});

describe('results', () => {
  const m = { stage: 'knockout' } as Match;
  it('validates sets', () => {
    const rules = getSport('volleyball').rules;
    const sets = (pairs: [string, string][]) => ({ home: '', away: '', tiebreakWinner: '' as const, decidedBy: '', sets: pairs.map(([home, away]) => ({ home, away })) });
    expect(buildResult(rules, m, sets([['25', '20'], ['25', '20'], ['25', '20']]))).toMatchObject({ home: 3, away: 0, winner: 'home' });
    expect(typeof buildResult(rules, m, sets([['25', '20'], ['25', '20']]))).toBe('string');
    expect(typeof buildResult(rules, m, sets([['25', '20'], ['25', '20'], ['25', '20'], ['20', '25']]))).toBe('string');
  });
  it('needs a tiebreak winner for level knockout scores', () => {
    const rules = getSport('football').rules;
    const input = { home: '1', away: '1', sets: [], tiebreakWinner: '' as const, decidedBy: '' };
    expect(typeof buildResult(rules, m, input)).toBe('string');
    expect(buildResult(rules, m, { ...input, tiebreakWinner: 'away', decidedBy: 'Penalties' })).toMatchObject({ winner: 'away', decidedBy: 'Penalties' });
    expect(buildResult(rules, { stage: 'league' } as Match, input)).toMatchObject({ winner: 'draw' });
  });
  it('hints when a first-to target score is missed or passed by both sides', () => {
    const rules = { ...getSport('custom').rules, targetScore: 21 };
    expect(scoreWarning(rules, 21, 15)).toBeNull();
    expect(scoreWarning(rules, 18, 15)).toMatch(/reaches 21/);
    expect(scoreWarning(rules, 23, 21)).toMatch(/Both sides passed 21/);
    expect(scoreWarning({ ...rules, targetScore: 0 }, 3, 1)).toBeNull();
    expect(scoreWarning({ ...rules, targetScore: undefined }, 3, 1)).toBeNull();
  });
  it('formats match lengths', () => {
    expect(formatMinutes(0)).toBe('');
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(90)).toBe('1 h 30 min');
    expect(formatMinutes(120)).toBe('2 h');
  });
});

describe('swiss', () => {
  it('runs all rounds without rematches and rotates byes', () => {
    let t = createTournament(draft('chess', 'swiss', 7, { swissRounds: 5 }));
    while (true) {
      t = playAll(t);
      if (!canAdvanceSwiss(t)) break;
      t = recompute({ ...t, matches: [...t.matches, ...nextSwissRound(t)] });
    }
    const pairs = t.matches.filter((m) => m.away).map((m) => [m.home, m.away].sort().join());
    expect(new Set(pairs).size).toBe(pairs.length);
    const byes = t.matches.filter((m) => m.bye).map((m) => m.home);
    expect(byes).toHaveLength(5);
    expect(new Set(byes).size).toBe(5);
    expect(champion(t)).toBe('p1');
  });
});
