export type ScoringMode = 'score' | 'sets';
export type FormatKind = 'single' | 'league' | 'knockout' | 'groups' | 'swiss';
export type Tiebreaker = 'points' | 'headToHead' | 'diff' | 'scored' | 'wins' | 'setDiff';
export type Side = 'home' | 'away';

export interface Rules {
  scoringMode: ScoringMode;
  /** What a unit of score is called: Goals, Points, Runs, Games... */
  scoreLabel: string;
  allowDraws: boolean;
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
  /** Sets mode: match is best of N sets/games/maps. */
  bestOf: number;
  /** Sets mode: what one set is called: Set, Game, Map, Frame... */
  setLabel: string;
  /** Sets mode: target score to win a set, 0 when there is no fixed target. */
  pointsPerSet: number;
  /** Sets mode: target for the deciding set, 0 to use pointsPerSet. */
  decidingSetPoints: number;
  /** Sets mode: required lead to close a set (1 or 2). */
  winBy: number;
  /** Score mode: first side to reach this score wins, 0 when there is no fixed target. Absent on older tournaments. */
  targetScore?: number;
  /** Planned length of one match in minutes, 0 when untimed. Absent on older tournaments. */
  matchMinutes?: number;
  tiebreakers: Tiebreaker[];
}

export interface FormatOptions {
  kind: FormatKind;
  legs: 1 | 2;
  groupCount: number;
  advancePerGroup: number;
  thirdPlace: boolean;
  swissRounds: number;
}

export interface SportPreset {
  id: string;
  name: string;
  emoji: string;
  participantNoun: string;
  suggestedFormat: FormatKind;
  rules: Rules;
}

export interface Participant {
  id: string;
  name: string;
  /** 1-based seed, from the order participants were entered. */
  seed: number;
}

export type SlotSource =
  | { type: 'participant'; id: string }
  | { type: 'winner'; matchId: string }
  | { type: 'loser'; matchId: string }
  | { type: 'group'; group: number; position: number }
  | { type: 'bye' };

export interface SetScore {
  home: number;
  away: number;
}

export interface Result {
  /** Score mode: the score. Sets mode: sets won. */
  home: number;
  away: number;
  sets?: SetScore[];
  winner: Side | 'draw';
  /** How a level score was settled, e.g. "Penalties". */
  decidedBy?: string;
  walkover?: boolean;
}

export type Stage = 'single' | 'league' | 'group' | 'knockout' | 'swiss';

export interface Match {
  id: string;
  stage: Stage;
  group?: number;
  round: number;
  roundName?: string;
  order: number;
  home: string | null;
  away: string | null;
  homeSource?: SlotSource;
  awaySource?: SlotSource;
  result?: Result;
  isThirdPlace?: boolean;
  /** Swiss bye: `home` sits the round out and is credited a win. */
  bye?: boolean;
  /** Scheduled start, epoch ms. */
  startsAt?: number;
  /** Where it is played, e.g. "Court 2". */
  court?: string;
}

export interface ScheduleSettings {
  /** First match start, epoch ms. */
  start: number;
  /** Names of the courts, pitches or tables played on at the same time. */
  courts: string[];
  /** Length of one match slot in minutes. */
  matchMinutes: number;
  /** Changeover between matches on the same court, in minutes. */
  breakMinutes: number;
}

export interface RegistrationSettings {
  open: boolean;
  /** Most entries accepted; later sign-ups join the waitlist. 0 = no limit. */
  capacity: number;
  /** Optional note shown on the sign-up form. */
  message?: string;
}

export interface Sponsor {
  name: string;
  /** Small image as a data URL. */
  logo?: string;
  url?: string;
}

export interface Branding {
  /** Hex colour, e.g. #0b8f5e. */
  accent?: string;
  /** Small image as a data URL. */
  logo?: string;
  sponsors?: Sponsor[];
}

export interface Tournament {
  id: string;
  name: string;
  sportId: string;
  sportName: string;
  emoji: string;
  participantNoun: string;
  createdAt: number;
  updatedAt: number;
  format: FormatOptions;
  rules: Rules;
  participants: Participant[];
  /** Participant ids per group, for the groups format. */
  groups?: string[][];
  matches: Match[];
  /** 'setup' while the organiser is still collecting entries; fixtures are generated when it starts. Absent = started. */
  phase?: 'setup';
  registration?: RegistrationSettings;
  schedule?: ScheduleSettings;
  branding?: Branding;
  /** Server-managed fields, never sent back as data. */
  shareId?: string;
  version?: number;
  role?: 'owner' | 'editor';
  ownerName?: string;
  /** Paid features unlocked (always true when billing is off). */
  pro?: boolean;
}

export type TournamentDraft = Omit<Tournament, 'matches' | 'groups' | 'createdAt' | 'updatedAt' | 'shareId' | 'version' | 'role' | 'ownerName' | 'pro'>;
