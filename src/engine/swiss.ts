import type { Match, Tournament } from '../types';
import { standings } from './standings';
import { uid } from './uid';

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function swissRoundCount(t: Tournament): number {
  return Math.max(0, ...t.matches.map((m) => m.round));
}

export function canAdvanceSwiss(t: Tournament): boolean {
  return t.format.kind === 'swiss' && swissRoundCount(t) < t.format.swissRounds && t.matches.every((m) => m.result);
}

/** Backtracking pairing: highest-ranked unpaired player takes the best opponent they have not met. */
function pairUp(pool: string[], played: Set<string>, budget: { steps: number }): [string, string][] | null {
  if (pool.length === 0) return [];
  if (--budget.steps < 0) return null;
  const [first, ...rest] = pool;
  for (let i = 0; i < rest.length; i++) {
    if (played.has(pairKey(first, rest[i]))) continue;
    const remaining = rest.filter((_, j) => j !== i);
    const tail = pairUp(remaining, played, budget);
    if (tail) return [[first, rest[i]], ...tail];
  }
  return null;
}

export function nextSwissRound(t: Tournament): Match[] {
  const round = swissRoundCount(t) + 1;
  const ranked = standings(t.participants, t.matches, t.rules).map((r) => r.id);
  const played = new Set<string>();
  const hadBye = new Set<string>();
  const homeCount = new Map<string, number>();
  for (const m of t.matches) {
    if (m.bye && m.home) hadBye.add(m.home);
    if (m.home && m.away) {
      played.add(pairKey(m.home, m.away));
      homeCount.set(m.home, (homeCount.get(m.home) ?? 0) + 1);
    }
  }

  const pool = [...ranked];
  const out: Match[] = [];
  if (pool.length % 2) {
    const byeIdx = [...pool].reverse().findIndex((id) => !hadBye.has(id));
    const idx = byeIdx === -1 ? pool.length - 1 : pool.length - 1 - byeIdx;
    const [byeId] = pool.splice(idx, 1);
    out.push({
      id: uid(), stage: 'swiss', round, order: pool.length / 2, home: byeId, away: null,
      bye: true, result: { home: 0, away: 0, winner: 'home' },
    });
  }

  const pairs = pairUp(pool, played, { steps: 50_000 })
    ?? Array.from({ length: pool.length / 2 }, (_, i) => [pool[2 * i], pool[2 * i + 1]] as [string, string]);

  pairs.forEach(([a, b], i) => {
    const [home, away] = (homeCount.get(a) ?? 0) <= (homeCount.get(b) ?? 0) ? [a, b] : [b, a];
    out.push({ id: uid(), stage: 'swiss', round, order: i, home, away });
  });
  return out.sort((a, b) => a.order - b.order);
}
