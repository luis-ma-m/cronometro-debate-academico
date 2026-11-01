/**
 * Shared durable persistence boundary for the single-application runtime.
 *
 * IndexedDB is the transactional primary store. Legacy localStorage formats are
 * accessed only through an explicit adapter; this module never deletes them.
 */
export const APPLICATION_DATABASE_NAME = 'ledu-application-runtime-v1';
export const APPLICATION_DATABASE_VERSION = 1;
export const APPLICATION_RECORDS_STORE = 'records';

export interface ApplicationRecord<T = unknown> {
  readonly schemaVersion: 1;
  readonly namespace: string;
  readonly key: string;
  readonly revision: number;
  readonly updatedAt: number;
  readonly value: T;
}

export interface PutApplicationRecordOptions {
  /** undefined = unconditional; null = create only; integer = compare-and-set. */
  expectedRevision?: number | null;
  now?: number;
}

export interface ApplicationRecordRepository {
  get<T = unknown>(namespace: string, key: string): Promise<ApplicationRecord<T> | null>;
  put<T = unknown>(namespace: string, key: string, value: T, options?: PutApplicationRecordOptions): Promise<ApplicationRecord<T> | null>;
  delete(namespace: string, key: string, expectedRevision?: number | null): Promise<boolean>;
  list<T = unknown>(namespace: string): Promise<ApplicationRecord<T>[]>;
}

export class ApplicationPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApplicationPersistenceError';
  }
}

export class ApplicationPersistenceConflict extends ApplicationPersistenceError {
  constructor(message = 'El registro cambió en otra pestaña; vuelve a leerlo antes de guardar.') {
    super(message);
    this.name = 'ApplicationPersistenceConflict';
  }
}

function validatePart(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength
    || /[\\u0000-\\u001f\\u007f]/.test(value)) {
    throw new ApplicationPersistenceError(label + ' no es válido.');
  }
  return value;
}

function validateRevision(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ApplicationPersistenceError(label + ' debe ser un entero seguro no negativo.');
  }
  return value as number;
}

function cloneJson<T>(value: T): T {
  let serialized: string | undefined;
  try { serialized = JSON.stringify(value); } catch { /* handled below */ }
  if (typeof serialized !== 'string') throw new ApplicationPersistenceError('El registro debe ser serializable como JSON.');
  try { return JSON.parse(serialized) as T; }
  catch { throw new ApplicationPersistenceError('El registro contiene un valor JSON no válido.'); }
}

function validateRecord<T>(value: unknown, namespace: string, key: string): ApplicationRecord<T> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApplicationPersistenceError('El registro persistido no es un objeto.');
  }
  const item = value as Record<string, unknown>;
  if (item.schemaVersion !== 1 || item.namespace !== namespace || item.key !== key) {
    throw new ApplicationPersistenceError('La identidad o versión del registro persistido no coincide.');
  }
  const revision = validateRevision(item.revision, 'La revisión');
  const updatedAt = validateRevision(item.updatedAt, 'La fecha de actualización');
  if (!Object.prototype.hasOwnProperty.call(item, 'value')) {
    throw new ApplicationPersistenceError('El registro persistido no contiene value.');
  }
  return Object.freeze({
    schemaVersion: 1,
    namespace,
    key,
    revision,
    updatedAt,
    value: cloneJson(item.value as T),
  });
}

function recordId(namespace: string, key: string): string {
  return namespace + ':' + key;
}

function validateIdentity(namespace: string, key: string): void {
  validatePart(namespace, 'El namespace', 128);
  validatePart(key, 'La clave', 256);
}

function transactionError(transaction: IDBTransaction, reject: (reason: unknown) => void): void {
  transaction.onabort = () => reject(transaction.error ?? new ApplicationPersistenceError('Transacción IndexedDB cancelada.'));
  transaction.onerror = () => reject(transaction.error ?? new ApplicationPersistenceError('Error en transacción IndexedDB.'));
}

export function createIndexedDbApplicationRecordRepository(
  factory: IDBFactory = globalThis.indexedDB,
): ApplicationRecordRepository {
  if (!factory) throw new ApplicationPersistenceError('IndexedDB no está disponible en este navegador.');
  const database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(APPLICATION_DATABASE_NAME, APPLICATION_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(APPLICATION_RECORDS_STORE)) {
        const store = db.createObjectStore(APPLICATION_RECORDS_STORE, { keyPath: 'id' });
        store.createIndex('byNamespaceUpdatedAt', ['namespace', 'updatedAt'], { unique: false });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new ApplicationPersistenceError('No se pudo abrir la persistencia común.'));
    request.onblocked = () => reject(new ApplicationPersistenceError('La actualización de la persistencia está bloqueada por otra pestaña.'));
  });

  return {
    async get<T>(namespace: string, key: string) {
      validateIdentity(namespace, key);
      const db = await database;
      const tx = db.transaction(APPLICATION_RECORDS_STORE, 'readonly');
      const request = tx.objectStore(APPLICATION_RECORDS_STORE).get(recordId(namespace, key));
      const raw = await new Promise<unknown>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error ?? new ApplicationPersistenceError('No se pudo leer el registro.'));
        transactionError(tx, reject);
      });
      return raw === null ? null : validateRecord<T>((raw as Record<string, unknown>).record, namespace, key);
    },

    async put<T>(namespace: string, key: string, value: T, options: PutApplicationRecordOptions = {}) {
      validateIdentity(namespace, key);
      const cloned = cloneJson(value);
      const now = options.now ?? Date.now();
      validateRevision(now, 'La fecha de actualización');
      if (options.expectedRevision !== undefined && options.expectedRevision !== null) {
        validateRevision(options.expectedRevision, 'La revisión esperada');
      }
      const db = await database;
      return new Promise<ApplicationRecord<T> | null>((resolve, reject) => {
        const tx = db.transaction(APPLICATION_RECORDS_STORE, 'readwrite');
        const store = tx.objectStore(APPLICATION_RECORDS_STORE);
        let result: ApplicationRecord<T> | null = null;
        let conflict = false;
        const request = store.get(recordId(namespace, key));
        request.onerror = () => reject(request.error ?? new ApplicationPersistenceError('No se pudo comprobar la revisión.'));
        request.onsuccess = () => {
          const raw = request.result as { record?: unknown } | undefined;
          const current = raw ? validateRecord<T>(raw.record, namespace, key) : null;
          if (options.expectedRevision !== undefined
            && (options.expectedRevision === null ? current !== null : current?.revision !== options.expectedRevision)) {
            conflict = true;
            return;
          }
          result = Object.freeze({
            schemaVersion: 1,
            namespace,
            key,
            revision: (current?.revision ?? 0) + 1,
            updatedAt: now,
            value: cloned,
          });
          store.put({ id: recordId(namespace, key), namespace, updatedAt: now, record: result });
        };
        tx.oncomplete = () => resolve(conflict ? null : result);
        transactionError(tx, reject);
      });
    },

    async delete(namespace: string, key: string, expectedRevision?: number | null) {
      validateIdentity(namespace, key);
      if (expectedRevision !== undefined && expectedRevision !== null) validateRevision(expectedRevision, 'La revisión esperada');
      const db = await database;
      return new Promise<boolean>((resolve, reject) => {
        const tx = db.transaction(APPLICATION_RECORDS_STORE, 'readwrite');
        const store = tx.objectStore(APPLICATION_RECORDS_STORE);
        let deleted = false;
        const request = store.get(recordId(namespace, key));
        request.onerror = () => reject(request.error ?? new ApplicationPersistenceError('No se pudo comprobar el registro antes de borrarlo.'));
        request.onsuccess = () => {
          const raw = request.result as { record?: unknown } | undefined;
          const current = raw ? validateRecord(raw.record, namespace, key) : null;
          if (expectedRevision !== undefined
            && (expectedRevision === null ? current !== null : current?.revision !== expectedRevision)) return;
          if (!current) return;
          store.delete(recordId(namespace, key));
          deleted = true;
        };
        tx.oncomplete = () => resolve(deleted);
        transactionError(tx, reject);
      });
    },

    async list<T>(namespace: string) {
      validatePart(namespace, 'El namespace', 128);
      const db = await database;
      const tx = db.transaction(APPLICATION_RECORDS_STORE, 'readonly');
      const request = tx.objectStore(APPLICATION_RECORDS_STORE).index('byNamespaceUpdatedAt')
        .getAll(IDBKeyRange.bound([namespace, 0], [namespace, Number.MAX_SAFE_INTEGER]));
      const raw = await new Promise<unknown[]>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result as unknown[]);
        request.onerror = () => reject(request.error ?? new ApplicationPersistenceError('No se pudo listar la persistencia.'));
        transactionError(tx, reject);
      });
      return raw.map((item) => {
        const row = item as { record?: unknown; namespace?: unknown };
        if (row.namespace !== namespace) throw new ApplicationPersistenceError('El índice devolvió un namespace inesperado.');
        const record = row.record as Record<string, unknown> | undefined;
        if (!record || typeof record.key !== 'string') throw new ApplicationPersistenceError('El índice contiene un registro inválido.');
        return validateRecord<T>(record, namespace, record.key);
      }).sort((a, b) => a.updatedAt - b.updatedAt || a.key.localeCompare(b.key));
    },
  };
}

/** Deterministic in-memory implementation for tests and non-browser adapters. */
export function createMemoryApplicationRecordRepository(): ApplicationRecordRepository {
  const records = new Map<string, ApplicationRecord>();
  return {
    async get<T>(namespace: string, key: string) {
      validateIdentity(namespace, key);
      const current = records.get(recordId(namespace, key));
      return current ? validateRecord<T>(current, namespace, key) : null;
    },
    async put<T>(namespace: string, key: string, value: T, options: PutApplicationRecordOptions = {}) {
      validateIdentity(namespace, key);
      const id = recordId(namespace, key);
      const current = records.get(id) ?? null;
      if (options.expectedRevision !== undefined
        && (options.expectedRevision === null ? current !== null : current?.revision !== options.expectedRevision)) return null;
      const now = options.now ?? Date.now();
      validateRevision(now, 'La fecha de actualización');
      const record = Object.freeze({
        schemaVersion: 1 as const, namespace, key,
        revision: (current?.revision ?? 0) + 1,
        updatedAt: now,
        value: cloneJson(value),
      });
      records.set(id, record);
      return validateRecord<T>(record, namespace, key);
    },
    async delete(namespace: string, key: string, expectedRevision?: number | null) {
      validateIdentity(namespace, key);
      const id = recordId(namespace, key);
      const current = records.get(id);
      if (!current || (expectedRevision !== undefined
        && (expectedRevision === null || current.revision !== expectedRevision))) return false;
      records.delete(id);
      return true;
    },
    async list<T>(namespace: string) {
      validatePart(namespace, 'El namespace', 128);
      return [...records.values()].filter((item) => item.namespace === namespace)
        .map((item) => validateRecord<T>(item, namespace, item.key))
        .sort((a, b) => a.updatedAt - b.updatedAt || a.key.localeCompare(b.key));
    },
  };
}

export interface LegacyApplicationRecordAdapter<T> {
  read(): string | null;
  write(value: T): void;
  parse(value: unknown): T;
  serialize(value: T): string;
}

export type DualReadResult<T> =
  | { status: 'missing' }
  | { status: 'primary'; record: ApplicationRecord<T> }
  | { status: 'migrated'; record: ApplicationRecord<T> }
  | { status: 'legacy-unmigrated'; value: T; error: unknown }
  | { status: 'conflict'; primary: ApplicationRecord<T>; legacy: T };

export class LegacyMirrorWriteError extends ApplicationPersistenceError {
  readonly primaryRecord: ApplicationRecord<unknown>;
  readonly causeValue: unknown;
  constructor(primaryRecord: ApplicationRecord<unknown>, causeValue: unknown) {
    super('El registro principal se guardó, pero falló la escritura espejo heredada. No se debe repetir con un ID nuevo.');
    this.name = 'LegacyMirrorWriteError';
    this.primaryRecord = primaryRecord;
    this.causeValue = causeValue;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).sort().map((key) => JSON.stringify(key) + ':' + stableJson(record[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

/**
 * Compatibility adapter for one legacy localStorage record.
 * Reads never delete v1. Writes commit v2 first, then mirror v1; mirror failure
 * is surfaced with the committed primary record so callers can reconcile it.
 */
export function createDualReadWriteApplicationRecord<T>(
  repository: ApplicationRecordRepository,
  namespace: string,
  key: string,
  legacy: LegacyApplicationRecordAdapter<T>,
  now: () => number = Date.now,
) {
  validateIdentity(namespace, key);
  return {
    async read(): Promise<DualReadResult<T>> {
      const primary = await repository.get<T>(namespace, key);
      const rawLegacy = legacy.read();
      let legacyValue: T | null = null;
      if (rawLegacy !== null) {
        try { legacyValue = legacy.parse(JSON.parse(rawLegacy)); }
        catch { throw new ApplicationPersistenceError('El registro heredado existe pero no supera su validación; se conserva intacto.'); }
      }
      if (primary && legacyValue !== null) {
        if (stableJson(primary.value) !== stableJson(legacyValue)) {
          return { status: 'conflict', primary, legacy: legacyValue };
        }
        return { status: 'primary', record: primary };
      }
      if (primary) return { status: 'primary', record: primary };
      if (legacyValue === null) return { status: 'missing' };
      const migrated = await repository.put(namespace, key, legacyValue, { expectedRevision: null, now: now() });
      if (migrated) return { status: 'migrated', record: migrated };
      const concurrent = await repository.get<T>(namespace, key);
      if (concurrent && stableJson(concurrent.value) === stableJson(legacyValue)) {
        return { status: 'migrated', record: concurrent };
      }
      if (concurrent) return { status: 'conflict', primary: concurrent, legacy: legacyValue };
      return { status: 'legacy-unmigrated', value: legacyValue, error: new ApplicationPersistenceConflict() };
    },

    async write(value: T, expectedRevision?: number | null): Promise<ApplicationRecord<T>> {
      const validated = legacy.parse(value);
      const record = await repository.put(namespace, key, validated, { expectedRevision, now: now() });
      if (!record) throw new ApplicationPersistenceConflict();
      try {
        legacy.write(validated);
      } catch (error) {
        throw new LegacyMirrorWriteError(record, error);
      }
      return record;
    },
  };
}
