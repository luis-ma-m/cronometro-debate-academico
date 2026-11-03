import { useSyncExternalStore } from 'react';
import { createTabStore, type TabStore, type TabStoreState } from './store';
import { createWriterLock } from './writerLock';
import { getBrowserSharedTournamentRepository, hydrateLegacyTabulationKeys } from '../contracts/sharedTournamentRepository';

let browserStore: TabStore | null = null;

/**
 * One store per page, created outside React so StrictMode double renders never create two writers. Only one tab
 * of the browser writes; the others stay read-only until they take control.
 */
function createSharedStorage(): Storage {
  const legacy = window.localStorage;
  const shared = getBrowserSharedTournamentRepository();
  // Restore only missing keys from the shared document. Existing v1 records always win
  // until the user explicitly migrates/reconciles them.
  hydrateLegacyTabulationKeys(legacy);
  const isSharedKey = (key: string) => key === 'ledu-tabulacion-index-v1' || key.startsWith('ledu-tabulacion-v1:');
  return {
    get length() { return legacy.length; },
    clear: () => legacy.clear(),
    key: (index: number) => legacy.key(index),
    getItem: (key: string) => legacy.getItem(key) ?? (isSharedKey(key) ? shared.readTabulationEntry(key) : null),
    setItem: (key: string, value: string) => {
      legacy.setItem(key, value);
      if (isSharedKey(key)) shared.writeTabulationEntry(key, value);
    },
    removeItem: (key: string) => {
      legacy.removeItem(key);
      if (isSharedKey(key)) shared.removeTabulationEntry(key);
    },
  } as Storage;
}

export function getBrowserTabStore(): TabStore {
  browserStore ??= createTabStore({ storage: createSharedStorage(), lock: createWriterLock({ name: 'ledu-tabulacion' }) });
  return browserStore;
}

export function useTabStore(store: TabStore): TabStoreState {
  return useSyncExternalStore(store.subscribe, store.getState);
}
