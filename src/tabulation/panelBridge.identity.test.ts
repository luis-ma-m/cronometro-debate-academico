import { describe, expect, it } from 'vitest';
import { canonicalId, resolveMappedIdentity } from '../contracts/identity';

describe('panel identity adapter contract', () => {
  it('uses explicit mappings and preserves canonical values', () => {
    expect(resolveMappedIdentity('team', { local: 'manager-team' }, 'local')).toBe(canonicalId('team', 'manager-team'));
  });

  it('does not invent an identity when no mapping exists', () => {
    expect(resolveMappedIdentity('team', {}, 'local')).toBeNull();
  });
});
