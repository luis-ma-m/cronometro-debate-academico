import { describe, expect, it } from 'vitest';
import { validateTournamentInput } from '../../api/core';
import type { Room, Tournament } from '../domain';
import { createTimer, LEDU_PHASES } from '../timer';
import { applyOutboxToPanel, buildOutbox, buildPanelHandoff, mergeHandoff, readHandoff, tournamentFromHandoff, writeHandoff } from './panelBridge';
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
