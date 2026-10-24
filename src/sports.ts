import type { FormatKind, Rules, SportPreset, Tiebreaker } from './types';

const base: Rules = {
  scoringMode: 'score',
  scoreLabel: 'Points',
  allowDraws: false,
  pointsWin: 3,
  pointsDraw: 1,
  pointsLoss: 0,
  bestOf: 3,
  setLabel: 'Set',
  pointsPerSet: 0,
  decidingSetPoints: 0,
  winBy: 1,
  targetScore: 0,
  matchMinutes: 0,
  tiebreakers: ['points', 'headToHead', 'diff', 'scored'],
};

function preset(
  id: string,
  name: string,
  emoji: string,
  participantNoun: string,
  suggestedFormat: FormatKind,
  rules: Partial<Rules>,
): SportPreset {
  return { id, name, emoji, participantNoun, suggestedFormat, rules: { ...base, ...rules } };
}

const setTiebreakers: Tiebreaker[] = ['points', 'wins', 'setDiff', 'diff', 'headToHead'];

export const SPORTS: SportPreset[] = [
  preset('football', 'Football', '⚽', 'Team', 'groups', {
    scoreLabel: 'Goals', allowDraws: true, pointsWin: 3, pointsDraw: 1, matchMinutes: 90,
  }),
  preset('basketball', 'Basketball', '🏀', 'Team', 'league', {
    scoreLabel: 'Points', pointsWin: 2, pointsLoss: 1, pointsDraw: 0, matchMinutes: 48,
  }),
  preset('volleyball', 'Volleyball', '🏐', 'Team', 'groups', {
    scoringMode: 'sets', scoreLabel: 'Points', bestOf: 5, pointsPerSet: 25, decidingSetPoints: 15, winBy: 2,
    tiebreakers: setTiebreakers,
  }),
  preset('foot-tennis', 'Foot tennis', '🦶', 'Pair', 'groups', {
    scoringMode: 'sets', scoreLabel: 'Points', bestOf: 3, pointsPerSet: 11, winBy: 2, pointsWin: 1, pointsDraw: 0,
    tiebreakers: setTiebreakers,
  }),
  preset('tennis', 'Tennis', '🎾', 'Player', 'knockout', {
    scoringMode: 'sets', scoreLabel: 'Games', bestOf: 3, pointsPerSet: 6, winBy: 2, pointsWin: 1, pointsDraw: 0,
    tiebreakers: ['wins', 'headToHead', 'setDiff', 'diff'],
  }),
  preset('padel', 'Padel', '🥎', 'Pair', 'groups', {
    scoringMode: 'sets', scoreLabel: 'Games', bestOf: 3, pointsPerSet: 6, winBy: 2, pointsWin: 1, pointsDraw: 0,
    tiebreakers: ['wins', 'headToHead', 'setDiff', 'diff'],
  }),
  preset('table-tennis', 'Table tennis', '🏓', 'Player', 'groups', {
    scoringMode: 'sets', setLabel: 'Game', bestOf: 5, pointsPerSet: 11, winBy: 2, pointsWin: 2, pointsLoss: 1, pointsDraw: 0,
    tiebreakers: setTiebreakers,
  }),
  preset('badminton', 'Badminton', '🏸', 'Player', 'knockout', {
    scoringMode: 'sets', setLabel: 'Game', bestOf: 3, pointsPerSet: 21, winBy: 2, pointsWin: 1, pointsDraw: 0,
    tiebreakers: setTiebreakers,
  }),
  preset('pickleball', 'Pickleball', '🥒', 'Player', 'groups', {
    scoringMode: 'sets', setLabel: 'Game', bestOf: 3, pointsPerSet: 11, winBy: 2, pointsWin: 1, pointsDraw: 0,
    tiebreakers: setTiebreakers,
  }),
  preset('handball', 'Handball', '🤾', 'Team', 'groups', {
    scoreLabel: 'Goals', allowDraws: true, pointsWin: 2, pointsDraw: 1, matchMinutes: 60,
  }),
  preset('hockey', 'Ice hockey', '🏒', 'Team', 'league', {
    scoreLabel: 'Goals', pointsWin: 2, pointsDraw: 0, matchMinutes: 60,
  }),
  preset('rugby', 'Rugby', '🏉', 'Team', 'groups', {
    scoreLabel: 'Points', allowDraws: true, pointsWin: 4, pointsDraw: 2, matchMinutes: 80,
  }),
  preset('american-football', 'American football', '🏈', 'Team', 'league', {
    scoreLabel: 'Points', allowDraws: true, pointsWin: 2, pointsDraw: 1, matchMinutes: 60,
  }),
  preset('cricket', 'Cricket', '🏏', 'Team', 'league', {
    scoreLabel: 'Runs', allowDraws: true, pointsWin: 2, pointsDraw: 1,
  }),
  preset('chess', 'Chess', '♟️', 'Player', 'swiss', {
    scoreLabel: 'Score', allowDraws: true, pointsWin: 1, pointsDraw: 0.5,
    tiebreakers: ['points', 'headToHead', 'wins'],
  }),
  preset('darts', 'Darts', '🎯', 'Player', 'knockout', {
    scoreLabel: 'Legs', pointsWin: 2, pointsDraw: 0,
  }),
  preset('esports', 'Esports', '🎮', 'Team', 'groups', {
    scoringMode: 'sets', setLabel: 'Map', scoreLabel: 'Rounds', bestOf: 3, pointsDraw: 0,
    tiebreakers: setTiebreakers,
  }),
  preset('custom', 'Custom sport', '✨', 'Team', 'league', {
    allowDraws: true,
  }),
];

export function getSport(id: string): SportPreset {
  return SPORTS.find((s) => s.id === id) ?? SPORTS[SPORTS.length - 1];
}

export const TIEBREAKER_LABELS: Record<Tiebreaker, string> = {
  points: 'Points',
  headToHead: 'Head-to-head',
  diff: 'Score difference',
  scored: 'Score for',
  wins: 'Wins',
  setDiff: 'Set difference',
};

export const FORMAT_INFO: Record<FormatKind, { name: string; blurb: string; icon: string }> = {
  single: { name: 'Single match', blurb: 'One match between two sides.', icon: '⚔️' },
  league: { name: 'League', blurb: 'Everyone plays everyone; best record wins.', icon: '📋' },
  knockout: { name: 'Knockout', blurb: 'Lose once and you are out. Byes added automatically.', icon: '🪜' },
  groups: { name: 'Groups + knockout', blurb: 'Round-robin groups, top finishers go to a bracket.', icon: '🏆' },
  swiss: { name: 'Swiss', blurb: 'Fixed number of rounds, paired by similar records.', icon: '🔀' },
};
