import { describe, expect, it } from 'vitest';
import { canonicalJson, cyrb53 } from './hash';

describe('canonical JSON', () => {
  it('sorts object keys at every level and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}');
  });

  it('drops undefined values like JSON.stringify', () => {
    expect(canonicalJson({ a: undefined, b: [undefined, 1] })).toBe('{"b":[null,1]}');
  });
});

describe('cyrb53', () => {
  it('matches the reference implementation (stored logs depend on it never changing)', () => {
    // 'a' → 7929297801672961 is the published cyrb53 test vector; the rest come from the reference code.
    expect(cyrb53('')).toBe('0bdcb81aee8d83');
    expect(cyrb53('a')).toBe((7929297801672961).toString(16).padStart(14, '0'));
    expect(cyrb53('ADUMA')).toBe('0ae39aa6d33cdb');
    expect(cyrb53('árbitro')).toBe('0af487390c55ad');
  });

  it('changes with any character and with the seed', () => {
    expect(cyrb53('ronda 1')).not.toBe(cyrb53('ronda 2'));
    expect(cyrb53('árbitro')).not.toBe(cyrb53('arbitro'));
    expect(cyrb53('x', 1)).not.toBe(cyrb53('x', 2));
  });
});
