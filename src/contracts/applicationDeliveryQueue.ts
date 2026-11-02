import {
  APPLICATION_DATABASE_NAME,
  APPLICATION_DATABASE_VERSION,
  APPLICATION_DELIVERIES_STORE,
  ApplicationPersistenceError,
} from './applicationPersistence';

export type ApplicationDeliveryStatus = 'pending' | 'claimed' | 'acked';
export type ApplicationDeliveryEndpoint = 'manager' | 'tabulation';

export interface ApplicationDelivery<T = unknown> {
  readonly schemaVersion: 1;
  readonly deliveryId: string;
  readonly source: ApplicationDeliveryEndpoint;
  readonly target: ApplicationDeliveryEndpoint;
  readonly kind: string;
  readonly createdAt: number;
  readonly payload: T;
  readonly status: ApplicationDeliveryStatus;
  readonly attempts: number;
  readonly leaseOwner?: string;
  readonly leaseUntil?: number;
  readonly ackedAt?: number;
}

export interface EnqueueApplicationDelivery<T = unknown> {
  deliveryId: string;
  source: ApplicationDeliveryEndpoint;
  target: ApplicationDeliveryEndpoint;
  kind: string;
  createdAt: number;
  payload: T;
}

export interface ClaimApplicationDeliveryOptions {
  consumer: string;
  target: ApplicationDeliveryEndpoint;
  kind?: string;
  now: number;
  leaseMs: number;
}

export interface ApplicationDeliveryQueue {
  enqueue<T>(input: EnqueueApplicationDelivery<T>): Promise<ApplicationDelivery<T>>;
  get<T = unknown>(deliveryId: string): Promise<ApplicationDelivery<T> | null>;
  list<T = unknown>(target?: ApplicationDeliveryEndpoint): Promise<ApplicationDelivery<T>[]>;
  claimNext<T = unknown>(options: ClaimApplicationDeliveryOptions): Promise<ApplicationDelivery<T> | null>;
  acknowledge(deliveryId: string, consumer: string, now: number): Promise<boolean>;
  release(deliveryId: string, consumer: string): Promise<boolean>;
}

function validText(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) {
    throw new ApplicationPersistenceError(label + ' no es válido.');
  }
  return value;
}

function validTime(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ApplicationPersistenceError(label + ' debe ser un entero seguro no negativo.');
  }
  return value as number;
}

function clone<T>(value: T): T {
  let json: string | undefined;
  try { json = JSON.stringify(value); } catch { /* validated below */ }
  if (typeof json !== 'string') throw new ApplicationPersistenceError('El payload debe ser serializable como JSON.');
  try { return JSON.parse(json) as T; }
  catch { throw new ApplicationPersistenceError('El payload no es JSON válido.'); }
}

function validateInput<T>(input: EnqueueApplicationDelivery<T>): EnqueueApplicationDelivery<T> {
  validText(input.deliveryId, 'El deliveryId');
  if (!['manager', 'tabulation'].includes(input.source) || !['manager', 'tabulation'].includes(input.target)
    || input.source === input.target) throw new ApplicationPersistenceError('El origen o destino de la entrega no es válido.');
  validText(input.kind, 'El tipo de entrega', 100);
  validTime(input.createdAt, 'La fecha de creación');
  return { ...input, payload: clone(input.payload) };
}

function validateStored<T>(value: unknown): ApplicationDelivery<T> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApplicationPersistenceError('La entrega persistida no es válida.');
  const item = value as Record<string, unknown>;
  if (item.schemaVersion !== 1 || !['manager', 'tabulation'].includes(String(item.source))
    || !['manager', 'tabulation'].includes(String(item.target)) || item.source === item.target
    || !['pending', 'claimed', 'acked'].includes(String(item.status))) {
    throw new ApplicationPersistenceError('La versión, ruta o estado de la entrega no es válido.');
  }
  validText(item.deliveryId, 'El deliveryId');
  validText(item.kind, 'El tipo de entrega', 100);
  validTime(item.createdAt, 'La fecha de creación');
  validTime(item.attempts, 'El contador de intentos');
  if (item.status === 'claimed') {
    validText(item.leaseOwner, 'El propietario del lease');
    validTime(item.leaseUntil, 'La expiración del lease');
  }
  if (item.status === 'acked') validTime(item.ackedAt, 'La fecha de ACK');
  if (!Object.prototype.hasOwnProperty.call(item, 'payload')) throw new ApplicationPersistenceError('La entrega no contiene payload.');
  return Object.freeze({
    schemaVersion: 1,
    deliveryId: item.deliveryId as string,
    source: item.source as ApplicationDeliveryEndpoint,
    target: item.target as ApplicationDeliveryEndpoint,
    kind: item.kind as string,
    createdAt: item.createdAt as number,
    payload: clone(item.payload as T),
    status: item.status as ApplicationDeliveryStatus,
    attempts: item.attempts as number,
    ...(typeof item.leaseOwner === 'string' ? { leaseOwner: item.leaseOwner } : {}),
    ...(typeof item.leaseUntil === 'number' ? { leaseUntil: item.leaseUntil } : {}),
    ...(typeof item.ackedAt === 'number' ? { ackedAt: item.ackedAt } : {}),
  });
}

function deliveryIdentity<T>(item: ApplicationDelivery<T>) {
  return {
    schemaVersion: item.schemaVersion,
    deliveryId: item.deliveryId,
    source: item.source,
    target: item.target,
    kind: item.kind,
    createdAt: item.createdAt,
    payload: item.payload,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).sort().map(key => JSON.stringify(key) + ':' + stableJson(record[key])).join(',') + '}';
  }
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string') throw new ApplicationPersistenceError('El payload no tiene una representación JSON estable.');
  return serialized;
}

function sameJson(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

/** Deterministic queue used by unit tests and non-browser adapters. */
export function createMemoryApplicationDeliveryQueue(): ApplicationDeliveryQueue {
  const items = new Map<string, ApplicationDelivery>();
  return {
    async enqueue<T>(raw) {
      const input = validateInput(raw);
      const current = items.get(input.deliveryId);
      if (current) {
        if (!sameJson(deliveryIdentity(current), { schemaVersion: 1, ...input })) {
          throw new ApplicationPersistenceError('El deliveryId ya existe con un contenido diferente.');
        }
        return validateStored<T>(current);
      }
      const record = validateStored<T>({ schemaVersion: 1, ...input, status: 'pending', attempts: 0 });
      items.set(record.deliveryId, record);
      return record;
    },
    async get<T>(id) {
      validText(id, 'El deliveryId');
      const item = items.get(id);
      return item ? validateStored<T>(item) : null;
    },
    async list<T>(target) {
      return [...items.values()].filter(item => !target || item.target === target)
        .sort((a, b) => a.createdAt - b.createdAt || a.deliveryId.localeCompare(b.deliveryId))
        .map(item => validateStored<T>(item));
    },
    async claimNext<T>({ consumer, target, kind, now, leaseMs }) {
      validText(consumer, 'El consumidor');
      if (target !== 'manager' && target !== 'tabulation') throw new ApplicationPersistenceError('El destino de consumo no es válido.');
      validTime(now, 'La fecha actual');
      if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 300_000) throw new ApplicationPersistenceError('La duración del lease debe estar entre 1 y 300000 ms.');
      const candidate = [...items.values()].filter(item => item.target === target && (!kind || item.kind === kind) && (item.status === 'pending'
        || (item.status === 'claimed' && (item.leaseUntil ?? 0) <= now)))
        .sort((a, b) => a.createdAt - b.createdAt || a.deliveryId.localeCompare(b.deliveryId))[0];
      if (!candidate) return null;
      const claimed = validateStored<T>({
        ...candidate, status: 'claimed', attempts: candidate.attempts + 1,
        leaseOwner: consumer, leaseUntil: now + leaseMs,
      });
      items.set(candidate.deliveryId, claimed);
      return claimed;
    },
    async acknowledge(id, consumer, now) {
      validText(id, 'El deliveryId');
      validText(consumer, 'El consumidor');
      validTime(now, 'La fecha de ACK');
      const current = items.get(id);
      if (!current || current.status !== 'claimed' || current.leaseOwner !== consumer || (current.leaseUntil ?? 0) <= now) return false;
      items.set(id, validateStored({ ...current, status: 'acked', ackedAt: now, leaseOwner: undefined, leaseUntil: undefined }));
      return true;
    },
    async release(id, consumer) {
      validText(id, 'El deliveryId');
      validText(consumer, 'El consumidor');
      const current = items.get(id);
      if (!current || current.status !== 'claimed' || current.leaseOwner !== consumer) return false;
      items.set(id, validateStored({ ...current, status: 'pending', leaseOwner: undefined, leaseUntil: undefined }));
      return true;
    },
  };
}

/**
 * Durable IndexedDB queue. Claims and ACKs are single read-write transactions,
 * so two tabs cannot own the same unexpired delivery lease.
 */
export function createIndexedDbApplicationDeliveryQueue(
  factory: IDBFactory = globalThis.indexedDB,
): ApplicationDeliveryQueue {
  if (!factory) throw new ApplicationPersistenceError('IndexedDB no está disponible en este navegador.');
  const database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(APPLICATION_DATABASE_NAME, APPLICATION_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('records')) {
        const records = db.createObjectStore('records', { keyPath: 'id' });
        records.createIndex('byNamespaceUpdatedAt', ['namespace', 'updatedAt'], { unique: false });
      }
      if (!db.objectStoreNames.contains(APPLICATION_DELIVERIES_STORE)) {
        const deliveries = db.createObjectStore(APPLICATION_DELIVERIES_STORE, { keyPath: 'deliveryId' });
        deliveries.createIndex('byCreatedAt', 'createdAt', { unique: false });
        deliveries.createIndex('byTargetCreatedAt', ['target', 'createdAt'], { unique: false });
      }
    };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error ?? new ApplicationPersistenceError('No se pudo abrir la cola de entregas.'));
    request.onblocked = () => reject(new ApplicationPersistenceError('La actualización de IndexedDB está bloqueada por otra pestaña.'));
  });

  const read = async <T>(id: string): Promise<ApplicationDelivery<T> | null> => {
    const db = await database;
    const tx = db.transaction(APPLICATION_DELIVERIES_STORE, 'readonly');
    const request = tx.objectStore(APPLICATION_DELIVERIES_STORE).get(id);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result ? validateStored<T>(request.result) : null);
      request.onerror = () => reject(request.error);
      tx.onabort = () => reject(tx.error);
    });
  };

  return {
    async enqueue<T>(raw) {
      const input = validateInput(raw);
      const db = await database;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(APPLICATION_DELIVERIES_STORE, 'readwrite');
        const store = tx.objectStore(APPLICATION_DELIVERIES_STORE);
        let result: ApplicationDelivery<T> | null = null;
        let error: unknown;
        const request = store.get(input.deliveryId);
        request.onsuccess = () => {
          try {
            if (request.result) {
              const existing = validateStored<T>(request.result);
              if (!sameJson(deliveryIdentity(existing), { schemaVersion: 1, ...input })) throw new ApplicationPersistenceError('El deliveryId ya existe con un contenido diferente.');
              result = existing;
            } else {
              result = validateStored<T>({ schemaVersion: 1, ...input, status: 'pending', attempts: 0 });
              store.add(result);
            }
          } catch (cause) { error = cause; try { tx.abort(); } catch { /* noop */ } }
        };
        tx.oncomplete = () => error ? reject(error) : resolve(result!);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(error ?? tx.error);
      });
    },
    get: read,
    async list<T>(target) {
      const db = await database;
      const tx = db.transaction(APPLICATION_DELIVERIES_STORE, 'readonly');
      const index = tx.objectStore(APPLICATION_DELIVERIES_STORE).index(target ? 'byTargetCreatedAt' : 'byCreatedAt');
      const request = index.getAll(target ? IDBKeyRange.bound([target, 0], [target, Number.MAX_SAFE_INTEGER]) : undefined);
      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          try { resolve((request.result as unknown[]).map(item => validateStored<T>(item)).sort((a,b) => a.createdAt-b.createdAt || a.deliveryId.localeCompare(b.deliveryId))); }
          catch (error) { reject(error); }
        };
        request.onerror = () => reject(request.error);
        tx.onabort = () => reject(tx.error);
      });
    },
    async claimNext<T>({ consumer, target, now, leaseMs }) {
      validText(consumer, 'El consumidor');
      if (target !== 'manager' && target !== 'tabulation') throw new ApplicationPersistenceError('El destino de consumo no es válido.');
      validTime(now, 'La fecha actual');
      if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 300_000) throw new ApplicationPersistenceError('La duración del lease debe estar entre 1 y 300000 ms.');
      const db = await database;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(APPLICATION_DELIVERIES_STORE, 'readwrite');
        const store = tx.objectStore(APPLICATION_DELIVERIES_STORE);
        const request = store.getAll();
        let result: ApplicationDelivery<T> | null = null;
        let error: unknown;
        request.onsuccess = () => {
          try {
            const candidate = (request.result as unknown[]).map(item => validateStored<T>(item))
              .filter(item => item.target === target && (!kind || item.kind === kind) && (item.status === 'pending' || (item.status === 'claimed' && (item.leaseUntil ?? 0) <= now)))
              .sort((a,b) => a.createdAt-b.createdAt || a.deliveryId.localeCompare(b.deliveryId))[0];
            if (!candidate) return;
            result = validateStored<T>({ ...candidate, status: 'claimed', attempts: candidate.attempts + 1, leaseOwner: consumer, leaseUntil: now + leaseMs });
            store.put(result);
          } catch (cause) { error = cause; try { tx.abort(); } catch { /* noop */ } }
        };
        tx.oncomplete = () => error ? reject(error) : resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(error ?? tx.error);
      });
    },
    async acknowledge(id, consumer, now) {
      validText(id, 'El deliveryId'); validText(consumer, 'El consumidor'); validTime(now, 'La fecha de ACK');
      const db = await database;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(APPLICATION_DELIVERIES_STORE, 'readwrite');
        const store = tx.objectStore(APPLICATION_DELIVERIES_STORE);
        let accepted = false;
        const request = store.get(id);
        request.onsuccess = () => {
          try {
            if (!request.result) return;
            const current = validateStored(request.result);
            if (current.status !== 'claimed' || current.leaseOwner !== consumer || (current.leaseUntil ?? 0) <= now) return;
            store.put(validateStored({ ...current, status: 'acked', ackedAt: now, leaseOwner: undefined, leaseUntil: undefined }));
            accepted = true;
          } catch (error) { try { tx.abort(); } catch { /* noop */ } reject(error); }
        };
        tx.oncomplete = () => resolve(accepted);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    },
    async release(id, consumer) {
      validText(id, 'El deliveryId'); validText(consumer, 'El consumidor');
      const db = await database;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(APPLICATION_DELIVERIES_STORE, 'readwrite');
        const store = tx.objectStore(APPLICATION_DELIVERIES_STORE);
        let accepted = false;
        const request = store.get(id);
        request.onsuccess = () => {
          try {
            if (!request.result) return;
            const current = validateStored(request.result);
            if (current.status !== 'claimed' || current.leaseOwner !== consumer) return;
            store.put(validateStored({ ...current, status: 'pending', leaseOwner: undefined, leaseUntil: undefined }));
            accepted = true;
          } catch (error) { try { tx.abort(); } catch { /* noop */ } reject(error); }
        };
        tx.oncomplete = () => resolve(accepted);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    },
  };
}
