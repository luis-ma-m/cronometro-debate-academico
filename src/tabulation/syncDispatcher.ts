import { ApiError, previewTabulationActa, publishTabulationRound, saveTabulationActa } from '../api';
import { appendPanelPublishAcknowledgement } from './panelBridge';
import type { PendingSyncOperation } from './syncOutbox';
import type { SyncDispatchResult } from './syncOutboxWorker';

const ACTA_PENDING_PREFIX = 'ledu-tabulation-acta-pending-v1:';
export const ACTA_SYNC_ACK_EVENT = 'ledu:acta-sync-ack';

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function classify(error: unknown): SyncDispatchResult {
  const code = error instanceof ApiError ? error.code
    : error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : '';
  const message = error instanceof Error ? error.message : 'No se ha podido sincronizar la operación.';
  const status = error instanceof ApiError ? error.status
    : error && typeof error === 'object' && 'status' in error ? Number((error as { status?: unknown }).status) : 0;
  const retryAfterMs = error && typeof error === 'object' && 'retryAfterMs' in error
    ? Number((error as { retryAfterMs?: unknown }).retryAfterMs) || 0 : 0;
  if (code === 'UNAUTHORIZED' || status === 401) {
    return { status: 'pause', error: { code: code || 'UNAUTHORIZED', message }, retryAfterMs: 60_000 };
  }
  if (status === 409 || [
    'REVISION_CONFLICT', 'TOURNAMENT_MISMATCH', 'IDEMPOTENCY_MISMATCH',
    'ACTA_REVISION_CONFLICT', 'ACTA_RULES_REVISION_CONFLICT', 'ACTA_IDENTITY_MISMATCH',
    'ACTA_REPLACEMENT_CONFIRMATION_REQUIRED', 'ACTA_REPLACEMENT_CONFIRMATION_INVALID',
  ].includes(code)) return { status: 'conflict', error: { code: code || 'REVISION_CONFLICT', message } };
  if (status === 429 || code === 'RATE_LIMITED') {
    return { status: 'retry', error: { code: code || 'RATE_LIMITED', message }, retryAfterMs };
  }
  if (status >= 400 && status < 500 || [
    'INVALID_PAYLOAD', 'INVALID_RELATION', 'OPERATION_NOT_ALLOWED', 'FORMAT_NOT_CONFIGURED',
    'ACTA_CONTEXT_INVALID', 'ACTA_IDENTITY_REVIEW_REQUIRED', 'INVALID_ACTA',
    'INVALID_ACTA_SOURCE', 'ACTA_SOURCE_MODE_MISMATCH', 'INVALID_ELIMINATION_RESULT',
    'ELIMINATION_RESULT_MISMATCH', 'SCHEMA_TOO_NEW',
  ].includes(code)) return { status: 'failed', error: { code: code || 'INVALID_OPERATION', message } };
  return { status: 'retry', error: { code: code || 'NETWORK_ERROR', message }, retryAfterMs };
}

async function dispatchRound(token: string, operation: PendingSyncOperation): Promise<SyncDispatchResult> {
  const payload = operation.payload as Record<string, unknown>;
  const published = await publishTabulationRound(token, {
    protocolVersion: 1, operationId: operation.operationId, tournamentId: operation.tournamentId,
    entityType: 'round', entityId: operation.entityId, operation: 'publish-round',
    baseRevision: operation.baseRevision, payload, payloadHash: operation.payloadHash,
  });
  if (!Array.isArray(published.debateAssignments)
    || typeof payload.tabTournamentId !== 'string' || typeof payload.tabulationRoundId !== 'string') {
    throw new Error('El servidor confirmó la ronda, pero no devolvió el mapping de debates esperado. Se requiere reconciliación por operationId.');
  }
  appendPanelPublishAcknowledgement(window.localStorage, {
    version: 1, operationId: operation.operationId,
    tabTournamentId: payload.tabTournamentId, tabulationRoundId: payload.tabulationRoundId,
    managerRoundId: published.roundId, revision: published.revision,
    debateAssignments: published.debateAssignments,
  });
  return { status: 'acknowledged', response: published };
}

async function dispatchActa(token: string, operation: PendingSyncOperation): Promise<SyncDispatchResult> {
  const payload = operation.payload;
  if (!record(payload)) return { status: 'failed', error: { code: 'INVALID_PAYLOAD', message: 'El payload del acta pendiente no es válido.' } };
  if (payload.mode === 'first-save') {
    if (payload.assignmentId !== operation.entityId || !record(payload.source)) {
      return { status: 'failed', error: { code: 'INVALID_PAYLOAD', message: 'La primera publicación no coincide con la asignación pendiente.' } };
    }
    const comparison = await previewTabulationActa(token, operation.entityId, payload.source);
    if (comparison.assignmentId !== operation.entityId || comparison.tournamentId !== operation.tournamentId) {
      return { status: 'conflict', error: { code: 'ACTA_IDENTITY_MISMATCH', message: 'La comparación pertenece a otro torneo o asignación.' } };
    }
    if (comparison.currentSourceId) {
      if (comparison.changes.length === 0) {
        return { status: 'acknowledged', response: { alreadyCurrent: true, currentSourceId: comparison.currentSourceId } };
      }
      return { status: 'conflict', error: { code: 'ACTA_REPLACEMENT_REVIEW_REQUIRED', message: 'Ya existe una versión oficial distinta. Revisa las diferencias y confirma expresamente su sustitución desde Tabulación.' } };
    }
    const saved = await saveTabulationActa(token, {
      operationId: operation.operationId,
      assignmentId: operation.entityId,
      source: comparison.proposedSource,
      expectedCurrentSourceId: null,
      confirmReplace: false,
      expectedSettingsRevision: comparison.settingsRevision,
    });
    return { status: 'acknowledged', response: saved };
  }
  if (payload.mode === 'confirmed' && record(payload.input)) {
    const input = payload.input;
    if (input.operationId !== operation.operationId || input.assignmentId !== operation.entityId
      || !record(input.source) || (input.expectedCurrentSourceId !== null && typeof input.expectedCurrentSourceId !== 'string')
      || typeof input.confirmReplace !== 'boolean' || !Number.isSafeInteger(input.expectedSettingsRevision)) {
      return { status: 'failed', error: { code: 'INVALID_PAYLOAD', message: 'La operación de acta confirmada no conserva el contexto exacto de la comparación.' } };
    }
    const saved = await saveTabulationActa(token, {
      operationId: operation.operationId,
      assignmentId: operation.entityId,
      source: input.source,
      expectedCurrentSourceId: input.expectedCurrentSourceId as string | null,
      confirmReplace: input.confirmReplace,
      expectedSettingsRevision: input.expectedSettingsRevision as number,
    });
    return { status: 'acknowledged', response: saved };
  }
  return { status: 'failed', error: { code: 'INVALID_PAYLOAD', message: 'La modalidad de sincronización del acta no está soportada.' } };
}

export function createTabulationSyncDispatcher(options: {
  token: string;
  onUnauthorized?: () => void;
}): (operation: PendingSyncOperation) => Promise<SyncDispatchResult> {
  return async (operation) => {
    try {
      if (operation.operation === 'publish-round' && operation.entityType === 'round') {
        return await dispatchRound(options.token, operation);
      }
      if (operation.operation === 'replace-acta' && operation.entityType === 'acta') {
        return await dispatchActa(options.token, operation);
      }
      return { status: 'failed', error: { code: 'OPERATION_NOT_ALLOWED', message: 'La operación no está autorizada para sincronización desde Tabulación.' } };
    } catch (error) {
      const result = classify(error);
      if (result.status === 'pause' && result.error.code === 'UNAUTHORIZED') options.onUnauthorized?.();
      return result;
    }
  };
}

export function notifyTabulationSyncAcknowledged(operation: PendingSyncOperation, response?: unknown): void {
  if (operation.operation !== 'replace-acta' || operation.entityType !== 'acta') return;
  const key = ACTA_PENDING_PREFIX + operation.entityId;
  try {
    const current = JSON.parse(window.localStorage.getItem(key) ?? 'null') as { operationId?: unknown } | null;
    if (current?.operationId === operation.operationId) window.localStorage.removeItem(key);
  } catch { /* The durable IndexedDB ACK remains authoritative. */ }
  window.dispatchEvent(new CustomEvent(ACTA_SYNC_ACK_EVENT, {
    detail: { operationId: operation.operationId, assignmentId: operation.entityId, response },
  }));
}
