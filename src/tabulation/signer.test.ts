import { describe, expect, it } from 'vitest';
import { matchActaSigner } from './signer';

const judges = [
  { id: 'chair', name: 'Luis Martín Maíllo' },
  { id: 'panel', name: 'Ana María Pérez Gómez' },
];

describe('matchActaSigner', () => {
  it('identifies the chair despite case, accents and omitted surnames', () => {
    expect(matchActaSigner('LUIS martin', judges, 'chair')).toEqual({
      kind: 'chair', judgeId: 'chair', judgeName: 'Luis Martín Maíllo',
    });
  });

  it('identifies a secondary judge from a partial multi-token name', () => {
    expect(matchActaSigner('ana perez', judges, 'chair')).toEqual({
      kind: 'panel', judgeId: 'panel', judgeName: 'Ana María Pérez Gómez',
    });
  });

  it('accepts a unique first name when the assigned panel makes it unambiguous', () => {
    expect(matchActaSigner('ANA', judges, 'chair').kind).toBe('panel');
  });

  it('does not guess when a single name is shared by two assigned judges', () => {
    expect(matchActaSigner('Ana', [
      { id: 'one', name: 'Ana Pérez' },
      { id: 'two', name: 'Ana Gómez' },
    ], 'one')).toEqual({ kind: 'unmatched' });
  });

  it('flags a signer who does not match any assigned judge', () => {
    expect(matchActaSigner('Carlos López', judges, 'chair')).toEqual({ kind: 'unmatched' });
  });

  it('ignores titles and punctuation', () => {
    expect(matchActaSigner('Dra. Ana M. Pérez', judges, 'chair').kind).toBe('panel');
  });
});
