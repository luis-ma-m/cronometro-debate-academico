import type { PublicRoom, Tournament } from './domain';
import type { ScoreCategory, RoundScorecard } from './scoring';
import type { TimerAction } from './timer';

const EXPLICIT_API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.trim() ?? '';
const API_URL = EXPLICIT_API_URL || (import.meta.env.PROD ? '/api' : '');
export const apiConfigured = API_URL.length > 0;

export class ApiError extends Error {
  constructor(message: string, public code = 'API_ERROR', public retryAfterMs = 0) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiCall<T>(action: string, payload: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  if (!API_URL) throw new ApiError('No hay API remota en este entorno. La aplicación está en modo de demostración local.', 'NOT_CONFIGURED');
  let response: Response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload }),
      cache: 'no-store',
      credentials: 'same-origin',
      ...(signal ? { signal } : {}),
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
    const retryAfterHeader = response.headers.get('retry-after');
    const retryAfterSeconds = retryAfterHeader && Number.isFinite(Number(retryAfterHeader)) ? Number(retryAfterHeader) : 0;
    const retryAfterDate = retryAfterHeader && retryAfterSeconds === 0 ? Date.parse(retryAfterHeader) : Number.NaN;
    const retryAfterMs = Math.max(0, retryAfterSeconds ? retryAfterSeconds * 1000 : Number.isFinite(retryAfterDate) ? retryAfterDate - Date.now() : 0);
    if (response.status >= 500 && (!detail.error || detail.error.code === 'INTERNAL_ERROR')) {
      const reference = requestId ? ' Referencia para localizarlo en Vercel: ' + requestId + '.' : '';
      throw new ApiError(
        'La función de Vercel ha fallado internamente (HTTP ' + response.status + '). Revisa Vercel → Logs → Runtime Logs. No se ha podido confirmar la operación.' + reference,
        'VERCEL_RUNTIME_ERROR',
        retryAfterMs,
      );
    }
    throw new ApiError(
      detail.error?.message ?? ('El backend respondió HTTP ' + response.status),
      detail.error?.code ?? 'HTTP_ERROR',
      retryAfterMs,
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
export const getTournament = (token: string, signal?: AbortSignal) => apiCall<Tournament>('getTournament', { token }, signal);
export const saveTournament = (token: string, expectedRevision: number, tournament: Tournament) =>
  apiCall<Tournament>('saveTournament', { token, expectedRevision, tournament });
export const saveScoreConfig = (token: string, expectedRevision: number, categories: ScoreCategory[], scorecards: RoundScorecard[]) =>
  apiCall<Tournament>('saveScoreConfig', { token, expectedRevision, categories, scorecards });
export const getPublicRoom = (roomId: string) => apiCall<PublicRoom>('getPublicRoom', { roomId });
export interface RoomConnectionStatus {
  physicalRoomId: string;
  roomName: string;
  connected: boolean;
  lastSeenAt: number | null;
  disconnectedAt: number | null;
}
export const sendRoomHeartbeat = (roomId: string, controlKey: string) =>
  apiCall<{ serverTime: number }>('roomHeartbeat', { roomId, controlKey });
export const getRoomConnectionStatuses = (token: string) =>
  apiCall<RoomConnectionStatus[]>('getRoomConnectionStatuses', { token });
export const getRoomControllerToken = (token: string, roomId: string, rotate = false) =>
  apiCall<{ token: string }>('getRoomControllerToken', { token, roomId, rotate });
export interface PendingDebate {
  assignmentId: string;
  physicalRoomId: string;
  roomName: string;
  teamFavor: string;
  teamContra: string;
  phaseName: string;
  status: string;
  statusLabel: string;
  remainingSeconds: number;
}

export interface RoundActivationPreview {
  activeRoundId: string;
  activeRoundName: string;
  targetRoundId: string;
  targetRoundName: string;
  alreadyActive: boolean;
  pending: PendingDebate[];
  activationRevision: number;
  serverTime: number;
}

export const getRoundActivationPreview = (token: string, roundId: string) =>
  apiCall<RoundActivationPreview>('getRoundActivationPreview', { token, roundId });
export const activateRound = (token: string, roundId: string, force = false, expectedActivationRevision?: number) =>
  apiCall<Tournament>('activateRound', { token, roundId, force, expectedActivationRevision });
export const updateTimer = (
  roomId: string,
  action: TimerAction,
  expectedRevision: number,
  controlKey?: string,
  assignmentId?: string,
  expectedActivationRevision?: number,
) => apiCall<PublicRoom>('updateRoomTimer', {
  roomId, action, expectedRevision, controlKey, assignmentId, expectedActivationRevision,
});

export interface TabulationActaHistoryVersion {
  id: string;
  sourceMode: 'judges' | 'joint' | 'elimination';
  roundKind: 'qualifying' | 'elimination';
  baseRevision: number;
  sourceHash: string;
  eliminationResult?: Record<string, unknown> | null;
  operationId: string;
  supersedesSourceId: string | null;
  createdBy: string;
  createdAt: number;
}
export interface TabulationActaHistory {
  tournamentId: string;
  assignmentId: string;
  currentVersionId: string | null;
  totalVersions: number;
  rewriteCount: number;
  truncated: boolean;
  versions: TabulationActaHistoryVersion[];
}
export const getTabulationActaHistory = (token: string, assignmentId: string) =>
  apiCall<TabulationActaHistory>('getTabulationActaHistory', { token, assignmentId });

export interface TabulationRoundPublishOperation {
  protocolVersion: 1;
  operationId: string;
  tournamentId: string;
  entityType: 'round';
  entityId: string;
  operation: 'publish-round';
  baseRevision: number;
  payload: Record<string, unknown>;
  payloadHash: string;
}
export interface PublishedTabulationRound {
  tournamentId: string;
  roundId: string;
  roundNumber: number;
  roundName: string;
  roundKind: 'qualifying' | 'elimination';
  tabTournamentId: string;
  tabulationRoundId: string;
  assignmentIds: string[];
  debateAssignments: Array<{ tabulationDebateId: string; assignmentId: string }>;
  revision: number;
  operationId: string;
}
export const publishTabulationRound = (token: string, operation: TabulationRoundPublishOperation) =>
  apiCall<PublishedTabulationRound>('publishTabulationRound', { token, operation });

export interface PersistedTabulationSettings {
  schemaVersion: number;
  tournamentId: string;
  revision: number;
  settings: import('./tabulation/types').TabSettings;
  updatedAt: number | null;
  updatedBy: string;
}
export const getTabulationSettings = (token: string) =>
  apiCall<PersistedTabulationSettings>('getTabulationSettings', { token });
export const saveTabulationSettings = (
  token: string,
  expectedRevision: number,
  settings: import('./tabulation/types').TabSettings,
  operationId: string,
) => apiCall<PersistedTabulationSettings>('saveTabulationSettings', {
  token, expectedRevision, schemaVersion: 2, settings, operationId,
});
