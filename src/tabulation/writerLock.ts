import type { KeyValueStorage } from './store';

/**
 * Only one tab may write the tabulation at a time; the others stay read-only until they take control. Web Locks
 * (HTTPS or localhost) hand the role over as soon as the writer closes. Without them, a lease in localStorage is
 * renewed every 2 s and expires after 6 s.
 */
export const LEASE_KEY = 'ledu-tabulacion-writer-v1';
const LEASE_MS = 6_000;
const RENEW_MS = 2_000;

export interface LockManagerLike {
  request(name: string, options: { ifAvailable?: boolean; steal?: boolean }, callback: (lock: unknown) => unknown): Promise<unknown>;
}

interface LockEvents {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

export interface WriterLock {
  isWriter(): boolean;
  subscribe(listener: () => void): () => void;
  /** «Tomar el control»: this tab becomes the writer and the previous one turns read-only. */
  takeOver(): void;
  /** Gives up the role so another tab can take it. */
  release(): void;
  dispose(): void;
}

export interface WriterLockOptions {
  name: string;
  locks?: LockManagerLike | null;
  storage?: KeyValueStorage | null;
  tabId?: string;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => () => void;
  events?: LockEvents | null;
}

export function createWriterLock(options: WriterLockOptions): WriterLock {
  const listeners = new Set<() => void>();
  let writer = false;
  const set = (value: boolean) => {
    if (writer === value) return;
    writer = value;
    listeners.forEach((listener) => listener());
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };
  const locks = options.locks === undefined ? ((globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks ?? null) : options.locks;
  if (locks) return webLocks(locks, options.name, set, () => writer, subscribe);
  const storage = options.storage === undefined ? (typeof window === 'undefined' ? null : window.localStorage) : options.storage;
  if (storage) return lease(storage, options, set, () => writer, subscribe);
  writer = true;
  return { isWriter: () => true, subscribe, takeOver: () => undefined, release: () => undefined, dispose: () => undefined };
}

function webLocks(locks: LockManagerLike, name: string, set: (value: boolean) => void, isWriter: () => boolean, subscribe: WriterLock['subscribe']): WriterLock {
  let releaseHold: (() => void) | null = null;
  let waiting = false;
  let disposed = false;
  const hold = (lock: unknown) => {
    if (!lock || disposed) return undefined;
    set(true);
    return new Promise<void>((resolve) => { releaseHold = resolve; });
  };
  // A stolen lock rejects its request: turn read-only and queue to get the role back when it is free.
  const lost = () => {
    releaseHold = null;
    set(false);
    wait();
  };
  const wait = () => {
    if (waiting || disposed) return;
    waiting = true;
    locks.request(name, {}, (lock) => {
      waiting = false;
      return hold(lock);
    }).catch(lost);
  };
  locks.request(name, { ifAvailable: true }, (lock) => {
    if (!lock) {
      wait();
      return undefined;
    }
    return hold(lock);
  }).catch(lost);
  const release = () => {
    releaseHold?.();
    releaseHold = null;
    set(false);
  };
  return {
    isWriter,
    subscribe,
    takeOver() {
      if (!disposed) locks.request(name, { steal: true }, hold).catch(lost);
    },
    release,
    dispose() {
      disposed = true;
      release();
    },
  };
}

function lease(storage: KeyValueStorage, options: WriterLockOptions, set: (value: boolean) => void, isWriter: () => boolean, subscribe: WriterLock['subscribe']): WriterLock {
  const tabId = options.tabId ?? Math.random().toString(36).slice(2);
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  });
  const events = options.events === undefined ? (typeof window === 'undefined' ? null : window) : options.events;
  let cancel: (() => void) | null = null;
  let disposed = false;

  const read = (): { tabId: string; expiresAt: number } | null => {
    try {
      const raw = JSON.parse(storage.getItem(LEASE_KEY) ?? 'null') as { tabId?: unknown; expiresAt?: unknown } | null;
      return raw && typeof raw.tabId === 'string' ? { tabId: raw.tabId, expiresAt: Number(raw.expiresAt) || 0 } : null;
    } catch {
      return null;
    }
  };
  const write = () => {
    try {
      storage.setItem(LEASE_KEY, JSON.stringify({ tabId, expiresAt: now() + LEASE_MS }));
      return true;
    } catch {
      return false;
    }
  };
  const check = () => {
    if (disposed) return;
    const current = read();
    const heldByOther = current !== null && current.tabId !== tabId && current.expiresAt > now();
    if (isWriter()) {
      if (heldByOther) set(false);
      else write();
    } else if (!heldByOther && write()) {
      set(true);
    }
  };
  const loop = () => {
    cancel = schedule(() => {
      check();
      if (!disposed) loop();
    }, RENEW_MS);
  };
  const onStorage = (event: Event) => {
    if ((event as StorageEvent).key === LEASE_KEY || (event as StorageEvent).key === null) check();
  };
  check();
  loop();
  events?.addEventListener('storage', onStorage);

  const release = () => {
    if (isWriter() && read()?.tabId === tabId) {
      try {
        storage.removeItem(LEASE_KEY);
      } catch { /* The lease simply expires. */ }
    }
    set(false);
  };
  return {
    isWriter,
    subscribe,
    takeOver() {
      if (!disposed && write()) set(true);
    },
    release,
    dispose() {
      disposed = true;
      cancel?.();
      events?.removeEventListener('storage', onStorage);
      release();
    },
  };
}
