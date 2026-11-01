import { describe, expect, it } from 'vitest';
import {
  canonicalId,
  entityIdentity,
  IdentityContractError,
  parseEntityIdentity,
  resolveMappedIdentity,
  sourceId,
} from './identity';

describe('canonical identity contracts', () => {
  it('preserves opaque legacy IDs without normalizing them', () => {
    expect(canonicalId('team', 'legacy:Team 01')).toBe('legacy:Team 01');
    expect(sourceId('speaker', 'speaker_01')).toBe('speaker_01');
  });

  it('rejects empty, oversized and control-character IDs', () => {
    expect(() => canonicalId('team', '   ')).toThrow(IdentityContractError);
    expect(() => sourceId('judge', 'bad\nid')).toThrow(IdentityContractError);
    expect(() => canonicalId('team', 'x'.repeat(201))).toThrow(IdentityContractError);
  });

  it('creates immutable, typed identities with explicit provenance', () => {
    const identity = entityIdentity('team', 'team-1', 'manager', 'tab-team-9');
    expect(identity).toEqual({
      kind: 'team',
      canonicalId: 'team-1',
      source: 'manager',
      sourceId: 'tab-team-9',
    });
    expect(Object.isFrozen(identity)).toBe(true);
  });

  it('resolves only explicit ID mappings and never guesses by name', () => {
    const mapping = { 'tab-team-9': 'team-1' };
    expect(resolveMappedIdentity('team', mapping, 'tab-team-9')).toBe('team-1');
    expect(resolveMappedIdentity('team', mapping, 'Team A')).toBeNull();
    const inherited = Object.create({ 'legacy-team': 'team-2' }) as Record<string, string>;
    expect(resolveMappedIdentity('team', inherited, 'legacy-team')).toBeNull();
  });

  it('validates external identity DTOs at runtime', () => {
    expect(parseEntityIdentity('judge', {
      kind: 'judge',
      canonicalId: 'judge-1',
      source: 'manager',
      sourceId: 'local-judge-1',
    }).canonicalId).toBe('judge-1');

    expect(() => parseEntityIdentity('team', {
      kind: 'judge',
      canonicalId: 'judge-1',
      source: 'manager',
      sourceId: 'local-judge-1',
    })).toThrow(IdentityContractError);
    expect(() => parseEntityIdentity('team', null)).toThrow(IdentityContractError);
  });
});
