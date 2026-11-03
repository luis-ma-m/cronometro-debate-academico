import { describe, expect, it, vi } from 'vitest';
import { applyTabulationParticipantSnapshot, persistTabulationParticipantSnapshot, sameParticipantDomain } from './tabulationParticipantSync';
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

  it('persists the Tabulation participant projection to Neon using the fetched revision', async () => {
    const save = async (_token: string, revision: number, tournament: Tournament) => ({
      ...tournament, revision: revision + 1, updatedAt: 200,
    });
    const saveSpy = vi.fn(save);
    const result = await persistTabulationParticipantSnapshot('manager-token', snapshot, 7, {
      getTournament: async () => current,
      saveTournament: saveSpy,
    });
    expect(result.changed).toBe(true);
    expect(result.tournament.revision).toBe(8);
    expect(saveSpy).toHaveBeenCalledOnce();
    expect(saveSpy).toHaveBeenCalledWith('manager-token', 7, expect.objectContaining({
      teams: [expect.objectContaining({ id: 'team-canonical' })],
      rounds: current.rounds,
      rooms: current.rooms,
    }));
  });

  it('does not overwrite a newer remote participant revision', async () => {
    const save = vi.fn(async (_token: string, _revision: number, tournament: Tournament) => tournament);
    await expect(persistTabulationParticipantSnapshot('manager-token', snapshot, 6, {
      getTournament: async () => current,
      saveTournament: save,
    })).rejects.toThrow('Conflicto de sincronización');
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects a snapshot for another tournament', () => {
    expect(() => applyTabulationParticipantSnapshot(current, { ...snapshot, tournamentId: 'other' }))
      .toThrow('La instantánea de participantes pertenece a otro torneo.');
  });

  it('does not treat server-generated physical-room timestamps as participant changes', () => {
    const first = applyTabulationParticipantSnapshot(current, snapshot);
    const second = applyTabulationParticipantSnapshot(first, snapshot);
    expect(second.physicalRooms[0].updatedAt).toBeGreaterThanOrEqual(first.physicalRooms[0].updatedAt);
    expect(sameParticipantDomain(first, second)).toBe(true);
  });

  it('does not write to Neon when the participant projection is already current', async () => {
    const currentSnapshot = { ...snapshot, teams: [], speakers: [], judges: [], physicalRooms: [] };
    const save = vi.fn(async (_token: string, _revision: number, tournament: Tournament) => tournament);
    const result = await persistTabulationParticipantSnapshot('manager-token', currentSnapshot, 7, {
      getTournament: async () => current,
      saveTournament: save,
    });
    expect(result.changed).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('detects when the participant projection is already current', () => {
    const projected = applyTabulationParticipantSnapshot(current, snapshot);
    expect(sameParticipantDomain(projected, projected)).toBe(true);
    expect(sameParticipantDomain(current, projected)).toBe(false);
  });
});
