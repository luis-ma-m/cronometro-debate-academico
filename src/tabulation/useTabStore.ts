import { useSyncExternalStore } from 'react';
import { createTabStore, INDEX_KEY, tournamentKey, type TabStore, type TabStoreState } from './store';
import { createWriterLock } from './writerLock';
import {
  CANONICAL_TOURNAMENT_KEY,
  createCanonicalTabulationStorage,
  getBrowserCanonicalTournamentRepository,
} from '../contracts/canonicalTournamentRepository';

let browserStore: TabStore | null = null;

function canonicalStoreEvents(): {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
} {
  const wrappers = new WeakMap<(event: Event) => void, EventListener>();
  return {
    addEventListener(type, listener) {
      const wrapped: EventListener = (event) => {
        if (type !== 'storage' || (event as StorageEvent).key !== CANONICAL_TOURNAMENT_KEY) {
          listener(event);
          return;
        }
        const repository = getBrowserCanonicalTournamentRepository();
        const index = repository.readIndex();
        listener(new StorageEvent('storage', { key: INDEX_KEY, newValue: JSON.stringify(index) }));
        const activeId = browserStore?.getState().tournament?.id ?? index.activeId;
        if (activeId) {
          const tournament = repository.readTabulation(activeId);
          listener(new StorageEvent('storage', {
            key: tournamentKey(activeId),
            newValue: tournament ? JSON.stringify(tournament) : null,
          }));
        }
      };
      wrappers.set(listener, wrapped);
      window.addEventListener(type, wrapped);
    },
    removeEventListener(type, listener) {
      const wrapped = wrappers.get(listener);
      if (wrapped) window.removeEventListener(type, wrapped);
      wrappers.delete(listener);
    },
  };
}

/**
 * One store per page, created outside React so StrictMode double renders never create two writers.
 * Its synchronous Storage facade is only a compatibility boundary: tournament/index reads and writes
 * are backed by the canonical entity repository; logs, backups and operator metadata remain append-only
 * auxiliary records in their existing keys.
 */
export function getBrowserTabStore(): TabStore {
  browserStore ??= createTabStore({
    storage: createCanonicalTabulationStorage(window.localStorage),
    events: canonicalStoreEvents(),
    lock: createWriterLock({ name: 'ledu-tabulacion' }),
  });
  return browserStore;
}

export function useTabStore(store: TabStore): TabStoreState {
  return useSyncExternalStore(store.subscribe, store.getState);
}
