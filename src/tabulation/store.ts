import { describeChanges, mergeChanges, summarizeChanges, type Change } from './changes';
import { adoptLog, appendLogEntry, archivedLastSeq, archiveTail, formatLogTime, readLog, removeLog, verifyLog, type LogInput, type LogVerification } from './log';
import { normalizeTabTournament, type NormalizeResult } from './normalize';
import { makeTabId, type TabLogEntry, type TabTournament } from './types';
import type { WriterLock } from './writerLock';

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
export const OPERATOR_KEY = 'ledu-tabulacion-operador-v1';
export const MAX_BACKUPS = 3;
/** The quota (~5 MB) is shared with the panel; above this the panel login could fail to store its session. */
export const STORAGE_WARNING_BYTES = 3 * 1024 * 1024;
/** Unnamed edits are grouped in one log entry until this long without changes. */
const LOG_IDLE_MS = 10_000;
const MAX_CHANGES_PER_ENTRY = 20;

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
  /** Another tab is the writer: nothing can be changed here until this tab takes control. */
  readOnly: boolean;
  /** Name written in each log entry (who is at the tabulation desk). */
  operator: string;
  /** Problems archiving the log; the entries stay saved with the tournament meanwhile. */
  logIssues: string[];
}

export interface TabStore {
  getState(): TabStoreState;
  subscribe(listener: () => void): () => void;
  /**
   * Applies a change unless this tab is read-only or in conflict; returns whether the tournament is as requested.
   * `meta` names the action in the log; without it the change is described automatically.
   */
  update(mutator: (tournament: TabTournament) => TabTournament, meta?: LogInput): boolean;
  /** Adds a log entry without changing the tournament (e.g. an export). */
  log(input: LogInput): boolean;
  /** Records an error in the log once per message. Never throws. */
  logError(message: string, details?: unknown): void;
  /** Saves now; true when everything is stored. */
  flush(): boolean;
  create(tournament: TabTournament): void;
  open(id: string): void;
  remove(id: string): void;
  importTournament(tournament: TabTournament, mode: 'replace' | 'copy', log?: TabLogEntry[]): void;
  hasTournament(id: string): boolean;
  backup(label: string): boolean;
  listBackups(): BackupInfo[];
  restoreBackup(slot: number): void;
  /** Conflict resolution: adopt the version saved by another tab. */
  reloadFromStorage(): void;
  /** Conflict resolution: keep this tab's version. */
  overwrite(): void;
  readLog(): { entries: TabLogEntry[]; issues: string[] };
  verifyLog(): LogVerification & { issues: string[] };
  setOperator(name: string): void;
  /** «Tomar el control» from another tab. */
  takeControl(): void;
}

export interface TabStoreOptions {
  storage: KeyValueStorage;
  events?: StoreEvents | null;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => () => void;
  debounceMs?: number;
  /** Single-writer coordination between tabs; without it this tab always writes. */
  lock?: WriterLock | null;
  logIdleMs?: number;
  /** Describes unnamed changes for the log (injectable for tests). */
  describe?: (before: TabTournament, after: TabTournament) => Change[];
}

export function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { name, code } = error as { name?: string; code?: number };
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

interface EditDetails { changes: Change[]; omitted: number }

function capChanges(changes: Change[], omitted: number): EditDetails {
  return changes.length > MAX_CHANGES_PER_ENTRY
    ? { changes: changes.slice(0, MAX_CHANGES_PER_ENTRY), omitted: omitted + changes.length - MAX_CHANGES_PER_ENTRY }
    : { changes, omitted };
}

function editMessage(details: EditDetails): string {
  return summarizeChanges(details.changes) + (details.omitted ? ' Otros ' + details.omitted + ' cambios sin detallar.' : '');
}

/**
 * External store for the local tabulation (bound to React with useSyncExternalStore). Edits are saved with a short
 * debounce; each save checks the stored revision so two tabs never overwrite each other silently. Every change is
 * logged in the same write as the change itself, and the log is then archived in append-only pages.
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
  const logIdleMs = options.logIdleMs ?? LOG_IDLE_MS;
  const describe = options.describe ?? describeChanges;
  const lock = options.lock ?? null;
  const listeners = new Set<() => void>();
  const loggedErrors = new Set<string>();
  let loggingError = false;
  let cancelSave: (() => void) | null = null;
  let cancelIdle: (() => void) | null = null;
  let baseRevision: number | null = null;
  /** Sequence number of the group of unnamed edits that may still grow (always the last tail entry). */
  let openEdit: number | null = null;
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

  function readOperator(): string {
    try {
      return storage.getItem(OPERATOR_KEY) ?? '';
    } catch {
      return '';
    }
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

  /**
   * Archives the closed tail entries (all of them unless a group of unnamed edits is still open) and returns the
   * tournament without them. Only called once those entries are saved with the tournament.
   */
  function archiveEntries(tournament: TabTournament): { tournament: TabTournament; issues: string[] } {
    const closed = tournament.logTail.filter((entry) => entry.seq !== openEdit);
    if (!closed.length) return { tournament, issues: [] };
    const result = archiveTail(storage, tournament.id, closed);
    if (!result.ok) {
      return { tournament, issues: ['No se ha podido archivar el registro (' + closed.length + ' entradas): siguen guardadas con el torneo. Libera espacio exportando y borrando copias o torneos antiguos.'] };
    }
    const issues = result.newSegment ? ['El final del registro archivado estaba dañado o alterado: se ha empezado un tramo nuevo. Revísalo en «Registro».'] : [];
    return { tournament: { ...tournament, logTail: tournament.logTail.filter((entry) => entry.seq === openEdit) }, issues };
  }

  /** On load: continue numbering after the archive and archive what an interrupted session left in the tail. */
  function recoverLog(tournament: TabTournament, writer: boolean): { tournament: TabTournament; issues: string[] } {
    const continued = { ...tournament, logSeq: Math.max(tournament.logSeq, archivedLastSeq(storage, tournament.id)) };
    return writer ? archiveEntries(continued) : { tournament: continued, issues: [] };
  }

  function initialState(): TabStoreState {
    const readOnly = lock ? !lock.isWriter() : false;
    const index = readIndex();
    const activeId = index.tournaments.some((entry) => entry.id === index.activeId) ? index.activeId : index.tournaments[0]?.id ?? null;
    const loaded = activeId ? load(activeId) : null;
    baseRevision = loaded?.tournament.revision ?? null;
    const recovered = loaded ? recoverLog(loaded.tournament, !readOnly) : null;
    return {
      tournaments: index.tournaments,
      tournament: recovered?.tournament ?? null,
      status: loaded ? 'saved' : 'idle',
      lastSavedAt: null,
      error: null,
      loadIssues: loaded?.issues ?? [],
      usageBytes: measureUsage(),
      readOnly,
      operator: readOperator(),
      logIssues: recovered?.issues ?? [],
    };
  }

  function removeBackups(id: string) {
    for (let slot = 0; slot < MAX_BACKUPS; slot++) storage.removeItem(backupKey(id, slot));
  }

  /** Frees space by removing the single oldest automatic backup of any tournament. */
  function freeOldestBackup(): { label: string; createdAt: number } | null {
    let oldest: { key: string; label: string; createdAt: number } | null = null;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(BACKUP_PREFIX)) continue;
      let label = 'Copia';
      let createdAt = 0;
      try {
        const raw = JSON.parse(storage.getItem(key) ?? 'null') as { label?: unknown; createdAt?: unknown } | null;
        label = String(raw?.label ?? 'Copia');
        createdAt = Number(raw?.createdAt) || 0;
      } catch { /* A damaged backup is the first one to go. */ }
      if (!oldest || createdAt < oldest.createdAt) oldest = { key, label, createdAt };
    }
    if (!oldest) return null;
    storage.removeItem(oldest.key);
    return oldest;
  }

  function writeItem(key: string, value: string): 'ok' | 'quota' | 'error' {
    try {
      storage.setItem(key, value);
      return 'ok';
    } catch (error) {
      return isQuotaError(error) ? 'quota' : 'error';
    }
  }

  function cancelPending() {
    cancelSave?.();
    cancelSave = null;
  }

  function scheduleSave() {
    cancelPending();
    cancelSave = schedule(() => {
      cancelSave = null;
      save();
    }, debounceMs);
  }

  function save(force = false): boolean {
    cancelPending();
    const tournament = state.tournament;
    if (!tournament || (state.status !== 'dirty' && !force)) return state.status !== 'conflict' && state.status !== 'error';
    if (state.readOnly) return false;
    const stored = storedRevision(tournament.id);
    if (!force && stored !== null && baseRevision !== null && stored !== baseRevision) {
      emit({ status: 'conflict' });
      return false;
    }
    const revision = Math.max(baseRevision ?? 0, stored ?? 0) + 1;
    let saved: TabTournament = { ...tournament, revision };
    for (;;) {
      const outcome = writeItem(tournamentKey(saved.id), JSON.stringify(saved));
      if (outcome === 'ok') break;
      const freed = outcome === 'quota' ? freeOldestBackup() : null;
      if (!freed) {
        emit({
          status: 'error',
          error: outcome === 'quota'
            ? 'No queda espacio en el almacenamiento del navegador. Exporta una copia y borra torneos o copias antiguas.'
            : 'El navegador no ha permitido guardar. Exporta una copia de inmediato.',
        });
        return false;
      }
      saved = appendLogEntry(saved, {
        type: 'storage.quota',
        message: 'Almacenamiento lleno: se ha borrado la copia automática más antigua («' + freed.label + '», ' + formatLogTime(freed.createdAt) + ').',
      }, { at: now(), operator: state.operator });
    }
    baseRevision = revision;
    const tournaments = [{ id: saved.id, name: saved.name, updatedAt: saved.updatedAt }, ...state.tournaments.filter((entry) => entry.id !== saved.id)];
    writeIndex(saved.id, tournaments);
    const archived = archiveEntries(saved);
    emit({ tournament: archived.tournament, tournaments, status: 'saved', lastSavedAt: now(), error: null, usageBytes: measureUsage(), logIssues: archived.issues });
    return true;
  }

  /** Closes the group of unnamed edits and archives it once saved. */
  function closeOpenEdit() {
    cancelIdle?.();
    cancelIdle = null;
    if (openEdit === null) return;
    openEdit = null;
    if (state.readOnly || !state.tournament) return;
    if (state.status === 'dirty') {
      save();
    } else if (state.status === 'saved') {
      const archived = archiveEntries(state.tournament);
      emit({ tournament: archived.tournament, logIssues: archived.issues, usageBytes: measureUsage() });
    }
  }

  function resetIdle() {
    cancelIdle?.();
    cancelIdle = schedule(() => {
      cancelIdle = null;
      closeOpenEdit();
    }, logIdleMs);
  }

  /** Adds the log entry of a change. The log always continues from the current tournament: restoring never rewinds it. */
  function withLog(current: TabTournament, next: TabTournament, meta: LogInput | undefined): TabTournament {
    const result: TabTournament = { ...next, logTail: current.logTail, logSeq: Math.max(current.logSeq, next.logSeq) };
    const context = { at: now(), operator: state.operator };
    if (meta) {
      openEdit = null;
      return appendLogEntry(result, meta, context);
    }
    let changes: Change[];
    try {
      changes = describe(current, next);
    } catch (error) {
      openEdit = null;
      return appendLogEntry(result, { type: 'edit', message: 'Cambios sin detalle: no se han podido describir (' + errorText(error) + ').' }, context);
    }
    if (!changes.length) return result;
    const last = result.logTail.at(-1);
    if (openEdit !== null && last && last.seq === openEdit && last.type === 'edit' && last.operator === context.operator) {
      const previous = (last.details ?? { changes: [], omitted: 0 }) as EditDetails;
      const merged = mergeChanges(previous.changes ?? [], changes);
      if (!merged.length && !previous.omitted) {
        // Everything in the group was undone: the entry disappears and its number is reused.
        openEdit = null;
        return { ...result, logTail: result.logTail.slice(0, -1), logSeq: result.logSeq === last.seq ? last.seq - 1 : result.logSeq };
      }
      const details = capChanges(merged, previous.omitted ?? 0);
      return { ...result, logTail: [...result.logTail.slice(0, -1), { ...last, at: context.at, message: editMessage(details), details }] };
    }
    const details = capChanges(changes, 0);
    const appended = appendLogEntry(result, { type: 'edit', message: editMessage(details), details }, context);
    openEdit = appended.logSeq;
    return appended;
  }

  function setActive(tournament: TabTournament | null, revision: number | null, loadIssues: string[] = []) {
    cancelPending();
    cancelIdle?.();
    cancelIdle = null;
    openEdit = null;
    baseRevision = revision;
    const recovered = tournament ? recoverLog(tournament, !state.readOnly) : { tournament: null, issues: [] };
    emit({ tournament: recovered.tournament, status: tournament ? 'saved' : 'idle', loadIssues, error: null, logIssues: recovered.issues });
  }

  /** Starts a tournament that is not in this store yet (created or imported), continuing any archive it already has. */
  function activateNew(tournament: TabTournament, input: LogInput) {
    store.flush();
    cancelIdle?.();
    cancelIdle = null;
    openEdit = null;
    baseRevision = null;
    const base = { ...tournament, revision: 0, logSeq: Math.max(tournament.logSeq, archivedLastSeq(storage, tournament.id)) };
    emit({ tournament: appendLogEntry(base, input, { at: now(), operator: state.operator }), status: 'dirty', loadIssues: [], error: null });
    save();
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
    closeOpenEdit();
  }

  function onLockChange() {
    const readOnly = lock ? !lock.isWriter() : false;
    if (readOnly === state.readOnly) return;
    if (readOnly) {
      // Keep what was typed here before handing over; a late write is caught as a revision conflict.
      if (state.status === 'dirty') save();
      cancelPending();
      cancelIdle?.();
      cancelIdle = null;
      openEdit = null;
      emit({ readOnly: true });
      return;
    }
    emit({ readOnly: false });
    store.reloadFromStorage();
  }
  lock?.subscribe(onLockChange);

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
    update(mutator, meta) {
      const current = state.tournament;
      if (!current || state.status === 'conflict' || state.readOnly) return false;
      let next: TabTournament;
      try {
        next = mutator(current);
      } catch (error) {
        emit({ error: 'No se ha podido aplicar el cambio: ' + errorText(error) });
        store.logError('No se ha podido aplicar un cambio: ' + errorText(error));
        return false;
      }
      if (next === current) return true;
      let logged: TabTournament;
      try {
        logged = withLog(current, next, meta);
      } catch {
        // The log never blocks a change.
        openEdit = null;
        logged = { ...next, logTail: current.logTail, logSeq: Math.max(current.logSeq, next.logSeq) };
      }
      emit({ tournament: { ...logged, updatedAt: now() }, status: 'dirty' });
      scheduleSave();
      if (openEdit !== null) resetIdle();
      return true;
    },
    log(input) {
      const current = state.tournament;
      if (!current || state.status === 'conflict' || state.readOnly) return false;
      openEdit = null;
      emit({ tournament: appendLogEntry(current, input, { at: now(), operator: state.operator }), status: 'dirty' });
      scheduleSave();
      return true;
    },
    logError(message, details) {
      if (loggingError || loggedErrors.has(message)) return;
      loggedErrors.add(message);
      loggingError = true;
      try {
        store.log({ type: 'error', message, ...(details !== undefined ? { details } : {}) });
      } catch { /* Logging an error must never cause another one. */ } finally {
        loggingError = false;
      }
    },
    flush() {
      // A failed save (full or locked storage) is retried: the cause may be gone, e.g. after freeing space.
      if (state.status === 'error' && state.tournament && !state.readOnly) emit({ status: 'dirty' });
      if (state.status === 'dirty') return save();
      return state.status === 'saved' || state.status === 'idle';
    },
    create(tournament) {
      if (state.readOnly) return;
      activateNew(tournament, { type: 'tournament.create', message: 'Torneo creado: ' + tournament.name + '.', details: { presetId: tournament.settings.presetId } });
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
      if (state.readOnly) return;
      storage.removeItem(tournamentKey(id));
      removeBackups(id);
      removeLog(storage, id);
      const tournaments = state.tournaments.filter((entry) => entry.id !== id);
      const wasActive = state.tournament?.id === id;
      writeIndex(wasActive ? null : state.tournament?.id ?? null, tournaments);
      if (wasActive) setActive(null, null);
      emit({ tournaments, usageBytes: measureUsage() });
    },
    importTournament(tournament, mode, log = []) {
      if (state.readOnly) return;
      const exists = store.hasTournament(tournament.id);
      if (!exists || mode === 'copy') {
        const target = exists ? { ...tournament, id: makeTabId('torneo'), name: tournament.name + ' (copia)' } : tournament;
        const adopted = adoptLog(storage, target.id, log);
        activateNew(target, {
          type: 'tournament.import',
          message: 'Importada una copia del torneo «' + tournament.name + '»' + (adopted ? ' con su registro (' + log.length + ' entradas).' : '.'),
        });
        return;
      }
      const previous = load(tournament.id);
      if (previous) writeBackup(previous.tournament, 'Antes de importar una copia');
      store.flush();
      const adopted = adoptLog(storage, tournament.id, log);
      cancelIdle?.();
      cancelIdle = null;
      openEdit = null;
      baseRevision = null;
      // The history of this browser goes on: the copy replaces the data, never the log.
      const local = previous?.tournament;
      const base: TabTournament = {
        ...tournament,
        logTail: adopted ? tournament.logTail : local?.logTail ?? [],
        logSeq: Math.max(tournament.logSeq, local?.logSeq ?? 0, archivedLastSeq(storage, tournament.id)),
      };
      const message = 'Importada una copia del torneo «' + tournament.name + '» que reemplaza los datos'
        + (adopted ? ', con su registro (' + log.length + ' entradas).' : log.length ? '. Se conserva el registro de este navegador; la copia traía ' + log.length + ' entradas.' : '.');
      emit({ tournament: appendLogEntry(base, { type: 'tournament.import', message }, { at: now(), operator: state.operator }), status: 'dirty', loadIssues: [], error: null });
      save(true);
    },
    hasTournament: (id) => storage.getItem(tournamentKey(id)) !== null,
    backup(label) {
      return state.tournament && !state.readOnly ? writeBackup(state.tournament, label) : false;
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
      if (!current || state.readOnly) return;
      const info = readBackupInfo(current.id, slot);
      let restored: TabTournament;
      try {
        const raw = JSON.parse(storage.getItem(backupKey(current.id, slot)) ?? 'null') as { tournament?: unknown } | null;
        restored = normalizeTabTournament(raw?.tournament).tournament;
      } catch {
        emit({ error: 'La copia seleccionada no se puede leer.' });
        return;
      }
      writeBackup(current, 'Antes de restaurar una copia');
      store.update(() => ({ ...restored, id: current.id, revision: current.revision }), {
        type: 'backup.restore',
        message: 'Restaurada la copia «' + (info?.label ?? 'Copia') + '»' + (info ? ' (' + formatLogTime(info.createdAt) + ')' : '') + '.',
      });
    },
    reloadFromStorage() {
      const id = state.tournament?.id;
      const loaded = id ? load(id) : null;
      setActive(loaded?.tournament ?? null, loaded?.tournament.revision ?? null, loaded?.issues ?? []);
      emit({ tournaments: readIndex().tournaments });
    },
    overwrite() {
      const current = state.tournament;
      if (!current || state.readOnly) return;
      emit({
        tournament: appendLogEntry(current, { type: 'conflict.overwrite', message: 'Se sobrescribe la versión guardada desde otra pestaña.' }, { at: now(), operator: state.operator }),
        status: 'dirty',
      });
      save(true);
    },
    readLog() {
      const tournament = state.tournament;
      return tournament ? readLog(storage, tournament.id, tournament.logTail) : { entries: [], issues: [] };
    },
    verifyLog() {
      const { entries, issues } = store.readLog();
      return { ...verifyLog(entries), issues };
    },
    setOperator(name) {
      const operator = name.trim().slice(0, 60);
      try {
        storage.setItem(OPERATOR_KEY, operator);
      } catch { /* Kept for this session only. */ }
      emit({ operator });
    },
    takeControl() {
      lock?.takeOver();
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
