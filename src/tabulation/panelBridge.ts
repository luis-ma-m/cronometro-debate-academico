import type { Judge, Room, Speaker, Team, Tournament } from '../domain';
import { createTimer, resolvePhases, validateAssignments, withRoomStatus } from '../timer';
import { createTabTournament } from './presets';
import { randomSeed } from './random';
import type { PresetId, TabJudge, TabTeam, TabTournament } from './types';

/**
 * Versioned hand-offs between the admin panel and the local tabulation. Each side only reads the other's
 * payload through these formats, never its internal storage.
 */
export const HANDOFF_KEY = 'ledu-tabulacion-handoff-v1';
export const OUTBOX_KEY = 'ledu-tabulacion-outbox-v1';

type SimpleStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface PanelHandoff {
  format: 'ledu-tabulacion-handoff';
  version: 1;
  createdAt: number;
  tournamentName: string;
  teams: Array<Pick<Team, 'id' | 'name' | 'institution' | 'active' | 'incompatibleJudgeIds'>>;
  speakers: Speaker[];
  judges: Array<Pick<Judge, 'id' | 'name' | 'institution' | 'active' | 'incompatibleJudgeIds'>>;
  venues: Array<{ id: string; name: string; active: boolean }>;
}

export interface PanelOutboxDebate {
  physicalRoomId: string;
  venueName: string;
  teamFavorId: string;
  teamContraId: string;
  /** Sorted: the panel stores judges without order, so the chair stays in the tabulation. */
  judgeIds: string[];
  chairId: string;
  sidesProvisional: boolean;
}

export interface PanelOutbox {
  format: 'ledu-tabulacion-outbox';
  version: 1;
  createdAt: number;
  tabTournamentName: string;
  panelTournamentName: string | null;
  roundName: string;
  debates: PanelOutboxDebate[];
}

function readJson<T>(storage: SimpleStorage, key: string, format: string): T | null {
  try {
    const value = JSON.parse(storage.getItem(key) ?? 'null') as { format?: string; version?: number } | null;
    return value && value.format === format && value.version === 1 ? (value as T) : null;
  } catch {
    return null;
  }
}

export function buildPanelHandoff(panel: Tournament, now = Date.now()): PanelHandoff {
  return {
    format: 'ledu-tabulacion-handoff',
    version: 1,
    createdAt: now,
    tournamentName: panel.tournamentName,
    teams: panel.teams.map(({ id, name, institution, active, incompatibleJudgeIds }) => ({ id, name, institution, active, incompatibleJudgeIds: [...incompatibleJudgeIds] })),
    speakers: (panel.speakers ?? []).map((speaker) => ({ ...speaker })),
    judges: panel.judges.map(({ id, name, institution, active, incompatibleJudgeIds }) => ({ id, name, institution, active, incompatibleJudgeIds: [...incompatibleJudgeIds] })),
    venues: panel.physicalRooms.map(({ id, name, active }) => ({ id, name, active })),
  };
}

export const writeHandoff = (storage: SimpleStorage, handoff: PanelHandoff) => storage.setItem(HANDOFF_KEY, JSON.stringify(handoff));
export const readHandoff = (storage: SimpleStorage) => readJson<PanelHandoff>(storage, HANDOFF_KEY, 'ledu-tabulacion-handoff');
export const clearHandoff = (storage: SimpleStorage) => storage.removeItem(HANDOFF_KEY);
export const writeOutbox = (storage: SimpleStorage, outbox: PanelOutbox) => storage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
export const readOutbox = (storage: SimpleStorage) => readJson<PanelOutbox>(storage, OUTBOX_KEY, 'ledu-tabulacion-outbox');

export interface MergeSummary { tournament: TabTournament; added: number; updated: number; warnings: string[] }

/**
 * Brings the panel participants into a tabulation (same IDs). The panel owns names, institutions and
 * incompatibilities; the tabulation keeps its own judge levels, chairs, availability, swing, break eligibility
 * and active flags. Nothing is ever deleted.
 */
export function mergeHandoff(tournament: TabTournament, handoff: PanelHandoff, now = Date.now()): MergeSummary {
  let added = 0;
  let updated = 0;
  const warnings: string[] = [];
  if (tournament.panelLink && tournament.panelLink.tournamentName !== handoff.tournamentName) {
    warnings.push('Este torneo se enlazó con «' + tournament.panelLink.tournamentName + '» y los datos vienen de «' + handoff.tournamentName + '».');
  }
  const merge = <T extends { id: string }>(current: T[], incoming: T[], update: (existing: T, next: T) => T) => {
    const result = [...current];
    for (const item of incoming) {
      const index = result.findIndex((existing) => existing.id === item.id);
      if (index < 0) { result.push(item); added++; continue; }
      const next = update(result[index], item);
      if (JSON.stringify(next) !== JSON.stringify(result[index])) { result[index] = next; updated++; }
    }
    return result;
  };
  const teams = merge<TabTeam>(
    tournament.teams,
    handoff.teams.map((team) => ({ ...team, swing: false, breakEligible: true })),
    (existing, next) => ({ ...existing, name: next.name, institution: next.institution, incompatibleJudgeIds: next.incompatibleJudgeIds }),
  );
  const teamIds = new Set(teams.map((team) => team.id));
  const speakers = merge(
    tournament.speakers,
    handoff.speakers.filter((speaker) => teamIds.has(speaker.teamId)),
    (existing, next) => ({ ...existing, name: next.name, teamId: next.teamId }),
  );
  const judges = merge<TabJudge>(
    tournament.judges,
    handoff.judges.map((judge) => ({ ...judge, rating: 3, canChair: true, unavailableRoundIds: [] })),
    (existing, next) => ({ ...existing, name: next.name, institution: next.institution, incompatibleJudgeIds: next.incompatibleJudgeIds }),
  );
  const venues = merge(tournament.venues, handoff.venues, (existing, next) => ({ ...existing, name: next.name }));
  return {
    tournament: { ...tournament, teams, speakers, judges, venues, panelLink: { tournamentName: handoff.tournamentName, linkedAt: now } },
    added,
    updated,
    warnings,
  };
}

export function tournamentFromHandoff(handoff: PanelHandoff, presetId: PresetId, now = Date.now(), seed = randomSeed()): TabTournament {
  return mergeHandoff(createTabTournament(handoff.tournamentName, presetId, now, seed), handoff, now).tournament;
}

export interface OutboxResult { outbox: PanelOutbox | null; issues: string[]; warnings: string[] }

export function buildOutbox(tournament: TabTournament, roundId: string, now = Date.now()): OutboxResult {
  const round = tournament.rounds.find((item) => item.id === roundId);
  if (!round) return { outbox: null, issues: ['La ronda no existe.'], warnings: [] };
  const issues: string[] = [];
  const warnings: string[] = [];
  const venues = new Map(tournament.venues.map((venue) => [venue.id, venue.name]));
  const debates: PanelOutboxDebate[] = [];
  for (const debate of round.debates) {
    const [a, b] = debate.teamIds;
    const venueName = venues.get(debate.venueId) ?? '';
    if (!venueName) { issues.push('Hay debates sin sala: asigna una sala a cada debate antes de enviarlo.'); continue; }
    if (!a || !b) { issues.push(venueName + ': faltan equipos.'); continue; }
    const favor = debate.favorTeamId ?? a;
    debates.push({
      physicalRoomId: debate.venueId,
      venueName,
      teamFavorId: favor,
      teamContraId: favor === a ? b : a,
      judgeIds: [...debate.judgeIds].sort(),
      chairId: debate.chairId,
      sidesProvisional: !debate.favorTeamId,
    });
  }
  const provisional = debates.filter((debate) => debate.sidesProvisional).length;
  if (provisional) warnings.push(provisional + ' debate(s) sin postura sorteada: se enviarán con una postura provisional que podrás intercambiar en el panel.');
  if (debates.some((debate) => !debate.judgeIds.length)) warnings.push('Hay debates sin jueces.');
  if (issues.length) return { outbox: null, issues: [...new Set(issues)], warnings };
  return {
    outbox: {
      format: 'ledu-tabulacion-outbox',
      version: 1,
      createdAt: now,
      tabTournamentName: tournament.name,
      panelTournamentName: tournament.panelLink?.tournamentName ?? null,
      roundName: round.name,
      debates,
    },
    issues,
    warnings,
  };
}

export interface ApplyOutboxResult { rooms: Room[] | null; issues: string[]; summary: string[]; changed: number }

const sameSet = (left: string[], right: string[]) => left.length === right.length && [...left].sort().join('|') === [...right].sort().join('|');

/**
 * All-or-nothing: returns the panel rooms with the selected round re-assigned from the outbox, or only issues.
 * Existing assignments are reused per physical room, missing ones are created like "Asignar sala existente",
 * rooms of that round not used by the tabulation are emptied (never deleted), and rooms whose timer has started
 * or that already have a scorecard can only stay as they are.
 */
export function applyOutboxToPanel(panel: Tournament, panelRoundId: string, outbox: PanelOutbox, options: { makeId: (prefix: string) => string; now?: number }): ApplyOutboxResult {
  const now = options.now ?? Date.now();
  const issues: string[] = [];
  const round = panel.rounds.find((item) => item.id === panelRoundId);
  if (!round) return { rooms: null, issues: ['Selecciona una ronda del panel.'], summary: [], changed: 0 };
  const physicalRooms = new Map(panel.physicalRooms.map((physical) => [physical.id, physical]));
  const teams = new Map(panel.teams.map((team) => [team.id, team]));
  const judges = new Set(panel.judges.map((judge) => judge.id));
  const seenRooms = new Set<string>();
  for (const debate of outbox.debates) {
    if (!physicalRooms.has(debate.physicalRoomId)) issues.push('La sala «' + debate.venueName + '» no existe en el panel.');
    if (seenRooms.has(debate.physicalRoomId)) issues.push('La sala «' + debate.venueName + '» aparece en dos debates.');
    seenRooms.add(debate.physicalRoomId);
    if (!teams.has(debate.teamFavorId) || !teams.has(debate.teamContraId)) issues.push(debate.venueName + ': algún equipo no existe en el panel.');
    if (debate.judgeIds.some((id) => !judges.has(id))) issues.push(debate.venueName + ': algún juez no existe en el panel.');
  }
  if (issues.length) return { rooms: null, issues: [...new Set(issues)], summary: [], changed: 0 };

  const minimumJudges = panel.minimumJudgesPerRoom ?? 1;
  const scored = new Set((panel.scoring?.scorecards ?? []).map((card) => card.roomId));
  const targets = new Map(outbox.debates.map((debate) => [debate.physicalRoomId, debate]));
  let changed = 0;
  const rooms: Room[] = panel.rooms.map((room) => {
    if (room.roundId !== panelRoundId) return room;
    const target = targets.get(room.physicalRoomId);
    const teamFavorId = target?.teamFavorId ?? '';
    const teamContraId = target?.teamContraId ?? '';
    const judgeIds = target?.judgeIds ?? [];
    if (room.teamFavorId === teamFavorId && room.teamContraId === teamContraId && sameSet(room.judgeIds, judgeIds)) return room;
    if (room.timer.status !== 'idle' || scored.has(room.id)) {
      issues.push(room.name + ' tiene el cronómetro iniciado o finalizado, o un acta: su asignación no se puede cambiar.');
      return room;
    }
    changed++;
    return withRoomStatus({ ...room, teamFavorId, teamContraId, judgeIds: [...judgeIds], updatedAt: now }, minimumJudges);
  });
  const format = panel.formats.find((item) => item.id === round.defaultFormatId) ?? panel.formats[0];
  for (const debate of outbox.debates) {
    if (rooms.some((room) => room.roundId === panelRoundId && room.physicalRoomId === debate.physicalRoomId)) continue;
    const physical = physicalRooms.get(debate.physicalRoomId)!;
    const phases = (format?.phases?.length ? format.phases : resolvePhases(panel.formatPhases, panel.rooms)).map((phase) => ({ ...phase }));
    rooms.push(withRoomStatus({
      id: options.makeId('assignment'), name: physical.name, roundId: panelRoundId, physicalRoomId: physical.id, formatId: '',
      teamFavorId: debate.teamFavorId, teamContraId: debate.teamContraId, judgeIds: [...debate.judgeIds], status: 'unassigned',
      phases, timer: { ...createTimer(phases), updatedAt: now }, notes: '', updatedAt: now,
    }, minimumJudges));
    changed++;
  }
  issues.push(...validateAssignments({ ...panel, rooms: rooms.filter((room) => room.roundId === panelRoundId) }));
  if (issues.length) return { rooms: null, issues: [...new Set(issues)], summary: [], changed: 0 };
  const name = (id: string) => teams.get(id)?.name ?? id;
  const summary = outbox.debates.map((debate) => debate.venueName + ': ' + name(debate.teamFavorId) + ' (A favor) – ' + name(debate.teamContraId) + ' (En contra) · '
    + debate.judgeIds.length + (debate.judgeIds.length === 1 ? ' juez' : ' jueces') + (debate.sidesProvisional ? ' · postura provisional' : ''));
  return { rooms, issues: [], summary, changed };
}
