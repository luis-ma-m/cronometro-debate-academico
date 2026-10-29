import { describe, expect, it } from 'vitest';
import { applyJudgeImport, applyTeamImport, applyVenueImport, parseDelimited, parseJudgeLines, parseTeamLines, parseVenueLines, toCsv } from './csv';
import { makeTournament } from './test-fixtures';

describe('pasted lists', () => {
  it('detects tab, semicolon and comma separators and honours quotes', () => {
    expect(parseDelimited('A\tB\nC\tD')).toEqual([['A', 'B'], ['C', 'D']]);
    expect(parseDelimited('"Málaga; A";Universidad de Málaga\r\n\r\nB;C')).toEqual([['Málaga; A', 'Universidad de Málaga'], ['B', 'C']]);
    expect(parseDelimited('Uno, "Dos ""bis"""')).toEqual([['Uno', 'Dos "bis"']]);
  });

  it('reads teams with speakers, skipping a header line', () => {
    const { rows, errors } = parseTeamLines('Equipo;Institución;Orador 1\nMálaga A;Universidad de Málaga;Ana;Luis\n;Sin nombre');
    expect(rows).toEqual([{ name: 'Málaga A', institution: 'Universidad de Málaga', speakers: ['Ana', 'Luis'] }]);
    expect(errors).toEqual(['Línea 3: falta el nombre del equipo.']);
  });

  it('reads judges with level and chair flag', () => {
    const { rows, errors } = parseJudgeLines('Juez;Institución;Nivel;Preside\nAna;LEDU;5;sí\nLuis;;7;no');
    expect(rows).toEqual([
      { name: 'Ana', institution: 'LEDU', rating: 5, canChair: true },
      { name: 'Luis', institution: '', rating: undefined, canChair: false },
    ]);
    expect(errors[0]).toContain('nivel');
    expect(parseVenueLines('Sala\nAula 1\nAula 2').rows).toEqual(['Aula 1', 'Aula 2']);
  });

  it('reads an optional WhatsApp number as a fifth column and updates it', () => {
    const { rows } = parseJudgeLines('Ana;LEDU;5;sí;600 11 22 33');
    expect(rows[0]).toMatchObject({ name: 'Ana', phone: '34600112233' });
    const tournament = applyJudgeImport(makeTournament('aduma', []), rows).tournament;
    expect(tournament.judges[0].phone).toBe('34600112233');
    const updated = applyJudgeImport(tournament, [{ name: 'ana', institution: '', phone: '34611000000' }]);
    expect(updated).toMatchObject({ added: 0, updated: 1 });
    expect(updated.tournament.judges[0].phone).toBe('34611000000');
  });

  it('merges by name instead of duplicating', () => {
    let tournament = makeTournament('ledu-groups', []);
    tournament = applyTeamImport(tournament, [{ name: 'Málaga A', institution: 'UMA', speakers: ['Ana'] }]).tournament;
    const second = applyTeamImport(tournament, [{ name: 'málaga a', institution: 'Universidad de Málaga', speakers: ['Ana', 'Luis'] }]);
    expect(second).toMatchObject({ added: 0, updated: 1 });
    expect(second.tournament.teams[0].institution).toBe('Universidad de Málaga');
    expect(second.tournament.speakers.map((speaker) => speaker.name)).toEqual(['Ana', 'Luis']);
    const judges = applyJudgeImport(applyJudgeImport(tournament, [{ name: 'Eva', institution: 'X' }]).tournament, [{ name: 'EVA', institution: '', rating: 5 }]);
    expect(judges.tournament.judges).toHaveLength(1);
    expect(judges.tournament.judges[0]).toMatchObject({ institution: 'X', rating: 5 });
    expect(applyVenueImport(tournament, ['Aula 1', 'aula 1']).added).toBe(1);
  });
});

describe('CSV export', () => {
  it('uses semicolons, decimal commas, quotes and a BOM', () => {
    expect(toCsv([['Equipo', 'Media'], ['A; B', 12.345]])).toBe('\ufeffEquipo;Media\r\n"A; B";12,35');
  });
});
