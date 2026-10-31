import { describe, expect, it } from 'vitest';
import ledu from './fixtures/v1-ledu.json';
import uc3m from './fixtures/v1-uc3m.json';
import { normalizeTabTournament, parseTournamentExport, serializeTournamentExport } from './normalize';
import { ADUMA_RUBRIC, createTabTournament, presetSettings } from './presets';
import { computeTournamentOutcomes } from './results';
import { qualifyingRound } from './test-fixtures';
import { TIEBREAK_LABELS, type TabSettings, type TabTournament, type TiebreakKey } from './types';

const items = (value: number) => Object.fromEntries(ADUMA_RUBRIC.map((item) => [item.id, value]));

function fullAduma(): TabTournament {
  const tournament = createTabTournament('ADUMA', 'aduma', 1_800_000_000_000, 3);
  tournament.teams = [
    { id: 'a', name: 'A', institution: 'UMA', active: true, swing: false, breakEligible: true, incompatibleJudgeIds: ['j1'] },
    { id: 'b', name: 'B', institution: 'UGR', active: true, swing: false, breakEligible: true, incompatibleJudgeIds: [], fallenFromRound: 2 },
  ];
  tournament.speakers = [{ id: 's1', teamId: 'a', name: 'Ana' }];
  tournament.judges = [{ id: 'j1', name: 'Juez', institution: 'UMA', active: true, rating: 4, canChair: true, incompatibleJudgeIds: [], unavailableRoundIds: [] }];
  tournament.venues = [{ id: 'v1', name: 'Aula 1', active: true }];
  tournament.judgeConflicts = [
    { id: 'c1', judgeId: 'j1', teamId: 'b', level: 'subjective', note: 'Ex entrenador' },
    { id: 'c2', judgeId: 'j1', institution: 'UGR', level: 'objective', note: '' },
  ];
  const round = qualifyingRound(1, [{
    id: 'd1', venueId: 'v1', teamIds: ['a', 'b'], favorTeamId: 'b', judgeIds: ['j1'], chairId: 'j1',
    result: {
      lineup: {}, ballots: [], penalties: { a: { warnings: 1, minors: 0, majors: 0, disqualified: false } }, notes: 'Buen debate', updatedAt: 5,
      joint: {
        winnerTeamId: 'a', items: { a: items(4), b: { ...items(3), coherencia: 3.5 } }, quickTotals: { a: 40 }, writtenTotals: { b: 33 },
        speakers: { a: [{ speakerId: 's1', score: 8.5, roles: ['introductor', 'concluder'] }] },
      },
    },
  }], { silent: true });
  round.managerRoundId = 'manager-round-1';
  round.debates[0].managerAssignmentId = '00000000-0000-4000-8000-000000000001';
  tournament.rounds = [round];
  tournament.draftRound = {
    round: { ...round, id: 'r2', number: 2, name: 'Ronda 2' }, generated: { ...round, id: 'r2', number: 2, name: 'Ronda 2' },
    seed: 77, kind: 'swiss', fingerprint: 'abc', createdAt: 9, editHistory: [{ ...round, id: 'r2', number: 2, name: 'Ronda 2' }],
  };
  tournament.logTail = [{ seq: 1, at: 10, operator: 'Mesa', type: 'round.generated', message: 'Ronda 2 generada', details: { seed: 77 }, prevHash: '', hash: 'h1' }];
  tournament.logSeq = 1;
  tournament.settings = { ...tournament.settings, bracketSeedOrder: [1, 8, 3, 6, 2, 7, 4, 5] };
  return tournament;
}

describe('schema v2 normalization', () => {
  it('round-trips an ADUMA tournament with every new field', () => {
    const tournament = fullAduma();
    const { tournament: back, issues } = parseTournamentExport(serializeTournamentExport(tournament, 1));
    expect(issues).toEqual([]);
    expect(back).toEqual(tournament);
  });

  it('keeps every value of every new setting', () => {
    const variants: Array<Partial<TabSettings>> = [
      ...(['ledu-groups', 'uc3m-swiss', 'aduma', 'custom'] as const).map((presetId) => ({ presetId })),
      ...(['ledu', 'pairs', 'aduma', 'none'] as const).map((warningConversion) => ({ warningConversion })),
      ...(['blocks', 'aduma'] as const).map((minorEscalation) => ({ minorEscalation })),
      ...(['judges', 'joint'] as const).map((ballotMode) => ({ ballotMode })),
      ...(['hard', 'lastResort'] as const).map((conflictPolicy) => ({ conflictPolicy })),
      ...(['average', 'ballots', 'roundAverage'] as const).map((forfeitWinnerPoints) => ({ forfeitWinnerPoints })),
      ...(['fixed', 'reseed'] as const).map((bracketMode) => ({ bracketMode })),
      { oddPanels: false }, { oddPanels: true }, { blindQualifying: true }, { expectedTeams: 20 }, { itemMin: 1, itemMax: 5 },
      { tiebreaks: Object.keys(TIEBREAK_LABELS) as TiebreakKey[] },
    ];
    for (const patch of variants) {
      const tournament = createTabTournament('X', 'aduma', 1, 1);
      tournament.settings = { ...tournament.settings, ...patch };
      expect(normalizeTabTournament(JSON.parse(JSON.stringify(tournament))).tournament.settings, JSON.stringify(patch)).toEqual(tournament.settings);
    }
  });

  it('loads tournaments saved by version 1 with the defaults of their preset', () => {
    for (const [raw, presetId] of [[ledu, 'ledu-groups'], [uc3m, 'uc3m-swiss']] as const) {
      const { tournament, issues } = normalizeTabTournament(raw);
      expect(issues).toEqual([]);
      expect(tournament.schemaVersion).toBe(2);
      expect(tournament.settings).toEqual({ ...presetSettings(presetId), tiebreaks: tournament.settings.tiebreaks });
      expect(tournament).toMatchObject({ judgeConflicts: [], logTail: [], logSeq: 0 });
      expect(tournament.draftRound).toBeUndefined();
      const outcomes = computeTournamentOutcomes(tournament);
      expect([...outcomes.values()].filter((outcome) => outcome.status === 'complete')).toHaveLength(8);
    }
  });

  it('drops a damaged draft and unusable log entries, and says so', () => {
    const raw = JSON.parse(JSON.stringify(fullAduma()));
    raw.draftRound = { round: 'roto' };
    raw.logTail = [{ seq: 'x' }, ...raw.logTail];
    const { tournament, issues } = normalizeTabTournament(raw);
    expect(tournament.draftRound).toBeUndefined();
    expect(tournament.logTail).toHaveLength(1);
    expect(issues.join(' ')).toContain('borrador');
  });

  it('ignores invalid roles, unknown teams and bad levels', () => {
    const raw = JSON.parse(JSON.stringify(fullAduma()));
    raw.judgeConflicts.push({ id: 'c3', judgeId: 'j1', teamId: 'b', level: 'mucha', note: '' });
    raw.rounds[0].debates[0].result.joint.speakers.a[0].roles.push('portavoz');
    raw.rounds[0].debates[0].result.joint.items.zz = { coherencia: 1 };
    const { tournament } = normalizeTabTournament(raw);
    expect(tournament.judgeConflicts).toHaveLength(2);
    expect(tournament.rounds[0].debates[0].result!.joint!.speakers.a[0].roles).toEqual(['introductor', 'concluder']);
    expect(Object.keys(tournament.rounds[0].debates[0].result!.joint!.items)).toEqual(['a', 'b']);
  });
});
