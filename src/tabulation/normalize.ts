import { presetSettings } from './presets';
import {
  SPEAKER_ROLES,
  TAB_SCHEMA_VERSION,
  TIEBREAK_LABELS,
  type PresetId,
  type SpeakerRole,
  type TabBallot,
  type TabDebate,
  type TabDebateResult,
  type TabJointActa,
  type TabJudgeConflict,
  type TabLogEntry,
  type PanelEntityIdMap,
  type TabPenalties,
  type TabRound,
  type TabRoundDraft,
  type TabRubricItem,
  type TabSettings,
  type TabSpeakerEntry,
  type TabTournament,
  type TiebreakKey,
} from './types';

export const TAB_EXPORT_FORMAT = 'ledu-tabulacion';

export class TabDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TabDataError';
  }
}

export interface NormalizeResult { tournament: TabTournament; issues: string[] }

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const int = (value: unknown, fallback: number, min = 0) => Math.max(min, Math.floor(num(value, fallback)));
const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
const ids = (value: unknown) => (Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))] : []);
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
const list = (value: unknown) => (Array.isArray(value) ? value.filter(isObject) : []);
const isFiniteNumber = (item: unknown): item is number => typeof item === 'number' && Number.isFinite(item);
const isText = (item: unknown): item is string => typeof item === 'string' && item.length > 0;
const isRole = (item: unknown): item is SpeakerRole => SPEAKER_ROLES.includes(item as SpeakerRole);

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => item.id && !seen.has(item.id) && seen.add(item.id));
}

function normalizeRubric(value: unknown, fallback: TabRubricItem[]): TabRubricItem[] {
  if (!Array.isArray(value)) return fallback;
  return uniqueById(list(value).filter((item) => isText(item.id)).map((item) => ({
    id: item.id as string, name: text(item.name, item.id as string), section: text(item.section), description: text(item.description),
  })));
}

function normalizePanelEntityIdMap(raw: unknown): PanelEntityIdMap | undefined {
  if (!isObject(raw)) return undefined;
  const read = (value: unknown): Record<string, string> => {
    if (!isObject(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => entry[0].length > 0 && isText(entry[1])));
  };
  return { teams: read(raw.teams), speakers: read(raw.speakers), judges: read(raw.judges), venues: read(raw.venues) };
}

function normalizeSettings(raw: unknown): TabSettings {
  const value = isObject(raw) ? raw : {};
  const presetId = oneOf<PresetId>(value.presetId, ['ledu-groups', 'uc3m-swiss', 'aduma', 'custom'], 'ledu-groups');
  const base = presetSettings(presetId === 'custom' ? 'ledu-groups' : presetId);
  const tiebreaks = Array.isArray(value.tiebreaks)
    ? [...new Set(value.tiebreaks.filter((key): key is TiebreakKey => typeof key === 'string' && key in TIEBREAK_LABELS))]
    : base.tiebreaks;
  const seedOrder = Array.isArray(value.bracketSeedOrder) ? value.bracketSeedOrder.filter((seed): seed is number => Number.isInteger(seed) && seed > 0) : base.bracketSeedOrder;
  return {
    presetId,
    stage: oneOf(value.stage, ['groups', 'swiss'], base.stage),
    groupCount: int(value.groupCount, base.groupCount, 1),
    groupAdvance: int(value.groupAdvance, base.groupAdvance, 1),
    swissRounds: int(value.swissRounds, base.swissRounds, 1),
    avoidSameInstitution: flag(value.avoidSameInstitution, base.avoidSameInstitution),
    breakSize: int(value.breakSize, base.breakSize, 2),
    bracketMode: oneOf(value.bracketMode, ['fixed', 'reseed'], base.bracketMode),
    qualifyingPanelSize: int(value.qualifyingPanelSize, base.qualifyingPanelSize, 1),
    eliminationPanelSize: int(value.eliminationPanelSize, base.eliminationPanelSize, 1),
    qualifyingSideMode: oneOf(value.qualifyingSideMode, ['draw', 'balanced'], base.qualifyingSideMode),
    scoreMin: num(value.scoreMin, base.scoreMin),
    scoreMax: num(value.scoreMax, base.scoreMax),
    scoresIncludePenalties: flag(value.scoresIncludePenalties, base.scoresIncludePenalties),
    trimExtremes: flag(value.trimExtremes, base.trimExtremes),
    speakerScores: flag(value.speakerScores, base.speakerScores),
    speakerScoreMin: num(value.speakerScoreMin, base.speakerScoreMin),
    speakerScoreMax: num(value.speakerScoreMax, base.speakerScoreMax),
    speakerScoreStep: Math.max(0, num(value.speakerScoreStep, base.speakerScoreStep)),
    speakerMetric: oneOf(value.speakerMetric, ['sum', 'average'], base.speakerMetric),
    warningConversion: oneOf(value.warningConversion, ['ledu', 'pairs', 'aduma', 'none'], base.warningConversion),
    minorPoints: num(value.minorPoints, base.minorPoints),
    minorsPerMajor: int(value.minorsPerMajor, base.minorsPerMajor),
    majorMode: oneOf(value.majorMode, ['forfeit', 'points'], base.majorMode),
    majorPoints: num(value.majorPoints, base.majorPoints),
    forfeitLoserPoints: num(value.forfeitLoserPoints, base.forfeitLoserPoints),
    forfeitWinnerPoints: oneOf(value.forfeitWinnerPoints, ['average', 'ballots', 'roundAverage'], base.forfeitWinnerPoints),
    tiebreaks,
    tiebreakFallback: oneOf(value.tiebreakFallback, ['lots', 'manual'], base.tiebreakFallback),
    ballotMode: oneOf(value.ballotMode, ['judges', 'joint'], base.ballotMode),
    rubric: normalizeRubric(value.rubric, base.rubric),
    itemMin: num(value.itemMin, base.itemMin),
    itemMax: num(value.itemMax, base.itemMax),
    minorEscalation: oneOf(value.minorEscalation, ['blocks', 'aduma'], base.minorEscalation),
    oddPanels: flag(value.oddPanels, base.oddPanels),
    conflictPolicy: oneOf(value.conflictPolicy, ['hard', 'lastResort'], base.conflictPolicy),
    blindQualifying: flag(value.blindQualifying, base.blindQualifying),
    expectedTeams: int(value.expectedTeams, base.expectedTeams),
    bracketSeedOrder: seedOrder,
  };
}

function numberRecord(value: unknown): Record<string, number> {
  if (!isObject(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => isFiniteNumber(entry[1])));
}

function roleRecord<T>(value: unknown, accept: (item: unknown) => item is T): Partial<Record<SpeakerRole, T>> {
  if (!isObject(value)) return {};
  return Object.fromEntries(SPEAKER_ROLES.filter((role) => accept(value[role])).map((role) => [role, value[role] as T]));
}

function normalizeJoint(raw: unknown, teamIds: [string, string]): TabJointActa | undefined {
  if (!isObject(raw)) return undefined;
  const byTeam = <T>(value: unknown, read: (item: unknown) => T): Record<string, T> =>
    Object.fromEntries(teamIds.filter((id) => id && isObject(value) && value[id] !== undefined).map((id) => [id, read((value as Json)[id])]));
  const optional = (value: unknown) => {
    const record = byTeam(value, (item) => item);
    const numbers = Object.fromEntries(Object.entries(record).filter((entry): entry is [string, number] => isFiniteNumber(entry[1])));
    return Object.keys(numbers).length ? numbers : undefined;
  };
  const quickTotals = optional(raw.quickTotals);
  const writtenTotals = optional(raw.writtenTotals);
  return {
    winnerTeamId: text(raw.winnerTeamId),
    items: byTeam(raw.items, numberRecord),
    ...(quickTotals ? { quickTotals } : {}),
    ...(writtenTotals ? { writtenTotals } : {}),
    speakers: byTeam(raw.speakers, (rows): TabSpeakerEntry[] => list(rows).filter((row) => isText(row.speakerId)).map((row) => ({
      speakerId: row.speakerId as string,
      score: num(row.score, Number.NaN),
      roles: Array.isArray(row.roles) ? [...new Set(row.roles.filter(isRole))] : [],
    }))),
  };
}

function normalizeResult(raw: unknown, teamIds: [string, string]): TabDebateResult | undefined {
  if (!isObject(raw)) return undefined;
  const byTeam = <T>(value: unknown, read: (item: unknown) => T): Record<string, T> =>
    Object.fromEntries(teamIds.filter((id) => isObject(value) && value[id] !== undefined).map((id) => [id, read((value as Json)[id])]));
  const ballots: TabBallot[] = list(raw.ballots).filter((ballot) => isText(ballot.judgeId)).map((ballot) => ({
    judgeId: ballot.judgeId as string,
    totals: numberRecord(ballot.totals),
    speeches: byTeam(ballot.speeches, (item) => roleRecord(item, isFiniteNumber)),
    ...(isText(ballot.winnerTeamId) ? { winnerTeamId: ballot.winnerTeamId } : {}),
  }));
  const penalties = byTeam<TabPenalties>(raw.penalties, (item) => {
    const value = isObject(item) ? item : {};
    return { warnings: int(value.warnings, 0), minors: int(value.minors, 0), majors: int(value.majors, 0), disqualified: flag(value.disqualified, false) };
  });
  const override = isObject(raw.override) && isText(raw.override.winnerTeamId)
    ? { winnerTeamId: raw.override.winnerTeamId, reason: text(raw.override.reason) }
    : undefined;
  const joint = normalizeJoint(raw.joint, teamIds);
  return {
    lineup: byTeam(raw.lineup, (item) => roleRecord(item, isText)),
    ballots,
    penalties,
    ...(override ? { override } : {}),
    ...(joint ? { joint } : {}),
    notes: text(raw.notes),
    updatedAt: num(raw.updatedAt, 0),
  };
}

interface References { teams: Set<string>; judges: Set<string>; venues: Set<string> }

/** Keeps every debate and result; references to missing entities are counted, not dropped. */
function normalizeRound(round: Json, references: References): { round: TabRound; broken: number } {
  let broken = 0;
  const debates: TabDebate[] = uniqueById(list(round.debates).filter((debate) => isText(debate.id)).map((debate) => {
    const pair = Array.isArray(debate.teamIds) ? debate.teamIds : [];
    const teamPair: [string, string] = [text(pair[0]), text(pair[1])];
    const judgeList = ids(debate.judgeIds);
    if (teamPair.some((id) => id && !references.teams.has(id)) || judgeList.some((id) => !references.judges.has(id))
      || (isText(debate.venueId) && !references.venues.has(debate.venueId))) broken++;
    const result = normalizeResult(debate.result, teamPair);
    return {
      id: debate.id as string,
      venueId: text(debate.venueId),
      teamIds: teamPair,
      ...(isText(debate.favorTeamId) && teamPair.includes(debate.favorTeamId) ? { favorTeamId: debate.favorTeamId } : {}),
      judgeIds: judgeList,
      chairId: text(debate.chairId),
      ...(typeof debate.bracketSlot === 'number' ? { bracketSlot: debate.bracketSlot } : {}),
      ...(result ? { result } : {}),
    };
  }));
  return {
    broken,
    round: {
      id: round.id as string,
      number: int(round.number, 1, 1),
      name: text(round.name, 'Ronda'),
      kind: oneOf(round.kind, ['qualifying', 'elimination'], 'qualifying'),
      sideMode: oneOf(round.sideMode, ['draw', 'balanced'], 'draw'),
      panelSize: int(round.panelSize, 3, 1),
      seed: int(round.seed, 1),
      silent: flag(round.silent, false),
      debates,
      createdAt: num(round.createdAt, 0),
      ...(typeof round.pushedAt === 'number' ? { pushedAt: round.pushedAt } : {}),
    },
  };
}

function normalizeDraft(raw: unknown, references: References): TabRoundDraft | undefined {
  if (!isObject(raw) || !isObject(raw.round) || !isText(raw.round.id) || !isObject(raw.generated) || !isText(raw.generated.id)) return undefined;
  const kind = oneOf(raw.kind, ['swiss', 'elimination', 'groups'], 'swiss');
  return {
    round: normalizeRound(raw.round, references).round,
    generated: normalizeRound(raw.generated, references).round,
    seed: int(raw.seed, 1),
    kind,
    ...(Array.isArray(raw.breakSeeds) ? { breakSeeds: ids(raw.breakSeeds) } : {}),
    fingerprint: text(raw.fingerprint),
    createdAt: num(raw.createdAt, 0),
    editHistory: list(raw.editHistory).filter((round) => isText(round.id)).slice(-50).map((round) => normalizeRound(round, references).round),
  };
}

export function normalizeLogEntry(raw: Json): TabLogEntry | null {
  if (!Number.isInteger(raw.seq) || !isFiniteNumber(raw.at) || !isText(raw.type) || typeof raw.hash !== 'string') return null;
  return {
    seq: raw.seq as number,
    at: raw.at,
    operator: text(raw.operator),
    type: raw.type,
    message: text(raw.message),
    ...(raw.details !== undefined ? { details: raw.details } : {}),
    prevHash: text(raw.prevHash),
    hash: raw.hash,
  };
}

/**
 * Tolerant reader for stored or imported tournaments: fills defaults, drops malformed entities and reports (but
 * keeps) broken references inside rounds so that no result is silently lost.
 */
export function normalizeTabTournament(raw: unknown): NormalizeResult {
  if (!isObject(raw) || !isText(raw.id)) throw new TabDataError('El archivo no contiene un torneo de tabulación válido.');
  if (num(raw.schemaVersion, TAB_SCHEMA_VERSION) > TAB_SCHEMA_VERSION) {
    throw new TabDataError('Esta copia se creó con una versión más reciente de la tabulación. Actualiza la aplicación antes de abrirla.');
  }
  const issues: string[] = [];
  const teams = uniqueById(list(raw.teams).filter((team) => isText(team.id)).map((team) => ({
    id: team.id as string,
    name: text(team.name, 'Equipo sin nombre'),
    institution: text(team.institution),
    active: flag(team.active, true),
    swing: flag(team.swing, false),
    breakEligible: flag(team.breakEligible, true),
    incompatibleJudgeIds: ids(team.incompatibleJudgeIds),
    ...(Number.isInteger(team.fallenFromRound) && (team.fallenFromRound as number) >= 1 ? { fallenFromRound: team.fallenFromRound as number } : {}),
  })));
  const teamIds = new Set(teams.map((team) => team.id));
  const allSpeakers = uniqueById(list(raw.speakers).filter((speaker) => isText(speaker.id)).map((speaker) => ({
    id: speaker.id as string, teamId: text(speaker.teamId), name: text(speaker.name, 'Orador sin nombre'),
  })));
  const speakers = allSpeakers.filter((speaker) => teamIds.has(speaker.teamId));
  if (speakers.length < allSpeakers.length) issues.push('Se han descartado ' + (allSpeakers.length - speakers.length) + ' oradores de equipos inexistentes.');
  const judges = uniqueById(list(raw.judges).filter((judge) => isText(judge.id)).map((judge) => ({
    id: judge.id as string,
    name: text(judge.name, 'Juez sin nombre'),
    institution: text(judge.institution),
    active: flag(judge.active, true),
    rating: Math.min(5, Math.max(1, int(judge.rating, 3, 1))),
    canChair: flag(judge.canChair, true),
    incompatibleJudgeIds: ids(judge.incompatibleJudgeIds),
    unavailableRoundIds: ids(judge.unavailableRoundIds),
    ...(isText(judge.phone) && judge.phone.trim() ? { phone: judge.phone.trim() } : {}),
  })));
  const judgeIds = new Set(judges.map((judge) => judge.id));
  const venues = uniqueById(list(raw.venues).filter((venue) => isText(venue.id)).map((venue) => ({
    id: venue.id as string, name: text(venue.name, 'Sala'), active: flag(venue.active, true),
  })));
  const references: References = { teams: teamIds, judges: judgeIds, venues: new Set(venues.map((venue) => venue.id)) };
  const groups = uniqueById(list(raw.groups).filter((group) => isText(group.id)).map((group) => ({
    id: group.id as string, name: text(group.name, 'Grupo'), teamIds: ids(group.teamIds).filter((id) => teamIds.has(id)),
  })));
  const judgeConflicts: TabJudgeConflict[] = uniqueById(list(raw.judgeConflicts)
    .filter((conflict) => isText(conflict.id) && isText(conflict.judgeId) && (isText(conflict.teamId) || isText(conflict.institution))
      && (conflict.level === 'objective' || conflict.level === 'subjective'))
    .map((conflict) => ({
      id: conflict.id as string,
      judgeId: conflict.judgeId as string,
      ...(isText(conflict.teamId) ? { teamId: conflict.teamId } : {}),
      ...(isText(conflict.institution) ? { institution: conflict.institution } : {}),
      level: conflict.level as TabJudgeConflict['level'],
      note: text(conflict.note),
    })));

  let broken = 0;
  const rounds: TabRound[] = uniqueById(list(raw.rounds).filter((round) => isText(round.id)).map((round) => {
    const normalized = normalizeRound(round, references);
    broken += normalized.broken;
    return normalized.round;
  })).sort((a, b) => a.number - b.number);
  if (broken) issues.push(broken + ' debate(s) hacen referencia a equipos, jueces o salas que ya no existen. Revísalos en Rondas.');

  const draftRound = normalizeDraft(raw.draftRound, references);
  if (raw.draftRound !== undefined && raw.draftRound !== null && !draftRound) issues.push('Se ha descartado un borrador de ronda dañado: genera la ronda de nuevo.');
  const logTail = list(raw.logTail).map(normalizeLogEntry).filter((entry): entry is TabLogEntry => entry !== null);

  const tournament: TabTournament = {
    schemaVersion: TAB_SCHEMA_VERSION,
    id: raw.id as string,
    name: text(raw.name, 'Torneo sin nombre'),
    createdAt: num(raw.createdAt, 0),
    updatedAt: num(raw.updatedAt, 0),
    revision: int(raw.revision, 0),
    seed: int(raw.seed, 1),
    ...(raw.sample === true ? { sample: true } : {}),
    settings: normalizeSettings(raw.settings),
    teams,
    speakers,
    judges,
    venues,
    groups,
    rounds,
    breakSeeds: ids(raw.breakSeeds),
    manualOrder: ids(raw.manualOrder),
    ...(isObject(raw.panelLink) ? { panelLink: { tournamentName: text(raw.panelLink.tournamentName), linkedAt: num(raw.panelLink.linkedAt, 0), ...(typeof raw.panelLink.remoteId === 'string' && raw.panelLink.remoteId ? { remoteId: raw.panelLink.remoteId } : {}), ...(isObject(raw.panelLink.idMap) ? { idMap: normalizePanelEntityIdMap(raw.panelLink.idMap) } : {}) } } : {}),
    ...(isObject(raw.whatsapp) ? { whatsapp: { deskPhone: text(raw.whatsapp.deskPhone), baseUrl: text(raw.whatsapp.baseUrl) } } : {}),
    judgeConflicts,
    ...(draftRound ? { draftRound } : {}),
    logTail,
    logSeq: Math.max(int(raw.logSeq, 0), ...logTail.map((entry) => entry.seq)),
  };
  return { tournament, issues };
}

export function serializeTournamentExport(tournament: TabTournament, now = Date.now(), log: TabLogEntry[] = []): string {
  return JSON.stringify({ format: TAB_EXPORT_FORMAT, schemaVersion: TAB_SCHEMA_VERSION, exportedAt: now, tournament, log }, null, 2);
}

export interface ParsedExport extends NormalizeResult { log: TabLogEntry[] }

/** Accepts an exported envelope (with its log) or a bare tournament object. */
export function parseTournamentExport(content: string): ParsedExport {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new TabDataError('El archivo no es un JSON válido.');
  }
  if (isObject(raw) && raw.format !== undefined) {
    if (raw.format !== TAB_EXPORT_FORMAT) throw new TabDataError('El archivo no es una copia de la tabulación.');
    const log = list(raw.log).map(normalizeLogEntry).filter((entry): entry is TabLogEntry => entry !== null);
    return { ...normalizeTabTournament(raw.tournament), log };
  }
  return { ...normalizeTabTournament(raw), log: [] };
}
