import { describe, expect, it } from 'vitest';
import { computeBreak, eliminationRoundName, generateFirstElimination, generateNextElimination, standardSeedOrder, tournamentChampion } from './bracket';
import { generateGroupStage } from './groups';
import { simulateRoundResults } from './sample';
import { debate, decided, makeTournament, qualifyingRound, result } from './test-fixtures';
import type { TabRound, TabTournament } from './types';

const ids = (n: number) => Array.from({ length: n }, (_, i) => 't' + String(i + 1).padStart(2, '0'));

/** One Swiss round where t01 > t02 > … by points so the standings follow the ids. */
function rankedSwiss(n: number): TabTournament {
  const tournament = makeTournament('uc3m-swiss', ids(n), ['j1'], n);
  tournament.settings.swissRounds = 1;
  tournament.settings.speakerScores = false;
  const teams = ids(n);
  const debates = [];
  for (let i = 0; i < n / 2; i++) debates.push(decided('d' + i, teams[i], teams[n - 1 - i], 20 - i, 1 + i));
  tournament.rounds = [qualifyingRound(1, debates)];
  return tournament;
}

function playRound(tournament: TabTournament, round: TabRound, seed: number): TabTournament {
  const staffed = { ...round, debates: round.debates.map((item) => ({ ...item, judgeIds: ['j1'], chairId: 'j1' })) };
  return simulateRoundResults({ ...tournament, rounds: [...tournament.rounds, staffed] }, staffed.id, seed).tournament;
}

describe('bracket helpers', () => {
  it('orders seeds so the top two can only meet in the final', () => {
    expect(standardSeedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(standardSeedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(standardSeedOrder(16).slice(0, 4)).toEqual([1, 16, 8, 9]);
    expect([1, 2, 4, 8, 16].map(eliminationRoundName)).toEqual(['Final', 'Semifinales', 'Cuartos de final', 'Octavos de final', 'Dieciseisavos de final']);
  });
});

describe('Swiss break', () => {
  it('seeds the top eight 1v8, 4v5, 2v7, 3v6 and skips ineligible teams', () => {
    const tournament = rankedSwiss(16);
    tournament.teams.find((team) => team.id === 't03')!.breakEligible = false;
    const { round, breakSeeds, issues } = generateFirstElimination(tournament, 1, 1);
    expect(issues).toEqual([]);
    expect(breakSeeds).toEqual(['t01', 't02', 't04', 't05', 't06', 't07', 't08', 't09']);
    expect(round!.name).toBe('Cuartos de final');
    expect(round!.debates.map((item) => item.teamIds)).toEqual([['t01', 't09'], ['t05', 't06'], ['t02', 't08'], ['t04', 't07']]);
  });

  it('reports an unresolved tie across the cut', () => {
    const tournament = rankedSwiss(16);
    tournament.settings.tiebreakFallback = 'manual';
    tournament.rounds[0].debates[7] = decided('d7', 't08', 't09', 12, 8);
    tournament.rounds[0].debates[6] = decided('d6', 't07', 't10', 12, 7);
    tournament.rounds[0].debates[5] = decided('d5', 't06', 't11', 12, 6);
    tournament.settings.breakSize = 4;
    tournament.rounds[0].debates[3] = decided('d3', 't04', 't13', 12, 4);
    tournament.rounds[0].debates[4] = decided('d4', 't05', 't12', 12, 5);
    expect(computeBreak(tournament).issues.join(' ').toLowerCase()).toContain('empate sin resolver');
  });

  it('re-seeds the semifinals best remaining against worst remaining', () => {
    let tournament = rankedSwiss(16);
    const first = generateFirstElimination(tournament, 1, 1);
    tournament = { ...tournament, breakSeeds: first.breakSeeds };
    // Every underdog wins the quarterfinals: winners are seeds 8, 5, 7, 6.
    const quarter = { ...first.round!, debates: first.round!.debates.map((item) => ({
      ...item, judgeIds: ['j1'], chairId: 'j1',
      result: result([{ judgeId: 'j1', totals: {}, speeches: {}, winnerTeamId: item.teamIds[1] }]),
    })) };
    tournament = { ...tournament, rounds: [...tournament.rounds, quarter] };
    const semis = generateNextElimination(tournament, 2, 1).round!;
    expect(semis.name).toBe('Semifinales');
    expect(semis.debates.map((item) => item.teamIds)).toEqual([['t05', 't08'], ['t06', 't07']]);
  });
});

describe('group break', () => {
  it('crosses group winners and runners-up and keeps group mates apart until the final', () => {
    let tournament = makeTournament('ledu-groups', ids(16), ['j1'], 8);
    tournament.settings.tiebreakFallback = 'lots';
    tournament.settings.speakerScores = false;
    tournament.groups = [0, 1, 2, 3].map((g) => ({ id: 'g' + g, name: 'Grupo ' + g, teamIds: ids(16).slice(g * 4, g * 4 + 4) }));
    for (const round of generateGroupStage(tournament, 5, 1).rounds) tournament = playRound(tournament, round, round.number);
    const first = generateFirstElimination(tournament, 9, 1);
    expect(first.issues).toEqual([]);
    const groupOf = (teamId: string) => tournament.groups.findIndex((group) => group.teamIds.includes(teamId));
    const debates = first.round!.debates;
    expect(debates.every((item) => groupOf(item.teamIds[0]) !== groupOf(item.teamIds[1]))).toBe(true);
    const topHalf = debates.slice(0, 2).flatMap((item) => item.teamIds).map(groupOf).sort();
    const bottomHalf = debates.slice(2).flatMap((item) => item.teamIds).map(groupOf).sort();
    expect(topHalf).toEqual([0, 1, 2, 3]);
    expect(bottomHalf).toEqual([0, 1, 2, 3]);

    tournament = { ...playRound({ ...tournament, breakSeeds: first.breakSeeds }, first.round!, 21) };
    const semis = generateNextElimination(tournament, 3, 1).round!;
    tournament = playRound(tournament, semis, 22);
    const final = generateNextElimination(tournament, 4, 1).round!;
    expect(final.name).toBe('Final');
    tournament = playRound(tournament, final, 23);
    const champion = tournamentChampion(tournament);
    expect(final.debates[0].teamIds).toContain(champion);
    expect(generateNextElimination(tournament, 5, 1).champion).toBe(champion);
  });

  it('waits for the group stage to finish', () => {
    const tournament = makeTournament('ledu-groups', ['a', 'b'], ['j1']);
    tournament.groups = [{ id: 'g', name: 'Grupo A', teamIds: ['a', 'b'] }];
    tournament.rounds = [qualifyingRound(1, [debate('1', 'a', 'b', ['j1'])])];
    expect(computeBreak(tournament).issues.join(' ')).toContain('no ha terminado');
  });
});
