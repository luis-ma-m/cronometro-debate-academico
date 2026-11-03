import { describe, expect, it } from 'vitest';
import { applyTabulationParticipantSnapshot, sameParticipantDomain } from './tabulationParticipantSync';
import type { Tournament } from '../domain';
import type { ParticipantSnapshot } from './participantSnapshot';

const current = {
  remoteId: 'tournament-1', tournamentName: 'Torneo', revision: 7, updatedAt: 100,
  teams: [], speakers: [], judges: [], physicalRooms: [], rounds: [{ id: 'round-1' }],
  rooms: [{ id: 'room-1' }], formats: [], activeRoundId: 'round-1', activationRevision: 3,
  activatedAt: 90, scoring: { categories: [] }, institutions: ['Institución antigua'],
} as unknown as Tournament;

const snapshot = {
  schemaVersion: 1, tournamentId: 'tournament-1', revision: 4, updatedAt: 120,
  teams: [{ identity: { kind: 'team', canonicalId: 'team-canonical', source: 'tabulation', sourceId: 'team-local' }, name: 'Equipo A', institution: 'Universidad A', active: true, incompatibleJudgeIds: ['judge-canonical'] }],
  speakers: [{ identity: { kind: 'speaker', canonicalId: 'speaker-canonical', source: 'tabulation', sourceId: 'speaker-local' }, teamId: 'team-canonical', name: 'Orador A' }],
  judges: [{ identity: { kind: 'judge', canonicalId: 'judge-canonical', source: 'tabulation', sourceId: 'judge-local' }, name: 'Jueza A', institution: 'Universidad B', active: true, incompatibleJudgeIds: [] }],
  physicalRooms: [{ identity: { kind: 'physical-room', canonicalId: 'venue-canonical', source: 'tabulation', sourceId: 'venue-local' }, name: 'Sala A', active: true }],
} as unknown as ParticipantSnapshot;

describe('Tabulation participant persistence adapter', () => {
  it('projects canonical IDs and preserves all manager-owned operational state', () => {
    const result = applyTabulationParticipantSnapshot(current, snapshot);
    expect(result.teams[0]).toMatchObject({ id: 'team-canonical', name: 'Equipo A', incompatibleJudgeIds: ['judge-canonical'] });
    expect(result.speakers?.[0]).toMatchObject({ id: 'speaker-canonical', teamId: 'team-canonical' });
    expect(result.judges[0].id).toBe('judge-canonical');
    expect(result.physicalRooms[0]).toMatchObject({ id: 'venue-canonical', slug: 'sala-a' });
    expect(result.rounds).toEqual(current.rounds);
    expect(result.rooms).toEqual(current.rooms);
    expect(result.activeRoundId).toBe(current.activeRoundId);
    expect(result.revision).toBe(current.revision);
    expect(result.institutions).toEqual(['Institución antigua', 'Universidad A', 'Universidad B']);
  });

  it('rejects a snapshot for another tournament', () => {
    expect(() => applyTabulationParticipantSnapshot(current, { ...snapshot, tournamentId: 'other' }))
      .toThrow('La instantánea de participantes pertenece a otro torneo.');
  });

  it('detects when the participant projection is already current', () => {
    const projected = applyTabulationParticipantSnapshot(current, snapshot);
    expect(sameParticipantDomain(projected, projected)).toBe(true);
    expect(sameParticipantDomain(current, projected)).toBe(false);
  });
});
