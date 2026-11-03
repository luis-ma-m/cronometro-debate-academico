import { ApiError, ackSyncOperation, getTabulationSyncOperationStatus, previewTabulationActa, publishTabulationRound, recordSyncOperation, saveTabulationActa } from '../api';
import { appendPanelPublishAcknowledgement } from './panelBridge';
import { enqueuePanelPublishAck } from '../contracts/applicationDeliveryAdapters';
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


async function executeJournaled(
  token: string,
  operation: PendingSyncOperation,
  run: () => Promise<unknown>,
): Promise<SyncDispatchResult> {
  const envelope = {
    protocolVersion: 1 as const,
    operationId: operation.operationId,
    tournamentId: operation.tournamentId,
    entityType: operation.entityType,
    entityId: operation.entityId,
    operation: operation.operation,
    baseRevision: operation.baseRevision,
    payload: operation.payload as Record<string, unknown>,
    payloadHash: operation.payloadHash,
  };
  const journal = await recordSyncOperation(token, envelope);
  if (journal.status === 'committed') {
    return { status: 'acknowledged', response: journal.result };
  }
  if (journal.status === 'conflict') {
    return { status: 'conflict', error: { code: journal.errorCode || 'REVISION_CONFLICT', message: journal.errorMessage || 'La operación requiere reconciliación.' } };
  }
  if (journal.status === 'rejected') {
    return { status: 'failed', error: { code: journal.errorCode || 'OPERATION_REJECTED', message: journal.errorMessage || 'La operación fue rechazada.' } };
  }
  try {
    const response = await run();
    // The domain transaction commits first; the journal ACK follows. If the ACK
    // request times out, retrying the same operationId replays the domain result.
    await ackSyncOperation(token, operation.operationId, operation.payloadHash, 'committed', response);
    return { status: 'acknowledged', response };
  } catch (error) {
    const classified = classify(error);
    if (classified.status === 'conflict') {
      await ackSyncOperation(token, operation.operationId, operation.payloadHash, 'conflict', undefined, classified.error).catch(() => undefined);
    } else if (classified.status === 'failed') {
      await ackSyncOperation(token, operation.operationId, operation.payloadHash, 'rejected', undefined, classified.error).catch(() => undefined);
    }
    // Network failures remain pending in Neon: a later retry can determine
    // whether the domain transaction committed or needs to run again.
    throw error;
  }
}

async function dispatchRound(token: string, operation: PendingSyncOperation): Promise<SyncDispatchResult> {
  const payload = operation.payload as Record<string, unknown>;
  const previous = await getTabulationSyncOperationStatus(token, operation);
  const published = previous.found ? previous.response as Awaited<ReturnType<typeof publishTabulationRound>>
    : await publishTabulationRound(token, {
    protocolVersion: 1, operationId: operation.operationId, tournamentId: operation.tournamentId,
    entityType: 'round', entityId: operation.entityId, operation: 'publish-round',
    baseRevision: operation.baseRevision, payload, payloadHash: operation.payloadHash,
  });
  if (!Array.isArray(published.debateAssignments)
    || typeof payload.tabTournamentId !== 'string' || typeof payload.tabulationRoundId !== 'string') {
    throw new Error('El servidor confirmó la ronda, pero no devolvió el mapping de debates esperado. Se requiere reconciliación por operationId.');
  }
  const acknowledgement = {
    version: 1 as const, operationId: operation.operationId,
    tabTournamentId: payload.tabTournamentId, tabulationRoundId: payload.tabulationRoundId,
    managerRoundId: published.roundId, revision: published.revision, updatedAt: published.updatedAt,
    debateAssignments: published.debateAssignments,
  };
  // The durable queue is authoritative for the current app; localStorage remains a rollback bridge.
  let queued = false;
  try { await enqueuePanelPublishAck(acknowledgement); queued = true; } catch { /* Use the legacy ACK below as recovery. */ }
  try { appendPanelPublishAcknowledgement(window.localStorage, acknowledgement); } catch {
    if (!queued) throw new Error('El servidor confirmó la ronda, pero no se pudo persistir su ACK. Recupera el resultado mediante operationId antes de volver a publicar.');
  }
  return { status: 'acknowledged', response: published };
}

async function dispatchActa(token: string, operation: PendingSyncOperation): Promise<SyncDispatchResult> {
  const payload = operation.payload;
  if (!record(payload)) return { status: 'failed', error: { code: 'INVALID_PAYLOAD', message: 'El payload del acta pendiente no es válido.' } };
  const previous = await getTabulationSyncOperationStatus(token, operation);
  if (previous.found) return { status: 'acknowledged', response: previous.response };
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
      if ((operation.operation === 'publish-round' && operation.entityType === 'round')
        || (operation.operation === 'replace-acta' && operation.entityType === 'acta')) {
        return await executeJournaled(options.token, operation, async () => {
          const result = operation.operation === 'publish-round'
            ? await dispatchRound(options.token, operation)
            : await dispatchActa(options.token, operation);
          if (result.status !== 'acknowledged') {
            const failure = result as Extract<SyncDispatchResult, { status: 'conflict' | 'failed' | 'retry' | 'pause' }>;
            const status = failure.status === 'conflict' ? 409 : failure.status === 'failed' ? 422 : 503;
            throw Object.assign(new Error(failure.error.message), { code: failure.error.code, status });
          }
          return result.response;
        });
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
