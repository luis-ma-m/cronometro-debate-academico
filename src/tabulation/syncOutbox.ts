/**
 * Durable client-side outbox for manager synchronization.
 * This module does not send HTTP requests: acknowledgement requires a confirmed server commit.
 */
export type SyncOperationKind = 'upsert' | 'publish-round' | 'replace-acta' | 'settings';
export type SyncOperationStatus = 'pending' | 'sending' | 'conflict' | 'failed';
export interface SyncOperationError { code: string; message: string }
export interface PendingSyncOperation {
  operationId: string; tournamentId: string; entityType: string; entityId: string;
  operation: SyncOperationKind; baseRevision: number; payload: unknown; payloadHash: string;
  status: SyncOperationStatus; attempts: number; createdAt: number; lastAttemptAt?: number;
  lastError?: SyncOperationError; workerId?: string; leaseUntil?: number;
}
export interface EnqueueSyncOperation {
  tournamentId: string; entityType: string; entityId: string;
  operation: SyncOperationKind; baseRevision: number; payload: unknown;
}
export interface SyncOutboxRepository {
  insert(operation: PendingSyncOperation): Promise<PendingSyncOperation | null>;
  list(tournamentId: string): Promise<PendingSyncOperation[]>;
  claimNext(tournamentId: string, workerId: string, now: number, leaseMs: number): Promise<PendingSyncOperation | null>;
  transition(operationId: string, workerId: string, status: 'pending' | 'conflict' | 'failed', error?: SyncOperationError): Promise<boolean>;
  acknowledge(operationId: string, workerId: string): Promise<boolean>;
  recoverExpired(now: number): Promise<number>;
}
export interface SyncOutbox {
  enqueue(input: EnqueueSyncOperation): Promise<{ operation: PendingSyncOperation; duplicate: boolean }>;
  list(tournamentId: string): Promise<PendingSyncOperation[]>;
  claimNext(tournamentId: string, workerId: string): Promise<PendingSyncOperation | null>;
  retry(operationId: string, workerId: string, error?: SyncOperationError): Promise<boolean>;
  markConflict(operationId: string, workerId: string, error: SyncOperationError): Promise<boolean>;
  markFailed(operationId: string, workerId: string, error: SyncOperationError): Promise<boolean>;
  acknowledge(operationId: string, workerId: string): Promise<boolean>;
  recoverExpiredLeases(): Promise<number>;
}

const MAX_PAYLOAD_BYTES = 1024 * 1024;
const DEFAULT_LEASE_MS = 60_000;
function stableValue(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('El payload de sincronización contiene un número no finito.');
    return value;
  }
  if (typeof value !== 'object') {
    throw new Error('El payload de sincronización contiene un valor no serializable.');
  }
  if (ancestors.has(value)) throw new Error('El payload de sincronización contiene una referencia circular.');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.some((key) => typeof key === 'symbol' || (key !== 'length' && (!/^\\d+$/.test(key) || Number(key) >= value.length)))) {
        throw new Error('El payload de sincronización contiene propiedades de array no serializables.');
      }
      const result: unknown[] = [];
      for (let index = 0; index < value.length; index++) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new Error('El payload de sincronización contiene un array disperso no serializable.');
        }
        result.push(stableValue(value[index], ancestors));
      }
      return result;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('El payload de sincronización solo admite objetos JSON planos.');
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key === 'symbol')) {
      throw new Error('El payload de sincronización contiene claves no serializables.');
    }
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of (keys as string[]).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
        throw new Error('El payload de sincronización contiene propiedades no serializables.');
      }
      result[key] = stableValue(source[key], ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}
export function serializeSyncPayload(payload: unknown): string {
  let serialized: string;
  try { serialized = JSON.stringify(stableValue(payload)); }
  catch (error) { throw new Error(error instanceof Error ? error.message : 'No se puede serializar el payload.'); }
  if (typeof serialized !== 'string') throw new Error('El payload de sincronización está vacío o no es serializable.');
  if (new TextEncoder().encode(serialized).byteLength > MAX_PAYLOAD_BYTES) throw new Error('El payload de sincronización supera el límite de 1 MB.');
  return serialized;
}
export async function hashSyncPayload(payload: unknown): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(serializeSyncPayload(payload)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function createId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
}
export function createSyncOutbox(
  repository: SyncOutboxRepository,
  options: { now?: () => number; createOperationId?: () => string; leaseMs?: number } = {},
): SyncOutbox {
  const now = options.now ?? Date.now;
  const createOperationId = options.createOperationId ?? createId;
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  return {
    async enqueue(input) {
      if (!input.tournamentId.trim() || !input.entityType.trim() || !input.entityId.trim()) throw new Error('La operación necesita torneo y entidad identificables.');
      if (!Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0) throw new Error('La revisión base de la operación no es válida.');
      const operation: PendingSyncOperation = {
        ...input, operationId: createOperationId(), payloadHash: await hashSyncPayload(input.payload),
        status: 'pending', attempts: 0, createdAt: now(),
      };
      const existing = await repository.insert(operation);
      if (existing && (
        existing.payloadHash !== operation.payloadHash || existing.tournamentId !== operation.tournamentId ||
        existing.entityType !== operation.entityType || existing.entityId !== operation.entityId ||
        existing.operation !== operation.operation || existing.baseRevision !== operation.baseRevision
      )) throw new Error('IDEMPOTENCY_MISMATCH: el operationId ya existe con otra operación o payload.');
      return { operation: existing ?? operation, duplicate: Boolean(existing) };
    },
    list: (tournamentId) => repository.list(tournamentId),
    claimNext: (tournamentId, workerId) => {
      if (!workerId.trim()) throw new Error('El worker necesita un identificador.');
      return repository.claimNext(tournamentId, workerId, now(), leaseMs);
    },
    retry: (id, worker, error) => repository.transition(id, worker, 'pending', error),
    markConflict: (id, worker, error) => repository.transition(id, worker, 'conflict', error),
    markFailed: (id, worker, error) => repository.transition(id, worker, 'failed', error),
    acknowledge: (id, worker) => repository.acknowledge(id, worker),
    recoverExpiredLeases: () => repository.recoverExpired(now()),
  };
}

const DB_NAME = 'ledu-tabulation-sync-v1';
const DB_VERSION = 1;
const STORE_NAME = 'operations';
function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Error leyendo IndexedDB.'));
  });
}
function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Transacción IndexedDB cancelada.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Error en transacción IndexedDB.'));
  });
}
function transactionError(transaction: IDBTransaction, reject: (reason: unknown) => void) {
  transaction.onabort = () => reject(transaction.error ?? new Error('Transacción IndexedDB cancelada.'));
  transaction.onerror = () => reject(transaction.error ?? new Error('Error en transacción IndexedDB.'));
}

/** IndexedDB is separate from TabStore/localStorage and serializes read-write transactions across tabs. */
export function createIndexedDbSyncOutboxRepository(factory: IDBFactory = globalThis.indexedDB): SyncOutboxRepository {
  if (!factory) throw new Error('IndexedDB no está disponible en este navegador.');
  const database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'operationId' });
        store.createIndex('byTournamentCreatedAt', ['tournamentId', 'createdAt'], { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir la cola de sincronización.'));
    request.onblocked = () => reject(new Error('La actualización de la cola está bloqueada por otra pestaña.'));
  });
  return {
    insert(operation) {
      return database.then((db) => new Promise<PendingSyncOperation | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite'); const store = tx.objectStore(STORE_NAME);
        let existing: PendingSyncOperation | null = null;
        tx.oncomplete = () => resolve(existing);
        transactionError(tx, reject);
        const request = store.get(operation.operationId);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          if (request.result) existing = request.result as PendingSyncOperation;
          else store.add(operation);
        };
      }));
    },
    async list(tournamentId) {
      const db = await database; const tx = db.transaction(STORE_NAME, 'readonly'); const done = transactionDone(tx);
      const rows = await requestValue(tx.objectStore(STORE_NAME).index('byTournamentCreatedAt').getAll(
        IDBKeyRange.bound([tournamentId, 0], [tournamentId, Number.MAX_SAFE_INTEGER]),
      )) as PendingSyncOperation[];
      await done;
      return rows.sort((a, b) => a.createdAt - b.createdAt || a.operationId.localeCompare(b.operationId));
    },
    claimNext(tournamentId, workerId, timestamp, leaseMs) {
      return database.then((db) => new Promise<PendingSyncOperation | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite'); const store = tx.objectStore(STORE_NAME);
        let result: PendingSyncOperation | null = null;
        tx.oncomplete = () => resolve(result); transactionError(tx, reject);
        const request = store.index('byTournamentCreatedAt').getAll(IDBKeyRange.bound([tournamentId, 0], [tournamentId, Number.MAX_SAFE_INTEGER]));
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const rows = request.result as PendingSyncOperation[];
          const oldest = rows.sort((a, b) => a.createdAt - b.createdAt || a.operationId.localeCompare(b.operationId))[0];
          if (!oldest || oldest.status !== 'pending') return;
          result = { ...oldest, status: 'sending', attempts: oldest.attempts + 1, lastAttemptAt: timestamp,
            workerId, leaseUntil: timestamp + leaseMs, lastError: undefined };
          store.put(result);
        };
      }));
    },
    transition(operationId, workerId, status, error) {
      return database.then((db) => new Promise<boolean>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite'); const store = tx.objectStore(STORE_NAME);
        let changed = false; tx.oncomplete = () => resolve(changed); transactionError(tx, reject);
        const request = store.get(operationId);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const current = request.result as PendingSyncOperation | undefined;
          if (!current || current.status !== 'sending' || current.workerId !== workerId) return;
          store.put({ ...current, status, lastError: error, workerId: undefined, leaseUntil: undefined });
          changed = true;
        };
      }));
    },
    acknowledge(operationId, workerId) {
      return database.then((db) => new Promise<boolean>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite'); const store = tx.objectStore(STORE_NAME);
        let changed = false; tx.oncomplete = () => resolve(changed); transactionError(tx, reject);
        const request = store.get(operationId);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const current = request.result as PendingSyncOperation | undefined;
          if (!current || current.status !== 'sending' || current.workerId !== workerId) return;
          store.delete(operationId); changed = true;
        };
      }));
    },
    recoverExpired(timestamp) {
      return database.then((db) => new Promise<number>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite'); const store = tx.objectStore(STORE_NAME);
        let recovered = 0; tx.oncomplete = () => resolve(recovered); transactionError(tx, reject);
        const request = store.getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          for (const row of request.result as PendingSyncOperation[]) {
            if (row.status !== 'sending' || (row.leaseUntil ?? 0) > timestamp) continue;
            store.put({ ...row, status: 'pending', workerId: undefined, leaseUntil: undefined,
              lastError: { code: 'LEASE_EXPIRED', message: 'Se recuperó una operación cuyo worker dejó de responder.' } });
            recovered++;
          }
        };
      }));
    },
  };
}
