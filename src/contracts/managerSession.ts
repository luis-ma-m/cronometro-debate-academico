/** Shared authentication-session contract for the Gestión and Tabulación shells. */
export const MANAGER_SESSION_STORAGE_KEY = 'ledu-admin-session';

export interface ManagerSession {
  token: string;
  expiresAt: number;
}

type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Parse an untrusted persisted value and reject expired or malformed sessions. */
export function parseManagerSession(value: unknown, now = Date.now()): ManagerSession | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.token !== 'string' || candidate.token.trim().length === 0
    || candidate.token.length > 200 || typeof candidate.expiresAt !== 'number'
    || !Number.isSafeInteger(candidate.expiresAt) || candidate.expiresAt <= now) return null;
  return { token: candidate.token, expiresAt: candidate.expiresAt };
}

export function readManagerSession(storage: SessionStorage, now = Date.now()): ManagerSession | null {
  try {
    return parseManagerSession(JSON.parse(storage.getItem(MANAGER_SESSION_STORAGE_KEY) ?? 'null'), now);
  } catch {
    return null;
  }
}

export function writeManagerSession(storage: SessionStorage, value: unknown, now = Date.now()): ManagerSession {
  const session = parseManagerSession(value, now);
  if (!session) throw new TypeError('La sesión del gestor no tiene un token y una caducidad válidos.');
  storage.setItem(MANAGER_SESSION_STORAGE_KEY, JSON.stringify(session));
  return session;
}

export function clearManagerSession(storage: SessionStorage): void {
  storage.removeItem(MANAGER_SESSION_STORAGE_KEY);
}
