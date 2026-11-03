import { describe, expect, it } from 'vitest';
import {
  CANONICAL_TOURNAMENT_KEY,
  createCanonicalTournamentRepository,
  migrateLegacyTournamentStorage,
} from './canonicalTournamentRepository';
import type { Tournament } from '../domain';
import type { TabTournament } from '../tabulation/types';

function storage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

const manager = (patch: Partial<Tournament> = {}) => ({
  remoteId: 'remote-1', tournamentName: 'Liga', rounds: [], teams: [
    { id: 'team-manager', name: 'Equipo actualizado', institution: 'UMA', active: true, incompatibleJudgeIds: ['judge-manager'] },
  ], speakers: [{ id: 'speaker-manager', teamId: 'team-manager', name: 'Oradora' }],
  judges: [{ id: 'judge-manager', name: 'Jueza', institution: 'UMA', active: true, incompatibleJudgeIds: [] }],
  rooms: [], physicalRooms: [], formats: [], activeRoundId: '', activationRevision: 1, activatedAt: 1,
  revision: 2, updatedAt: 2, ...patch,
} as unknown as Tournament);

const tabulation = (patch: Partial<TabTournament> = {}) => ({
  schemaVersion: 2, id: 'tab-1', name: 'Liga tab', createdAt: 1, updatedAt: 3, revision: 1, seed: 1,
  settings: {}, teams: [{ id: 'team-tab', name: 'Nombre antiguo', institution: 'Antigua', active: true, swing: true, breakEligible: false, incompatibleJudgeIds: [] }],
  speakers: [{ id: 'speaker-tab', teamId: 'team-tab', name: 'Nombre anterior' }],
  judges: [{ id: 'judge-tab', name: 'Jueza anterior', institution: 'Antigua', active: true, rating: 4, canChair: true, incompatibleJudgeIds: [], unavailableRoundIds: [] }],
  venues: [{ id: 'venue-tab', name: 'Sala' }], groups: [], rounds: [], breakSeeds: [], manualOrder: [],
  panelLink: { tournamentName: 'Liga', linkedAt: 1, remoteId: 'remote-1', idMap: {
    teams: { 'team-tab': 'team-manager' }, speakers: { 'speaker-tab': 'speaker-manager' },
    judges: { 'judge-tab': 'judge-manager' }, venues: {},
  } },
  judgeConflicts: [], logTail: [], logSeq: 0, ...patch,
} as unknown as TabTournament);

describe('canonical tournament repository', () => {
  it('stores manager and tabulation entities once under explicit shared identities', () => {
    const local = storage();
    const repository = createCanonicalTournamentRepository(local, () => 10);
    repository.writeManager(manager());
    repository.writeTabulation(tabulation());

    const raw = JSON.parse(local.getItem(CANONICAL_TOURNAMENT_KEY)!);
    expect(Object.keys(raw.entities)).toHaveLength(4);
    expect(Object.keys(raw.entities).some((key) => key.includes('|team|team-manager'))).toBe(true);
    expect(repository.readManager<Tournament>()?.teams[0]).toMatchObject({ id: 'team-manager', name: 'Equipo actualizado' });
    expect(repository.readTabulation<TabTournament>('tab-1')?.teams[0]).toMatchObject({
      id: 'team-tab', name: 'Equipo actualizado', institution: 'UMA', swing: true, breakEligible: false, incompatibleJudgeIds: ['judge-tab'],
    });
    expect(repository.readTabulation<TabTournament>('tab-1')?.speakers[0]).toMatchObject({
      id: 'speaker-tab', teamId: 'team-tab', name: 'Oradora',
    });
    expect(repository.readTabulation<TabTournament>('tab-1')?.judges[0]).toMatchObject({
      id: 'judge-tab', name: 'Jueza', institution: 'UMA', rating: 4,
    });
    expect(repository.readTabulation<TabTournament>('tab-1')?.teams[0].incompatibleJudgeIds).toEqual(['judge-tab']);
  });

  it('does not merge entities by name or by an absent mapping', () => {
    const local = storage();
    const repository = createCanonicalTournamentRepository(local);
    repository.writeManager(manager());
    repository.writeTabulation(tabulation({ panelLink: { tournamentName: 'Liga', linkedAt: 1, remoteId: 'remote-1' } }));
    const raw = JSON.parse(local.getItem(CANONICAL_TOURNAMENT_KEY)!);
    expect(Object.keys(raw.entities).filter((key) => key.includes('|team|'))).toHaveLength(2);
  });

  it('prunes deleted source records without deleting the other module record', () => {
    const local = storage();
    const repository = createCanonicalTournamentRepository(local);
    repository.writeManager(manager());
    repository.writeTabulation(tabulation());
    repository.writeManager(manager({ teams: [], speakers: [], judges: [], physicalRooms: [] }));
    expect(repository.readManager<Tournament>()?.teams).toEqual([]);
    expect(repository.readTabulation<TabTournament>('tab-1')?.teams[0]).toMatchObject({ id: 'team-tab', swing: true });
  });

  it('migrates old snapshots on first read and leaves the legacy bytes intact', () => {
    const legacyManager = manager();
    const legacyTab = tabulation();
    const local = storage({
      'ledu-tournament-demo-v1': JSON.stringify(legacyManager),
      'ledu-tabulacion-index-v1': JSON.stringify({ activeId: 'tab-1', tournaments: [{ id: 'tab-1', name: 'Liga', updatedAt: 3 }] }),
      'ledu-tabulacion-v1:tab-1': JSON.stringify(legacyTab),
    });
    migrateLegacyTournamentStorage(local);
    const repository = createCanonicalTournamentRepository(local);
    expect(repository.readManager<Tournament>()?.teams[0].id).toBe('team-manager');
    expect(repository.readTabulation<TabTournament>('tab-1')?.teams[0].id).toBe('team-tab');
    expect(local.getItem('ledu-tournament-demo-v1')).toBe(JSON.stringify(legacyManager));
    expect(local.getItem('ledu-tabulacion-v1:tab-1')).toBe(JSON.stringify(legacyTab));
    repository.deleteTabulation('tab-1');
    migrateLegacyTournamentStorage(local);
    expect(repository.readTabulation<TabTournament>('tab-1')).toBeNull();
  });
  it('never overwrites a malformed canonical document during legacy migration', () => {
    const malformed = '{broken';
    const local = storage({
      [CANONICAL_TOURNAMENT_KEY]: malformed,
      'ledu-tournament-demo-v1': JSON.stringify(manager()),
    });
    expect(() => migrateLegacyTournamentStorage(local)).not.toThrow();
    expect(local.getItem(CANONICAL_TOURNAMENT_KEY)).toBe(malformed);
    expect(local.getItem('ledu-tournament-demo-v1')).not.toBeNull();
  });
  it('keeps a tombstone so a deleted legacy tournament cannot reappear', () => {
    const legacy = JSON.stringify(tabulation());
    const local = storage({ 'ledu-tabulacion-v1:tab-1': legacy });
    const repository = createCanonicalTournamentRepository(local);
    repository.writeTabulation(tabulation());
    repository.deleteTabulation('tab-1');
    expect(repository.readTabulation('tab-1')).toBeNull();
    expect(repository.isTabulationDeleted('tab-1')).toBe(true);
    expect(local.getItem('ledu-tabulacion-v1:tab-1')).toBe(legacy);
  });
  it('recovers tabulation bytes held only by the superseded shared projection', () => {
    const legacyTab = tabulation();
    const index = { activeId: 'tab-1', tournaments: [{ id: 'tab-1', name: 'Liga', updatedAt: 3 }] };
    const local = storage({
      'ledu-shared-tournament-v1': JSON.stringify({
        manager: manager(),
        tabulation: {
          'ledu-tabulacion-index-v1': JSON.stringify(index),
          'ledu-tabulacion-v1:tab-1': JSON.stringify(legacyTab),
        },
      }),
    });
    migrateLegacyTournamentStorage(local);
    const repository = createCanonicalTournamentRepository(local);
    expect(repository.readTabulation<TabTournament>('tab-1')?.teams[0].id).toBe('team-tab');
    expect(local.getItem('ledu-shared-tournament-v1')).not.toBeNull();
  });
  it('stores rounds and published assignments once when their explicit IDs are linked', () => {
    const local = storage();
    const repository = createCanonicalTournamentRepository(local);
    repository.writeManager(manager({
      rounds: [{ id: 'round-manager', number: 1, name: 'Ronda oficial', active: true, defaultFormatId: 'format-1' }],
      rooms: [{
        id: 'room-manager', assignmentId: 'assignment-manager', name: 'Sala 1', roundId: 'round-manager',
        physicalRoomId: 'venue-manager', formatId: 'format-1', teamFavorId: 'team-manager',
        teamContraId: 'team-opponent', judgeIds: ['judge-manager'], status: 'ready', phases: [],
        timer: {}, notes: '', updatedAt: 2,
      }],
    }));
    repository.writeTabulation(tabulation({
      rounds: [{
        id: 'round-tab', number: 1, name: 'Ronda local', kind: 'qualifying', sideMode: 'balanced',
        panelSize: 1, seed: 1, silent: false, createdAt: 1, managerRoundId: 'round-manager',
        debates: [{
          id: 'debate-tab', venueId: 'venue-tab', teamIds: ['team-tab', 'other-team'], judgeIds: ['judge-tab'],
          chairId: 'judge-tab', managerAssignmentId: 'assignment-manager',
        }],
      }],
    }));
    const raw = JSON.parse(local.getItem(CANONICAL_TOURNAMENT_KEY)!);
    expect(Object.keys(raw.entities).filter((key) => key.includes('|round|round-manager'))).toHaveLength(1);
    expect(Object.keys(raw.entities).filter((key) => key.includes('|assignment|assignment-manager'))).toHaveLength(1);
    expect(repository.readManager<Tournament>()?.rounds[0]).toMatchObject({ id: 'round-manager', name: 'Ronda oficial' });
    expect(repository.readManager<Tournament>()?.rooms[0]).toMatchObject({
      id: 'room-manager', assignmentId: 'assignment-manager',
    });
    expect(repository.readTabulation<TabTournament>('tab-1')?.rounds[0]).toMatchObject({
      id: 'round-tab', name: 'Ronda oficial', managerRoundId: 'round-manager',
      debates: [{ id: 'debate-tab', managerAssignmentId: 'assignment-manager' }],
    });
  });
});
