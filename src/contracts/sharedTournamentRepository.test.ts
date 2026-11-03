import { describe, expect, it } from 'vitest';
import { createSharedTournamentRepository, hydrateLegacyTabulationKeys, SHARED_TOURNAMENT_KEY } from './sharedTournamentRepository';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe('shared active tournament repository', () => {
  it('keeps manager and tabulation projections in one versioned document', () => {
    const storage = memoryStorage();
    const repository = createSharedTournamentRepository(storage, () => 100);
    repository.writeManager({ id: 'manager-1', teams: ['a'] });
    repository.writeTabulationEntry('ledu-tabulacion-index-v1', JSON.stringify({ activeId: 'tab-1' }));
    repository.writeTabulationEntry('ledu-tabulacion-v1:tab-1', JSON.stringify({ id: 'tab-1', teams: ['b'] }));

    expect(repository.read()).toMatchObject({
      schemaVersion: 1, revision: 3, updatedAt: 100,
      manager: { id: 'manager-1', teams: ['a'] },
      tabulation: {
        'ledu-tabulacion-index-v1': JSON.stringify({ activeId: 'tab-1' }),
        'ledu-tabulacion-v1:tab-1': JSON.stringify({ id: 'tab-1', teams: ['b'] }),
      },
    });
    expect(repository.readManager()).toEqual({ id: 'manager-1', teams: ['a'] });
  });

  it('restores only missing legacy keys and never overwrites an existing local record', () => {
    const storage = memoryStorage();
    const repository = createSharedTournamentRepository(storage);
    repository.writeTabulationEntry('ledu-tabulacion-v1:one', 'shared-copy');
    storage.setItem('ledu-tabulacion-v1:one', 'legacy-authoritative');
    repository.writeTabulationEntry('ledu-tabulacion-v1:two', 'restore-me');

    hydrateLegacyTabulationKeys(storage);
    expect(storage.getItem('ledu-tabulacion-v1:one')).toBe('legacy-authoritative');
    expect(storage.getItem('ledu-tabulacion-v1:two')).toBe('restore-me');
  });

  it('rejects malformed shared documents without destroying their bytes', () => {
    const malformed = '{broken';
    const storage = memoryStorage({ [SHARED_TOURNAMENT_KEY]: malformed });
    expect(createSharedTournamentRepository(storage).read()).toMatchObject({ revision: 0, manager: null, tabulation: {} });
    expect(storage.getItem(SHARED_TOURNAMENT_KEY)).toBe(malformed);
  });

  it('removes only the requested tabulation projection', () => {
    const storage = memoryStorage();
    const repository = createSharedTournamentRepository(storage);
    repository.writeTabulationEntry('one', '1');
    repository.writeTabulationEntry('two', '2');
    repository.removeTabulationEntry('one');
    expect(repository.tabulationEntries()).toEqual({ two: '2' });
  });
});
