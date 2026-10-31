import { describe, expect, it } from 'vitest';
import { createTabTournament } from '../tabulation/presets';
import { INDEX_KEY, tournamentKey } from '../tabulation/store';
import { readLinkedTabulationTournament } from './TabulationTournamentRanking';

function memoryStorage(entries: Record<string, string>) {
  return { getItem: (key: string) => entries[key] ?? null };
}

describe('readLinkedTabulationTournament', () => {
  it('finds the tournament by canonical remote identity, not by its local name', () => {
    const tournament = createTabTournament('Nombre local', 'aduma');
    tournament.panelLink = {
      tournamentName: 'Torneo oficial',
      linkedAt: 10,
      remoteId: 'remote-42',
      remoteRevision: 7,
      remoteUpdatedAt: 123,
      idMap: { teams: { 'local-team': 'manager-team' }, speakers: {}, judges: {}, venues: {} },
    };
    const storage = memoryStorage({
      [INDEX_KEY]: JSON.stringify({ activeId: tournament.id, tournaments: [{ id: tournament.id, name: tournament.name, updatedAt: tournament.updatedAt }] }),
      [tournamentKey(tournament.id)]: JSON.stringify(tournament),
    });
    expect(readLinkedTabulationTournament(storage, 'remote-42')?.id).toBe(tournament.id);
    expect(readLinkedTabulationTournament(storage, 'another-tournament')).toBeNull();
  });

  it('ignores damaged entries and continues looking for a valid linked tournament', () => {
    const tournament = createTabTournament('Nombre local', 'aduma');
    tournament.panelLink = { tournamentName: 'Torneo oficial', linkedAt: 10, remoteId: 'remote-42' };
    const storage = memoryStorage({
      [INDEX_KEY]: JSON.stringify({ tournaments: [{ id: 'damaged', updatedAt: 20 }, { id: tournament.id, updatedAt: 10 }] }),
      [tournamentKey('damaged')]: '{not-json',
      [tournamentKey(tournament.id)]: JSON.stringify(tournament),
    });
    expect(readLinkedTabulationTournament(storage, 'remote-42')?.id).toBe(tournament.id);
  });

  it('returns null for missing index, missing remote identity or no linked tournament', () => {
    expect(readLinkedTabulationTournament(memoryStorage({}), 'remote-42')).toBeNull();
    expect(readLinkedTabulationTournament(memoryStorage({}), undefined)).toBeNull();
    const tournament = createTabTournament('Local', 'aduma');
    const storage = memoryStorage({
      [INDEX_KEY]: JSON.stringify({ tournaments: [{ id: tournament.id }] }),
      [tournamentKey(tournament.id)]: JSON.stringify(tournament),
    });
    expect(readLinkedTabulationTournament(storage, 'remote-42')).toBeNull();
  });
});
