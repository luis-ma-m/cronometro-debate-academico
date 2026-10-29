import { describe, expect, it } from 'vitest';
import { createRng, shuffle } from './random';
import { buildSpeakerStandings, buildTeamStandings } from './standings';
import { debate, jointDecided, makeTournament, qualifyingRound, result } from './test-fixtures';
import type { TabTournament } from './types';

const order = (rows: Array<{ teamId: string }>) => rows.map((row) => row.teamId);

function aduma(teamIds: string[]): TabTournament {
  return makeTournament('aduma', teamIds, ['j1'], 0);
}

describe('ADUMA standings', () => {
  it('gives the rival of a fallen team the average items of every team in the other rooms of the round', () => {
    const tournament = aduma(['a', 'b', 'c', 'd', 'e', 'f']);
    tournament.teams.find((team) => team.id === 'f')!.fallenFromRound = 1;
    tournament.rounds = [qualifyingRound(1, [jointDecided('1', 'a', 'b', 40, 30), jointDecided('2', 'c', 'd', 45, 35), debate('3', 'e', 'f', [])])];
    const rows = new Map(buildTeamStandings(tournament).map((row) => [row.teamId, row]));
    expect(rows.get('e')).toMatchObject({ wins: 1, points: 37.5, pendingPoints: 0 });
    expect(rows.get('f')).toMatchObject({ wins: 0, losses: 1, points: 0 });
    // The average uses every room of the round even when only part of the table is computed.
    expect(buildTeamStandings(tournament, { teamIds: ['e'] })[0].points).toBe(37.5);
  });

  it('keeps the average pending until another room of the round has its acta', () => {
    const tournament = aduma(['a', 'b', 'e', 'f']);
    tournament.teams.find((team) => team.id === 'f')!.fallenFromRound = 1;
    tournament.rounds = [qualifyingRound(1, [debate('1', 'a', 'b', ['j1']), debate('3', 'e', 'f', [])])];
    expect(buildTeamStandings(tournament).find((row) => row.teamId === 'e')).toMatchObject({ wins: 1, points: 0, pendingPoints: 1 });
  });

  it('counts two fallen teams as two losses without items', () => {
    const tournament = aduma(['a', 'b', 'x', 'y']);
    for (const id of ['x', 'y']) tournament.teams.find((team) => team.id === id)!.fallenFromRound = 1;
    tournament.rounds = [qualifyingRound(1, [jointDecided('1', 'a', 'b'), debate('2', 'x', 'y', [])])];
    const rows = new Map(buildTeamStandings(tournament).map((row) => [row.teamId, row]));
    expect(['x', 'y'].map((id) => [rows.get(id)!.wins, rows.get(id)!.losses, rows.get(id)!.points, rows.get(id)!.debates])).toEqual([[0, 1, 0, 1], [0, 1, 0, 1]]);
  });

  it('orders ties by fewer major faults and then fewer minor faults (art. 30)', () => {
    const tournament = aduma(['a', 'b', 'c', 'd', 'e', 'f']);
    const penalties = (majors: number, minors: number) => ({ warnings: 0, minors, majors, disqualified: false });
    tournament.rounds = [qualifyingRound(1, [
      { ...jointDecided('1', 'a', 'b', 50, 30), result: { ...jointDecided('1', 'a', 'b', 50, 30).result!, penalties: { a: penalties(1, 0) } } },
      { ...jointDecided('2', 'c', 'd', 45, 30), result: { ...jointDecided('2', 'c', 'd', 45, 30).result!, penalties: { c: penalties(0, 1) } } },
      jointDecided('3', 'e', 'f', 40, 30),
    ])];
    // a, c and e all have 1 win and 40 net items; e has no faults, c one minor, a one major.
    expect(order(buildTeamStandings(tournament)).slice(0, 3)).toEqual(['e', 'c', 'a']);
  });

  it('does not depend on the order of teams, rounds or debates', () => {
    const tournament = aduma(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    tournament.teams.find((team) => team.id === 'h')!.fallenFromRound = 2;
    tournament.rounds = [
      qualifyingRound(1, [jointDecided('1', 'a', 'b', 41, 30), jointDecided('2', 'c', 'd', 38, 36), jointDecided('3', 'e', 'f', 44, 20), jointDecided('4', 'g', 'h', 30, 29)]),
      qualifyingRound(2, [jointDecided('5', 'a', 'c', 40, 39), jointDecided('6', 'e', 'g', 35, 34), jointDecided('7', 'b', 'd', 33, 31), debate('8', 'f', 'h', [])]),
    ];
    const expected = buildTeamStandings(tournament);
    const rng = createRng(5);
    for (let i = 0; i < 10; i++) {
      const shuffled = {
        ...tournament,
        teams: shuffle(tournament.teams, rng),
        rounds: shuffle(tournament.rounds.map((round) => ({ ...round, debates: shuffle(round.debates, rng) })), rng),
      };
      expect(buildTeamStandings(shuffled)).toEqual(expected);
    }
  });
});

describe('ADUMA speaker awards', () => {
  it('counts one score per member and debate, and the same score in each intervention', () => {
    const tournament = aduma(['a', 'b', 'c', 'd']);
    const speakers = (score: number) => ({ a: [
      { speakerId: 'a-s1', score, roles: ['introductor' as const, 'concluder' as const] },
      { speakerId: 'a-s2', score: 7, roles: ['first_rebuttal' as const, 'second_rebuttal' as const] },
    ] });
    tournament.rounds = [
      qualifyingRound(1, [jointDecided('1', 'a', 'b', 40, 30, { speakers: speakers(8) }), jointDecided('2', 'c', 'd')]),
      qualifyingRound(2, [jointDecided('3', 'a', 'c', 40, 30, { speakers: speakers(9) }), jointDecided('4', 'b', 'd')]),
    ];
    const rankings = buildSpeakerStandings(tournament);
    const overall = rankings.find((ranking) => ranking.key === 'all')!;
    expect(overall.rows.map((row) => [row.speakerId, row.total, row.count])).toEqual([['a-s1', 17, 2], ['a-s2', 14, 2]]);
    expect(rankings.find((ranking) => ranking.key === 'concluder')!.rows.map((row) => [row.speakerId, row.total])).toEqual([['a-s1', 17]]);
  });

  it('marks the speakers whose team faced a fallen team', () => {
    const tournament = aduma(['a', 'b', 'c', 'x']);
    tournament.teams.find((team) => team.id === 'x')!.fallenFromRound = 2;
    const speakers = { a: [{ speakerId: 'a-s1', score: 8, roles: ['introductor' as const] }] };
    tournament.rounds = [
      qualifyingRound(1, [jointDecided('1', 'a', 'b', 40, 30, { speakers }), jointDecided('2', 'c', 'x')]),
      qualifyingRound(2, [debate('3', 'a', 'x', []), debate('4', 'b', 'c', ['j1'], result([], { joint: { winnerTeamId: 'b', items: {}, quickTotals: { b: 30, c: 20 }, speakers: {} } }))]),
    ];
    const row = buildSpeakerStandings(tournament).find((ranking) => ranking.key === 'all')!.rows[0];
    expect(row).toMatchObject({ speakerId: 'a-s1', fallenRivalDebates: 1 });
  });
});
