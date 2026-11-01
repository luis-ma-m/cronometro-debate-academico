import type { PhysicalRoom, Judge, Speaker, Team } from '../domain';
import { canonicalId, entityIdentity, resolveMappedIdentity, type EntityIdentity, type EntityKind, type IdentitySource } from './identity';
import type { TabJudge, TabSpeaker, TabTeam, TabVenue, PanelEntityIdMap } from '../tabulation/types';
import type { ActiveTournamentContext } from './activeTournamentContext';

/**
 * Lossless-in-scope shared projection of the entities owned by the application
 * core. Module-specific fields (e.g. tabulation judge rating, swing-team flags,
 * timer/assignment state) deliberately remain in their owning models.
 */
export interface ParticipantSnapshot {
  readonly schemaVersion: 1;
  readonly tournamentId: string;
  readonly revision: number;
  readonly updatedAt: number;
  readonly teams: readonly ParticipantTeam[];
  readonly speakers: readonly ParticipantSpeaker[];
  readonly judges: readonly ParticipantJudge[];
  readonly physicalRooms: readonly ParticipantPhysicalRoom[];
}

export interface ParticipantTeam {
  readonly identity: EntityIdentity<'team'>;
  readonly name: string;
  readonly institution: string;
  readonly active: boolean;
  readonly incompatibleJudgeIds: readonly string[];
}

export interface ParticipantSpeaker {
  readonly identity: EntityIdentity<'speaker'>;
  readonly teamId: string;
  readonly name: string;
}

export interface ParticipantJudge {
  readonly identity: EntityIdentity<'judge'>;
  readonly name: string;
  readonly institution: string;
  readonly active: boolean;
  readonly incompatibleJudgeIds: readonly string[];
}

export interface ParticipantPhysicalRoom {
  readonly identity: EntityIdentity<'physical-room'>;
  readonly name: string;
  readonly active: boolean;
}

export class ParticipantSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParticipantSnapshotError';
  }
}

type ParticipantSource = 'manager' | 'tabulation';
type IdMaps = Partial<Record<EntityKind, Readonly<Record<string, string>>>>;

function mapId<K extends EntityKind>(kind: K, id: string, source: ParticipantSource, maps: IdMaps): string {
  if (source === 'manager') return canonicalId(kind, id);
  const mapping = maps[kind];
  if (!mapping) throw new ParticipantSnapshotError('Falta el mapping explícito de ' + kind + '.');
  const resolved = resolveMappedIdentity(kind, mapping, id);
  if (!resolved) throw new ParticipantSnapshotError('No existe un mapping explícito de ' + kind + ' para ' + id + '.');
  return resolved;
}

function makeIdentity<K extends EntityKind>(kind: K, id: string, source: ParticipantSource, maps: IdMaps): EntityIdentity<K> {
  return entityIdentity(kind, mapId(kind, id, source, maps), source, id);
}

function uniqueIds(items: readonly { identity: EntityIdentity<EntityKind> }[], label: string): void {
  const ids = items.map((item) => item.identity.canonicalId);
  if (new Set(ids).size !== ids.length) throw new ParticipantSnapshotError('Hay IDs canónicos duplicados en ' + label + '.');
}

function finalizeSnapshot(
  context: ActiveTournamentContext,
  source: ParticipantSource,
  teams: ParticipantTeam[],
  speakers: ParticipantSpeaker[],
  judges: ParticipantJudge[],
  physicalRooms: ParticipantPhysicalRoom[],
): ParticipantSnapshot {
  uniqueIds(teams, 'equipos');
  uniqueIds(speakers, 'oradores');
  uniqueIds(judges, 'jueces');
  uniqueIds(physicalRooms, 'salas físicas');
  const teamIds = new Set(teams.map((team) => team.identity.canonicalId));
  const judgeIds = new Set(judges.map((judge) => judge.identity.canonicalId));
  for (const speaker of speakers) {
    if (!teamIds.has(speaker.teamId)) throw new ParticipantSnapshotError('El orador ' + speaker.name + ' referencia un equipo inexistente.');
  }
  for (const team of teams) {
    if (team.incompatibleJudgeIds.some((id) => !judgeIds.has(id))) {
      throw new ParticipantSnapshotError('El equipo ' + team.name + ' referencia un juez inexistente.');
    }
  }
  for (const judge of judges) {
    if (judge.incompatibleJudgeIds.some((id) => !judgeIds.has(id))) {
      throw new ParticipantSnapshotError('El juez ' + judge.name + ' referencia un juez incompatible inexistente.');
    }
  }
  return Object.freeze({
    schemaVersion: 1,
    tournamentId: context.tournamentId,
    revision: context.revision,
    updatedAt: context.updatedAt,
    teams: Object.freeze(teams.map((item) => Object.freeze({ ...item, incompatibleJudgeIds: Object.freeze([...item.incompatibleJudgeIds]) }))),
    speakers: Object.freeze(speakers.map((item) => Object.freeze({ ...item }))),
    judges: Object.freeze(judges.map((item) => Object.freeze({ ...item, incompatibleJudgeIds: Object.freeze([...item.incompatibleJudgeIds]) }))),
    physicalRooms: Object.freeze(physicalRooms.map((item) => Object.freeze({ ...item }))),
  });
}

/** Manager IDs are canonical at their source; no name-based resolution is used. */
export function participantSnapshotFromManager(
  context: ActiveTournamentContext,
  input: { teams: readonly Team[]; speakers: readonly Speaker[]; judges: readonly Judge[]; physicalRooms: readonly PhysicalRoom[] },
): ParticipantSnapshot {
  const source: ParticipantSource = 'manager';
  const maps: IdMaps = {};
  const teams = input.teams.map((item) => ({
    identity: makeIdentity('team', item.id, source, maps),
    name: item.name, institution: item.institution, active: item.active,
    incompatibleJudgeIds: item.incompatibleJudgeIds.map((id) => mapId('judge', id, source, maps)),
  }));
  const judges = input.judges.map((item) => ({
    identity: makeIdentity('judge', item.id, source, maps),
    name: item.name, institution: item.institution, active: item.active,
    incompatibleJudgeIds: item.incompatibleJudgeIds.map((id) => mapId('judge', id, source, maps)),
  }));
  const teamIds = new Map(input.teams.map((item) => [item.id, mapId('team', item.id, source, maps)]));
  const speakers = input.speakers.map((item) => {
    const teamId = teamIds.get(item.teamId);
    if (!teamId) throw new ParticipantSnapshotError('El orador ' + item.name + ' referencia un equipo inexistente.');
    return { identity: makeIdentity('speaker', item.id, source, maps), teamId, name: item.name };
  });
  const physicalRooms = input.physicalRooms.map((item) => ({
    identity: makeIdentity('physical-room', item.id, source, maps), name: item.name, active: item.active,
  }));
  return finalizeSnapshot(context, source, teams, speakers, judges, physicalRooms);
}

/** Tabulation must provide explicit local→canonical mappings for every entity and relation. */
export function participantSnapshotFromTabulation(
  context: ActiveTournamentContext,
  input: { teams: readonly TabTeam[]; speakers: readonly TabSpeaker[]; judges: readonly TabJudge[]; venues: readonly TabVenue[] },
  idMap: PanelEntityIdMap,
): ParticipantSnapshot {
  const source: ParticipantSource = 'tabulation';
  const maps: IdMaps = {
    team: idMap.teams, speaker: idMap.speakers, judge: idMap.judges, 'physical-room': idMap.venues,
  };
  const teams = input.teams.map((item) => ({
    identity: makeIdentity('team', item.id, source, maps),
    name: item.name, institution: item.institution, active: item.active,
    incompatibleJudgeIds: item.incompatibleJudgeIds.map((id) => mapId('judge', id, source, maps)),
  }));
  const judges = input.judges.map((item) => ({
    identity: makeIdentity('judge', item.id, source, maps),
    name: item.name, institution: item.institution, active: item.active,
    incompatibleJudgeIds: item.incompatibleJudgeIds.map((id) => mapId('judge', id, source, maps)),
  }));
  const teamIds = new Map(input.teams.map((item) => [item.id, mapId('team', item.id, source, maps)]));
  const speakers = input.speakers.map((item) => {
    const teamId = teamIds.get(item.teamId);
    if (!teamId) throw new ParticipantSnapshotError('El orador ' + item.name + ' referencia un equipo inexistente.');
    return { identity: makeIdentity('speaker', item.id, source, maps), teamId, name: item.name };
  });
  const physicalRooms = input.venues.map((item) => ({
    identity: makeIdentity('physical-room', item.id, source, maps), name: item.name, active: item.active,
  }));
  return finalizeSnapshot(context, source, teams, speakers, judges, physicalRooms);
}

/** Validate snapshots received from persistence or another module before consuming them. */
export function parseParticipantSnapshot(value: unknown): ParticipantSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ParticipantSnapshotError('El snapshot debe ser un objeto.');
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1 || typeof candidate.tournamentId !== 'string'
    || !Number.isSafeInteger(candidate.revision) || (candidate.revision as number) < 0
    || !Number.isSafeInteger(candidate.updatedAt) || (candidate.updatedAt as number) < 0
    || !Array.isArray(candidate.teams) || !Array.isArray(candidate.speakers)
    || !Array.isArray(candidate.judges) || !Array.isArray(candidate.physicalRooms)) {
    throw new ParticipantSnapshotError('La cabecera o las colecciones del snapshot no son válidas.');
  }
  const readIdentity = <K extends EntityKind>(kind: K, value: unknown): EntityIdentity<K> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ParticipantSnapshotError('Identidad inválida.');
    const item = value as Record<string, unknown>;
    if (item.kind !== kind || typeof item.canonicalId !== 'string'
      || typeof item.sourceId !== 'string' || (item.source !== 'manager' && item.source !== 'tabulation')) {
      throw new ParticipantSnapshotError('La identidad de ' + kind + ' no es válida.');
    }
    return entityIdentity(kind, item.canonicalId, item.source as IdentitySource, item.sourceId);
  };
  const readText = (value: unknown, label: string): string => {
    if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new ParticipantSnapshotError(label + ' no es válido.');
    return value;
  };
  const readBoolean = (value: unknown, label: string): boolean => {
    if (typeof value !== 'boolean') throw new ParticipantSnapshotError(label + ' no es válido.');
    return value;
  };
  const readIds = (value: unknown, label: string): string[] => {
    if (!Array.isArray(value)) throw new ParticipantSnapshotError(label + ' debe ser una lista.');
    return value.map((id) => readText(id, label));
  };
  const teams = candidate.teams.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ParticipantSnapshotError('Equipo inválido.');
    const item = raw as Record<string, unknown>;
    return { identity: readIdentity('team', item.identity), name: readText(item.name, 'Nombre de equipo'),
      institution: readText(item.institution, 'Institución'), active: readBoolean(item.active, 'Estado de equipo'),
      incompatibleJudgeIds: readIds(item.incompatibleJudgeIds, 'Incompatibilidades de equipo') };
  });
  const speakers = candidate.speakers.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ParticipantSnapshotError('Orador inválido.');
    const item = raw as Record<string, unknown>;
    return { identity: readIdentity('speaker', item.identity), teamId: readText(item.teamId, 'Equipo del orador'), name: readText(item.name, 'Nombre de orador') };
  });
  const judges = candidate.judges.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ParticipantSnapshotError('Juez inválido.');
    const item = raw as Record<string, unknown>;
    return { identity: readIdentity('judge', item.identity), name: readText(item.name, 'Nombre de juez'),
      institution: readText(item.institution, 'Institución del juez'), active: readBoolean(item.active, 'Estado de juez'),
      incompatibleJudgeIds: readIds(item.incompatibleJudgeIds, 'Incompatibilidades de juez') };
  });
  const physicalRooms = candidate.physicalRooms.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ParticipantSnapshotError('Sala física inválida.');
    const item = raw as Record<string, unknown>;
    return { identity: readIdentity('physical-room', item.identity), name: readText(item.name, 'Nombre de sala'),
      active: readBoolean(item.active, 'Estado de sala') };
  });
  const tournamentId = canonicalId('tournament', candidate.tournamentId);
  const context = Object.freeze({ schemaVersion: 1 as const, tournamentId, revision: candidate.revision as number,
    source: 'server' as const, updatedAt: candidate.updatedAt as number });
  return finalizeSnapshot(context, 'manager', teams, speakers, judges, physicalRooms);
}
