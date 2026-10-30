import type { SpeakerPosition } from '../scoring.js';

/** Local, frontend-only tabulation model. Nothing derived (standings, byes, outcomes) is stored. */
export const TAB_SCHEMA_VERSION = 2;

export type SpeakerRole = SpeakerPosition;
export const SPEAKER_ROLES: SpeakerRole[] = ['introductor', 'first_rebuttal', 'second_rebuttal', 'concluder'];

export type TabStage = 'groups' | 'swiss';
/** 'draw': sides are drawn before each debate; 'balanced': the tab fixes them when generating the round. */
export type SideMode = 'draw' | 'balanced';
export type BracketMode = 'fixed' | 'reseed';
export type WarningConversion = 'ledu' | 'pairs' | 'aduma' | 'none';
/** 'blocks': every `minorsPerMajor` minors make a major; 'aduma': from two minors on, minors − 1 majors (ADUMA art. 40.1). */
export type MinorEscalation = 'blocks' | 'aduma';
export type MajorFaultMode = 'forfeit' | 'points';
export type PresetId = 'ledu-groups' | 'uc3m-swiss' | 'aduma' | 'custom';
/** 'judges': one ballot per judge, majority wins. 'joint': one acta signed by the whole jury with a declared winner. */
export type BallotMode = 'judges' | 'joint';
/** 'hard': an objective conflict is never seated. 'lastResort': only when a debate would otherwise have no judge. */
export type ConflictPolicy = 'hard' | 'lastResort';
export type ConflictLevel = 'objective' | 'subjective';
export type TiebreakKey =
  | 'ballots'
  | 'pointsTotal'
  | 'pointsAverage'
  | 'headToHead'
  | 'headToHeadBallots'
  | 'headToHeadPoints'
  | 'speakerPoints'
  | 'fewestPenalties'
  | 'fewestMajors'
  | 'fewestMinors';

export const TIEBREAK_LABELS: Record<TiebreakKey, string> = {
  ballots: 'Votos de jueces a favor',
  pointsTotal: 'Puntos totales',
  pointsAverage: 'Puntuación media',
  headToHead: 'Enfrentamiento directo',
  headToHeadBallots: 'Votos en los enfrentamientos directos',
  headToHeadPoints: 'Puntos en los enfrentamientos directos',
  speakerPoints: 'Puntuación individual de los oradores',
  fewestPenalties: 'Menos faltas y avisos',
  fewestMajors: 'Menos faltas graves',
  fewestMinors: 'Menos faltas leves',
};

export interface TabRubricItem { id: string; name: string; section: string; description: string }

export interface TabSettings {
  presetId: PresetId;
  stage: TabStage;
  groupCount: number;
  groupAdvance: number;
  swissRounds: number;
  avoidSameInstitution: boolean;
  breakSize: number;
  bracketMode: BracketMode;
  qualifyingPanelSize: number;
  eliminationPanelSize: number;
  qualifyingSideMode: SideMode;
  scoreMin: number;
  scoreMax: number;
  /** When true the ballots already contain net scores, so penalties are recorded but not deducted. */
  scoresIncludePenalties: boolean;
  /** LEDU art. 31.4: with more than three judges drop the highest and lowest score. */
  trimExtremes: boolean;
  speakerScores: boolean;
  speakerScoreMin: number;
  speakerScoreMax: number;
  speakerScoreStep: number;
  speakerMetric: 'sum' | 'average';
  warningConversion: WarningConversion;
  minorPoints: number;
  minorsPerMajor: number;
  majorMode: MajorFaultMode;
  majorPoints: number;
  forfeitLoserPoints: number;
  /** 'average': mean of the team's other debates; 'roundAverage': mean of every team in the round's other rooms. */
  forfeitWinnerPoints: 'average' | 'ballots' | 'roundAverage';
  /** Ordered criteria applied after wins. */
  tiebreaks: TiebreakKey[];
  tiebreakFallback: 'lots' | 'manual';
  ballotMode: BallotMode;
  /** Item sheet of joint actas; each item is scored between itemMin and itemMax. */
  rubric: TabRubricItem[];
  itemMin: number;
  itemMax: number;
  minorEscalation: MinorEscalation;
  /** When false, panels of two judges are allowed (the chair has the casting vote). */
  oddPanels: boolean;
  conflictPolicy: ConflictPolicy;
  /** Qualifying rounds are "a ciegas": results stay out of projections and the draw does not reveal rankings. */
  blindQualifying: boolean;
  /** Registered teams the organisers expect (0 = no expectation). */
  expectedTeams: number;
  /** Seed order of the first elimination round when it differs from the standard bracket (empty = standard). */
  bracketSeedOrder: number[];
}

export interface TabTeam {
  id: string;
  name: string;
  institution: string;
  active: boolean;
  /** Filler team: debates normally but never appears in standings, speaker tabs or the break, and cannot win. */
  swing: boolean;
  breakEligible: boolean;
  incompatibleJudgeIds: string[];
  /** "Equipo caído": from this round on the team loses every debate and its rival gets the round's average items. */
  fallenFromRound?: number;
}

export interface TabSpeaker { id: string; teamId: string; name: string }

export interface TabJudge {
  id: string;
  name: string;
  institution: string;
  active: boolean;
  /** 1 (novice) – 5 (most experienced); used to place stronger panels in more important debates. */
  rating: number;
  canChair: boolean;
  incompatibleJudgeIds: string[];
  unavailableRoundIds: string[];
  /** Mobile number for WhatsApp (international digits), to send the acta link to the chair. */
  phone?: string;
}

export interface TabVenue { id: string; name: string; active: boolean }

export interface TabGroup { id: string; name: string; teamIds: string[] }

export interface TabBallot {
  judgeId: string;
  /** Gross team totals (before penalties) for qualifying rounds. */
  totals: Record<string, number>;
  speeches: Record<string, Partial<Record<SpeakerRole, number>>>;
  /** Vote for elimination rounds, where judges only vote. */
  winnerTeamId?: string;
}

export interface TabPenalties { warnings: number; minors: number; majors: number; disqualified: boolean }

/** Judge not eligible for a team or for every team of an institution. */
export interface TabJudgeConflict {
  id: string;
  judgeId: string;
  teamId?: string;
  institution?: string;
  level: ConflictLevel;
  note: string;
}

/** One row of the paper's "puntos de orador": a member, the score and the interventions they made. */
export interface TabSpeakerEntry { speakerId: string; score: number; roles: SpeakerRole[] }

/** Acta signed jointly by the jury (ADUMA art. 23): declared winner; items only break ties. */
export interface TabJointActa {
  winnerTeamId: string;
  items: Record<string, Record<string, number>>;
  /** Gross totals typed when the item detail is still pending. */
  quickTotals?: Record<string, number>;
  /** Totals as written on the paper, used to catch transcription errors. */
  writtenTotals?: Record<string, number>;
  speakers: Record<string, TabSpeakerEntry[]>;
}

export interface TabDebateResult {
  lineup: Record<string, Partial<Record<SpeakerRole, string>>>;
  ballots: TabBallot[];
  penalties: Record<string, TabPenalties>;
  /** Organiser decision that replaces the computed winner (e.g. both teams forfeited). */
  override?: { winnerTeamId: string; reason: string };
  joint?: TabJointActa;
  notes: string;
  updatedAt: number;
}

export interface TabDebate {
  id: string;
  venueId: string;
  /** Neutral order; the side is only known through favorTeamId. */
  teamIds: [string, string];
  favorTeamId?: string;
  judgeIds: string[];
  chairId: string;
  bracketSlot?: number;
  result?: TabDebateResult;
}

export interface TabRound {
  id: string;
  number: number;
  name: string;
  kind: 'qualifying' | 'elimination';
  sideMode: SideMode;
  panelSize: number;
  seed: number;
  /** Closed round: results are kept out of projected standings. */
  silent: boolean;
  debates: TabDebate[];
  createdAt: number;
  pushedAt?: number;
}

/** Round generated but not confirmed yet: it can be edited by hand and every change is logged. */
export interface TabRoundDraft {
  round: TabRound;
  /** The round exactly as the algorithm produced it, to list manual changes. */
  generated: TabRound;
  seed: number;
  kind: 'swiss' | 'elimination' | 'groups';
  breakSeeds?: string[];
  /** Fingerprint of the inputs the draft was generated from, to warn when they change. */
  fingerprint: string;
  createdAt: number;
  /** Previous versions of the draft, for undo inside the editor. */
  editHistory: TabRound[];
}

export interface TabLogEntry {
  seq: number;
  at: number;
  operator: string;
  type: string;
  message: string;
  details?: unknown;
  prevHash: string;
  hash: string;
}

export interface TabTournament {
  schemaVersion: typeof TAB_SCHEMA_VERSION;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  seed: number;
  sample?: boolean;
  settings: TabSettings;
  teams: TabTeam[];
  speakers: TabSpeaker[];
  judges: TabJudge[];
  venues: TabVenue[];
  groups: TabGroup[];
  rounds: TabRound[];
  /** Break order frozen when the first elimination round is generated. */
  breakSeeds: string[];
  /** Organiser order for ties left unresolved by every criterion (e.g. LEDU tie-break debates). */
  manualOrder: string[];
  panelLink?: { tournamentName: string; linkedAt: number };
  /** Actas by WhatsApp: the desk's number and the public address of the judges' page (empty = this one). */
  whatsapp?: { deskPhone: string; baseUrl: string };
  judgeConflicts: TabJudgeConflict[];
  draftRound?: TabRoundDraft;
  /** Log entries saved together with the tournament until they are copied to the append-only log pages. */
  logTail: TabLogEntry[];
  /** Sequence number of the last log entry written for this tournament. */
  logSeq: number;
}

/** Random IDs without crypto.randomUUID, which is missing on plain-http LAN origins. */
export function makeTabId(prefix = 'tab'): string {
  const bytes = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return prefix + '-' + Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function normalizeInstitution(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase('es-ES') ?? '';
}

export function sameInstitution(left: string | undefined, right: string | undefined): boolean {
  const a = normalizeInstitution(left);
  return Boolean(a && a === normalizeInstitution(right));
}

export function isFallenAt(team: Pick<TabTeam, 'fallenFromRound'> | undefined, roundNumber: number): boolean {
  return team?.fallenFromRound !== undefined && team.fallenFromRound <= roundNumber;
}

export function emptyPenalties(): TabPenalties {
  return { warnings: 0, minors: 0, majors: 0, disqualified: false };
}

export function qualifyingRounds(tournament: Pick<TabTournament, 'rounds'>): TabRound[] {
  return tournament.rounds.filter((round) => round.kind === 'qualifying').sort((a, b) => a.number - b.number);
}

export function eliminationRounds(tournament: Pick<TabTournament, 'rounds'>): TabRound[] {
  return tournament.rounds.filter((round) => round.kind === 'elimination').sort((a, b) => a.number - b.number);
}

/** Number the next round will take (qualifying and elimination rounds share one sequence). */
export function nextRoundNumber(tournament: Pick<TabTournament, 'rounds'>): number {
  return Math.max(0, ...tournament.rounds.map((round) => round.number)) + 1;
}
