import { useSyncExternalStore } from 'react';
import { createTabStore, type TabStore, type TabStoreState } from './store';
import { createWriterLock } from './writerLock';
import { createCanonicalTabulationStorage } from '../contracts/canonicalTournamentRepository';

let browserStore: TabStore | null = null;

/**
 * One store per page, created outside React so StrictMode double renders never create two writers. Only one tab
 * of the browser writes; the others stay read-only until they take control.
 */
export function getBrowserTabStore(): TabStore {\n  browserStore ??= createTabStore({ storage: createCanonicalTabulationStorage(window.localStorage), lock: createWriterLock({ name: 'ledu-tabulacion' }) });\n  return browserStore;\n}
export function getBrowserTabStore(): TabStore {
  browserStore ??= createTabStore({ storage: createSharedStorage(), lock: createWriterLock({ name: 'ledu-tabulacion' }) });
  return browserStore;
}

export function useTabStore(store: TabStore): TabStoreState {
  return useSyncExternalStore(store.subscribe, store.getState);
}
