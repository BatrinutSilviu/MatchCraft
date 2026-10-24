import type { Match, Result, Rules, SetScore, Side } from '../types';

export function setsToWin(rules: Rules): number {
  return Math.floor(rules.bestOf / 2) + 1;
}

export function drawsAllowed(rules: Rules, m: Match): boolean {
  return rules.allowDraws && m.stage !== 'knockout';
}

export interface ResultInput {
  home: string;
  away: string;
  sets: { home: string; away: string }[];
  tiebreakWinner: Side | '';
  decidedBy: string;
}

const num = (s: string) => (s.trim() === '' ? NaN : Number(s));

/** Soft check of a set score against the configured target; returns a hint, never blocks saving. */
export function setWarning(rules: Rules, s: SetScore, index: number): string | null {
  const target = index === rules.bestOf - 1 && rules.decidingSetPoints ? rules.decidingSetPoints : rules.pointsPerSet;
  if (!target) return null;
  const hi = Math.max(s.home, s.away);
  const lo = Math.min(s.home, s.away);
  if (hi < target) return `${rules.setLabel} ${index + 1}: winner usually reaches ${target}.`;
  if (hi - lo < rules.winBy && rules.winBy > 1 && hi <= target + 10) {
    return `${rules.setLabel} ${index + 1}: usually needs a ${rules.winBy}-point lead.`;
  }
  return null;
}

/** Soft check of a single-score result against the "first to N" target; returns a hint, never blocks saving. */
export function scoreWarning(rules: Rules, home: number, away: number): string | null {
  const target = rules.targetScore ?? 0;
  if (rules.scoringMode !== 'score' || !target || home === away) return null;
  const hi = Math.max(home, away);
  const lo = Math.min(home, away);
  if (hi < target) return `The winner usually reaches ${target} ${rules.scoreLabel.toLowerCase()}.`;
  if (lo >= target) return `Both sides passed ${target}. Check the score.`;
  return null;
}

/** "45 min", "1 h 30 min"; empty when the match is untimed. */
export function formatMinutes(minutes: number | undefined): string {
  if (!minutes) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}

export function buildResult(rules: Rules, m: Match, input: ResultInput): Result | string {
  if (rules.scoringMode === 'sets') {
    const sets: SetScore[] = [];
    for (const [i, s] of input.sets.entries()) {
      const h = num(s.home);
      const a = num(s.away);
      if (isNaN(h) && isNaN(a)) continue;
      if (isNaN(h) || isNaN(a) || h < 0 || a < 0) return `${rules.setLabel} ${i + 1} needs both scores.`;
      if (h === a) return `${rules.setLabel} ${i + 1} can't end level.`;
      sets.push({ home: h, away: a });
    }
    const need = setsToWin(rules);
    let home = 0;
    let away = 0;
    for (const [i, s] of sets.entries()) {
      if (home === need || away === need) return `The match was already decided before ${rules.setLabel.toLowerCase()} ${i + 1}.`;
      if (s.home > s.away) home++; else away++;
    }
    if (home < need && away < need) {
      return `Someone needs ${need} ${rules.setLabel.toLowerCase()}${need > 1 ? 's' : ''} to win (best of ${rules.bestOf}).`;
    }
    return { home, away, sets, winner: home > away ? 'home' : 'away' };
  }

  const home = num(input.home);
  const away = num(input.away);
  if (isNaN(home) || isNaN(away)) return 'Enter both scores.';
  if (home < 0 || away < 0) return 'Scores can’t be negative.';
  if (home !== away) return { home, away, winner: home > away ? 'home' : 'away' };
  if (drawsAllowed(rules, m)) return { home, away, winner: 'draw' };
  if (!input.tiebreakWinner) return 'Scores are level — pick who won the tiebreak.';
  return {
    home, away, winner: input.tiebreakWinner,
    decidedBy: input.decidedBy.trim() || undefined,
  };
}

