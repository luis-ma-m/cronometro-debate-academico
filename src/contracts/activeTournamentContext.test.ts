import { describe, expect, it } from 'vitest';
import {
  activeTournamentContext,
  ActiveTournamentContextError,
  parseActiveTournamentContext,
} from './activeTournamentContext';

describe('active tournament context', () => {
  it('creates an immutable context for the single active tournament', () => {
    const context = activeTournamentContext('tournament-1', 4, 'server', 1_800_000_000_000);
    expect(context).toEqual({
      schemaVersion: 1,
      tournamentId: 'tournament-1',
      revision: 4,
      source: 'server',
      updatedAt: 1_800_000_000_000,
    });
    expect(Object.isFrozen(context)).toBe(true);
  });

  it('supports a local context before a server identity is available', () => {
    expect(activeTournamentContext('local:installation-1', 0, 'local', 0).source).toBe('local');
  });

  it.each([
    null,
    [],
    {},
    { schemaVersion: 2, tournamentId: 't-1', revision: 0, source: 'local', updatedAt: 0 },
    { schemaVersion: 1, tournamentId: ' ', revision: 0, source: 'local', updatedAt: 0 },
    { schemaVersion: 1, tournamentId: 't-1', revision: -1, source: 'local', updatedAt: 0 },
    { schemaVersion: 1, tournamentId: 't-1', revision: 1.5, source: 'local', updatedAt: 0 },
    { schemaVersion: 1, tournamentId: 't-1', revision: 0, source: 'unknown', updatedAt: 0 },
    { schemaVersion: 1, tournamentId: 't-1', revision: 0, source: 'server', updatedAt: -1 },
  ])('rejects malformed external context %#', (value) => {
    expect(() => parseActiveTournamentContext(value)).toThrow(ActiveTournamentContextError);
  });

  it('rejects unsafe integer revisions and timestamps', () => {
    expect(() => activeTournamentContext('t-1', Number.MAX_SAFE_INTEGER + 1, 'server', 0))
      .toThrow(ActiveTournamentContextError);
    expect(() => activeTournamentContext('t-1', 0, 'server', Number.MAX_SAFE_INTEGER + 1))
      .toThrow(ActiveTournamentContextError);
  });
});
