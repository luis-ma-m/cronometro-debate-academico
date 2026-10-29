import { describe, expect, it } from 'vitest';
import { balanceSides, generateSwissRound, pairInOrder, teamMeetings, type PairingContext } from './pairing';
import { createRng, shuffle } from './random';
import { simulateRoundResults } from './sample';
import { decided, makeTournament, qualifyingRound } from './test-fixtures';

const ids = (n: number) => Array.from({ length: n }, (_, i) => 't' + String(i + 1).padStart(2, '0'));
const key = (x: string, y: string) => [x, y].sort().join('|');

function context(met: Array<[string, string]> = [], institutions: Record<string, string> = {}): PairingContext {
  const meetings = new Set(met.map(([x, y]) => key(x, y)));
  return {
    timesMet: (x, y) => (meetings.has(key(x, y)) ? 1 : 0),
    sameInstitution: (x, y) => Boolean(institutions[x] && institutions[x] === institutions[y]),
    avoidSameInstitution: true,
  };
}

/** Same lexicographic objective as the dynamic programme, for brute-force comparison. */
function cost(order: string[], pairs: Array<[string, string]>, ctx: PairingContext): number[] {
  const total = [0, 0, 0, 0, 0];
  for (const [x, y] of pairs) {
    const [p, i] = [order.indexOf(x), order.indexOf(y)].sort((u, v) => u - v);
    total[0] += ctx.timesMet(x, y) ? 1 : 0;
    total[1] += ctx.sameInstitution(x, y) ? 1 : 0;
    total[2] += i - p - 1;
    total[3] += (p + 1) * (i + 1);
    total[4] += p % 2 === 0 && i === p + 1 ? 0 : order.length - p;
  }
  return total;
}

function allMatchings(items: string[]): Array<Array<[string, string]>> {
  if (!items.length) return [[]];
  const [first, ...rest] = items;
  return rest.flatMap((other, index) => allMatchings(rest.filter((_, j) => j !== index)).map((tail) => [[first, other] as [string, string], ...tail]));
}

const lexLess = (x: number[], y: number[]) => { for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return x[k] < y[k]; return false; };

describe('adjacent pairing', () => {
  it('pairs 1–2, 3–4… when nobody has met', () => {
    expect(pairInOrder(ids(6), context()).pairs).toEqual([['t01', 't02'], ['t03', 't04'], ['t05', 't06']]);
  });

  it('reproduces the UC3M example: 15.º–16.º already met → 13.º–16.º and 14.º–15.º, never 1.º–16.º', () => {
    const { pairs, rematches } = pairInOrder(ids(16), context([['t15', 't16']]));
    expect(rematches).toBe(0);
    expect(pairs.slice(0, 6)).toEqual([['t01', 't02'], ['t03', 't04'], ['t05', 't06'], ['t07', 't08'], ['t09', 't10'], ['t11', 't12']]);
    expect(pairs.slice(6)).toEqual([['t13', 't16'], ['t14', 't15']]);
  });

  it('resolves a conflict in the middle as low in the table as possible', () => {
    expect(pairInOrder(ids(6), context([['t03', 't04']])).pairs).toEqual([['t01', 't02'], ['t03', 't06'], ['t04', 't05']]);
  });

  it('reaches further up when the bottom four have all met', () => {
    const bottom = ['t13', 't14', 't15', 't16'];
    const met = bottom.flatMap((x, i) => bottom.slice(i + 1).map((y) => [x, y] as [string, string]));
    const { pairs, rematches } = pairInOrder(ids(16), context(met));
    expect(rematches).toBe(0);
    expect(new Set(pairs.flat()).size).toBe(16);
  });

  it('returns a full pairing and reports an unavoidable rematch', () => {
    const met: Array<[string, string]> = [['t01', 't02'], ['t03', 't04'], ['t01', 't03'], ['t02', 't04'], ['t01', 't04'], ['t02', 't03']];
    const result = pairInOrder(ids(4), context(met));
    expect(result.pairs).toHaveLength(2);
    expect(result.rematches).toBe(2);
  });

  it('avoids pairing teams of the same institution when possible', () => {
    const institutions = { t01: 'X', t02: 'X', t03: 'Y', t04: 'Y' };
    const pairs = pairInOrder(ids(4), context([], institutions)).pairs;
    expect(pairs.some(([x, y]) => institutions[x as keyof typeof institutions] === institutions[y as keyof typeof institutions])).toBe(false);
  });

  it('finds the optimum of the objective (brute force, n ≤ 10)', () => {
    const rng = createRng(7);
    for (let trial = 0; trial < 40; trial++) {
      const n = 4 + 2 * Math.floor(rng() * 4);
      const order = ids(n);
      const met: Array<[string, string]> = [];
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (rng() < 0.3) met.push([order[i], order[j]]);
      const institutions = Object.fromEntries(order.map((id) => [id, 'I' + Math.floor(rng() * (n / 2))]));
      const ctx = context(met, institutions);
      const best = allMatchings(order).map((pairs) => cost(order, pairs, ctx)).reduce((x, y) => (lexLess(y, x) ? y : x));
      expect(cost(order, pairInOrder(order, ctx).pairs, ctx)).toEqual(best);
    }
  });
});

describe('Swiss rounds', () => {
  it('generates five rounds for 64 teams without avoidable rematches, quickly', () => {
    let tournament = makeTournament('uc3m-swiss', ids(64), ['j1'], 32);
    tournament.settings.speakerScores = false;
    tournament.teams.forEach((team, index) => { team.institution = 'Universidad ' + (index % 20); });
    const started = performance.now();
    for (let n = 1; n <= 5; n++) {
      const generated = generateSwissRound(tournament, 1000 + n, 1);
      expect(generated.issues).toEqual([]);
      expect(generated.warnings.filter((warning) => warning.includes('repetido'))).toEqual([]);
      const round = { ...generated.round!, debates: generated.round!.debates.map((debate) => ({ ...debate, judgeIds: ['j1'], chairId: 'j1' })) };
      tournament = simulateRoundResults({ ...tournament, rounds: [...tournament.rounds, round] }, round.id, n).tournament;
    }
    expect(performance.now() - started).toBeLessThan(3000);
    expect([...teamMeetings(tournament).values()].every((times) => times === 1)).toBe(true);
  });

  it('pairs round 2 by standings: winners with winners', () => {
    const tournament = makeTournament('uc3m-swiss', ['a', 'b', 'c', 'd'], ['j1']);
    tournament.rounds = [qualifyingRound(1, [decided('1', 'a', 'b', 15, 10), decided('2', 'c', 'd', 14, 10)])];
    const round = generateSwissRound(tournament, 5, 1).round!;
    expect(round.debates.map((debate) => [...debate.teamIds].sort())).toEqual([['a', 'c'], ['b', 'd']]);
    expect(round.debates.every((debate) => debate.favorTeamId)).toBe(true);
  });

  it('refuses to generate with pending ballots or an odd number of teams', () => {
    const tournament = makeTournament('uc3m-swiss', ['a', 'b', 'c'], ['j1']);
    expect(generateSwissRound(tournament, 1, 1).issues.join(' ')).toContain('par');
    tournament.teams.pop();
    tournament.rounds = [qualifyingRound(1, [{ ...decided('1', 'a', 'b', 15, 10), result: undefined }])];
    expect(generateSwissRound(tournament, 1, 1).issues.join(' ')).toContain('Completa antes');
  });
});

describe('sides', () => {
  it('gives "A favor" to the team that has defended it fewer times', () => {
    const history = new Map([['a', { favor: 2, contra: 0 }], ['b', { favor: 0, contra: 2 }]]);
    expect(balanceSides([['a', 'b']], history, () => 0.9)).toEqual(['b']);
    expect(history.get('b')).toEqual({ favor: 1, contra: 2 });
  });

  it('balances a full schedule when drawing ties', () => {
    const history = new Map<string, { favor: number; contra: number }>();
    const rng = createRng(3);
    const teams = ids(8);
    for (let round = 0; round < 6; round++) {
      const order = shuffle(teams, rng);
      balanceSides([[order[0], order[1]], [order[2], order[3]], [order[4], order[5]], [order[6], order[7]]], history, rng);
    }
    for (const entry of history.values()) expect(Math.abs(entry.favor - entry.contra)).toBeLessThanOrEqual(2);
  });
});
