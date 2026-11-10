import type { Match, ScheduleSettings, SlotSource, Tournament } from '../types';
import { isByeMatch } from './progress';

const MIN = 60_000;

/** Bye slots and Swiss byes are never played, so they never get a time. */
const playable = (m: Match) => !isByeMatch(m) && !m.bye;

export function defaultSchedule(t: Tournament, now = Date.now()): ScheduleSettings {
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  return {
    start: start.getTime(),
    courts: ['Court 1', 'Court 2'],
    matchMinutes: t.rules.matchMinutes || 30,
    breakMinutes: 5,
  };
}

/**
 * Gives every playable match a start time and a court.
 *
 * - `mode: 'all'` re-plans every unplayed match; played matches keep their slot.
 * - `mode: 'missing'` keeps every match that already has a slot and only places new ones
 *   (e.g. a freshly paired Swiss round).
 *
 * Matches are placed greedily in fixture order on whichever court frees up first, never before
 * the matches they depend on (bracket feeders, a whole group for group qualifiers) have finished,
 * and never while either side is still playing or changing over.
 */
export function applySchedule(t: Tournament, s: ScheduleSettings, mode: 'all' | 'missing' = 'all'): Tournament {
  const courts = s.courts.map((c) => c.trim()).filter(Boolean);
  if (!courts.length || s.matchMinutes <= 0) return t;
  const length = s.matchMinutes * MIN;
  const gap = Math.max(0, s.breakMinutes) * MIN;

  const keep = (m: Match) => m.startsAt !== undefined && (mode === 'missing' || Boolean(m.result));
  const matches = t.matches.map((m) => {
    if (!playable(m)) {
      const { startsAt: _s, court: _c, ...rest } = m;
      return rest as Match;
    }
    if (keep(m)) return { ...m };
    const { startsAt: _s, court: _c, ...rest } = m;
    return rest as Match;
  });
  const byId = new Map(matches.map((m) => [m.id, m]));

  const courtFree = new Map(courts.map((c) => [c, s.start]));
  const busyUntil = new Map<string, number>();
  const end = (m: Match) => (m.startsAt ?? 0) + length;

  // New matches (e.g. the next Swiss round) only exist once everything before them is over.
  let floor = s.start;
  for (const m of matches) {
    if (m.startsAt === undefined) continue;
    if (mode === 'missing') floor = Math.max(floor, end(m) + gap);
    const court = m.court && courtFree.has(m.court) ? m.court : undefined;
    if (court) courtFree.set(court, Math.max(courtFree.get(court)!, end(m) + gap));
    for (const p of [m.home, m.away]) if (p) busyUntil.set(p, Math.max(busyUntil.get(p) ?? 0, end(m) + gap));
  }

  // When a match can start at the earliest, judged only by what it depends on.
  const readyMemo = new Map<string, number>();
  const finishOf = (id: string): number => {
    const m = byId.get(id);
    if (!m) return s.start;
    if (playable(m)) return m.startsAt !== undefined ? end(m) + gap : m.result ? s.start : Infinity;
    // A bye slot "finishes" as soon as whoever advances through it is known.
    return readyAt(m);
  };
  const sourceReady = (src: SlotSource | undefined): number => {
    if (!src) return s.start;
    switch (src.type) {
      case 'winner':
      case 'loser': return finishOf(src.matchId);
      case 'group': {
        const group = matches.filter((x) => x.stage === 'group' && x.group === src.group);
        return Math.max(s.start, ...group.map((x) => finishOf(x.id)));
      }
      default: return s.start;
    }
  };
  function readyAt(m: Match): number {
    const cached = readyMemo.get(m.id);
    if (cached !== undefined) return cached;
    const ready = Math.max(s.start, sourceReady(m.homeSource), sourceReady(m.awaySource));
    readyMemo.set(m.id, ready);
    return ready;
  }

  for (const m of matches) {
    if (!playable(m) || m.startsAt !== undefined) continue;
    readyMemo.clear();
    let ready = Math.max(floor, readyAt(m));
    if (!Number.isFinite(ready)) continue;
    for (const p of [m.home, m.away]) if (p) ready = Math.max(ready, busyUntil.get(p) ?? 0);

    let best = courts[0];
    let bestStart = Infinity;
    for (const c of courts) {
      const start = Math.max(courtFree.get(c)!, ready);
      if (start < bestStart) {
        best = c;
        bestStart = start;
      }
    }
    m.startsAt = bestStart;
    m.court = best;
    courtFree.set(best, bestStart + length + gap);
    for (const p of [m.home, m.away]) if (p) busyUntil.set(p, bestStart + length + gap);
  }

  return { ...t, schedule: { ...s, courts }, matches };
}

/** Drops every time and court. */
export function clearSchedule(t: Tournament): Tournament {
  const { schedule: _s, ...rest } = t;
  return {
    ...rest,
    matches: t.matches.map((m) => {
      const { startsAt: _a, court: _c, ...x } = m;
      return x as Match;
    }),
  };
}

/** Unplayed scheduled matches with both sides known, soonest first. */
export function upNext(t: Tournament, limit = 6): Match[] {
  return t.matches
    .filter((m) => playable(m) && !m.result && m.startsAt !== undefined && m.home && m.away)
    .sort((a, b) => a.startsAt! - b.startsAt! || (a.court ?? '').localeCompare(b.court ?? ''))
    .slice(0, limit);
}

/** When the last scheduled match ends, or null if nothing is scheduled. */
export function scheduleEnd(t: Tournament): number | null {
  const s = t.schedule;
  const times = t.matches.map((m) => m.startsAt).filter((x): x is number => x !== undefined);
  if (!s || !times.length) return null;
  return Math.max(...times) + s.matchMinutes * MIN;
}

export function formatClock(ms: number, withDay = false): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return withDay ? `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${time}` : time;
}

/** True when scheduled matches fall on more than one calendar day, so times need a date. */
export function spansDays(t: Tournament): boolean {
  const days = new Set(t.matches.filter((m) => m.startsAt !== undefined).map((m) => new Date(m.startsAt!).toDateString()));
  return days.size > 1;
}
