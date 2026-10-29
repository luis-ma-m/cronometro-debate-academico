import { describe, expect, it } from 'vitest';
import { allocateJudges, hungarian, roundIssues } from './adjudication';
import { createRng } from './random';
import { debate, decided, judge, makeTournament, qualifyingRound } from './test-fixtures';

function permutations(items: number[], size: number): number[][] {
  if (!size) return [[]];
  return items.flatMap((item) => permutations(items.filter((other) => other !== item), size - 1).map((rest) => [item, ...rest]));
}

describe('hungarian', () => {
  it('matches brute force on random rectangular matrices', () => {
    const rng = createRng(11);
    for (let trial = 0; trial < 60; trial++) {
      const rows = 1 + Math.floor(rng() * 4);
      const cols = rows + Math.floor(rng() * 3);
      const matrix = Array.from({ length: rows }, () => Array.from({ length: cols }, () => Math.floor(rng() * 50)));
      const total = (assignment: number[]) => assignment.reduce((sum, col, row) => sum + matrix[row][col], 0);
      const best = Math.min(...permutations(Array.from({ length: cols }, (_, i) => i), rows).map(total));
      const assignment = hungarian(matrix);
      expect(new Set(assignment).size).toBe(rows);
      expect(total(assignment)).toBe(best);
    }
  });
});

function roundWith(debates: number, judges: number) {
  const teamIds = Array.from({ length: debates * 2 }, (_, i) => 't' + i);
  const tournament = makeTournament('ledu-groups', teamIds, Array.from({ length: judges }, (_, i) => 'j' + i), debates);
  const round = qualifyingRound(1, Array.from({ length: debates }, (_, i) => ({ ...debate('d' + i, 't' + 2 * i, 't' + (2 * i + 1), []), venueId: 'v' + (i + 1) })));
  tournament.rounds = [round];
  return { tournament, round };
}

describe('judge allocation', () => {
  it('fills odd panels with a chair and never seats a conflicted judge', () => {
    const { tournament, round } = roundWith(3, 9);
    tournament.judges[0] = judge('j0', { institution: 'Inst t0' });
    tournament.judges[1] = judge('j1', { canChair: false, rating: 5 });
    tournament.teams[3].incompatibleJudgeIds = ['j2'];
    tournament.judges[3] = judge('j3', { incompatibleJudgeIds: ['j4'] });
    const { debates, warnings } = allocateJudges(tournament, round.id, { replace: true, seed: 1 });
    expect(warnings).toEqual([]);
    expect(debates.map((item) => item.judgeIds.length)).toEqual([3, 3, 3]);
    expect(debates.find((item) => item.teamIds.includes('t0'))!.judgeIds).not.toContain('j0');
    expect(debates.find((item) => item.teamIds.includes('t3'))!.judgeIds).not.toContain('j2');
    expect(debates.some((item) => item.judgeIds.includes('j3') && item.judgeIds.includes('j4'))).toBe(false);
    expect(debates.every((item) => item.judgeIds.includes(item.chairId) && item.chairId !== 'j1')).toBe(true);
    expect(roundIssues({ ...tournament, rounds: [{ ...round, debates }] }, { ...round, debates }).get('d0')).toEqual([]);
  });

  it('shrinks the least important panels to one judge instead of leaving even panels', () => {
    const { tournament, round } = roundWith(2, 4);
    const { debates, warnings } = allocateJudges(tournament, round.id, { replace: true, seed: 1 });
    expect(debates.map((item) => item.judgeIds.length).sort()).toEqual([1, 3]);
    expect(warnings.join(' ')).toContain('panel menor');
  });

  it('leaves a debate empty when every judge conflicts with it', () => {
    const { tournament, round } = roundWith(1, 2);
    tournament.judges = tournament.judges.map((item) => ({ ...item, institution: 'Inst t0' }));
    const { debates, warnings } = allocateJudges(tournament, round.id, { replace: true, seed: 1 });
    expect(debates[0].judgeIds).toEqual([]);
    expect(warnings.join(' ')).toContain('sin jueces');
  });

  it('keeps manual judges and only fills the remaining seats', () => {
    const { tournament, round } = roundWith(2, 6);
    round.debates[0].judgeIds = ['j5'];
    round.debates[0].chairId = 'j5';
    const { debates } = allocateJudges(tournament, round.id, { replace: false, seed: 2 });
    expect(debates[0].judgeIds[0]).toBe('j5');
    expect(debates[0].chairId).toBe('j5');
    expect(debates.map((item) => item.judgeIds.length)).toEqual([3, 3]);
  });

  it('avoids judges who already saw the same teams when it can', () => {
    const { tournament } = roundWith(1, 2);
    tournament.rounds = [
      qualifyingRound(1, [{ ...decided('old', 't0', 't1'), judgeIds: ['j0'], chairId: 'j0' }]),
      qualifyingRound(2, [{ ...debate('new', 't0', 't1', []), venueId: 'v1' }], { panelSize: 1 }),
    ];
    const { debates } = allocateJudges(tournament, tournament.rounds[1].id, { replace: true, seed: 3 });
    expect(debates[0].judgeIds).toEqual(['j1']);
  });

  it('reports double bookings, rematches and conflicts in the draw', () => {
    const tournament = makeTournament('ledu-groups', ['a', 'b', 'c', 'd'], ['j1'], 2);
    tournament.judges[0].institution = 'Inst a';
    const previous = qualifyingRound(1, [decided('1', 'a', 'b')]);
    const current = qualifyingRound(2, [
      { ...debate('2', 'a', 'b', ['j1']), venueId: 'v1' },
      { ...debate('3', 'c', 'a', ['j1']), venueId: 'v1' },
    ]);
    tournament.rounds = [previous, current];
    const issues = roundIssues(tournament, current);
    expect(issues.get('2')!.join(' ')).toContain('ya se enfrentaron');
    expect(issues.get('2')!.join(' ')).toContain('comparten institución');
    expect(issues.get('3')!.join(' ')).toContain('dos debates');
    expect(issues.get('3')!.join(' ')).toContain('dos paneles');
    expect(issues.get('3')!.join(' ')).toContain('sala se repite');
  });
});
