import { describe, expect, it } from 'vitest';
import { presetSettings } from './presets';
import { aggregatePanel, computeDebateOutcome, effectivePenalties, minorsFromWarnings, outcomeContext, penaltyConversionWarning } from './results';
import { ballots, debate, judge, makeTournament, result, team } from './test-fixtures';
import type { TabRound } from './types';

const qualifying: Pick<TabRound, 'kind' | 'sideMode' | 'number'> = { kind: 'qualifying', sideMode: 'balanced', number: 1 };
const elimination: Pick<TabRound, 'kind' | 'sideMode' | 'number'> = { kind: 'elimination', sideMode: 'balanced', number: 6 };

function ledu() {
  const tournament = makeTournament('ledu-groups', ['a', 'b'], ['j1', 'j2', 'j3', 'j4', 'j5']);
  return { tournament, context: outcomeContext(tournament) };
}

describe('penalties', () => {
  it('converts warnings with the LEDU escalation and in pairs', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((w) => minorsFromWarnings(w, 'ledu'))).toEqual([0, 0, 1, 1, 2, 3, 4, 5]);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((w) => minorsFromWarnings(w, 'pairs'))).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(minorsFromWarnings(9, 'none')).toBe(0);
  });

  it('turns three LEDU minors into a forfeiting major and deducts 7 per remaining minor', () => {
    const settings = presetSettings('ledu-groups');
    expect(effectivePenalties({ warnings: 1, minors: 2, majors: 0, disqualified: false }, settings)).toMatchObject({ minors: 2, majors: 0, deduction: 14, forfeit: false });
    expect(effectivePenalties({ warnings: 2, minors: 2, majors: 0, disqualified: false }, settings)).toMatchObject({ minors: 0, majors: 1, forfeit: true });
  });

  it('applies UC3M point penalties where two minors become a −5 major', () => {
    const settings = presetSettings('uc3m-swiss');
    expect(effectivePenalties({ warnings: 0, minors: 3, majors: 0, disqualified: false }, settings)).toMatchObject({ minors: 1, majors: 1, deduction: 7, forfeit: false });
    expect(effectivePenalties({ warnings: 0, minors: 0, majors: 0, disqualified: true }, settings).forfeit).toBe(true);
    expect(effectivePenalties(undefined, { ...settings, scoresIncludePenalties: true }).deduction).toBe(0);
  });

  it('warns when a conversion would reduce the deduction', () => {
    expect(penaltyConversionWarning(presetSettings('uc3m-swiss'))).toBeNull();
    expect(penaltyConversionWarning({ ...presetSettings('uc3m-swiss'), minorsPerMajor: 3 })).toContain('reduce');
  });
});

describe('panel aggregation', () => {
  it('drops the highest and lowest score only with more than three judges', () => {
    expect(aggregatePanel([50, 60, 70, 80, 90], true)).toBe(70);
    expect(aggregatePanel([50, 60, 100], true)).toBe(70);
    expect(aggregatePanel([50, 60, 70, 80, 90], false)).toBe(70);
    expect(aggregatePanel([10, 20, 30, 100], true)).toBe(25);
    expect(aggregatePanel([], true)).toBeNull();
  });
});

describe('debate outcome', () => {
  it('awards the debate to the majority even when the loser has the higher average', () => {
    const { context } = ledu();
    const outcome = computeDebateOutcome(qualifying, debate('d', 'a', 'b', ['j1', 'j2', 'j3'], result(ballots('a', 'b', [[70, 65], [71, 60], [40, 90]]))), context);
    expect(outcome.status).toBe('complete');
    expect(outcome.winnerTeamId).toBe('a');
    expect(outcome.lines.map((line) => [line.teamId, line.votes, Number(line.points?.toFixed(2))])).toEqual([['a', 2, 60.33], ['b', 1, 71.67]]);
  });

  it('deducts penalties from every ballot before deriving the vote', () => {
    const { context } = ledu();
    const outcome = computeDebateOutcome(qualifying, debate('d', 'a', 'b', ['j1'], result(ballots('a', 'b', [[70, 65]]), {
      penalties: { a: { warnings: 0, minors: 1, majors: 0, disqualified: false } },
    })), context);
    expect(outcome.winnerTeamId).toBe('b');
    expect(outcome.lines[0].points).toBe(63);
  });

  it('rejects a ballot that gives both teams the same score', () => {
    const { context } = ledu();
    const outcome = computeDebateOutcome(qualifying, debate('d', 'a', 'b', ['j1'], result(ballots('a', 'b', [[70, 70]]))), context);
    expect(outcome.status).toBe('invalid');
    expect(outcome.issues.join(' ')).toContain('misma puntuación');
  });

  it('is pending until every judge of the panel has a ballot', () => {
    const { context } = ledu();
    const outcome = computeDebateOutcome(qualifying, debate('d', 'a', 'b', ['j1', 'j2', 'j3'], result(ballots('a', 'b', [[70, 60]]))), context);
    expect(outcome.status).toBe('pending');
  });

  it('lets the chair decide a tied even panel', () => {
    const { context } = ledu();
    const outcome = computeDebateOutcome(qualifying, debate('d', 'a', 'b', ['j1', 'j2', 'j3', 'j4'], result(ballots('a', 'b', [[60, 70], [80, 50], [55, 65], [90, 10]])), { chairId: 'j3' }), context);
    expect(outcome.winnerTeamId).toBe('b');
    expect(outcome.warnings.join(' ')).toContain('juez principal');
  });

  it('trims the extremes of a five-judge panel per team', () => {
    const { context } = ledu();
    const outcome = computeDebateOutcome(qualifying, debate('d', 'a', 'b', ['j1', 'j2', 'j3', 'j4', 'j5'], result(ballots('a', 'b', [[90, 50], [80, 60], [70, 65], [60, 55], [100, 40]]))), context);
    expect(outcome.lines[0].points).toBe(80);
    expect(outcome.lines[1].points).toBe(55);
  });

  it('gives a LEDU forfeit to the opponent with every vote and 25 points to the loser', () => {
    const { context } = ledu();
    const outcome = computeDebateOutcome(qualifying, debate('d', 'a', 'b', ['j1', 'j2', 'j3'], result([], {
      penalties: { a: { warnings: 0, minors: 0, majors: 1, disqualified: false } },
    })), context);
    expect(outcome.status).toBe('complete');
    expect(outcome.lines.map((line) => [line.teamId, line.won, line.votes, line.points, line.forfeitWin, line.forfeitLoss])).toEqual([
      ['a', false, 0, 25, false, true],
      ['b', true, 3, null, true, false],
    ]);
  });

  it('needs a manual decision when both teams forfeit', () => {
    const { context } = ledu();
    const penalties = { a: { warnings: 0, minors: 0, majors: 1, disqualified: false }, b: { warnings: 0, minors: 0, majors: 0, disqualified: true } };
    const pending = computeDebateOutcome(qualifying, debate('d', 'a', 'b', ['j1'], result([], { penalties })), context);
    expect(pending.status).toBe('invalid');
    const decided = computeDebateOutcome(qualifying, debate('d', 'a', 'b', ['j1'], result([], { penalties, override: { winnerTeamId: 'b', reason: 'Comité' } })), context);
    expect(decided.winnerTeamId).toBe('b');
  });

  it('counts only votes in elimination rounds', () => {
    const { context } = ledu();
    const outcome = computeDebateOutcome(elimination, debate('d', 'a', 'b', ['j1', 'j2', 'j3'], result([
      { judgeId: 'j1', totals: {}, speeches: {}, winnerTeamId: 'b' },
      { judgeId: 'j2', totals: {}, speeches: {}, winnerTeamId: 'a' },
      { judgeId: 'j3', totals: {}, speeches: {}, winnerTeamId: 'b' },
    ])), context);
    expect(outcome.winnerTeamId).toBe('b');
    expect(outcome.lines.map((line) => [line.votes, line.points])).toEqual([[1, null], [2, null]]);
  });

  it('never lets a swing team win', () => {
    const tournament = makeTournament('uc3m-swiss', [], ['j1']);
    tournament.teams = [team('a', 'X', { swing: true }), team('b', 'Y')];
    const outcome = computeDebateOutcome(qualifying, debate('d', 'a', 'b', ['j1'], result(ballots('a', 'b', [[18, 12]]))), outcomeContext(tournament));
    expect(outcome.winnerTeamId).toBe('b');
  });

  it('averages speech scores per role and warns about speakers in more than two turns', () => {
    const tournament = makeTournament('uc3m-swiss', ['a', 'b'], ['j1', 'j2']);
    tournament.judges = [judge('j1'), judge('j2')];
    const lineup = { a: { introductor: 'a-s1', first_rebuttal: 'a-s1', second_rebuttal: 'a-s1', concluder: 'a-s2' } };
    const list = ballots('a', 'b', [[15, 12], [14, 13]]);
    list[0].speeches = { a: { introductor: 4, concluder: 5 } };
    list[1].speeches = { a: { introductor: 3, concluder: 5 } };
    const outcome = computeDebateOutcome(qualifying, debate('d', 'a', 'b', ['j1', 'j2'], result(list, { lineup })), outcomeContext(tournament));
    expect(outcome.speeches).toEqual([
      { teamId: 'a', role: 'introductor', speakerId: 'a-s1', score: 3.5 },
      { teamId: 'a', role: 'concluder', speakerId: 'a-s2', score: 5 },
    ]);
    expect(outcome.lines[0].speakerPoints).toBe(8.5);
    expect(outcome.warnings.join(' ')).toContain('más de dos turnos');
  });

  it('rejects speech scores outside the scale', () => {
    const tournament = makeTournament('uc3m-swiss', ['a', 'b'], ['j1']);
    const list = ballots('a', 'b', [[15, 12]]);
    list[0].speeches = { a: { introductor: 4.5 } };
    const outcome = computeDebateOutcome(qualifying, debate('d', 'a', 'b', ['j1'], result(list, { lineup: { a: { introductor: 'a-s1' } } })), outcomeContext(tournament));
    expect(outcome.status).toBe('invalid');
  });
});
