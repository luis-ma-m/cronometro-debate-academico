import { describe, expect, it } from 'vitest';
import { ADUMA_RUBRIC } from './presets';
import { computeDebateOutcome, outcomeContext } from './results';
import { debate, makeTournament, result, team } from './test-fixtures';
import { emptyPenalties, type TabJointActa, type TabRound } from './types';

const qualifying: Pick<TabRound, 'kind' | 'sideMode' | 'number'> = { kind: 'qualifying', sideMode: 'draw', number: 2 };
const elimination: Pick<TabRound, 'kind' | 'sideMode' | 'number'> = { kind: 'elimination', sideMode: 'draw', number: 5 };
const items = (value: number) => Object.fromEntries(ADUMA_RUBRIC.map((item) => [item.id, value]));

function setup(teamExtra: Record<string, { fallenFromRound?: number }> = {}) {
  const tournament = makeTournament('aduma', ['a', 'b'], ['j1', 'j2', 'j3']);
  tournament.teams = ['a', 'b'].map((id) => team(id, 'Inst ' + id, teamExtra[id] ?? {}));
  return outcomeContext(tournament);
}
const joint = (extra: Partial<TabJointActa> = {}): TabJointActa => ({ winnerTeamId: 'a', items: { a: items(4), b: items(3) }, speakers: {}, ...extra });
const jointDebate = (acta?: TabJointActa, extra = {}) => debate('d', 'a', 'b', ['j1', 'j2', 'j3'], acta ? result([], { joint: acta, ...extra }) : undefined);

describe('ADUMA joint acta', () => {
  it('takes the declared winner and the net items of each team', () => {
    const outcome = computeDebateOutcome(qualifying, jointDebate(joint(), { penalties: { a: { ...emptyPenalties(), warnings: 2 } } }), setup());
    expect(outcome.status).toBe('complete');
    expect(outcome.winnerTeamId).toBe('a');
    expect(outcome.lines.map((line) => [line.teamId, line.won, line.votes, line.points])).toEqual([['a', true, 1, 39], ['b', false, 0, 33]]);
  });

  it('accepts a declared winner with fewer items (art. 23) and warns', () => {
    const outcome = computeDebateOutcome(qualifying, jointDebate(joint({ winnerTeamId: 'b' })), setup());
    expect(outcome.winnerTeamId).toBe('b');
    expect(outcome.warnings.join(' ')).toContain('menos ítems');
  });

  it('is pending while the acta is incomplete and invalid when a value is wrong', () => {
    expect(computeDebateOutcome(qualifying, jointDebate(joint({ winnerTeamId: '' })), setup()).status).toBe('pending');
    expect(computeDebateOutcome(qualifying, jointDebate(joint({ items: { a: items(4) } })), setup()).status).toBe('pending');
    expect(computeDebateOutcome(qualifying, jointDebate(joint({ items: { a: items(4), b: { ...items(3), coherencia: 9 } } })), setup()).status).toBe('invalid');
  });

  it('only needs the winner in elimination rounds', () => {
    const outcome = computeDebateOutcome(elimination, jointDebate({ winnerTeamId: 'b', items: {}, speakers: {} }), setup());
    expect(outcome.winnerTeamId).toBe('b');
    expect(outcome.lines.map((line) => line.points)).toEqual([null, null]);
  });

  it('records one score per member and the same score in each intervention', () => {
    const tournament = makeTournament('aduma', ['a', 'b'], ['j1']);
    const acta = joint({ speakers: { a: [
      { speakerId: 'a-s1', score: 8, roles: ['introductor', 'concluder'] },
      { speakerId: 'a-s2', score: 6.5, roles: ['first_rebuttal', 'second_rebuttal'] },
    ] } });
    const outcome = computeDebateOutcome(qualifying, debate('d', 'a', 'b', ['j1'], result([], { joint: acta })), outcomeContext(tournament));
    expect(outcome.speakerTotals).toEqual([{ speakerId: 'a-s1', teamId: 'a', score: 8 }, { speakerId: 'a-s2', teamId: 'a', score: 6.5 }]);
    expect(outcome.speeches.map((speech) => [speech.role, speech.speakerId, speech.score])).toEqual([
      ['introductor', 'a-s1', 8], ['concluder', 'a-s1', 8], ['first_rebuttal', 'a-s2', 6.5], ['second_rebuttal', 'a-s2', 6.5],
    ]);
    expect(outcome.lines[0].speakerPoints).toBe(14.5);
  });

  it('gives a disqualified team the loss and defers the winner to the round average', () => {
    const outcome = computeDebateOutcome(qualifying, jointDebate(joint(), { penalties: { a: { ...emptyPenalties(), disqualified: true } } }), setup());
    expect(outcome.winnerTeamId).toBe('b');
    expect(outcome.lines.map((line) => [line.teamId, line.points, line.deferred])).toEqual([['a', 0, null], ['b', null, 'round']]);
  });
});

describe('equipo caído', () => {
  it('loses without an acta from its round onwards; the rival wins with the round average', () => {
    const outcome = computeDebateOutcome(qualifying, jointDebate(), setup({ b: { fallenFromRound: 2 } }));
    expect(outcome.status).toBe('complete');
    expect(outcome.winnerTeamId).toBe('a');
    expect(outcome.lines.map((line) => [line.teamId, line.won, line.points, line.deferred, line.fallenWin, line.fallenLoss])).toEqual([
      ['a', true, null, 'round', true, false],
      ['b', false, 0, null, false, true],
    ]);
  });

  it('ignores an acta entered for a fallen team, with a warning', () => {
    const outcome = computeDebateOutcome(qualifying, jointDebate(joint({ winnerTeamId: 'b' })), setup({ b: { fallenFromRound: 1 } }));
    expect(outcome.winnerTeamId).toBe('a');
    expect(outcome.warnings.join(' ')).toContain('caído');
  });

  it('plays normally in rounds before the team fell', () => {
    const outcome = computeDebateOutcome(qualifying, jointDebate(joint({ winnerTeamId: 'b' })), setup({ b: { fallenFromRound: 3 } }));
    expect(outcome.winnerTeamId).toBe('b');
  });

  it('two fallen teams: both lose and nobody receives items', () => {
    const outcome = computeDebateOutcome(qualifying, jointDebate(), setup({ a: { fallenFromRound: 1 }, b: { fallenFromRound: 2 } }));
    expect(outcome).toMatchObject({ status: 'complete', winnerTeamId: null, noWinner: true });
    expect(outcome.lines.map((line) => [line.won, line.points, line.deferred])).toEqual([[false, 0, null], [false, 0, null]]);
  });

  it('two fallen teams in an elimination round need a committee decision', () => {
    const context = setup({ a: { fallenFromRound: 1 }, b: { fallenFromRound: 1 } });
    expect(computeDebateOutcome(elimination, jointDebate(), context).status).toBe('invalid');
    const decided = computeDebateOutcome(elimination, debate('d', 'a', 'b', [], result([], { override: { winnerTeamId: 'b', reason: 'Comité' } })), context);
    expect(decided.winnerTeamId).toBe('b');
  });

  it('lets the organisers override a fallen result', () => {
    const outcome = computeDebateOutcome(qualifying, debate('d', 'a', 'b', [], result([], { override: { winnerTeamId: 'b', reason: 'Reclamación' } })), setup({ b: { fallenFromRound: 1 } }));
    expect(outcome.winnerTeamId).toBe('b');
  });
});
