import { describe, expect, it } from 'vitest';
import { ADUMA_DEFAULT_NAME, ADUMA_RUBRIC, createTabTournament, PRESET_OPTIONS, presetSettings } from './presets';
import { effectivePenalties } from './results';
import { emptyPenalties, isFallenAt, TAB_SCHEMA_VERSION } from './types';
import { team } from './test-fixtures';

describe('ADUMA preset (Reglamento V Torneo Nacional ADUMA)', () => {
  it('follows arts. 16, 22, 23, 25, 29–31, 36 and 43', () => {
    const settings = presetSettings('aduma');
    expect(settings).toMatchObject({
      presetId: 'aduma', stage: 'swiss', swissRounds: 4, breakSize: 8, bracketMode: 'fixed', bracketSeedOrder: [1, 8, 3, 6, 2, 7, 4, 5],
      qualifyingPanelSize: 3, oddPanels: false, qualifyingSideMode: 'draw', ballotMode: 'joint', itemMin: 0, itemMax: 5,
      speakerScoreMin: 1, speakerScoreMax: 10, speakerScoreStep: 0.5, speakerMetric: 'sum',
      warningConversion: 'aduma', minorEscalation: 'aduma', minorPoints: 5, majorMode: 'points', majorPoints: 10,
      tiebreaks: ['pointsTotal', 'headToHead', 'fewestMajors', 'fewestMinors'], tiebreakFallback: 'manual',
      conflictPolicy: 'lastResort', blindQualifying: true, expectedTeams: 20, avoidSameInstitution: false, forfeitWinnerPoints: 'roundAverage',
    });
    expect(ADUMA_RUBRIC).toHaveLength(11);
    expect([...new Set(ADUMA_RUBRIC.map((item) => item.section))]).toEqual(['Fondo', 'Estructura', 'Forma']);
    expect(new Set(ADUMA_RUBRIC.map((item) => item.id)).size).toBe(11);
    expect(PRESET_OPTIONS.map((option) => option.id)).toContain('aduma');
  });

  it('creates the tournament with its name and the current schema', () => {
    const tournament = createTabTournament('', 'aduma', 1, 2);
    expect(tournament).toMatchObject({ name: ADUMA_DEFAULT_NAME, schemaVersion: TAB_SCHEMA_VERSION, judgeConflicts: [], logTail: [], logSeq: 0 });
    expect(TAB_SCHEMA_VERSION).toBe(2);
  });

  it('keeps the previous behaviour for LEDU and UC3M', () => {
    for (const id of ['ledu-groups', 'uc3m-swiss'] as const) {
      expect(presetSettings(id)).toMatchObject({ ballotMode: 'judges', minorEscalation: 'blocks', oddPanels: true, conflictPolicy: 'hard', blindQualifying: false, bracketSeedOrder: [] });
    }
  });

  it('applies the penalty table sent to the committee (arts. 36, 39, 40)', () => {
    const settings = presetSettings('aduma');
    const table: Array<[{ warnings?: number; minors?: number; majors?: number }, number, number, number]> = [
      [{ warnings: 1 }, 0, 0, 0],
      [{ warnings: 2 }, 1, 0, 5],
      [{ warnings: 3 }, 0, 1, 10],
      [{ minors: 1 }, 1, 0, 5],
      [{ minors: 2 }, 0, 1, 10],
      [{ minors: 3 }, 0, 2, 20],
      [{ warnings: 1, minors: 1 }, 1, 0, 5],
      [{ warnings: 2, minors: 1 }, 0, 1, 10],
      [{ majors: 1 }, 0, 1, 10],
    ];
    for (const [input, minors, majors, deduction] of table) {
      expect(effectivePenalties({ ...emptyPenalties(), ...input }, settings), JSON.stringify(input)).toMatchObject({ minors, majors, deduction, forfeit: false });
    }
  });
});

describe('equipo caído', () => {
  it('is fallen from the indicated round onwards only', () => {
    const fallen = team('x', 'X', { fallenFromRound: 2 });
    expect([1, 2, 3].map((round) => isFallenAt(fallen, round))).toEqual([false, true, true]);
    expect(isFallenAt(team('y'), 3)).toBe(false);
    expect(isFallenAt(undefined, 3)).toBe(false);
  });
});
