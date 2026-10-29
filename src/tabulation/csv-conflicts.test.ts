import { describe, expect, it } from 'vitest';
import { applyConflictImport, parseConflictLines } from './csv';
import { makeTournament } from './test-fixtures';

function tournament() {
  const value = makeTournament('aduma', ['a', 'b'], ['j1', 'j2'], 0);
  value.teams[0].institution = 'Universidad de Málaga';
  return value;
}

describe('pasted judge incompatibilities', () => {
  it('matches judges, teams and institutions ignoring case and accents, and reports what it does not recognise', () => {
    const { rows, errors } = parseConflictLines([
      'Juez;Equipo o institución;Tipo;Nota',
      'juez J1;equipo a;objetiva;Entrenador',
      'Juez j2;universidad de malaga;Subjetiva',
      'Juez j3;Equipo a;objetiva',
      'Juez j1;Nadie;subjetiva',
      'Juez j1;Equipo b;quizá',
    ].join('\n'), tournament());
    expect(rows).toEqual([
      { judgeId: 'j1', teamId: 'a', level: 'objective', note: 'Entrenador' },
      { judgeId: 'j2', institution: 'Universidad de Málaga', level: 'subjective', note: '' },
    ]);
    expect(errors).toEqual([
      'Línea 4: no se encuentra el juez «Juez j3».',
      'Línea 5: «Nadie» no es ningún equipo ni institución.',
      'Línea 6: el tipo debe ser «objetiva» o «subjetiva».',
    ]);
  });

  it('adds new incompatibilities and updates the ones already listed', () => {
    const base = tournament();
    const first = applyConflictImport(base, parseConflictLines('Juez j1;Equipo a;objetiva\nJuez j2;Universidad de Málaga;subjetiva', base).rows);
    expect(first).toMatchObject({ added: 2, updated: 0 });
    const again = applyConflictImport(first.tournament, parseConflictLines('Juez j1;Equipo a;subjetiva;Cambio\nJuez j2;UNIVERSIDAD DE MALAGA;subjetiva', base).rows);
    expect(again).toMatchObject({ added: 0, updated: 1 });
    expect(again.tournament.judgeConflicts.map((item) => [item.judgeId, item.teamId ?? item.institution, item.level, item.note])).toEqual([
      ['j1', 'a', 'subjective', 'Cambio'], ['j2', 'Universidad de Málaga', 'subjective', ''],
    ]);
  });
});
