import { describe, expect, it } from 'vitest';
import { buildGroupStandings, buildSpeakerStandings, buildTeamStandings } from './standings';
import { ballots, debate, decided, makeTournament, qualifyingRound, result, team } from './test-fixtures';

const order = (rows: Array<{ teamId: string }>) => rows.map((row) => row.teamId);

describe('team standings', () => {
  it('orders by wins and then by the configured chain', () => {
    const tournament = makeTournament('uc3m-swiss', ['a', 'b', 'c', 'd'], ['j1']);
    tournament.rounds = [qualifyingRound(1, [decided('d1', 'a', 'b', 15, 10), decided('d2', 'c', 'd', 18, 9)])];
    const rows = buildTeamStandings(tournament);
    expect(order(rows)).toEqual(['c', 'a', 'b', 'd']);
    expect(rows.map((row) => [row.wins, row.points])).toEqual([[1, 18], [1, 15], [0, 10], [0, 9]]);
  });

  it('restarts the chain inside a sub-block so head-to-head is recomputed between the remaining teams', () => {
    // a, b and c beat d and form a cycle; head-to-head points separate a, then b beat c directly.
    const tournament = makeTournament('ledu-groups', ['a', 'b', 'c', 'd'], ['j1']);
    tournament.groups = [{ id: 'g', name: 'Grupo A', teamIds: ['a', 'b', 'c', 'd'] }];
    tournament.rounds = [
      qualifyingRound(1, [decided('1', 'a', 'b', 80, 50), decided('2', 'c', 'd', 90, 40)]),
      qualifyingRound(2, [decided('3', 'b', 'c', 75, 70), decided('4', 'a', 'd', 70, 40)]),
      qualifyingRound(3, [decided('5', 'c', 'a', 55, 54), decided('6', 'b', 'd', 60, 40)]),
    ];
    const [group] = buildGroupStandings(tournament);
    expect(order(group.rows)).toEqual(['a', 'b', 'c', 'd']);
    expect(group.rows.every((row) => !row.tied)).toBe(true);
  });

  it('uses head-to-head votes inside a three-way cycle', () => {
    const tournament = makeTournament('ledu-groups', ['a', 'b', 'c'], ['j1', 'j2', 'j3']);
    const three = (id: string, x: string, y: string, totals: Array<[number, number]>) => debate(id, x, y, ['j1', 'j2', 'j3'], result(ballots(x, y, totals)));
    tournament.rounds = [
      qualifyingRound(1, [three('1', 'a', 'b', [[70, 60], [70, 60], [70, 60]])]),
      qualifyingRound(2, [three('2', 'b', 'c', [[70, 60], [70, 60], [60, 70]])]),
      qualifyingRound(3, [three('3', 'c', 'a', [[70, 60], [70, 60], [60, 70]])]),
    ];
    expect(order(buildTeamStandings(tournament))).toEqual(['a', 'c', 'b']);
  });

  it('skips head-to-head when the tied teams have not all met, then falls back to seeded lots', () => {
    const tournament = makeTournament('uc3m-swiss', ['a', 'b', 'c', 'd'], ['j1']);
    tournament.rounds = [qualifyingRound(1, [decided('1', 'a', 'b', 15, 10), decided('2', 'c', 'd', 15, 10)])];
    const rows = buildTeamStandings(tournament);
    expect(rows.slice(0, 2).map((row) => row.rank)).toEqual([1, 2]);
    expect(rows.slice(0, 2).every((row) => row.decidedByLots)).toBe(true);
    expect(buildTeamStandings(tournament)).toEqual(rows);
  });

  it('keeps unresolved LEDU ties shared until the organiser orders them', () => {
    const tournament = makeTournament('ledu-groups', ['a', 'b', 'c', 'd'], ['j1']);
    tournament.rounds = [qualifyingRound(1, [decided('1', 'a', 'b'), decided('2', 'c', 'd')])];
    const tied = buildTeamStandings(tournament);
    expect(tied.slice(0, 2).map((row) => [row.rank, row.tied])).toEqual([[1, true], [1, true]]);
    tournament.manualOrder = ['c', 'a'];
    expect(order(buildTeamStandings(tournament)).slice(0, 2)).toEqual(['c', 'a']);
  });

  it('scores a forfeit win with the average of the other debates, or leaves it pending', () => {
    const tournament = makeTournament('ledu-groups', ['a', 'b', 'c', 'e'], ['j1']);
    const major = { warnings: 0, minors: 0, majors: 1, disqualified: false };
    tournament.rounds = [
      qualifyingRound(1, [decided('1', 'a', 'b', 72, 60)]),
      qualifyingRound(2, [debate('2', 'a', 'c', ['j1'], result([], { penalties: { c: major } })), debate('3', 'e', 'b', ['j1'], result([], { penalties: { b: major } }))]),
    ];
    const rows = new Map(buildTeamStandings(tournament).map((row) => [row.teamId, row]));
    expect(rows.get('a')).toMatchObject({ wins: 2, points: 144, pointsAverage: 72, ballots: 2 });
    expect(rows.get('c')).toMatchObject({ points: 25, majors: 1 });
    expect(rows.get('e')).toMatchObject({ wins: 1, points: 0, pendingPoints: 1 });
  });

  it('can be limited to the rounds played up to a given number and excludes swing teams', () => {
    const tournament = makeTournament('uc3m-swiss', ['a', 'b'], ['j1']);
    tournament.teams.push(team('s', 'Swing', { swing: true }));
    tournament.rounds = [qualifyingRound(1, [decided('1', 'a', 'b', 15, 10)]), qualifyingRound(2, [decided('2', 'b', 'a', 15, 10)])];
    expect(buildTeamStandings(tournament, { upToRoundNumber: 1 }).map((row) => [row.teamId, row.wins])).toEqual([['a', 1], ['b', 0]]);
    expect(order(buildTeamStandings(tournament))).not.toContain('s');
  });
});

describe('speaker standings', () => {
  it('ranks overall and per role, breaking ties with the team ranking', () => {
    const tournament = makeTournament('uc3m-swiss', ['a', 'b'], ['j1']);
    const list = ballots('a', 'b', [[15, 10]]);
    list[0].speeches = { a: { introductor: 4, concluder: 4 }, b: { introductor: 4 } };
    const lineup = { a: { introductor: 'a-s1', concluder: 'a-s2' }, b: { introductor: 'b-s1' } };
    tournament.rounds = [qualifyingRound(1, [debate('1', 'a', 'b', ['j1'], result(list, { lineup }))])];
    const rankings = buildSpeakerStandings(tournament);
    const overall = rankings.find((ranking) => ranking.key === 'all')!;
    expect(overall.rows.map((row) => [row.speakerId, row.rank])).toEqual([['a-s1', 1], ['a-s2', 1], ['b-s1', 3]]);
    expect(rankings.find((ranking) => ranking.key === 'introductor')!.rows.map((row) => row.speakerId)).toEqual(['a-s1', 'b-s1']);
  });
});
