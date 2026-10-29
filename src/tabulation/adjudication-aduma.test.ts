import { describe, expect, it } from 'vitest';
import snapshot from './fixtures/allocation-snapshot.json';
import ledu from './fixtures/v1-ledu.json';
import uc3m from './fixtures/v1-uc3m.json';
import { ALLOCATION_COST, allocateJudges, allocateJudgesForRound, roundIssues } from './adjudication';
import { normalizeTabTournament } from './normalize';
import { debate, judge, makeTournament, qualifyingRound, team } from './test-fixtures';
import type { TabJudgeConflict, TabTournament } from './types';

function adumaRound(debateCount: number, judgeCount: number): TabTournament {
  const teamIds = Array.from({ length: debateCount * 2 }, (_, i) => 't' + i);
  const tournament = makeTournament('aduma', teamIds, Array.from({ length: judgeCount }, (_, i) => 'j' + i), debateCount);
  tournament.rounds = [qualifyingRound(1, Array.from({ length: debateCount }, (_, i) => ({ ...debate('d' + i, 't' + 2 * i, 't' + (2 * i + 1), []), venueId: 'v' + (i + 1) })))];
  return tournament;
}
const conflict = (judgeId: string, target: { teamId?: string; institution?: string }, level: TabJudgeConflict['level']): TabJudgeConflict => ({ id: judgeId + level, judgeId, ...target, level, note: '' });

describe('ADUMA judge allocation', () => {
  it('allows panels of two: 25 judges for 10 rooms give 5×3 + 5×2', () => {
    const tournament = adumaRound(10, 25);
    const { debates } = allocateJudges(tournament, 'r1', { replace: true, seed: 1 });
    expect(debates.map((item) => item.judgeIds.length).sort()).toEqual([2, 2, 2, 2, 2, 3, 3, 3, 3, 3]);
    expect(roundIssues(tournament, { ...tournament.rounds[0], debates }).get('d0')!.join(' ')).not.toContain('par');
  });

  it('seats an objective conflict only when the debate would otherwise have no judge, never as a wing', () => {
    const tournament = adumaRound(1, 2);
    tournament.judges = [judge('j0', { institution: 'Inst t0' }), judge('j1')];
    let result = allocateJudges(tournament, 'r1', { replace: true, seed: 1 });
    expect(result.debates[0].judgeIds).toEqual(['j1']);
    tournament.judges = [judge('j0', { institution: 'Inst t0' })];
    result = allocateJudges(tournament, 'r1', { replace: true, seed: 1 });
    expect(result.debates[0].judgeIds).toEqual(['j0']);
    expect(result.warnings.join(' ')).toContain('objetiva');
  });

  it('applies listed conflicts per team and per institution with their level', () => {
    const tournament = adumaRound(2, 6);
    tournament.teams = tournament.teams.map((item, i) => ({ ...item, institution: i < 2 ? 'UGR' : 'UMA' }));
    tournament.judgeConflicts = [conflict('j0', { institution: 'UGR' }, 'objective'), conflict('j1', { teamId: 't0' }, 'subjective')];
    const { debates } = allocateJudges(tournament, 'r1', { replace: true, seed: 2 });
    const ugr = debates.find((item) => item.teamIds.includes('t0'))!;
    expect(ugr.judgeIds).not.toContain('j0');
    expect(ugr.judgeIds).not.toContain('j1');
  });

  it('uses a subjective conflict as a wing judge rather than leaving the seat empty', () => {
    const tournament = adumaRound(1, 3);
    tournament.judgeConflicts = [conflict('j2', { teamId: 't1' }, 'subjective')];
    const { debates, warnings } = allocateJudges(tournament, 'r1', { replace: true, seed: 3 });
    expect(debates[0].judgeIds).toHaveLength(3);
    expect(debates[0].chairId).not.toBe('j2');
    expect(warnings.join(' ')).toContain('subjetiva');
  });

  it('does not staff debates against a fallen team', () => {
    const tournament = adumaRound(2, 6);
    tournament.teams.find((item) => item.id === 't3')!.fallenFromRound = 1;
    const { debates } = allocateJudges(tournament, 'r1', { replace: true, seed: 4 });
    expect(debates.find((item) => item.id === 'd1')!.judgeIds).toEqual([]);
    expect(debates.find((item) => item.id === 'd0')!.judgeIds).toHaveLength(3);
  });

  it('clears the panel and the chair of a debate that stopped being held, and warns while it keeps a room or judges', () => {
    const tournament = adumaRound(2, 3);
    const staffed = allocateJudges(tournament, 'r1', { replace: true, seed: 6 }).debates;
    tournament.rounds[0].debates = staffed;
    tournament.teams.find((item) => item.id === 't0')!.fallenFromRound = 1;
    expect(roundIssues(tournament, tournament.rounds[0]).get('d0')!.join(' ')).toContain('no se disputa');
    const { debates } = allocateJudges(tournament, 'r1', { replace: true, seed: 6 });
    expect(debates[0]).toMatchObject({ judgeIds: [], chairId: '' });
    expect(debates[1].judgeIds.includes(debates[1].chairId)).toBe(true);
  });

  it('allocates a round that is not in the tournament yet (a draft)', () => {
    const tournament = adumaRound(2, 6);
    const draft = { ...tournament.rounds[0], id: 'draft' };
    tournament.rounds = [];
    expect(allocateJudgesForRound(tournament, draft, { replace: true, seed: 5 }).debates.every((item) => item.judgeIds.length === 3)).toBe(true);
  });

  it('keeps every cost tier above any sum of lower tiers for up to 64 debates', () => {
    const rows = 64;
    const softMax = ALLOCATION_COST.NON_CHAIR + 2 * ALLOCATION_COST.SEEN_TEAM + 400 + 1;
    expect(rows * (ALLOCATION_COST.SUBJECTIVE + softMax)).toBeLessThan(ALLOCATION_COST.EMPTY_WING);
    expect(rows * (ALLOCATION_COST.SUBJECTIVE + softMax)).toBeLessThan(ALLOCATION_COST.OBJECTIVE);
    expect(rows * ALLOCATION_COST.OBJECTIVE).toBeLessThan(ALLOCATION_COST.EMPTY_CHAIR);
    expect(rows * ALLOCATION_COST.EMPTY_CHAIR).toBeLessThan(ALLOCATION_COST.FORBIDDEN);
    expect(rows * ALLOCATION_COST.FORBIDDEN).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});

describe('classic presets keep their allocation', () => {
  it('matches the snapshot taken before the ADUMA changes', () => {
    for (const [name, raw] of [['ledu', ledu], ['uc3m', uc3m]] as const) {
      const tournament = normalizeTabTournament(raw).tournament;
      for (const seed of [1, 2, 3]) {
        const result = allocateJudges(tournament, tournament.rounds[0].id, { replace: true, seed });
        expect({ panels: result.debates.map((item) => [item.judgeIds, item.chairId]), warnings: result.warnings }, name + '-' + seed)
          .toEqual(snapshot[(name + '-' + seed) as keyof typeof snapshot]);
      }
    }
  });

  it('still never seats an objective conflict under the hard policy', () => {
    const tournament = makeTournament('ledu-groups', ['a', 'b'], ['j1'], 1);
    tournament.judges = [judge('j1', { institution: 'Inst a' })];
    tournament.teams = [team('a'), team('b')];
    tournament.rounds = [qualifyingRound(1, [{ ...debate('d', 'a', 'b', []), venueId: 'v1' }])];
    expect(allocateJudges(tournament, 'r1', { replace: true, seed: 1 }).debates[0].judgeIds).toEqual([]);
  });
});
