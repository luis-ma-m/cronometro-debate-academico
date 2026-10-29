import { describe, expect, it } from 'vitest';
import { computeBreak, generateFirstElimination, generateNextElimination } from './bracket';
import { jointDecided, makeTournament, qualifyingRound, result } from './test-fixtures';
import type { TabRound, TabTournament } from './types';

const ids = (n: number) => Array.from({ length: n }, (_, i) => 't' + String(i + 1).padStart(2, '0'));

/** ADUMA with one Swiss round already played so that the standings follow the ids (t01 first). */
function rankedAduma(n = 16): TabTournament {
  const tournament = makeTournament('aduma', ids(n), ['j1'], n);
  tournament.settings.swissRounds = 1;
  const teams = ids(n);
  tournament.rounds = [qualifyingRound(1, Array.from({ length: n / 2 }, (_, i) => jointDecided('d' + i, teams[i], teams[n - 1 - i], 50 - i, 10 + i)))];
  return tournament;
}

/** Adds an elimination round with the given winners (by position in the round). */
function decide(tournament: TabTournament, round: TabRound, winners: Array<string | null>): TabTournament {
  return {
    ...tournament,
    rounds: [...tournament.rounds, {
      ...round,
      debates: round.debates.map((debate, index) => (winners[index]
        ? { ...debate, result: result([], { joint: { winnerTeamId: winners[index]!, items: {}, speakers: {} } }) }
        : debate)),
    }],
  };
}

const pairs = (round: TabRound | null) => round!.debates.map((debate) => debate.teamIds);

describe('ADUMA bracket (art. 31)', () => {
  it('pairs the quarterfinals 1–8, 3–6, 2–7, 4–5 and keeps the semifinal paths fixed', () => {
    const tournament = rankedAduma();
    const quarters = generateFirstElimination(tournament, 1, 1);
    expect(quarters.issues).toEqual([]);
    expect(pairs(quarters.round)).toEqual([['t01', 't08'], ['t03', 't06'], ['t02', 't07'], ['t04', 't05']]);
    // Two upsets: t08 and t05 go through.
    const played = decide({ ...tournament, breakSeeds: quarters.breakSeeds }, quarters.round!, ['t08', 't03', 't02', 't05']);
    const semis = generateNextElimination(played, 2, 1);
    expect(pairs(semis.round)).toEqual([['t08', 't03'], ['t02', 't05']]);
    const final = generateNextElimination(decide(played, semis.round!, ['t03', 't02']), 3, 1);
    expect(pairs(final.round)).toEqual([['t03', 't02']]);
  });

  it('falls back to the standard bracket when the seed order does not match the break size', () => {
    const tournament = rankedAduma();
    tournament.settings.breakSize = 4;
    expect(pairs(generateFirstElimination(tournament, 1, 1).round)).toEqual([['t01', 't04'], ['t02', 't03']]);
  });

  it('leaves a fallen team out of the break', () => {
    const tournament = rankedAduma();
    tournament.teams.find((team) => team.id === 't03')!.fallenFromRound = 2;
    const preview = computeBreak(tournament);
    expect(preview.qualifiers.map((item) => item.teamId)).toEqual(['t01', 't02', 't04', 't05', 't06', 't07', 't08', 't09']);
  });

  it('lets the rival of a team that falls during the eliminations go through, with no room for that debate', () => {
    const tournament = rankedAduma();
    const quarters = generateFirstElimination(tournament, 1, 1);
    const played = decide({ ...tournament, breakSeeds: quarters.breakSeeds }, quarters.round!, ['t01', 't03', 't02', 't04']);
    played.teams.find((team) => team.id === 't03')!.fallenFromRound = 3;
    const semis = generateNextElimination(played, 2, 1).round!;
    expect(semis.debates.map((debate) => [debate.teamIds, debate.venueId])).toEqual([[['t01', 't03'], ''], [['t02', 't04'], 'v1']]);
    const final = generateNextElimination(decide(played, semis, [null, 't04']), 3, 1);
    expect(pairs(final.round)).toEqual([['t01', 't04']]);
  });

  it('waits for the organisers when both teams of an elimination debate have fallen', () => {
    const tournament = rankedAduma();
    const quarters = generateFirstElimination(tournament, 1, 1);
    let played = decide({ ...tournament, breakSeeds: quarters.breakSeeds }, quarters.round!, [null, 't03', 't02', 't04']);
    for (const id of ['t01', 't08']) played.teams.find((team) => team.id === id)!.fallenFromRound = 2;
    expect(generateNextElimination(played, 2, 1).issues.join(' ')).toContain('Cuartos de final');
    played = {
      ...played,
      rounds: played.rounds.map((round) => (round.kind !== 'elimination' ? round : {
        ...round,
        debates: round.debates.map((debate, index) => (index ? debate : { ...debate, result: result([], { override: { winnerTeamId: 't08', reason: 'Decisión del comité' } }) })),
      })),
    };
    expect(pairs(generateNextElimination(played, 2, 1).round)).toEqual([['t08', 't03'], ['t02', 't04']]);
  });
});
