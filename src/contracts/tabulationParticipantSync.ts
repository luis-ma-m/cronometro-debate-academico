import type { Tournament } from '../domain';
import type { ParticipantSnapshot } from './participantSnapshot';

/**
 * Applies the participant domain owned by Tabulation to the manager's canonical
 * Neon-backed tournament aggregate. All non-participant manager state (round
 * activation, assignments, timer configuration, scoring and formats) is preserved.
 */
export function applyTabulationParticipantSnapshot(
  current: Tournament,
  snapshot: ParticipantSnapshot,
): Tournament {
  if (!current.remoteId || current.remoteId !== snapshot.tournamentId) {
    throw new Error('La instantánea de participantes pertenece a otro torneo.');
  }
  const teams = snapshot.teams.map((item) => ({
    id: item.identity.canonicalId,
    name: item.name,
    institution: item.institution,
    active: item.active,
    incompatibleJudgeIds: [...item.incompatibleJudgeIds],
  }));
  const speakers = snapshot.speakers.map((item) => ({
    id: item.identity.canonicalId,
    teamId: item.teamId,
    name: item.name,
  }));
  const judges = snapshot.judges.map((item) => ({
    id: item.identity.canonicalId,
    name: item.name,
    institution: item.institution,
    active: item.active,
    incompatibleJudgeIds: [...item.incompatibleJudgeIds],
  }));
  const physicalRooms = snapshot.physicalRooms.map((item) => {
    const previous = current.physicalRooms.find((room) => room.id === item.identity.canonicalId);
    const slug = item.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-ES')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sala';
    const now = Date.now();
    return {
      id: item.identity.canonicalId, slug: previous?.slug ?? slug, name: item.name, active: item.active,
      createdAt: previous?.createdAt ?? now, updatedAt: now,
    };
  });
  const institutions = [...new Set([
    ...(current.institutions ?? []),
    ...teams.map((item) => item.institution),
    ...judges.map((item) => item.institution),
  ].map((item) => item.trim()).filter(Boolean))];
  return { ...current, teams, speakers, judges, physicalRooms, institutions };
}

export async function persistTabulationParticipantSnapshot(
  token: string,
  snapshot: ParticipantSnapshot,
  expectedRevision: number | undefined,
  dependencies: {
    getTournament: (token: string) => Promise<Tournament>;
    saveTournament: (token: string, expectedRevision: number, tournament: Tournament) => Promise<Tournament>;
  },
): Promise<{ tournament: Tournament; changed: boolean }> {
  const remote = await dependencies.getTournament(token);
  if (remote.remoteId !== snapshot.tournamentId) {
    throw new Error('El torneo remoto activo no coincide con el torneo de la instantánea.');
  }
  const candidate = applyTabulationParticipantSnapshot(remote, snapshot);
  if (sameParticipantDomain(remote, candidate)) return { tournament: remote, changed: false };
  if (typeof expectedRevision === 'number' && remote.revision !== expectedRevision) {
    throw new Error('Conflicto de sincronización: Neon ha cambiado desde la última versión confirmada. No se han sobrescrito los cambios remotos.');
  }
  const saved = await dependencies.saveTournament(token, remote.revision, candidate);
  return { tournament: saved, changed: true };
}

export function sameParticipantDomain(left: Tournament, right: Tournament): boolean {
  const project = (value: Tournament) => ({
    teams: value.teams,
    speakers: value.speakers ?? [],
    judges: value.judges,
    physicalRooms: value.physicalRooms,
  });
  return JSON.stringify(project(left)) === JSON.stringify(project(right));
}
