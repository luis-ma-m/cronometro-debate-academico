import type { PublicRoom, Tournament } from './domain';
import type { TimerAction } from './timer';

const EXPLICIT_API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.trim() ?? '';
const API_URL = EXPLICIT_API_URL || (import.meta.env.PROD ? '/api' : '');
export const apiConfigured = API_URL.length > 0;

export class ApiError extends Error {
  constructor(message: string, public code = 'API_ERROR') {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiCall<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!API_URL) throw new ApiError('No hay API remota en este entorno. La aplicación está en modo de demostración local.', 'NOT_CONFIGURED');
  let response: Response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload }),
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('No hay conexión con el backend. Comprueba internet y vuelve a intentarlo.', 'NETWORK_ERROR');
  }
  if (!response.ok) {
    let raw = '';
    let detail: { error?: { message?: string; code?: string } } = {};
    try {
      raw = await response.text();
      detail = JSON.parse(raw) as typeof detail;
    } catch { /* Vercel can return a non-JSON platform error before the handler runs. */ }

    const requestId = response.headers.get('x-vercel-id');
    if (response.status >= 500 && (!detail.error || detail.error.code === 'INTERNAL_ERROR')) {
      const reference = requestId ? ' Referencia para localizarlo en Vercel: ' + requestId + '.' : '';
      throw new ApiError(
        'La función de Vercel ha fallado internamente (HTTP ' + response.status + '). Revisa Vercel → Logs → Runtime Logs. No se ha podido confirmar la operación.' + reference,
        'VERCEL_RUNTIME_ERROR',
      );
    }
    throw new ApiError(
      detail.error?.message ?? ('El backend respondió HTTP ' + response.status),
      detail.error?.code ?? 'HTTP_ERROR',
    );
  }
  let result: { ok: boolean; data?: T; error?: { message?: string; code?: string } };
  try { result = await response.json() as typeof result; }
  catch { throw new ApiError('El backend no devolvió JSON válido. Comprueba la configuración de la API de Vercel.', 'INVALID_RESPONSE'); }
  if (!result.ok || result.data === undefined) throw new ApiError(result.error?.message ?? 'Error del backend.', result.error?.code);
  return result.data;
}

export const login = (password: string) => apiCall<{ token: string; expiresAt: number }>('login', { password });
export const logout = (token: string) => apiCall<{ loggedOut: boolean }>('logout', { token });
export const getTournament = (token: string) => apiCall<Tournament>('getTournament', { token });
export const saveTournament = (token: string, expectedRevision: number, tournament: Tournament) =>
  apiCall<Tournament>('saveTournament', { token, expectedRevision, tournament });
export const getPublicRoom = (roomId: string) => apiCall<PublicRoom>('getPublicRoom', { roomId });
export const getRoomControllerToken = (token: string, roomId: string, rotate = false) =>
  apiCall<{ token: string }>('getRoomControllerToken', { token, roomId, rotate });
export const updateTimer = (roomId: string, action: TimerAction, expectedRevision: number, controlKey?: string) =>
  apiCall<PublicRoom>('updateRoomTimer', { roomId, action, expectedRevision, controlKey });
