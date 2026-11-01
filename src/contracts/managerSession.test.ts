import { describe, expect, it } from 'vitest';
import {
  clearManagerSession,
  MANAGER_SESSION_STORAGE_KEY,
  parseManagerSession,
  readManagerSession,
  writeManagerSession,
} from './managerSession';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe('shared manager session contract', () => {
  it('accepts a valid unexpired session and rejects malformed or expired values', () => {
    expect(parseManagerSession({ token: 'session-token', expiresAt: 2000 }, 1000))
      .toEqual({ token: 'session-token', expiresAt: 2000 });
    expect(parseManagerSession({ token: ' ', expiresAt: 2000 }, 1000)).toBeNull();
    expect(parseManagerSession({ token: 'x'.repeat(201), expiresAt: 2000 }, 1000)).toBeNull();
    expect(parseManagerSession({ token: 'session-token', expiresAt: 1000 }, 1000)).toBeNull();
    expect(parseManagerSession(null, 1000)).toBeNull();
  });

  it('round-trips through the single shared storage key', () => {
    const storage = memoryStorage();
    const session = writeManagerSession(storage, { token: 'session-token', expiresAt: 2000 }, 1000);
    expect(session).toEqual({ token: 'session-token', expiresAt: 2000 });
    expect(readManagerSession(storage, 1000)).toEqual(session);
    expect(storage.getItem(MANAGER_SESSION_STORAGE_KEY)).toBe(JSON.stringify(session));
  });

  it('clears the shared session and safely handles corrupt persisted JSON', () => {
    const storage = memoryStorage();
    storage.setItem(MANAGER_SESSION_STORAGE_KEY, '{invalid');
    expect(readManagerSession(storage, 1000)).toBeNull();
    writeManagerSession(storage, { token: 'session-token', expiresAt: 2000 }, 1000);
    clearManagerSession(storage);
    expect(readManagerSession(storage, 1000)).toBeNull();
  });

  it('refuses to persist invalid sessions', () => {
    expect(() => writeManagerSession(memoryStorage(), { token: '', expiresAt: 2000 }, 1000)).toThrow(TypeError);
  });
});
