import type { SpeakerPosition } from '../scoring';

/** Local, frontend-only tabulation model. Nothing derived (standings, byes, outcomes) is stored. */
export const TAB_SCHEMA_VERSION = 1;

export type SpeakerRole = SpeakerPosition;
export const SPEAKER_ROLES: SpeakerRole[] = ['introductor', 'first_rebuttal', 'second_rebuttal', 'concluder'];

export type TabStage = 'groups' | 'swiss';
/** 'draw': sides are drawn before each debate; 'balanced': the tab fixes them when generating the round. */
export type SideMode = 'draw' | 'balanced';
export type BracketMode = 'fixed' | 'reseed';
export type WarningConversion = 'ledu' | 'pairs' | 'none';
export type MajorFaultMode = 'forfeit' | 'points';
export type PresetId = 'ledu-groups' | 'uc3m-swiss' | 'custom';
export type TiebreakKey =
  | 'ballots'
  | 'pointsTotal'
  | 'pointsAverage'
  | 'headToHead'
  | 'headToHeadBallots'
  | 'headToHeadPoints'
  | 'speakerPoints'
  | 'fewestPenalties';

export const TIEBREAK_LABELS: Record<TiebreakKey, string> = {
  ballots: 'Votos de jueces a favor',
  pointsTotal: 'Puntos totales',
  pointsAverage: 'Puntuación media',
  headToHead: 'Enfrentamiento directo',
  headToHeadBallots: 'Votos en los enfrentamientos directos',
  headToHeadPoints: 'Puntos en los enfrentamientos directos',
  speakerPoints: 'Puntuación individual de los oradores',
  fewestPenalties: 'Menos faltas y avisos',
};

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
  forfeitWinnerPoints: 'average' | 'ballots';
  /** Ordered criteria applied after wins. */
  tiebreaks: TiebreakKey[];
  tiebreakFallback: 'lots' | 'manual';
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

export interface TabDebateResult {
  lineup: Record<string, Partial<Record<SpeakerRole, string>>>;
  ballots: TabBallot[];
  penalties: Record<string, TabPenalties>;
  /** Organiser decision that replaces the computed winner (e.g. both teams forfeited). */
  override?: { winnerTeamId: string; reason: string };
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

export function emptyPenalties(): TabPenalties {
  return { warnings: 0, minors: 0, majors: 0, disqualified: false };
}

export function qualifyingRounds(tournament: Pick<TabTournament, 'rounds'>): TabRound[] {
  return tournament.rounds.filter((round) => round.kind === 'qualifying').sort((a, b) => a.number - b.number);
}

export function eliminationRounds(tournament: Pick<TabTournament, 'rounds'>): TabRound[] {
  return tournament.rounds.filter((round) => round.kind === 'elimination').sort((a, b) => a.number - b.number);
}
