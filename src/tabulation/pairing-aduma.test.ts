import { describe, expect, it } from 'vitest';
import { addRestTeam, generateSwissRound, swissOrder } from './pairing';
import { jointDecided, makeTournament, qualifyingRound } from './test-fixtures';
import type { TabTournament } from './types';

const ids = (n: number) => Array.from({ length: n }, (_, i) => 't' + String(i + 1).padStart(2, '0'));
const pairKey = (pair: string[]) => [...pair].sort().join('|');

/** Round 1 already played: t01 > t02, t03 > t04, …; winners rank t01, t03, t05… and then losers t02, t04, t06… */
function afterRoundOne(n: number, venues = n / 2): TabTournament {
  const tournament = makeTournament('aduma', ids(n), ['j1'], venues);
  const teams = ids(n);
  const debates = [];
  for (let i = 0; i < n; i += 2) debates.push(jointDecided('d' + i, teams[i], teams[i + 1], 50 - i, 30 - i));
  tournament.rounds = [qualifyingRound(1, debates)];
  return tournament;
}

describe('pairing with fallen teams (ADUMA)', () => {
  it('pairs fallen teams with each other first, even if they already met', () => {
    const tournament = afterRoundOne(8);
    for (const id of ['t01', 't02']) tournament.teams.find((team) => team.id === id)!.fallenFromRound = 2;
    const round = generateSwissRound(tournament, 3, 1).round!;
    expect(round.debates.map((debate) => pairKey(debate.teamIds))).toContain('t01|t02');
  });

  it('puts a single fallen team last so it meets the lowest-ranked team', () => {
    const tournament = afterRoundOne(8);
    tournament.teams.find((team) => team.id === 't01')!.fallenFromRound = 2;
    expect(swissOrder(tournament, 5, undefined, 2).at(-1)).toBe('t01');
  });

  it('gives no room to a debate against a fallen team', () => {
    const tournament = afterRoundOne(8, 3);
    tournament.teams.find((team) => team.id === 't08')!.fallenFromRound = 2;
    const round = generateSwissRound(tournament, 7, 1).round!;
    const fallenDebate = round.debates.find((debate) => debate.teamIds.includes('t08'))!;
    expect(fallenDebate.venueId).toBe('');
    expect(round.debates.filter((debate) => debate.venueId).map((debate) => debate.venueId).sort()).toEqual(['v1', 'v2', 'v3']);
  });

  it('asks for a «Descanso» team when the number of teams is odd, and adds it already fallen', () => {
    const tournament = makeTournament('aduma', ids(5), ['j1'], 3);
    expect(generateSwissRound(tournament, 1, 1).issues.join(' ')).toContain('Descanso');
    const withRest = addRestTeam(tournament);
    const rest = withRest.teams.at(-1)!;
    expect(rest).toMatchObject({ name: 'Descanso', fallenFromRound: 1, breakEligible: false });
    expect(generateSwissRound(withRest, 1, 1).issues).toEqual([]);
  });
});

describe('blind rounds (art. 29)', () => {
  it('marks the round as closed and shuffles rooms and team order so they do not reveal the ranking', () => {
    const tournament = afterRoundOne(16);
    const ideal = ['t01|t03', 't05|t07', 't09|t11', 't13|t15', 't02|t04', 't06|t08', 't10|t12', 't14|t16'];
    let rankOrdered = 0;
    let higherFirst = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const round = generateSwissRound(tournament, seed, 1).round!;
      expect(round.silent).toBe(true);
      const pairs = round.debates.map((debate) => pairKey(debate.teamIds));
      expect([...pairs].sort()).toEqual([...ideal].sort());
      if (pairs.join() === ideal.join()) rankOrdered++;
      higherFirst += round.debates.filter((debate) => debate.teamIds[0] < debate.teamIds[1]).length;
    }
    expect(rankOrdered).toBe(0);
    expect(higherFirst).toBeGreaterThan(5);
    expect(higherFirst).toBeLessThan(35);
  });

  it('keeps the ranking order when rounds are public', () => {
    const tournament = afterRoundOne(8);
    tournament.settings.blindQualifying = false;
    const round = generateSwissRound(tournament, 1, 1).round!;
    expect(round.silent).toBe(false);
    expect(round.debates.map((debate) => debate.teamIds)).toEqual([['t01', 't03'], ['t05', 't07'], ['t02', 't04'], ['t06', 't08']]);
  });
});
