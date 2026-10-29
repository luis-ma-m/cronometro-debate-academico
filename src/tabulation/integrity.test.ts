import { describe, expect, it } from 'vitest';
import { checkIntegrity } from './integrity';
import { debate, jointDecided, judge, makeTournament, qualifyingRound, team } from './test-fixtures';

describe('checkIntegrity', () => {
  it('finds nothing wrong in a clean tournament', () => {
    const tournament = makeTournament('aduma', ['a', 'b', 'c', 'd'], ['j1', 'j2'], 2);
    tournament.settings.expectedTeams = 4;
    tournament.rounds = [qualifyingRound(1, [jointDecided('d1', 'a', 'b'), { ...jointDecided('d2', 'c', 'd'), judgeIds: ['j2'], chairId: 'j2' }])];
    expect(checkIntegrity(tournament)).toEqual({ errors: [], warnings: [] });
  });

  it('reports duplicated ids, broken references and double bookings', () => {
    const tournament = makeTournament('aduma', ['a', 'b', 'c', 'd'], ['j1'], 2);
    tournament.teams.push(team('a', 'Otra'));
    tournament.rounds = [
      qualifyingRound(1, [debate('d1', 'a', 'b', ['j1']), debate('d2', 'a', 'ghost', ['j1', 'nadie'])]),
      qualifyingRound(1, [debate('d1', 'c', 'd', [])], { id: 'r1b' }),
    ];
    tournament.rounds[0].debates[0].venueId = 'v1';
    tournament.rounds[0].debates[1].venueId = 'v1';
    tournament.breakSeeds = ['zz'];
    tournament.judgeConflicts = [{ id: 'c', judgeId: 'nadie', teamId: 'a', level: 'objective', note: '' }];
    const { errors, warnings } = checkIntegrity(tournament);
    const text = errors.join('\n');
    expect(text).toContain('equipos con el mismo identificador');
    expect(text).toContain('debates con el mismo identificador');
    expect(text).toContain('Ronda 1: Equipo a aparece en dos debates');
    expect(text).toContain('Ronda 1: Juez j1 está en dos paneles');
    expect(text).toContain('Ronda 1: la sala Aula 1 se usa dos veces');
    expect(text).toContain('equipo que no existe');
    expect(text).toContain('juez que no existe');
    expect(text).toContain('Dos rondas tienen el número 1');
    expect(warnings.join('\n')).toContain('clasificados');
    expect(warnings.join('\n')).toContain('incompatibilidad de un juez que no existe');
  });

  it('warns about institutions written in two ways, which would hide a conflict', () => {
    const tournament = makeTournament('aduma', ['a', 'b', 'c'], [], 0);
    tournament.teams[0].institution = 'Universidad de Málaga';
    tournament.teams[1].institution = 'universidad de malaga ';
    tournament.teams[2].institution = 'Universidad de Granada';
    tournament.judges = [judge('j1', { institution: 'Universidad  de Málaga' })];
    const warnings = checkIntegrity(tournament).warnings.join('\n');
    expect(warnings).toContain('«Universidad de Málaga»');
    expect(warnings).toContain('«universidad de malaga »');
    expect(warnings).not.toContain('Granada');
  });

  it('flags a pending draft that collides with a confirmed round', () => {
    const tournament = makeTournament('aduma', ['a', 'b'], [], 0);
    const round = qualifyingRound(1, [debate('d1', 'a', 'b', [])]);
    tournament.rounds = [round];
    tournament.draftRound = { round: { ...round, id: 'otro' }, generated: round, seed: 1, kind: 'swiss', fingerprint: '', createdAt: 0, editHistory: [] };
    expect(checkIntegrity(tournament).errors.join(' ')).toContain('borrador');
  });

  it('warns when the number of teams does not match the expected one', () => {
    const tournament = makeTournament('aduma', ['a', 'b', 'c'], [], 0);
    expect(checkIntegrity(tournament).warnings.join(' ')).toContain('3 equipos activos de 20 previstos');
  });
});
