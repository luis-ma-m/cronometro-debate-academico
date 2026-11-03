import { createIndexedDbApplicationRecordRepository } from './applicationPersistence';

export const SHARED_TOURNAMENT_KEY = 'ledu-shared-tournament-v1';
export const SHARED_TOURNAMENT_NAMESPACE = 'active-tournament';

export interface SharedTournamentDocument {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly updatedAt: number;
  readonly manager: unknown | null;
  readonly tabulation: Readonly<Record<string, string>>;
}

export interface SharedTournamentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const emptyDocument = (): SharedTournamentDocument => ({
  schemaVersion: 1, revision: 0, updatedAt: 0, manager: null, tabulation: {},
});

function parseDocument(raw: string | null): SharedTournamentDocument | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<SharedTournamentDocument>;
    if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || (value.revision ?? -1) < 0
      || !Number.isSafeInteger(value.updatedAt) || (value.updatedAt ?? -1) < 0
      || !value.tabulation || typeof value.tabulation !== 'object' || Array.isArray(value.tabulation)) return null;
    return {
      schemaVersion: 1, revision: value.revision!, updatedAt: value.updatedAt!,
      manager: value.manager ?? null,
      tabulation: Object.fromEntries(Object.entries(value.tabulation).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
    };
  } catch { return null; }
}

/**
 * Synchronous shared runtime boundary for the two browser shells.
 *
 * The domain models remain module-specific, but both are persisted as projections
 * of one active-tournament document. Legacy keys remain readable and are mirrored
 * rather than deleted. IndexedDB receives a durable versioned copy asynchronously.
 */
export function createSharedTournamentRepository(storage: SharedTournamentStorage, now: () => number = Date.now) {
  let writeChain: Promise<void> = Promise.resolve();

  function read(): SharedTournamentDocument {
    return parseDocument(storage.getItem(SHARED_TOURNAMENT_KEY)) ?? emptyDocument();
  }

  function commit(patch: Partial<Pick<SharedTournamentDocument, 'manager' | 'tabulation'>>): SharedTournamentDocument {
    const current = read();
    const next: SharedTournamentDocument = Object.freeze({
      schemaVersion: 1,
      revision: current.revision + 1,
      updatedAt: now(),
      manager: Object.prototype.hasOwnProperty.call(patch, 'manager') ? patch.manager : current.manager,
      tabulation: patch.tabulation ? { ...current.tabulation, ...patch.tabulation } : current.tabulation,
    });
    storage.setItem(SHARED_TOURNAMENT_KEY, JSON.stringify(next));
    // Keep the IndexedDB mirror ordered within this tab. A failed mirror is non-fatal:
    // the synchronous local copy remains available and the next write retries it.
    writeChain = writeChain.then(async () => {
      try {
        const repository = createIndexedDbApplicationRecordRepository();
        const existing = await repository.get<SharedTournamentDocument>(SHARED_TOURNAMENT_NAMESPACE, 'active');
        await repository.put(SHARED_TOURNAMENT_NAMESPACE, 'active', next, { expectedRevision: existing?.revision ?? null, now: next.updatedAt });
      } catch { /* IndexedDB may be unavailable; local-first operation is preserved. */ }
    });
    return next;
  }

  return {
    read,
    writeManager(value: unknown) { return commit({ manager: value }); },
    readManager<T>(): T | null { return read().manager as T | null; },
    writeTabulationEntry(key: string, value: string) { return commit({ tabulation: { [key]: value } }); },
    removeTabulationEntry(key: string) {
      const current = read();
      const tabulation = { ...current.tabulation };
      delete tabulation[key];
      return commit({ tabulation });
    },
    readTabulationEntry(key: string): string | null { return read().tabulation[key] ?? null; },
    tabulationEntries(): Readonly<Record<string, string>> { return read().tabulation; },
  };
}

export function getBrowserSharedTournamentRepository() {
  return createSharedTournamentRepository(window.localStorage);
}

/** Test and migration helper: only restores missing legacy keys; never overwrites them. */
export function hydrateLegacyTabulationKeys(storage: SharedTournamentStorage & { getItem(key: string): string | null }) {
  const repository = createSharedTournamentRepository(storage);
  for (const [key, value] of Object.entries(repository.tabulationEntries())) {
    if (storage.getItem(key) === null) storage.setItem(key, value);
  }
}
