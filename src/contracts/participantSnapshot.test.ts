import { describe, expect, it } from 'vitest';
import type { Team, Speaker, Judge, PhysicalRoom } from '../domain';
import type { TabTeam, TabSpeaker, TabJudge, TabVenue } from '../tabulation/types';
import { activeTournamentContext } from './activeTournamentContext';
import { ParticipantSnapshotError, parseParticipantSnapshot, participantSnapshotFromManager, participantSnapshotFromTabulation } from './participantSnapshot';

const context = activeTournamentContext('tournament-1', 7, 'server', 1_800_000_000_000);

const managerInput = {
  teams: [{ id: 'team-1', name: 'Equipo A', institution: 'UMA', active: true, incompatibleJudgeIds: ['judge-1'] }] as Team[],
  speakers: [{ id: 'speaker-1', teamId: 'team-1', name: 'Orador A' }] as Speaker[],
  judges: [{ id: 'judge-1', name: 'Juez A', institution: 'UCA', active: true, incompatibleJudgeIds: [] }] as Judge[],
  physicalRooms: [{ id: 'room-1', slug: 'sala-1', name: 'Sala 1', active: true, createdAt: 1, updatedAt: 1 }] as PhysicalRoom[],
};

describe('shared participant snapshot', () => {
  it('projects manager entities into immutable canonical DTOs', () => {
    const snapshot = participantSnapshotFromManager(context, managerInput);
    expect(snapshot.teams[0].identity.canonicalId).toBe('team-1');
    expect(snapshot.speakers[0].teamId).toBe('team-1');
    expect(snapshot.teams[0].incompatibleJudgeIds).toEqual(['judge-1']);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.teams[0])).toBe(true);
  });

  it('requires explicit mappings for every tabulation identity and relation', () => {
    const teams = [{ id: 'tab-team', name: 'Equipo A', institution: 'UMA', active: true, swing: false, breakEligible: true, incompatibleJudgeIds: ['tab-judge'] }] as TabTeam[];
    const speakers = [{ id: 'tab-speaker', teamId: 'tab-team', name: 'Orador A' }] as TabSpeaker[];
    const judges = [{ id: 'tab-judge', name: 'Juez A', institution: 'UCA', active: true, rating: 3, canChair: true, incompatibleJudgeIds: [], unavailableRoundIds: [] }] as TabJudge[];
    const venues = [{ id: 'tab-room', name: 'Sala 1', active: true }] as TabVenue[];
    const mappings = { teams: { 'tab-team': 'team-1' }, speakers: { 'tab-speaker': 'speaker-1' },
      judges: { 'tab-judge': 'judge-1' }, venues: { 'tab-room': 'room-1' } };
    const snapshot = participantSnapshotFromTabulation(context, { teams, speakers, judges, venues }, mappings);
    expect(snapshot.teams[0].identity.canonicalId).toBe('team-1');
    expect(snapshot.speakers[0].teamId).toBe('team-1');
    expect(snapshot.physicalRooms[0].identity.canonicalId).toBe('room-1');
    expect(() => participantSnapshotFromTabulation(context, { teams, speakers, judges, venues }, {
      ...mappings, judges: {},
    })).toThrow(ParticipantSnapshotError);
  });

  it('rejects duplicate canonical identities and broken participant relationships', () => {
    expect(() => participantSnapshotFromManager(context, {
      ...managerInput,
      teams: [...managerInput.teams, { ...managerInput.teams[0], name: 'Duplicado' }],
    })).toThrow(ParticipantSnapshotError);
    expect(() => participantSnapshotFromManager(context, {
      ...managerInput,
      speakers: [{ id: 'speaker-1', teamId: 'missing-team', name: 'Orador' }],
    })).toThrow(ParticipantSnapshotError);
  });

  it('parses a snapshot at a module boundary and rejects tampered references', () => {
    const snapshot = participantSnapshotFromManager(context, managerInput);
    expect(parseParticipantSnapshot(snapshot)).toEqual(snapshot);
    const tampered = { ...snapshot, speakers: [{ ...snapshot.speakers[0], teamId: 'missing-team' }] };
    expect(() => parseParticipantSnapshot(tampered)).toThrow(ParticipantSnapshotError);
    expect(() => parseParticipantSnapshot({ ...snapshot, revision: -1 })).toThrow(ParticipantSnapshotError);
  });
});
