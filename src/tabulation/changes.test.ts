import { describe, expect, it } from 'vitest';
import { describeChanges, mergeChanges, summarizeChanges } from './changes';
import { judge, jointDecided, makeTournament, qualifyingRound, team } from './test-fixtures';
import type { TabTournament } from './types';

function base(): TabTournament {
  const tournament = makeTournament('aduma', ['a', 'b', 'c', 'd'], ['j1', 'j2'], 2);
  tournament.rounds = [qualifyingRound(1, [jointDecided('d1', 'a', 'b', 40, 30), { ...jointDecided('d2', 'c', 'd', 38, 36), result: undefined }])];
  return tournament;
}

const labels = (before: TabTournament, after: TabTournament) => describeChanges(before, after).map((change) => change.label + ': ' + (change.before ?? '') + ' → ' + (change.after ?? ''));

describe('describeChanges', () => {
  it('returns nothing for the same tournament or a copy with only bookkeeping changes', () => {
    const tournament = base();
    expect(describeChanges(tournament, tournament)).toEqual([]);
    expect(describeChanges(tournament, { ...structuredClone(tournament), updatedAt: 5, revision: 9, logSeq: 4 })).toEqual([]);
  });

  it('describes team, judge and room changes by name', () => {
    const before = base();
    const after = structuredClone(before);
    after.teams[0].name = 'Equipo Alfa';
    after.teams[1].fallenFromRound = 2;
    after.teams.push(team('e'));
    after.judges = after.judges.filter((item) => item.id !== 'j2');
    after.judges[0].active = false;
    after.venues[1].name = 'Aula Magna';
    const lines = labels(before, after).join('\n');
    expect(lines).toContain('Equipo a: nombre: Equipo a → Equipo Alfa');
    expect(lines).toContain('Equipo b: caído desde la ronda:  → 2');
    expect(lines).toContain('Equipo añadido:  → Equipo e');
    expect(lines).toContain('Juez eliminado: Juez j2 → ');
    expect(lines).toContain('Juez j1: disponible: sí → no');
    expect(lines).toContain('Aula 2: nombre: Aula 2 → Aula Magna');
  });

  it('describes rule changes and listed incompatibilities', () => {
    const before = base();
    const after = structuredClone(before);
    after.settings.swissRounds = 5;
    after.judgeConflicts = [{ id: 'c1', judgeId: 'j1', teamId: 'a', level: 'subjective', note: 'Ex entrenador' }];
    const lines = labels(before, after).join('\n');
    expect(lines).toContain('Reglas · swissRounds: 4 → 5');
    expect(lines).toContain('Incompatibilidad añadida:  → Juez j1 · Equipo a · subjetiva (Ex entrenador)');
  });

  it('describes actas and pairings of a round', () => {
    const before = base();
    const after = structuredClone(before);
    after.rounds[0].debates[1] = jointDecided('d2', 'd', 'c', 41, 39);
    after.rounds[0].debates[0].judgeIds = ['j2'];
    after.rounds[0].debates[0].chairId = 'j2';
    const lines = labels(before, after).join('\n');
    expect(lines).toContain('Ronda 1 · Equipo c – Equipo d: acta: sin acta → gana Equipo d');
    expect(lines).toContain('Ronda 1 · Equipo a – Equipo b: jurado: Juez j1 → Juez j2');
  });

  it('describes judges added later in the round by an unknown id without failing', () => {
    const before = base();
    const after = structuredClone(before);
    after.judges.push(judge('j3'));
    after.rounds[0].debates[0].judgeIds = ['ghost'];
    expect(() => describeChanges(before, after)).not.toThrow();
    expect(labels(before, after).join('\n')).toContain('juez desconocido');
  });
});

describe('mergeChanges', () => {
  it('keeps the first value before and the last value after, and drops changes that were undone', () => {
    const first = [{ key: 'team:a:name', label: 'Equipo a: nombre', before: 'A', after: 'AB' }, { key: 'x', label: 'x', before: '1', after: '2' }];
    const second = [{ key: 'team:a:name', label: 'Equipo a: nombre', before: 'AB', after: 'ABC' }, { key: 'x', label: 'x', before: '2', after: '1' }];
    expect(mergeChanges(first, second)).toEqual([{ key: 'team:a:name', label: 'Equipo a: nombre', before: 'A', after: 'ABC' }]);
  });

  it('summarizes a list of changes in one line', () => {
    expect(summarizeChanges([])).toBe('Sin cambios.');
    const many = Array.from({ length: 5 }, (_, i) => ({ key: 'k' + i, label: 'Cambio ' + i, before: '', after: '' }));
    expect(summarizeChanges(many)).toBe('5 cambios: Cambio 0; Cambio 1; Cambio 2 y 2 más.');
  });
});
