import { useSyncExternalStore } from 'react';
import { createTabStore, type TabStore, type TabStoreState } from './store';
import { createWriterLock } from './writerLock';

let browserStore: TabStore | null = null;

/**
 * One store per page, created outside React so StrictMode double renders never create two writers. Only one tab
 * of the browser writes; the others stay read-only until they take control.
 */
export function getBrowserTabStore(): TabStore {
  browserStore ??= createTabStore({ storage: window.localStorage, lock: createWriterLock({ name: 'ledu-tabulacion' }) });
  return browserStore;
}

export function useTabStore(store: TabStore): TabStoreState {
  return useSyncExternalStore(store.subscribe, store.getState);
}
