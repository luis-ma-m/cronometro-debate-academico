import { describe, expect, it } from 'vitest';
import { validateTournamentInput } from '../../api/core';
import type { Room, Tournament } from '../domain';
import { createTimer, LEDU_PHASES } from '../timer';
import { applyOutboxToPanel, buildOutbox, buildPanelHandoff, readHandoff, tournamentFromHandoff, writeHandoff } from './panelBridge';
import { memoryStorage } from './store';
import { qualifyingRound } from './test-fixtures';
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
  const source = panel();
  return {
    ...tab,
    teams: source.teams.map((team) => ({ ...team, swing: false, breakEligible: true })),
    speakers: source.speakers ?? [],
    judges: source.judges.map((judge) => ({ ...judge, rating: 3, canChair: true, unavailableRoundIds: [] })),
    venues: source.physicalRooms.map(({ id, name, active }) => ({ id, name, active })),
    rounds: [qualifyingRound(1, [
      { id: 'd1', venueId: 'physical-a1', teamIds: ['t3', 't1'], favorTeamId: 't1', judgeIds: ['j2'], chairId: 'j2' },
      { id: 'd2', venueId: 'physical-a2', teamIds: ['t2', 't4'], judgeIds: ['j3'], chairId: 'j3' },
    ])],
  };
}

let ids = 0;
const makeId = (prefix: string) => prefix + '-' + ++ids;

describe('panel → tabulation', () => {
  it('opens an empty Tabulation tournament without importing Management participants', () => {
    const storage = memoryStorage();
    writeHandoff(storage, buildPanelHandoff(panel(), now));
    const handoff = readHandoff(storage)!;
    expect(handoff.teams).toEqual([]);
    expect(handoff.speakers).toEqual([]);
    expect(handoff.judges).toEqual([]);
    expect(handoff.venues).toEqual([]);
    const tab = tournamentFromHandoff(handoff, 'uc3m-swiss', now, 1);
    expect(tab.name).toBe('Torneo de prueba');
    expect(tab.teams).toEqual([]);
    expect(tab.judges).toEqual([]);
    expect(tab.venues).toEqual([]);
    expect(tab.speakers).toEqual([]);
    expect(tab.panelLink).toEqual({ tournamentName: 'Torneo de prueba', linkedAt: now });
    expect(readHandoff(memoryStorage({ 'ledu-tabulacion-handoff-v1': '{"format":"otra"}' }))).toBeNull();
  });

  it('keeps Tabulation participant data unchanged when Management sends its link handoff', () => {
    const source = panel();
    const tab = tabRound(tournamentFromHandoff(buildPanelHandoff(source, now), 'ledu-groups', now, 1));
    tab.judges = tab.judges.map((judge) => (judge.id === 'j2' ? { ...judge, rating: 5, canChair: false } : judge));
    const handoff = buildPanelHandoff(source, now);
    const result = tab;
    expect(result.teams.map((team) => team.name)).toEqual(['Equipo A', 'Equipo B', 'Equipo C', 'Equipo D']);
    expect(result.judges.find((judge) => judge.id === 'j2')).toMatchObject({ rating: 5, canChair: false });
    expect(handoff.teams).toEqual([]);
    expect(handoff.judges).toEqual([]);
  });
});

describe('tabulation → panel', () => {
  it('creates the assignments of an empty round and passes the panel and API validation', () => {
    const source = panel();
    const tab = tabRound(tournamentFromHandoff(buildPanelHandoff(source, now), 'ledu-groups', now, 1));
    const { outbox, warnings } = buildOutbox(tab, 'r1', now);
    expect(warnings.join(' ')).toContain('postura provisional');
    const applied = applyOutboxToPanel(source, 'r2', outbox!, { makeId, now });
    expect(applied.issues).toEqual([]);
    const created = applied.rooms!.filter((room) => room.roundId === 'r2');
    expect(created.map((room) => [room.physicalRoomId, room.teamFavorId, room.teamContraId, room.judgeIds, room.status])).toEqual([
      ['physical-a1', 't1', 't3', ['j2'], 'ready'],
      ['physical-a2', 't2', 't4', ['j3'], 'ready'],
    ]);
    expect(applied.summary[1]).toContain('postura provisional');
    const candidate = structuredClone({ ...source, rooms: applied.rooms!, rounds: applied.rounds, formats: applied.formats });
    expect(() => validateTournamentInput(candidate)).not.toThrow();
    expect(applyOutboxToPanel(candidate, 'r2', outbox!, { makeId, now })).toMatchObject({ issues: [], changed: 0 });
  });

  it('transfers the round timer snapshot and makes it authoritative over Management formats', () => {
    const source = panel();
    const tab = tabRound(tournamentFromHandoff(buildPanelHandoff(source, now), 'aduma', now, 1));
    tab.settings.timerPhases = [{ id: 'custom-1', name: 'Intervención común', side: 'favor', speaker: 'A favor', durationSeconds: 75, type: 'opening', warningThresholdsSeconds: [15], allowOvertimeDisplay: false }];
    tab.rounds[0].timerPhases = tab.settings.timerPhases.map((phase) => ({ ...phase }));
    const outbox = buildOutbox(tab, 'r1', now).outbox!;
    expect(outbox.version).toBe(3);
    expect(outbox.presetId).toBe('aduma');
    const applied = applyOutboxToPanel(source, 'r1', outbox, { makeId, now });
    expect(applied.issues).toEqual([]);
    expect(applied.rounds.find((item) => item.id === 'r1')).toMatchObject({ defaultFormatId: 'tabulation-aduma', scoreType: 'qualifying' });
    expect(applied.formats.find((item) => item.id === 'tabulation-aduma')?.phases).toEqual(tab.settings.timerPhases);
    expect(applied.rooms!.find((room) => room.id === 'a1')).toMatchObject({
      formatId: 'tabulation-aduma',
      phases: tab.settings.timerPhases,
      timer: { status: 'idle', remainingSeconds: 75 },
    });
  });

  it('creates missing teams and judges from the tabulation round snapshot', () => {
    const source = panel();
    const tab = tabRound(tournamentFromHandoff(buildPanelHandoff(source, now), 'ledu-groups', now, 1));
    tab.teams = [
      { id: 'tab-team-x', name: 'Equipo importado X', institution: 'Universidad X', active: true, swing: false, breakEligible: true, incompatibleJudgeIds: [] },
      { id: 'tab-team-y', name: 'Equipo importado Y', institution: 'Universidad Y', active: true, swing: false, breakEligible: true, incompatibleJudgeIds: [] },
    ];
    tab.speakers = [];
    tab.judges = [
      { id: 'tab-judge-x', name: 'Jueza importada X', institution: 'Universidad Z', active: true, rating: 4, canChair: true, incompatibleJudgeIds: [], unavailableRoundIds: [] },
    ];
    tab.rounds[0].debates = [{
      ...tab.rounds[0].debates[0],
      teamIds: ['tab-team-x', 'tab-team-y'],
      favorTeamId: 'tab-team-x',
      judgeIds: ['tab-judge-x'],
      chairId: 'tab-judge-x',
    }];
    tab.speakers = [];
    tab.rounds[0].debates = [tab.rounds[0].debates[0]];
    const outbox = buildOutbox(tab, 'r1', now).outbox!;
    expect(outbox.teams?.map((team) => team.id)).toEqual(['tab-team-x', 'tab-team-y']);
    expect(outbox.judges?.map((judge) => judge.id)).toEqual(['tab-judge-x']);
    const applied = applyOutboxToPanel(source, 'r2', outbox, { makeId, now });
    expect(applied.issues).toEqual([]);
    expect(applied.teams.find((team) => team.id === 'tab-team-x')).toMatchObject({ name: 'Equipo importado X', institution: 'Universidad X' });
    expect(applied.judges.find((judge) => judge.id === 'tab-judge-x')).toMatchObject({ name: 'Jueza importada X', institution: 'Universidad Z' });
    expect(applied.institutions).toContain('Universidad Z');
    expect(applied.rooms!.find((room) => room.roundId === 'r2')).toMatchObject({
      teamFavorId: 'tab-team-x', teamContraId: 'tab-team-y', judgeIds: ['tab-judge-x'],
    });
  });

  it('applies the complete Tabulation participant snapshot and updates existing attributes', () => {
    const source = panel();
    const tab = tabRound(tournamentFromHandoff(buildPanelHandoff(source, now), 'ledu-groups', now, 1));
    source.teams.push({ id: 'legacy-team', name: 'Equipo retirado', institution: 'Universidad antigua', active: true, incompatibleJudgeIds: [] });
    source.judges.push({ id: 'legacy-judge', name: 'Juez retirado', institution: 'LEDU', active: true, incompatibleJudgeIds: [] });
    tab.teams[0] = { ...tab.teams[0], name: 'Equipo A actualizado', institution: 'Universidad nueva', active: true };
    tab.judges[1] = { ...tab.judges[1], name: 'Juez 2 actualizado', institution: 'Institución nueva', active: true };
    tab.speakers = [
      { id: 's1', teamId: 't1', name: 'Debatiente actualizado' },
      { id: 's2', teamId: 't1', name: 'Debatiente nuevo' },
    ];
    const outbox = buildOutbox(tab, 'r1', now).outbox!;
    expect(outbox.teams).toHaveLength(tab.teams.length);
    expect(outbox.judges).toHaveLength(tab.judges.length);
    expect(outbox.speakers).toEqual(tab.speakers);
    const applied = applyOutboxToPanel(source, 'r2', outbox, { makeId, now });
    expect(applied.issues).toEqual([]);
    expect(applied.teams.find((team) => team.id === 't1')).toMatchObject({ name: 'Equipo A actualizado', institution: 'Universidad nueva', active: true });
    expect(applied.judges.find((judge) => judge.id === 'j2')).toMatchObject({ name: 'Juez 2 actualizado', institution: 'Institución nueva', active: true });
    expect(applied.teams.find((team) => team.id === 'legacy-team')?.active).toBe(false);
    expect(applied.judges.find((judge) => judge.id === 'legacy-judge')?.active).toBe(false);
    expect(applied.speakers).toContainEqual({ id: 's1', teamId: 't1', name: 'Debatiente actualizado' });
    expect(applied.speakers).toContainEqual({ id: 's2', teamId: 't1', name: 'Debatiente nuevo' });
  });

  it('reuses existing teams and judges by normalized name when imported IDs differ', () => {
    const source = panel();
    const tab = tabRound(tournamentFromHandoff(buildPanelHandoff(source, now), 'ledu-groups', now, 1));
    tab.teams = [
      { id: 'tab-t1', name: '  EQUIPO A ', institution: 'Universidad A', active: true, swing: false, breakEligible: true, incompatibleJudgeIds: [] },
      { id: 'tab-t2', name: 'Equipo B', institution: 'Universidad B', active: true, swing: false, breakEligible: true, incompatibleJudgeIds: [] },
    ];
    tab.speakers = [];
    tab.judges = [
      { id: 'tab-j2', name: 'JUEZ 2', institution: 'LEDU', active: true, rating: 3, canChair: true, incompatibleJudgeIds: [], unavailableRoundIds: [] },
    ];
    tab.rounds[0].debates = [{
      ...tab.rounds[0].debates[0],
      teamIds: ['tab-t1', 'tab-t2'],
      favorTeamId: 'tab-t1',
      judgeIds: ['tab-j2'],
      chairId: 'tab-j2',
    }];
    const outbox = buildOutbox(tab, 'r1', now).outbox!;
    const applied = applyOutboxToPanel(source, 'r2', outbox, { makeId, now });
    expect(applied.issues).toEqual([]);
    expect(applied.addedTeams).toBe(0);
    expect(applied.addedJudges).toBe(0);
    expect(applied.teams).toHaveLength(source.teams.length);
    expect(applied.judges).toHaveLength(source.judges.length);
    expect(applied.rooms!.find((room) => room.roundId === 'r2')).toMatchObject({
      teamFavorId: 't1', teamContraId: 't2', judgeIds: ['j2'],
    });
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

  it('overwrites started and finished rooms and resets their timers instead of blocking import', () => {
    const source = panel();
    source.rooms[0].timer = { ...source.rooms[0].timer, status: 'finished', remainingSeconds: 0 };
    const tab = tabRound(tournamentFromHandoff(buildPanelHandoff(source, now), 'ledu-groups', now, 1));
    const applied = applyOutboxToPanel(source, 'r1', buildOutbox(tab, 'r1', now).outbox!, { makeId, now });
    expect(applied.issues).toEqual([]);
    expect(applied.resetTimers).toBe(1);
    expect(applied.rooms!.find((room) => room.id === 'a1')).toMatchObject({
      teamFavorId: 't1', teamContraId: 't3', judgeIds: ['j2'], timer: { status: 'idle' },
    });
  });

  it('creates missing physical rooms and rejects assignment conflicts', () => {
    const source = panel();
    const tab = tabRound(tournamentFromHandoff(buildPanelHandoff(source, now), 'ledu-groups', now, 1));
    tab.rounds[0].debates[0].judgeIds = ['j1', 'j3'];
    const conflict = buildOutbox(tab, 'r1', now);
    expect(conflict.outbox).toBeNull();
    expect(conflict.issues.join(' ')).toContain('incompatibles');
    tab.rounds[0].debates[0].judgeIds = ['j2'];
    tab.rounds[0].debates[0].venueId = 'tab-sala';
    tab.venues.push({ id: 'tab-sala', name: 'Aula nueva', active: true });
    const imported = applyOutboxToPanel(source, 'r2', buildOutbox(tab, 'r1', now).outbox!, { makeId, now });
    expect(imported.issues).toEqual([]);
    expect(imported.addedPhysicalRooms).toBe(1);
    expect(imported.physicalRooms.find((room) => room.name === 'Aula nueva')).toMatchObject({ name: 'Aula nueva', active: true });
    expect(imported.rooms!.find((room) => room.roundId === 'r2' && room.name === 'Aula nueva')).toMatchObject({ teamFavorId: 't1', teamContraId: 't3', judgeIds: ['j2'] });
  });

  it('reuses physical rooms by normalized name when tabulation IDs differ', () => {
    const source = panel();
    const tab = tabRound(tournamentFromHandoff(buildPanelHandoff(source, now), 'ledu-groups', now, 1));
    tab.venues.find((venue) => venue.id === 'physical-a1')!.name = '  SALA   A1 ';
    tab.rounds[0].debates[0].venueId = 'tab-a1';
    tab.venues.push({ id: 'tab-a1', name: 'sala a1', active: true });
    const imported = applyOutboxToPanel(source, 'r2', buildOutbox(tab, 'r1', now).outbox!, { makeId, now });
    expect(imported.issues).toEqual([]);
    expect(imported.addedPhysicalRooms).toBe(0);
    expect(imported.physicalRooms).toHaveLength(source.physicalRooms.length);
    expect(imported.rooms!.find((room) => room.roundId === 'r2' && room.physicalRoomId === 'physical-a1')).toBeDefined();
  });

  it('reports existing assignments that will be overwritten', () => {
    const source = panel();
    source.rooms.push({ ...source.rooms[0], id: 'a2-r2', name: 'Sala A1', roundId: 'r2', teamFavorId: 't2', teamContraId: 't4', judgeIds: ['j3'] });
    const tab = tabRound(tournamentFromHandoff(buildPanelHandoff(source, now), 'ledu-groups', now, 1));
    const imported = applyOutboxToPanel(source, 'r2', buildOutbox(tab, 'r1', now).outbox!, { makeId, now });
    expect(imported.issues).toEqual([]);
    expect(imported.overwrittenRooms).toBe(1);
    expect(imported.rooms!.find((room) => room.id === 'a2-r2')).toMatchObject({ teamFavorId: 't1', teamContraId: 't3', judgeIds: ['j2'] });
  });

  it('requires a venue for every debate before building the outbox', () => {
    const tab = tabRound(tournamentFromHandoff(buildPanelHandoff(panel(), now), 'ledu-groups', now, 1));
    tab.rounds[0].debates[0].venueId = '';
    expect(buildOutbox(tab, 'r1', now).issues[0]).toContain('sin sala');
  });
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

  it('blocks incompatible judges before creating an outbox under the hard policy', () => {
    const source = panel();
    const tab = tabRound(tournamentFromHandoff(buildPanelHandoff(source, now), 'ledu-groups', now, 1));
    tab.rounds[0].debates[0].judgeIds = ['j1', 'j3'];
    const result = buildOutbox(tab, 'r1', now);
    expect(result.outbox).toBeNull();
    expect(result.issues.join(' ')).toContain('incompatibles');
  });

  it('blocks a judge assigned to two debates even when the room names are identical', () => {
    const source = panel();
    const tab = tabRound(tournamentFromHandoff(buildPanelHandoff(source, now), 'ledu-groups', now, 1));
    tab.venues.find((venue) => venue.id === 'physical-a2')!.name = 'Sala A1';
    tab.rounds[0].debates[1].judgeIds = ['j2'];
    const result = buildOutbox(tab, 'r1', now);
    expect(result.outbox).toBeNull();
    expect(result.issues.join(' ')).toContain('Juez 2 está asignado a Sala A1 y a Sala A1');
  });

  it('blocks a team assigned to two debates in the same round', () => {
    const source = panel();
    const tab = tabRound(tournamentFromHandoff(buildPanelHandoff(source, now), 'ledu-groups', now, 1));
    tab.rounds[0].debates[1].teamIds = ['t1', 't4'];
    const result = buildOutbox(tab, 'r1', now);
    expect(result.outbox).toBeNull();
    expect(result.issues.join(' ')).toContain('Equipo A aparece en');
  });

  it('blocks a favor side that references a team outside the debate', () => {
    const source = panel();
    const tab = tabRound(tournamentFromHandoff(buildPanelHandoff(source, now), 'ledu-groups', now, 1));
    tab.rounds[0].debates[0].favorTeamId = 't4';
    const result = buildOutbox(tab, 'r1', now);
    expect(result.outbox).toBeNull();
    expect(result.issues.join(' ')).toContain('no pertenece a este debate');
  });
});
