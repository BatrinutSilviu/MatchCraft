import type { Match, Participant, SlotSource, Tournament, TournamentDraft } from '../types';
import { uid } from './uid';
import { recompute } from './progress';

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** Standard bracket order so seeds 1 and 2 can only meet in the final: [1, 8, 4, 5, 2, 7, 3, 6]. */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

/** Circle-method round robin. Returns rounds of [home, away] pairs. */
export function roundRobin(ids: string[], legs: 1 | 2): [string, string][][] {
  const BYE = '__bye__';
  const list = [...ids];
  if (list.length % 2) list.push(BYE);
  const n = list.length;
  const rounds: [string, string][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i];
      const b = list[n - 1 - i];
      if (a === BYE || b === BYE) continue;
      // Alternate the fixed participant's home/away so nobody is always at home.
      pairs.push(i === 0 && r % 2 === 1 ? [b, a] : [a, b]);
    }
    rounds.push(pairs);
    list.splice(1, 0, list.pop()!);
  }
  if (legs === 2) {
    const second = rounds.map((pairs) => pairs.map(([a, b]) => [b, a] as [string, string]));
    rounds.push(...second);
  }
  return rounds;
}

export function roundName(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semi-finals';
  if (fromEnd === 2) return 'Quarter-finals';
  return `Round of ${2 ** (fromEnd + 1)}`;
}

/** Build a single-elimination bracket from seeded entries (index 0 = top seed). */
export function buildKnockout(entries: SlotSource[], thirdPlace: boolean): Match[] {
  const size = nextPow2(Math.max(2, entries.length));
  const order = seedOrder(size);
  const totalRounds = Math.log2(size);
  const all: Match[] = [];
  let prev: Match[] = [];
  for (let r = 1; r <= totalRounds; r++) {
    const count = size / 2 ** r;
    const cur: Match[] = [];
    for (let i = 0; i < count; i++) {
      const homeSource: SlotSource = r === 1
        ? entries[order[2 * i] - 1] ?? { type: 'bye' }
        : { type: 'winner', matchId: prev[2 * i].id };
      const awaySource: SlotSource = r === 1
        ? entries[order[2 * i + 1] - 1] ?? { type: 'bye' }
        : { type: 'winner', matchId: prev[2 * i + 1].id };
      cur.push({
        id: uid(), stage: 'knockout', round: r, roundName: roundName(r, totalRounds), order: i,
        home: null, away: null, homeSource, awaySource,
      });
    }
    all.push(...cur);
    if (r === totalRounds && thirdPlace && prev.length === 2) {
      all.push({
        id: uid(), stage: 'knockout', round: r, roundName: 'Third place', order: 1, isThirdPlace: true,
        home: null, away: null,
        homeSource: { type: 'loser', matchId: prev[0].id },
        awaySource: { type: 'loser', matchId: prev[1].id },
      });
    }
    prev = cur;
  }
  return all;
}

/** Snake-distribute seeded participants into groups so each group gets a fair mix. */
export function distributeGroups(participants: Participant[], groupCount: number): string[][] {
  const groups: string[][] = Array.from({ length: groupCount }, () => []);
  [...participants].sort((a, b) => a.seed - b.seed).forEach((p, i) => {
    const row = Math.floor(i / groupCount);
    const col = i % groupCount;
    groups[row % 2 === 0 ? col : groupCount - 1 - col].push(p.id);
  });
  return groups;
}

/**
 * Qualifier entries for the knockout stage: all group winners, then all runners-up, etc.
 * Then swap entries so no first-round match is a rematch from the same group where avoidable.
 */
export function groupQualifiers(groupCount: number, advance: number): SlotSource[] {
  const entries: SlotSource[] = [];
  for (let pos = 1; pos <= advance; pos++) {
    for (let g = 0; g < groupCount; g++) entries.push({ type: 'group', group: g, position: pos });
  }
  const size = nextPow2(entries.length);
  const order = seedOrder(size);
  const pairs: [number, number][] = [];
  for (let i = 0; i < size; i += 2) pairs.push([order[i] - 1, order[i + 1] - 1]);

  const groupOf = (idx: number) => {
    const e = entries[idx];
    return e && e.type === 'group' ? e.group : -1;
  };
  const clash = ([a, b]: [number, number]) => groupOf(a) !== -1 && groupOf(a) === groupOf(b);

  for (const pair of pairs) {
    if (!clash(pair)) continue;
    const lower = Math.max(pair[0], pair[1]);
    const lowerPos = (entries[lower] as { position: number }).position;
    for (const other of pairs) {
      if (other === pair) continue;
      const candidate = Math.max(other[0], other[1]);
      const e = entries[candidate];
      if (!e || e.type !== 'group' || e.position !== lowerPos) continue;
      [entries[lower], entries[candidate]] = [entries[candidate], entries[lower]];
      if (!clash(pair) && !clash(other)) break;
      [entries[lower], entries[candidate]] = [entries[candidate], entries[lower]];
    }
  }
  return entries;
}

export function swissFirstRound(participants: Participant[]): Match[] {
  const sorted = [...participants].sort((a, b) => a.seed - b.seed);
  const matches: Match[] = [];
  if (sorted.length % 2) {
    const byePlayer = sorted.pop()!;
    matches.push({
      id: uid(), stage: 'swiss', round: 1, order: sorted.length / 2, home: byePlayer.id, away: null,
      bye: true, result: { home: 0, away: 0, winner: 'home', walkover: false },
    });
  }
  const half = sorted.length / 2;
  for (let i = 0; i < half; i++) {
    const [home, away] = i % 2 === 0 ? [sorted[i], sorted[i + half]] : [sorted[i + half], sorted[i]];
    matches.push({ id: uid(), stage: 'swiss', round: 1, order: i, home: home.id, away: away.id });
  }
  return matches.sort((a, b) => a.order - b.order);
}

export function validateDraft(d: TournamentDraft): string | null {
  const n = d.participants.length;
  const noun = d.participantNoun.toLowerCase();
  if (!d.name.trim()) return 'Give your tournament a name.';
  if (new Set(d.participants.map((p) => p.name.trim().toLowerCase())).size !== n) return `Each ${noun} needs a unique name.`;
  switch (d.format.kind) {
    case 'single':
      return n === 2 ? null : `A single match needs exactly 2 ${noun}s (you have ${n}).`;
    case 'league':
    case 'knockout':
      return n >= 2 ? null : `Add at least 2 ${noun}s.`;
    case 'swiss':
      if (n < 3) return `Swiss needs at least 3 ${noun}s.`;
      return d.format.swissRounds >= 1 && d.format.swissRounds < n ? null : `Swiss rounds must be between 1 and ${n - 1}.`;
    case 'groups': {
      const { groupCount, advancePerGroup } = d.format;
      if (groupCount < 1) return 'Use at least 1 group.';
      if (n < groupCount * 2) return `${groupCount} groups need at least ${groupCount * 2} ${noun}s.`;
      const smallest = Math.floor(n / groupCount);
      if (advancePerGroup < 1 || advancePerGroup > smallest) return `Between 1 and ${smallest} can advance from each group.`;
      if (groupCount * advancePerGroup < 2) return 'At least 2 must advance to the knockout stage.';
      return null;
    }
  }
}

export function createTournament(d: TournamentDraft): Tournament {
  const now = Date.now();
  const ids = [...d.participants].sort((a, b) => a.seed - b.seed).map((p) => p.id);
  let matches: Match[] = [];
  let groups: string[][] | undefined;

  switch (d.format.kind) {
    case 'single':
      matches = [{ id: uid(), stage: 'single', round: 1, order: 0, home: ids[0], away: ids[1] }];
      break;
    case 'league':
      matches = roundRobin(ids, d.format.legs).flatMap((pairs, r) =>
        pairs.map(([home, away], i) => ({ id: uid(), stage: 'league' as const, round: r + 1, order: i, home, away })),
      );
      break;
    case 'knockout':
      matches = buildKnockout(ids.map((id) => ({ type: 'participant', id })), d.format.thirdPlace);
      break;
    case 'groups': {
      groups = distributeGroups(d.participants, d.format.groupCount);
      const groupMatches = groups.flatMap((g, gi) =>
        roundRobin(g, d.format.legs).flatMap((pairs, r) =>
          pairs.map(([home, away], i) => ({
            id: uid(), stage: 'group' as const, group: gi, round: r + 1, order: i, home, away,
          })),
        ),
      );
      groupMatches.sort((a, b) => a.round - b.round || a.group - b.group || a.order - b.order);
      const ko = buildKnockout(groupQualifiers(d.format.groupCount, d.format.advancePerGroup), d.format.thirdPlace);
      matches = [...groupMatches, ...ko];
      break;
    }
    case 'swiss':
      matches = swissFirstRound(d.participants);
      break;
  }

  return recompute({ ...d, groups, matches, createdAt: now, updatedAt: now });
}
