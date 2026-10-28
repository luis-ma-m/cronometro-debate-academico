import { normalizeTabTournament, type NormalizeResult } from './normalize';
import { makeTabId, type TabTournament } from './types';

/** Subset of the Web Storage API, injectable so the store can be tested in node. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

interface StoreEvents {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

export const INDEX_KEY = 'ledu-tabulacion-index-v1';
const TOURNAMENT_PREFIX = 'ledu-tabulacion-v1:';
const BACKUP_PREFIX = 'ledu-tabulacion-backup-v1:';
export const MAX_BACKUPS = 3;
/** The quota (~5 MB) is shared with the panel; above this the panel login could fail to store its session. */
export const STORAGE_WARNING_BYTES = 3 * 1024 * 1024;

export const tournamentKey = (id: string) => TOURNAMENT_PREFIX + id;
const backupKey = (id: string, slot: number) => BACKUP_PREFIX + id + ':' + slot;

export type SaveStatus = 'idle' | 'dirty' | 'saved' | 'conflict' | 'error';
export interface TabIndexEntry { id: string; name: string; updatedAt: number }
export interface BackupInfo { slot: number; label: string; createdAt: number }

export interface TabStoreState {
  tournaments: TabIndexEntry[];
  tournament: TabTournament | null;
  status: SaveStatus;
  lastSavedAt: number | null;
  error: string | null;
  loadIssues: string[];
  usageBytes: number;
}

export interface TabStore {
  getState(): TabStoreState;
  subscribe(listener: () => void): () => void;
  update(mutator: (tournament: TabTournament) => TabTournament): void;
  flush(): void;
  create(tournament: TabTournament): void;
  open(id: string): void;
  remove(id: string): void;
  importTournament(tournament: TabTournament, mode: 'replace' | 'copy'): void;
  hasTournament(id: string): boolean;
  backup(label: string): boolean;
  listBackups(): BackupInfo[];
  restoreBackup(slot: number): void;
  /** Conflict resolution: adopt the version saved by another tab. */
  reloadFromStorage(): void;
  /** Conflict resolution: keep this tab's version. */
  overwrite(): void;
}

export interface TabStoreOptions {
  storage: KeyValueStorage;
  events?: StoreEvents | null;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => () => void;
  debounceMs?: number;
}

export function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { name, code } = error as { name?: string; code?: number };
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
}

/**
 * External store for the local tabulation (bound to React with useSyncExternalStore). Edits are saved with a short
 * debounce; each save checks the stored revision so two tabs never overwrite each other silently.
 */
export function createTabStore(options: TabStoreOptions): TabStore {
  const { storage } = options;
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  });
  const events = options.events === undefined ? (typeof window === 'undefined' ? null : window) : options.events;
  const debounceMs = options.debounceMs ?? 300;
  const listeners = new Set<() => void>();
  let cancelSave: (() => void) | null = null;
  let baseRevision: number | null = null;
  let state = initialState();

  function emit(patch: Partial<TabStoreState>) {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  }

  function measureUsage(): number {
    let chars = 0;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key) chars += key.length + (storage.getItem(key)?.length ?? 0);
    }
    return chars * 2;
  }

  function readIndex(): { activeId: string | null; tournaments: TabIndexEntry[] } {
    try {
      const raw = JSON.parse(storage.getItem(INDEX_KEY) ?? 'null') as { activeId?: unknown; tournaments?: unknown } | null;
      if (raw && Array.isArray(raw.tournaments)) {
        const tournaments = raw.tournaments
          .filter((entry): entry is TabIndexEntry => Boolean(entry) && typeof entry.id === 'string' && storage.getItem(tournamentKey(entry.id)) !== null)
          .map((entry) => ({ id: entry.id, name: String(entry.name ?? 'Torneo'), updatedAt: Number(entry.updatedAt) || 0 }));
        return { activeId: typeof raw.activeId === 'string' ? raw.activeId : null, tournaments };
      }
    } catch { /* Rebuilt below from the tournament keys. */ }
    const tournaments: TabIndexEntry[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(TOURNAMENT_PREFIX)) continue;
      try {
        const raw = JSON.parse(storage.getItem(key) ?? 'null') as { name?: unknown; updatedAt?: unknown } | null;
        tournaments.push({ id: key.slice(TOURNAMENT_PREFIX.length), name: String(raw?.name ?? 'Torneo'), updatedAt: Number(raw?.updatedAt) || 0 });
      } catch { /* Unreadable entries are ignored. */ }
    }
    return { activeId: tournaments[0]?.id ?? null, tournaments };
  }

  function writeIndex(activeId: string | null, tournaments: TabIndexEntry[]) {
    try {
      storage.setItem(INDEX_KEY, JSON.stringify({ activeId, tournaments }));
    } catch { /* The index can be rebuilt from the tournament keys. */ }
  }

  function load(id: string): NormalizeResult | null {
    try {
      const raw = storage.getItem(tournamentKey(id));
      return raw === null ? null : normalizeTabTournament(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  function storedRevision(id: string): number | null {
    try {
      const raw = storage.getItem(tournamentKey(id));
      if (raw === null) return null;
      return Number((JSON.parse(raw) as { revision?: unknown }).revision) || 0;
    } catch {
      return null;
    }
  }

  function initialState(): TabStoreState {
    const index = readIndex();
    const activeId = index.tournaments.some((entry) => entry.id === index.activeId) ? index.activeId : index.tournaments[0]?.id ?? null;
    const loaded = activeId ? load(activeId) : null;
    baseRevision = loaded?.tournament.revision ?? null;
    return {
      tournaments: index.tournaments,
      tournament: loaded?.tournament ?? null,
      status: loaded ? 'saved' : 'idle',
      lastSavedAt: null,
      error: null,
      loadIssues: loaded?.issues ?? [],
      usageBytes: measureUsage(),
    };
  }

  function removeBackups(id: string) {
    for (let slot = 0; slot < MAX_BACKUPS; slot++) storage.removeItem(backupKey(id, slot));
  }

  /** Writes a value, freeing this tournament's backups once if the quota is exhausted. */
  function write(key: string, value: string, tournamentId: string): boolean {
    try {
      storage.setItem(key, value);
      return true;
    } catch (error) {
      if (!isQuotaError(error)) return false;
      removeBackups(tournamentId);
      try {
        storage.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    }
  }

  function cancelPending() {
    cancelSave?.();
    cancelSave = null;
  }

  function save(force = false): boolean {
    cancelPending();
    const tournament = state.tournament;
    if (!tournament || (state.status !== 'dirty' && !force)) return true;
    const stored = storedRevision(tournament.id);
    if (!force && stored !== null && baseRevision !== null && stored !== baseRevision) {
      emit({ status: 'conflict' });
      return false;
    }
    const revision = Math.max(baseRevision ?? 0, stored ?? 0) + 1;
    const saved = { ...tournament, revision };
    if (!write(tournamentKey(saved.id), JSON.stringify(saved), saved.id)) {
      emit({ status: 'error', error: 'No queda espacio en el almacenamiento del navegador. Exporta una copia y borra torneos o copias antiguas.' });
      return false;
    }
    baseRevision = revision;
    const tournaments = [{ id: saved.id, name: saved.name, updatedAt: saved.updatedAt }, ...state.tournaments.filter((entry) => entry.id !== saved.id)];
    writeIndex(saved.id, tournaments);
    emit({ tournament: saved, tournaments, status: 'saved', lastSavedAt: now(), error: null, usageBytes: measureUsage() });
    return true;
  }

  function setActive(tournament: TabTournament | null, revision: number | null, loadIssues: string[] = []) {
    cancelPending();
    baseRevision = revision;
    emit({ tournament, status: tournament ? 'saved' : 'idle', loadIssues, error: null });
  }

  function writeBackup(tournament: TabTournament, label: string): boolean {
    const slots = Array.from({ length: MAX_BACKUPS }, (_, slot) => ({ slot, info: readBackupInfo(tournament.id, slot) }));
    const target = slots.find((entry) => !entry.info) ?? slots.sort((x, y) => x.info!.createdAt - y.info!.createdAt)[0];
    try {
      storage.setItem(backupKey(tournament.id, target.slot), JSON.stringify({ label, createdAt: now(), tournament }));
      return true;
    } catch {
      return false;
    }
  }

  function readBackupInfo(id: string, slot: number): BackupInfo | null {
    try {
      const raw = JSON.parse(storage.getItem(backupKey(id, slot)) ?? 'null') as { label?: unknown; createdAt?: unknown } | null;
      return raw ? { slot, label: String(raw.label ?? 'Copia'), createdAt: Number(raw.createdAt) || 0 } : null;
    } catch {
      return null;
    }
  }

  function onStorage(event: Event) {
    const { key, newValue } = event as StorageEvent;
    if (key === null || key === INDEX_KEY) {
      emit({ tournaments: readIndex().tournaments, usageBytes: measureUsage() });
      return;
    }
    const active = state.tournament;
    if (!active || key !== tournamentKey(active.id)) return;
    if (newValue === null) {
      setActive(null, null);
      emit({ tournaments: readIndex().tournaments });
      return;
    }
    if (state.status === 'dirty' || state.status === 'conflict') {
      cancelPending();
      emit({ status: 'conflict' });
      return;
    }
    try {
      const loaded = normalizeTabTournament(JSON.parse(newValue));
      setActive(loaded.tournament, loaded.tournament.revision, loaded.issues);
    } catch { /* Ignore unreadable writes from other tabs. */ }
  }

  function onPageHide() {
    if (state.status === 'dirty') save();
  }

  const store: TabStore = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1 && events) {
        events.addEventListener('storage', onStorage);
        events.addEventListener('pagehide', onPageHide);
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size && events) {
          events.removeEventListener('storage', onStorage);
          events.removeEventListener('pagehide', onPageHide);
        }
      };
    },
    update(mutator) {
      const current = state.tournament;
      if (!current || state.status === 'conflict') return;
      const next = mutator(current);
      if (next === current) return;
      emit({ tournament: { ...next, updatedAt: now() }, status: 'dirty' });
      cancelPending();
      cancelSave = schedule(() => {
        cancelSave = null;
        save();
      }, debounceMs);
    },
    flush() {
      if (state.status === 'dirty') save();
    },
    create(tournament) {
      store.flush();
      baseRevision = null;
      emit({ tournament: { ...tournament, revision: 0 }, status: 'dirty', loadIssues: [], error: null });
      save();
    },
    open(id) {
      store.flush();
      const loaded = load(id);
      if (!loaded) {
        emit({ error: 'No se ha podido abrir el torneo: los datos guardados no son válidos.' });
        return;
      }
      writeIndex(id, state.tournaments);
      setActive(loaded.tournament, loaded.tournament.revision, loaded.issues);
    },
    remove(id) {
      storage.removeItem(tournamentKey(id));
      removeBackups(id);
      const tournaments = state.tournaments.filter((entry) => entry.id !== id);
      const wasActive = state.tournament?.id === id;
      writeIndex(wasActive ? null : state.tournament?.id ?? null, tournaments);
      if (wasActive) setActive(null, null);
      emit({ tournaments, usageBytes: measureUsage() });
    },
    importTournament(tournament, mode) {
      const exists = store.hasTournament(tournament.id);
      if (!exists || mode === 'copy') {
        store.create(exists ? { ...tournament, id: makeTabId('torneo'), name: tournament.name + ' (copia)' } : tournament);
        return;
      }
      const previous = load(tournament.id);
      if (previous) writeBackup(previous.tournament, 'Antes de importar una copia');
      store.flush();
      baseRevision = null;
      emit({ tournament, status: 'dirty', loadIssues: [], error: null });
      save(true);
    },
    hasTournament: (id) => storage.getItem(tournamentKey(id)) !== null,
    backup(label) {
      return state.tournament ? writeBackup(state.tournament, label) : false;
    },
    listBackups() {
      const id = state.tournament?.id;
      if (!id) return [];
      return Array.from({ length: MAX_BACKUPS }, (_, slot) => readBackupInfo(id, slot))
        .filter((info): info is BackupInfo => Boolean(info))
        .sort((x, y) => y.createdAt - x.createdAt);
    },
    restoreBackup(slot) {
      const current = state.tournament;
      if (!current) return;
      let restored: TabTournament;
      try {
        const raw = JSON.parse(storage.getItem(backupKey(current.id, slot)) ?? 'null') as { tournament?: unknown } | null;
        restored = normalizeTabTournament(raw?.tournament).tournament;
      } catch {
        emit({ error: 'La copia seleccionada no se puede leer.' });
        return;
      }
      writeBackup(current, 'Antes de restaurar una copia');
      store.update(() => ({ ...restored, id: current.id, revision: current.revision }));
    },
    reloadFromStorage() {
      const id = state.tournament?.id;
      const loaded = id ? load(id) : null;
      setActive(loaded?.tournament ?? null, loaded?.tournament.revision ?? null, loaded?.issues ?? []);
      emit({ tournaments: readIndex().tournaments });
    },
    overwrite() {
      if (!state.tournament) return;
      emit({ status: 'dirty' });
      save(true);
    },
  };
  return store;
}

/** In-memory KeyValueStorage, used by tests. */
export function memoryStorage(initial: Record<string, string> = {}, quotaChars = Infinity): KeyValueStorage {
  const data = new Map(Object.entries(initial));
  const size = () => [...data].reduce((total, [key, value]) => total + key.length + value.length, 0);
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      const previous = data.get(key);
      data.set(key, value);
      if (size() > quotaChars) {
        if (previous === undefined) data.delete(key);
        else data.set(key, previous);
        throw Object.assign(new Error('Quota exceeded'), { name: 'QuotaExceededError' });
      }
    },
    removeItem: (key) => { data.delete(key); },
    key: (index) => [...data.keys()][index] ?? null,
    get length() { return data.size; },
  };
}
