import { describe, expect, it } from 'vitest';
import { validateTournamentInput } from '../../server/core.js';
import type { Room, Tournament } from '../domain';
import { createTimer, LEDU_PHASES } from '../timer';
import { appendPanelPublishAcknowledgement, applyOutboxToPanel, buildOutbox, buildPanelHandoff, mergeHandoff, readHandoff, readPanelPublishAcknowledgements, removePanelPublishAcknowledgements, PANEL_PUBLISH_ACK_KEY, suggestPanelEntityMatches, validatePanelEntityIdMap, tournamentFromHandoff, writeHandoff } from './panelBridge';
import { memoryStorage } from './store';
import { qualifyingRound } from './test-fixtures';
import { createTabTournament } from './presets';
import { normalizeTabTournament } from './normalize';
import type { TabTournament } from './types';

const now = 1_800_000_000_000;

function panel(): Tournament {
  const phases = LEDU_PHASES.map((phase) => ({ ...phase }));
  const room: Room = {
    id: 'a1', name: 'Sala A1', roundId: 'r1', physicalRoomId: 'physical-a1', formatId: '', teamFavorId: 't1', teamContraId: 't2',
    judgeIds: ['j1'], status: 'ready', phases, timer: createTimer(phases), notes: '', updatedAt: now,
  };
  return {
    tournamentName: 'Torneo de prueba',
    rounds: [
      { id: 'r1', number: 1, name: 'Ronda 1', active: true, defaultFormatId: 'format-ledu' },
      { id: 'r2', number: 2, name: 'Ronda 2', active: false, defaultFormatId: 'format-ledu' },
    ],
    teams: ['A', 'B', 'C', 'D'].map((letter, i) => ({ id: 't' + (i + 1), name: 'Equipo ' + letter, institution: 'Universidad ' + letter, active: true, incompatibleJudgeIds: [] })),
    speakers: [{ id: 's1', teamId: 't1', name: 'Ana' }],
    judges: [1, 2, 3].map((n) => ({ id: 'j' + n, name: 'Juez ' + n, institution: 'LEDU', active: true, incompatibleJudgeIds: n === 1 ? ['j3'] : n === 3 ? ['j1'] : [] })),
    rooms: [room],
    physicalRooms: ['a1', 'a2'].map((slug) => ({ id: 'physical-' + slug, slug: 'sala-' + slug, name: 'Sala ' + slug.toUpperCase(), active: true, createdAt: now, updatedAt: now })),
    formats: [{ id: 'format-ledu', name: 'LEDU', phases, version: 1, createdAt: now, updatedAt: now }],
    activeRoundId: 'r1', activationRevision: 1, activatedAt: now, formatPhases: phases, minimumJudgesPerRoom: 1, revision: 1, updatedAt: now,
  };
}

function tabRound(tab: TabTournament): TabTournament {
  return {
    ...tab,
    rounds: [qualifyingRound(1, [
      { id: 'd1', venueId: 'physical-a1', teamIds: ['t3', 't1'], favorTeamId: 't1', judgeIds: ['j2'], chairId: 'j2' },
      { id: 'd2', venueId: 'physical-a2', teamIds: ['t2', 't4'], judgeIds: ['j3'], chairId: 'j3' },
    ])],
  };
}

let ids = 0;
const makeId = (prefix: string) => prefix + '-' + ++ids;

describe('panel → tabulation', () => {
  it('creates a tabulation with the panel participants and the same IDs', () => {
    const storage = memoryStorage();
    writeHandoff(storage, buildPanelHandoff(panel(), now));
    const tab = tournamentFromHandoff(readHandoff(storage)!, 'uc3m-swiss', now, 1);
    expect(tab.name).toBe('Torneo de prueba');
    expect(tab.teams.map((team) => team.id)).toEqual(['t1', 't2', 't3', 't4']);
    expect(tab.judges.find((judge) => judge.id === 'j1')!.incompatibleJudgeIds).toEqual(['j3']);
    expect(tab.venues.map((venue) => venue.id)).toEqual(['physical-a1', 'physical-a2']);
    expect(tab.speakers).toEqual([{ id: 's1', teamId: 't1', name: 'Ana' }]);
    expect(tab.panelLink).toEqual({ tournamentName: 'Torneo de prueba', linkedAt: now });
    expect(readHandoff(memoryStorage({ 'ledu-tabulacion-handoff-v1': '{"format":"otra"}' }))).toBeNull();
  });


  it('carries the canonical manager identity into a newly created tabulation', () => {
    const source = { ...panel(), remoteId: 'remote-tournament-123' };
    const handoff = buildPanelHandoff(source, now);
    expect(handoff.tournamentId).toBe('remote-tournament-123');
    const tab = tournamentFromHandoff(handoff, 'ledu-groups', now, 1);
    expect(tab.panelLink).toEqual({
      tournamentName: 'Torneo de prueba',
      linkedAt: now,
      remoteId: 'remote-tournament-123',
      remoteRevision: 1,
      remoteUpdatedAt: now,
      idMap: {
        teams: { t1: 't1', t2: 't2', t3: 't3', t4: 't4' },
        speakers: { s1: 's1' },
        judges: { j1: 'j1', j2: 'j2', j3: 'j3' },
        venues: { 'physical-a1': 'physical-a1', 'physical-a2': 'physical-a2' },
      },
    });
  });


  it('rejects a stale snapshot without touching the local tournament', () => {
    const source = { ...panel(), remoteId: 'remote-tournament-123' };
    const linked = tournamentFromHandoff(buildPanelHandoff(source, now), 'ledu-groups', now, 1);
    const stale = buildPanelHandoff({ ...panel(), remoteId: 'remote-tournament-123' }, now - 1);
    stale.revision = 0;
    const result = mergeHandoff(linked, stale, now);
    expect(result.issues.join(' ')).toContain('más antiguo');
    expect(result.tournament).toBe(linked);
  });

  it('refuses to merge a handoff from another remote tournament, even when the name matches', () => {
    const original = { ...panel(), remoteId: 'remote-tournament-A' };
    const linked = tournamentFromHandoff(buildPanelHandoff(original, now), 'ledu-groups', now, 1);
    const foreign = buildPanelHandoff({ ...panel(), remoteId: 'remote-tournament-B' }, now + 1);
    const result = mergeHandoff(linked, foreign, now + 1);
    expect(result.issues).toHaveLength(1);
    expect(result.tournament).toBe(linked);
    expect(result.added).toBe(0);
    expect(result.updated).toBe(0);
  });

  it('does not bind an unlinked local tournament by name when the manager provides a remote identity', () => {
    const local = createTabTournament('Torneo de prueba', 'ledu-groups', now, 1);
    const handoff = buildPanelHandoff({ ...panel(), remoteId: 'remote-tournament-123' }, now);
    const result = mergeHandoff(local, handoff, now);
    expect(result.issues[0]).toContain('no está vinculado');
    expect(result.tournament).toBe(local);
  });



  it('links an existing local tournament only through the reviewed map and remaps references', () => {
    const local = createTabTournament('Copia local', 'ledu-groups', now, 1);
    local.teams = [{ id: 'local-team', name: 'Equipo A', institution: 'Universidad A', active: true, swing: false, breakEligible: true, incompatibleJudgeIds: [] }];
    local.speakers = [{ id: 'local-speaker', teamId: 'local-team', name: 'Ana' }];
    local.judges = [{ id: 'local-judge', name: 'Juez 1', institution: 'LEDU', active: true, rating: 5, canChair: false, incompatibleJudgeIds: [], unavailableRoundIds: [] }];
    local.venues = [{ id: 'local-venue', name: 'Sala A1', active: true }];
    const remote = panel();
    remote.teams = [{ id: 'remote-team', name: 'Equipo A', institution: 'Universidad A', active: true, incompatibleJudgeIds: ['remote-judge'] }];
    remote.speakers = [{ id: 'remote-speaker', teamId: 'remote-team', name: 'Ana' }];
    remote.judges = [{ id: 'remote-judge', name: 'Juez 1', institution: 'LEDU', active: true, incompatibleJudgeIds: [] }];
    remote.physicalRooms = [{ id: 'remote-venue', slug: 'sala-a1', name: 'Sala A1', active: true, createdAt: now, updatedAt: now }];
    const handoff = buildPanelHandoff({ ...remote, remoteId: 'remote-tournament-123' }, now);
    const idMap = {
      teams: { 'local-team': 'remote-team' },
      speakers: { 'local-speaker': 'remote-speaker' },
      judges: { 'local-judge': 'remote-judge' },
      venues: { 'local-venue': 'remote-venue' },
    };
    const result = mergeHandoff(local, handoff, now, idMap);
    expect(result.issues).toEqual([]);
    expect(result.tournament.teams.map((item) => item.id)).toEqual(['local-team']);
    expect(result.tournament.speakers).toEqual([{ id: 'local-speaker', teamId: 'local-team', name: 'Ana' }]);
    expect(result.tournament.teams[0].incompatibleJudgeIds).toEqual(['local-judge']);
    expect(result.tournament.judges[0]).toMatchObject({ id: 'local-judge', rating: 5, canChair: false });
    expect(result.tournament.venues.map((item) => item.id)).toEqual(['local-venue']);
    expect(result.tournament.panelLink?.idMap).toEqual(idMap);
  });


  it('creates new local IDs for unmapped remote entities and persists their mappings', () => {
    const local = createTabTournament('Copia local', 'ledu-groups', now, 1);
    local.teams = [{ id: 'local-team', name: 'Equipo local', institution: '', active: true, swing: false, breakEligible: true, incompatibleJudgeIds: [] }];
    const handoff = buildPanelHandoff({ ...panel(), remoteId: 'remote-tournament-123' }, now);
    const result = mergeHandoff(local, handoff, now, { teams: {}, speakers: {}, judges: {}, venues: {} });
    expect(result.issues).toEqual([]);
    expect(result.tournament.teams).toHaveLength(5);
    expect(result.tournament.teams.some((item) => item.id === 't1')).toBe(false);
    expect(Object.values(result.tournament.panelLink!.idMap!.teams)).toContain('t1');
    expect(new Set(result.tournament.teams.map((item) => item.id)).size).toBe(5);
  });

  it('refuses to map an orator onto a local speaker whose team is not mapped to the same remote team', () => {
    const local = createTabTournament('Copia local', 'ledu-groups', now, 1);
    local.teams = [{ id: 'local-team', name: 'Equipo local', institution: '', active: true, swing: false, breakEligible: true, incompatibleJudgeIds: [] }];
    local.speakers = [{ id: 'local-speaker', teamId: 'local-team', name: 'Ana' }];
    const handoff = buildPanelHandoff({ ...panel(), remoteId: 'remote-tournament-123' }, now);
    const result = mergeHandoff(local, handoff, now, { teams: {}, speakers: { 'local-speaker': 's1' }, judges: {}, venues: {} });
    expect(result.issues.join(' ')).toContain('no pertenece al equipo local');
    expect(result.tournament).toBe(local);
  });

  it('preserves the reviewed identity map when normalizing a local tournament', () => {
    const source = tournamentFromHandoff(buildPanelHandoff({ ...panel(), remoteId: 'remote-tournament-123' }, now), 'ledu-groups', now, 1);
    const normalized = normalizeTabTournament(source).tournament;
    expect(normalized.panelLink?.idMap).toEqual(source.panelLink?.idMap);
    expect(normalized.panelLink?.remoteRevision).toBe(1);
    expect(normalized.panelLink?.remoteUpdatedAt).toBe(now);
  });

  it('suggests possible entity matches without accepting them', () => {
    const local = createTabTournament('Copia local', 'ledu-groups', now, 1);
    local.teams = [{ ...local.teams[0], id: 'local-team', name: 'Equipo Á', institution: 'Universidad A' }];
    const remote = { ...panel(), teams: [{ id: 'remote-team', name: 'Equipo A', institution: 'Universidad A', active: true, incompatibleJudgeIds: [] }] };
    const suggestions = suggestPanelEntityMatches(local, buildPanelHandoff(remote, now));
    expect(suggestions).toContainEqual({ kind: 'teams', localId: 'local-team', remoteId: 'remote-team', reason: 'name-and-institution' });
    expect(local.panelLink).toBeUndefined();
  });

  it('rejects many-to-one and stale identity mappings', () => {
    const local = createTabTournament('Copia local', 'ledu-groups', now, 1);
    local.teams = [{ id: 'local-team', name: 'Equipo local', institution: '', active: true, swing: false, breakEligible: true, incompatibleJudgeIds: [] }];
    const handoff = buildPanelHandoff(panel(), now);
    const errors = validatePanelEntityIdMap(local, handoff, {
      teams: { 'local-team': 't1', 'other-local': 't1', 'missing-local': 'missing-remote' },
      speakers: {}, judges: {}, venues: {},
    });
    expect(errors.join(' ')).toContain('más de una entidad local');
    expect(errors.join(' ')).toContain('no existe');
  });

  it('merges idempotently and respects which side owns each field', () => {
    const source = panel();
    let tab = tournamentFromHandoff(buildPanelHandoff(source, now), 'ledu-groups', now, 1);
    tab = { ...tab, judges: tab.judges.map((judge) => (judge.id === 'j2' ? { ...judge, rating: 5, canChair: false } : judge)) };
    expect(mergeHandoff(tab, buildPanelHandoff(source, now), now)).toMatchObject({ added: 0, updated: 0, warnings: [] });
    source.teams[0].name = 'Equipo A renombrado';
    source.judges.push({ id: 'j4', name: 'Juez 4', institution: 'LEDU', active: true, incompatibleJudgeIds: [] });
    source.tournamentName = 'Otro torneo';
    const merged = mergeHandoff(tab, buildPanelHandoff(source, now), now);
    expect(merged).toMatchObject({ added: 1, updated: 1 });
    expect(merged.tournament.teams[0].name).toBe('Equipo A renombrado');
    expect(merged.tournament.judges.find((judge) => judge.id === 'j2')).toMatchObject({ rating: 5, canChair: false });
    expect(merged.warnings[0]).toContain('Torneo de prueba');
  });
});

describe('tabulation → panel', () => {
  it('accepts a manager-owned speaker team reassignment after the tournament is linked', () => {
    const source = panel();
    const tab = tournamentFromHandoff(buildPanelHandoff(source, now), 'ledu-groups', now, 1);
    source.speakers = (source.speakers ?? []).map((speaker) => speaker.id === 's1' ? { ...speaker, teamId: 't2' } : speaker);
    const merged = mergeHandoff(tab, buildPanelHandoff(source, now + 1), now + 1);
    expect(merged.issues).toEqual([]);
    expect(merged.tournament.speakers.find((speaker) => speaker.id === 's1')?.teamId).toBe('t2');
  });

  it('synchronizes manager-owned active flags without overwriting tabulation-only judge fields', () => {
    const source = panel();
    const tab = tournamentFromHandoff(buildPanelHandoff(source, now), 'ledu-groups', now, 1);
    source.teams[0].active = false;
    source.judges[0].active = false;
    source.physicalRooms[0].active = false;
    const merged = mergeHandoff(tab, buildPanelHandoff(source, now), now);
    expect(merged.tournament.teams.find((team) => team.id === 't1')?.active).toBe(false);
    expect(merged.tournament.judges.find((judge) => judge.id === 'j1')).toMatchObject({ active: false, rating: 3, canChair: true });
    expect(merged.tournament.venues.find((venue) => venue.id === 'physical-a1')?.active).toBe(false);
  });

  it('creates the assignments of an empty round and passes the panel and API validation', () => {
    const source = panel();
    const tab = tabRound(tournamentFromHandoff(buildPanelHandoff(source, now), 'ledu-groups', now, 1));
    const { outbox, warnings } = buildOutbox(tab, 'r1', now);
    expect(warnings.join(' ')).toContain('postura provisional');
    expect(outbox).toMatchObject({ roundName: 'Ronda 1', roundNumber: 1, roundKind: 'qualifying' });
    const applied = applyOutboxToPanel(source, 'r2', outbox!, { makeId, now });
    expect(applied.issues).toEqual([]);
    const created = applied.rooms!.filter((room) => room.roundId === 'r2');
    expect(created.map((room) => [room.physicalRoomId, room.teamFavorId, room.teamContraId, room.judgeIds, room.status])).toEqual([
      ['physical-a1', 't1', 't3', ['j2'], 'ready'],
      ['physical-a2', 't2', 't4', ['j3'], 'ready'],
    ]);
    expect(applied.summary[1]).toContain('postura provisional');
    const candidate = structuredClone({ ...source, rooms: applied.rooms! });
    expect(() => validateTournamentInput(candidate)).not.toThrow();
    expect(applyOutboxToPanel({ ...source, rooms: applied.rooms! }, 'r2', outbox!, { makeId, now })).toMatchObject({ issues: [], changed: 0 });
  });

  it('reuses and empties the existing assignments of the round', () => {
    const source = panel();
    const tab = tabRound(tournamentFromHandoff(buildPanelHandoff(source, now), 'ledu-groups', now, 1));
    tab.rounds[0].debates = tab.rounds[0].debates.slice(1);
    const applied = applyOutboxToPanel(source, 'r1', buildOutbox(tab, 'r1', now).outbox!, { makeId, now });
    const rounds = applied.rooms!.filter((room) => room.roundId === 'r1');
    expect(rounds.find((room) => room.id === 'a1')).toMatchObject({ teamFavorId: '', teamContraId: '', judgeIds: [], status: 'unassigned' });
    expect(rounds.find((room) => room.physicalRoomId === 'physical-a2')).toMatchObject({ teamFavorId: 't2', teamContraId: 't4' });
  });

  it('refuses the whole push when a started or scored room would change', () => {
    const source = panel();
    source.rooms[0].timer = { ...source.rooms[0].timer, status: 'finished' };
    const tab = tabRound(tournamentFromHandoff(buildPanelHandoff(source, now), 'ledu-groups', now, 1));
    const applied = applyOutboxToPanel(source, 'r1', buildOutbox(tab, 'r1', now).outbox!, { makeId, now });
    expect(applied.rooms).toBeNull();
    expect(applied.issues[0]).toContain('cronómetro');
  });

  it('rejects conflicts the panel would not save and entities the panel does not know', () => {
    const source = panel();
    const tab = tabRound(tournamentFromHandoff(buildPanelHandoff(source, now), 'ledu-groups', now, 1));
    tab.rounds[0].debates[0].judgeIds = ['j1', 'j3'];
    expect(applyOutboxToPanel(source, 'r2', buildOutbox(tab, 'r1', now).outbox!, { makeId, now }).issues.join(' ')).toContain('incompatibles');
    tab.rounds[0].debates[0].venueId = 'tab-sala';
    tab.venues.push({ id: 'tab-sala', name: 'Aula nueva', active: true });
    expect(applyOutboxToPanel(source, 'r2', buildOutbox(tab, 'r1', now).outbox!, { makeId, now }).issues.join(' ')).toContain('no existe en el panel');
  });

  it('requires a venue for every debate before building the outbox', () => {
    const tab = tabRound(tournamentFromHandoff(buildPanelHandoff(panel(), now), 'ledu-groups', now, 1));
    tab.rounds[0].debates[0].venueId = '';
    expect(buildOutbox(tab, 'r1', now).issues[0]).toContain('sin sala');
  });
});


  it('translates local entity IDs through the reviewed map before sending a round', () => {
    const source = { ...panel(), remoteId: 'remote-tournament-123' };
    const tab = tabRound(tournamentFromHandoff(buildPanelHandoff(source, now), 'ledu-groups', now, 1));
    tab.panelLink!.idMap = {
      teams: { t1: 't3', t2: 't4', t3: 't1', t4: 't2' },
      speakers: { s1: 's1' },
      judges: { j2: 'j3', j3: 'j2' },
      venues: { 'physical-a1': 'physical-a2', 'physical-a2': 'physical-a1' },
    };
    const { outbox, issues } = buildOutbox(tab, 'r1', now);
    expect(issues).toEqual([]);
    expect(outbox).toMatchObject({
      tournamentId: 'remote-tournament-123',
      basePanelRevision: 1,
      basePanelUpdatedAt: now,
      debates: [
        { physicalRoomId: 'physical-a2', teamFavorId: 't3', teamContraId: 't1', judgeIds: ['j3'] },
        { physicalRoomId: 'physical-a1', teamFavorId: 't4', teamContraId: 't2', judgeIds: ['j2'] },
      ],
    });
    const applied = applyOutboxToPanel(source, 'r2', outbox!, { makeId, now });
    expect(applied.issues).toEqual([]);
    expect(applied.rooms!.filter((room) => room.roundId === 'r2').map((room) => [room.physicalRoomId, room.teamFavorId, room.teamContraId, room.judgeIds])).toEqual([
      ['physical-a2', 't3', 't1', ['j3']],
      ['physical-a1', 't4', 't2', ['j2']],
    ]);
  });

  it('rejects a round proposal for a different manager tournament identity', () => {
    const source = { ...panel(), remoteId: 'remote-tournament-123' };
    const tab = tabRound(tournamentFromHandoff(buildPanelHandoff(source, now), 'ledu-groups', now, 1));
    const outbox = buildOutbox(tab, 'r1', now).outbox!;
    const result = applyOutboxToPanel({ ...source, remoteId: 'another-tournament' }, 'r2', outbox, { makeId, now });
    expect(result.rooms).toBeNull();
    expect(result.issues.join(' ')).toContain('otra identidad');
  });

  it('rejects a round proposal when the manager revision changed after the tabulation snapshot', () => {
    const source = { ...panel(), remoteId: 'remote-tournament-123' };
    const tab = tabRound(tournamentFromHandoff(buildPanelHandoff(source, now), 'ledu-groups', now, 1));
    const outbox = buildOutbox(tab, 'r1', now).outbox!;
    const result = applyOutboxToPanel({ ...source, revision: source.revision + 1, updatedAt: now + 1 }, 'r2', outbox, { makeId, now });
    expect(result.rooms).toBeNull();
    expect(result.issues.join(' ')).toContain('El gestor ha cambiado');
  });

  it('requires a manager mapping for every linked entity used by the proposed round', () => {
    const source = { ...panel(), remoteId: 'remote-tournament-123' };
    const tab = tabRound(tournamentFromHandoff(buildPanelHandoff(source, now), 'ledu-groups', now, 1));
    delete tab.panelLink!.idMap!.teams.t1;
    const result = buildOutbox(tab, 'r1', now);
    expect(result.outbox).toBeNull();
    expect(result.issues.join(' ')).toContain('no tiene correspondencia');
  });

describe('ADUMA rounds sent to the panel', () => {
  it('skips debates against a fallen team, which are not held', () => {
    const source = panel();
    const tab = tabRound(tournamentFromHandoff(buildPanelHandoff(source, now), 'aduma', now, 1));
    tab.teams.find((team) => team.id === 't4')!.fallenFromRound = 1;
    tab.rounds[0].debates[1] = { ...tab.rounds[0].debates[1], venueId: '', judgeIds: [], chairId: '' };
    const { outbox, issues, warnings } = buildOutbox(tab, 'r1', now);
    expect(issues).toEqual([]);
    expect(outbox!.debates.map((debate) => debate.physicalRoomId)).toEqual(['physical-a1']);
    expect(warnings.join(' ')).toContain('caído');
    expect(applyOutboxToPanel(source, 'r2', outbox!, { makeId, now }).issues).toEqual([]);
  });

  it('leaves out, with a warning, judges seated as a last resort that the panel would reject', () => {
    const source = panel();
    source.judges[1].institution = 'Universidad A';
    const tab = tabRound(tournamentFromHandoff(buildPanelHandoff(source, now), 'aduma', now, 1));
    // j2 shares institution with Equipo A; j1 and j3 are incompatible with each other.
    tab.rounds[0].debates[0] = { ...tab.rounds[0].debates[0], judgeIds: ['j2'], chairId: 'j2' };
    tab.rounds[0].debates[1] = { ...tab.rounds[0].debates[1], judgeIds: ['j3', 'j1'], chairId: 'j3' };
    const { outbox, warnings } = buildOutbox(tab, 'r1', now);
    expect(outbox!.debates.map((debate) => [debate.judgeIds, debate.chairId])).toEqual([[[], ''], [['j3'], 'j3']]);
    expect(warnings.join(' ')).toContain('Juez 2');
    expect(warnings.join(' ')).toContain('Juez 1');
    expect(applyOutboxToPanel(source, 'r2', outbox!, { makeId, now }).issues).toEqual([]);
  });

  it('keeps sending conflicts as they are under the hard policy, so the panel refuses them', () => {
    const source = panel();
    const tab = tabRound(tournamentFromHandoff(buildPanelHandoff(source, now), 'ledu-groups', now, 1));
    tab.rounds[0].debates[0].judgeIds = ['j1', 'j3'];
    expect(buildOutbox(tab, 'r1', now).outbox!.debates[0].judgeIds).toEqual(['j1', 'j3']);
  });
});


describe('Tabulation publication acknowledgements', () => {
  it('persists, deduplicates and consumes manager assignment mappings', () => {
    const storage = memoryStorage();
    const acknowledgement = {
      version: 1 as const,
      operationId: 'publish-op-0001',
      tabTournamentId: 'tab-tournament-1',
      tabulationRoundId: 'tab-round-1',
      managerRoundId: 'manager-round-1',
      revision: 8,
      debateAssignments: [{ tabulationDebateId: 'tab-debate-1', assignmentId: '00000000-0000-4000-8000-000000000001' }],
    };
    appendPanelPublishAcknowledgement(storage, acknowledgement);
    appendPanelPublishAcknowledgement(storage, acknowledgement);
    expect(readPanelPublishAcknowledgements(storage)).toEqual([acknowledgement]);
    removePanelPublishAcknowledgements(storage, ['publish-op-0001']);
    expect(readPanelPublishAcknowledgements(storage)).toEqual([]);
    expect(storage.getItem(PANEL_PUBLISH_ACK_KEY)).toBeNull();
  });

  it('ignores malformed or tampered assignment mappings', () => {
    const storage = memoryStorage({
      [PANEL_PUBLISH_ACK_KEY]: JSON.stringify([{
        version: 1, operationId: 'bad', tabTournamentId: 'tab-tournament-1',
        tabulationRoundId: 'tab-round-1', managerRoundId: 'manager-round-1', revision: 8,
        debateAssignments: [{ tabulationDebateId: 'tab-debate-1', assignmentId: 'not-a-uuid' }],
      }]),
    });
    expect(readPanelPublishAcknowledgements(storage)).toEqual([]);
  });
});
