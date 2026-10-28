import { useSyncExternalStore } from 'react';
import { createTabStore, type TabStore, type TabStoreState } from './store';

let browserStore: TabStore | null = null;

/** One store per page, created outside React so StrictMode double renders never create two writers. */
export function getBrowserTabStore(): TabStore {
  browserStore ??= createTabStore({ storage: window.localStorage });
  return browserStore;
}

export function useTabStore(store: TabStore): TabStoreState {
  return useSyncExternalStore(store.subscribe, store.getState);
}
