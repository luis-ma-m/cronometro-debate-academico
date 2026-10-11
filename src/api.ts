import type { PublicRoom, Tournament } from './domain';

const API_URL = (import.meta.env.VITE_APPS_SCRIPT_URL as string | undefined)?.trim() ?? '';
export const apiConfigured = API_URL.length > 0;

export class ApiError extends Error {
  constructor(message: string, public code = 'API_ERROR') {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiCall<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!API_URL) throw new ApiError('No se ha configurado VITE_APPS_SCRIPT_URL.', 'NOT_CONFIGURED');
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, payload }),
    cache: 'no-store',
    redirect: 'follow',
  });
  if (!response.ok) throw new ApiError('El backend respondió HTTP ' + response.status, 'HTTP_ERROR');
  let result: { ok: boolean; data?: T; error?: { message?: string; code?: string } };
  try { result = await response.json() as typeof result; }
  catch { throw new ApiError('El backend no devolvió JSON válido. Comprueba CORS y la URL de Apps Script.', 'INVALID_RESPONSE'); }
  if (!result.ok || result.data === undefined) throw new ApiError(result.error?.message ?? 'Error del backend.', result.error?.code);
  return result.data;
}

export const login = (password: string) => apiCall<{ token: string; expiresAt: number }>('login', { password });
export const getTournament = (token: string) => apiCall<Tournament>('getTournament', { token });
export const saveTournament = (token: string, expectedRevision: number, tournament: Tournament) =>
  apiCall<Tournament>('saveTournament', { token, expectedRevision, tournament });
export const getPublicRoom = (roomId: string) => apiCall<PublicRoom>('getPublicRoom', { roomId });
export const updateTimer = (roomId: string, action: 'start' | 'pause' | 'reset' | 'next', expectedRevision: number) =>
  apiCall<PublicRoom>('updateRoomTimer', { roomId, action, expectedRevision });
