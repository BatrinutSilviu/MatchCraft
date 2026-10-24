import type { Match, Participant, SlotSource, Tournament } from '../types';
import { standings } from './standings';

export function winnerId(m: Match | undefined): string | null {
  if (!m?.result) return null;
  if (m.result.winner === 'home') return m.home;
  if (m.result.winner === 'away') return m.away;
  return null;
}

export function loserId(m: Match | undefined): string | null {
  if (!m?.result || m.result.walkover) return null;
  if (m.result.winner === 'home') return m.away;
  if (m.result.winner === 'away') return m.home;
  return null;
}

export function groupLetter(g: number): string {
  return String.fromCharCode(65 + g);
}

export function groupParticipants(t: Tournament, g: number): Participant[] {
  const ids = new Set(t.groups?.[g] ?? []);
  return t.participants.filter((p) => ids.has(p.id));
}

export function groupMatches(t: Tournament, g: number): Match[] {
  return t.matches.filter((m) => m.stage === 'group' && m.group === g);
}

export function isGroupComplete(t: Tournament, g: number): boolean {
  const ms = groupMatches(t, g);
  return ms.length > 0 && ms.every((m) => m.result);
}

/**
 * Re-derive every bracket slot from its source (seed, earlier match, or group finish).
 * Results whose participants changed are cleared, and byes are advanced automatically.
 * Called after every edit, so correcting an early result safely ripples through the bracket.
 */
export function recompute(t: Tournament): Tournament {
  const matches = t.matches.map((m) => ({ ...m }));
  const byId = new Map(matches.map((m) => [m.id, m]));
  const groupTables = new Map<number, string[] | null>();

  const groupPosition = (g: number, position: number): string | null => {
    if (!groupTables.has(g)) {
      const draft = { ...t, matches };
      groupTables.set(
        g,
        isGroupComplete(draft, g)
          ? standings(groupParticipants(draft, g), groupMatches(draft, g), t.rules).map((r) => r.id)
          : null,
      );
    }
    return groupTables.get(g)?.[position - 1] ?? null;
  };

  const resolve = (s: SlotSource): string | null => {
    switch (s.type) {
      case 'participant': return s.id;
      case 'winner': return winnerId(byId.get(s.matchId));
      case 'loser': return loserId(byId.get(s.matchId));
      case 'group': return groupPosition(s.group, s.position);
      case 'bye': return null;
    }
  };

  for (const m of matches) {
    if (!m.homeSource || !m.awaySource) continue;
    const home = resolve(m.homeSource);
    const away = resolve(m.awaySource);
    if (home !== m.home || away !== m.away) {
      m.home = home;
      m.away = away;
      delete m.result;
    }
    const homeBye = m.homeSource.type === 'bye';
    const awayBye = m.awaySource.type === 'bye';
    if (homeBye !== awayBye) {
      const advancing = homeBye ? away : home;
      if (advancing) {
        m.result = { home: 0, away: 0, winner: homeBye ? 'away' : 'home', walkover: true };
      } else {
        delete m.result;
      }
    }
  }
  return { ...t, matches };
}

export function isByeMatch(m: Match): boolean {
  return m.homeSource?.type === 'bye' || m.awaySource?.type === 'bye';
}

export function describeSource(t: Tournament, s: SlotSource | undefined): string {
  if (!s) return 'TBD';
  switch (s.type) {
    case 'participant': return t.participants.find((p) => p.id === s.id)?.name ?? 'TBD';
    case 'bye': return 'Bye';
    case 'group': return `${ordinal(s.position)} Group ${groupLetter(s.group)}`;
    case 'winner':
    case 'loser': {
      const m = t.matches.find((x) => x.id === s.matchId);
      if (!m) return 'TBD';
      return `${s.type === 'winner' ? 'Winner' : 'Loser'} ${shortRound(m)}`;
    }
  }
}

function shortRound(m: Match): string {
  const name = m.roundName ?? `Round ${m.round}`;
  const abbrev = name === 'Semi-finals' ? 'SF' : name === 'Quarter-finals' ? 'QF' : name.replace('Round of ', 'R');
  return `${abbrev}${m.order + 1}`;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function champion(t: Tournament): string | null {
  switch (t.format.kind) {
    case 'single':
      return winnerId(t.matches[0]);
    case 'knockout':
    case 'groups': {
      const final = t.matches.find((m) => m.stage === 'knockout' && m.roundName === 'Final');
      return winnerId(final);
    }
    case 'league':
      return t.matches.every((m) => m.result) ? standings(t.participants, t.matches, t.rules)[0]?.id ?? null : null;
    case 'swiss': {
      const rounds = Math.max(0, ...t.matches.map((m) => m.round));
      return rounds >= t.format.swissRounds && t.matches.every((m) => m.result)
        ? standings(t.participants, t.matches, t.rules)[0]?.id ?? null
        : null;
    }
  }
}

export function progress(t: Tournament): { done: number; total: number } {
  const real = t.matches.filter((m) => !isByeMatch(m) && !m.bye);
  return { done: real.filter((m) => m.result).length, total: real.length };
}
