import { describe, expect, it } from 'vitest';
import { describeChanges, mergeChanges } from './changes';
import { ballots, debate, jointDecided, makeTournament, qualifyingRound, result } from './test-fixtures';
import type { TabTournament } from './types';

function base(): TabTournament {
  const tournament = makeTournament('aduma', ['a', 'b', 'c', 'd'], ['j1', 'j2'], 2);
  tournament.rounds = [qualifyingRound(1, [jointDecided('d1', 'a', 'b', 40, 30), debate('d2', 'c', 'd', ['j2'])])];
  return tournament;
}

const lines = (before: TabTournament, after: TabTournament) => describeChanges(before, after).map((change) => change.label + ': ' + (change.before ?? '') + ' → ' + (change.after ?? '')).join('\n');

describe('describeChanges (rest of the tournament)', () => {
  it('describes speakers, rounds, the draft and the bracket', () => {
    const before = base();
    const after = structuredClone(before);
    after.speakers[0].name = 'Ana';
    after.speakers.pop();
    after.rounds[0].silent = true;
    after.rounds[0].pushedAt = 5;
    after.rounds.push(qualifyingRound(2, [debate('d3', 'a', 'c', [])]));
    after.draftRound = { round: qualifyingRound(3, [debate('d4', 'b', 'd', [])]), generated: qualifyingRound(3, []), seed: 1, kind: 'swiss', fingerprint: '', createdAt: 0, editHistory: [] };
    after.groups = [{ id: 'g', name: 'Grupo A', teamIds: ['a', 'b'] }];
    after.breakSeeds = ['a', 'c'];
    after.manualOrder = ['c', 'a'];
    after.panelLink = { tournamentName: 'Panel', linkedAt: 1 };
    const text = lines(before, after);
    expect(text).toContain('Orador 1 de a: nombre: Orador 1 de a → Ana');
    expect(text).toContain('Orador eliminado: Orador 4 de d → ');
    expect(text).toContain('Ronda 1: cerrada: no → sí');
    expect(text).toContain('Ronda 1: enviada al panel:  → sí');
    expect(text).toContain('Ronda añadida:  → Ronda 2');
    expect(text).toContain('Borrador de ronda:  → borrador de Ronda 3 (1 debates)');
    expect(text).toContain('Grupos:  → Grupo A: Equipo a, Equipo b');
    expect(text).toContain('Clasificados para eliminatorias:  → Equipo a, Equipo c');
    expect(text).toContain('Orden manual de desempate:  → Equipo c, Equipo a');
    expect(text).toContain('Enlace con el panel:  → Panel');
    expect(lines(after, { ...after, rounds: after.rounds.slice(0, 1) })).toContain('Ronda eliminada: Ronda 2 → ');
  });

  it('notices an edited draft and an acta whose summary does not change', () => {
    const before = base();
    before.draftRound = { round: qualifyingRound(2, [debate('d3', 'a', 'c', [])]), generated: qualifyingRound(2, []), seed: 1, kind: 'swiss', fingerprint: '', createdAt: 0, editHistory: [] };
    const after = structuredClone(before);
    after.draftRound!.round.debates[0].venueId = 'v1';
    after.rounds[0].debates[0].result!.notes = 'Reclamación resuelta';
    const text = lines(before, after);
    expect(text).toContain('Borrador de ronda: borrador de Ronda 2 (1 debates) → borrador de Ronda 2 (1 debates) (modificado)');
    expect(text).toContain('Ronda 1 · Equipo a – Equipo b: acta (detalle): versión anterior → modificada');
  });

  it('summarizes manual decisions, judge ballots and faults in actas', () => {
    const before = base();
    const after = structuredClone(before);
    after.rounds[0].debates[0].result = result([], {
      override: { winnerTeamId: 'b', reason: 'Reclamación' },
      penalties: { a: { warnings: 1, minors: 2, majors: 0, disqualified: true } },
    });
    after.rounds[0].debates[1].result = result(ballots('c', 'd', [[70, 60]], ['j2']));
    const text = lines(before, after);
    expect(text).toContain('decisión manual: gana Equipo b (Reclamación)');
    expect(text).toContain('faltas: Equipo a 1A/2L/0G descalificado');
    expect(text).toContain('Ronda 1 · Equipo c – Equipo d: acta: sin acta → Juez j2: Equipo c 70, Equipo d 60');
  });

  it('keeps later field edits of an entity added in the same group as part of its creation', () => {
    const merged = mergeChanges(
      [{ key: 'team:x', label: 'Equipo añadido', before: '', after: 'Nuevo', added: true }],
      [{ key: 'team:x:name', label: 'Nuevo: nombre', before: 'Nuevo', after: 'Nuevo equipo' }, { key: 'team:x:institution', label: 'Nuevo: institución', before: '', after: 'UMA' }],
    );
    expect(merged).toEqual([{ key: 'team:x', label: 'Equipo añadido', before: '', after: 'Nuevo equipo', added: true }]);
  });
});
