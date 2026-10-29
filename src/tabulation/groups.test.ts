import { describe, expect, it } from 'vitest';
import { drawGroups, generateGroupStage, restingTeams, roundRobinRounds } from './groups';
import { makeTournament, team } from './test-fixtures';

describe('group draw', () => {
  it('builds balanced groups that keep teams of the same institution apart', () => {
    const teams = Array.from({ length: 16 }, (_, i) => team('t' + i, 'Universidad ' + (i % 8)));
    for (const seed of [1, 2, 3, 4, 5]) {
      const groups = drawGroups(teams, 4, seed);
      expect(groups.map((group) => group.teamIds.length)).toEqual([4, 4, 4, 4]);
      expect(new Set(groups.flatMap((group) => group.teamIds)).size).toBe(16);
      for (const group of groups) {
        const institutions = group.teamIds.map((id) => teams.find((item) => item.id === id)!.institution);
        expect(new Set(institutions).size).toBe(institutions.length);
      }
    }
    expect(drawGroups(teams, 4, 9).map((group) => group.teamIds)).toEqual(drawGroups(teams, 4, 9).map((group) => group.teamIds));
  });

  it('keeps sizes within one team when they cannot be equal', () => {
    const sizes = drawGroups(Array.from({ length: 10 }, (_, i) => team('t' + i)), 3, 4).map((group) => group.teamIds.length).sort();
    expect(sizes).toEqual([3, 3, 4]);
  });
});

describe('round robin', () => {
  it('schedules every pair exactly once with each team at most once per round', () => {
    for (let n = 2; n <= 7; n++) {
      const teams = Array.from({ length: n }, (_, i) => 'x' + i);
      const rounds = roundRobinRounds(teams);
      expect(rounds).toHaveLength(n % 2 ? n : n - 1);
      const seen = new Set<string>();
      for (const pairs of rounds) {
        const playing = pairs.flat();
        expect(new Set(playing).size).toBe(playing.length);
        for (const [a, b] of pairs) seen.add([a, b].sort().join('|'));
      }
      expect(seen.size).toBe((n * (n - 1)) / 2);
    }
  });
});

describe('group stage generation', () => {
  it('creates every fixture of every group, with rooms and resting teams in odd groups', () => {
    const tournament = makeTournament('ledu-groups', ['a', 'b', 'c', 'd', 'e', 'f', 'g'], [], 4);
    tournament.groups = [
      { id: 'g1', name: 'Grupo A', teamIds: ['a', 'b', 'c', 'd'] },
      { id: 'g2', name: 'Grupo B', teamIds: ['e', 'f', 'g'] },
    ];
    const { rounds, issues } = generateGroupStage(tournament, 11, 1);
    expect(issues).toEqual([]);
    expect(rounds.map((round) => round.name)).toEqual(['Jornada 1', 'Jornada 2', 'Jornada 3']);
    expect(rounds.flatMap((round) => round.debates)).toHaveLength(6 + 3);
    expect(rounds.every((round) => round.debates.every((debate) => debate.venueId))).toBe(true);
    expect(restingTeams(tournament, rounds[0])).toHaveLength(1);
  });

  it('balances sides across the group when the tab fixes them', () => {
    const tournament = makeTournament('ledu-groups', ['a', 'b', 'c', 'd'], [], 2);
    tournament.settings.qualifyingSideMode = 'balanced';
    tournament.groups = [{ id: 'g1', name: 'Grupo A', teamIds: ['a', 'b', 'c', 'd'] }];
    const { rounds } = generateGroupStage(tournament, 3, 1);
    const favor = new Map<string, number>();
    for (const debate of rounds.flatMap((round) => round.debates)) favor.set(debate.favorTeamId!, (favor.get(debate.favorTeamId!) ?? 0) + 1);
    expect([...favor.values()].every((times) => times >= 1 && times <= 2)).toBe(true);
  });

  it('explains why it cannot generate', () => {
    const tournament = makeTournament('ledu-groups', ['a', 'b'], []);
    expect(generateGroupStage(tournament, 1, 1).issues.join(' ')).toContain('Sortea');
  });
});
