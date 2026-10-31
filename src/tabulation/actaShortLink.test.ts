import { describe, expect, it } from 'vitest';
import { isActaLinkSnapshot } from './actaShortLink';
import type { ActaLink } from './whatsapp';

const valid: ActaLink = {
  version: 2,
  tournament: '',
  round: { number: 1, name: 'Ronda 1', elimination: false },
  debate: 'debate-ref',
  key: 'context-key',
  venue: 'Aula 1',
  teams: [
    { id: 'A', name: 'Equipo A', members: [{ id: 'A0', name: 'Oradora A' }] },
    { id: 'B', name: 'Equipo B', members: [{ id: 'B0', name: 'Orador B' }] },
  ],
  jury: ['Juez principal'],
  rules: {
    rubric: [{ id: 'item-1', name: 'Argumentación', section: 'Fondo', description: '' }],
    itemMin: 1, itemMax: 5, speakerScores: true, speakerScoreMin: 1,
    speakerScoreMax: 10, speakerScoreStep: 0.5, warningConversion: 0,
    minorEscalation: 0, minorPoints: 0, minorsPerMajor: 1, majorMode: 'fixed', majorPoints: 0,
  },
  desk: '',
};

describe('short-link snapshot validation', () => {
  it('accepts a complete immutable acta snapshot', () => {
    expect(isActaLinkSnapshot(valid)).toBe(true);
  });

  it('rejects missing rubric and malformed nested team members', () => {
    expect(isActaLinkSnapshot({ ...valid, rules: {} })).toBe(false);
    expect(isActaLinkSnapshot({ ...valid, teams: [{ ...valid.teams[0], members: [null] }, valid.teams[1]] })).toBe(false);
  });

  it('rejects duplicate team/member identifiers and malformed round metadata', () => {
    expect(isActaLinkSnapshot({ ...valid, teams: [valid.teams[0], { ...valid.teams[1], id: 'A' }] })).toBe(false);
    expect(isActaLinkSnapshot({ ...valid, round: { ...valid.round, number: 0 } })).toBe(false);
  });
});
