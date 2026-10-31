import type { PendingSyncOperation, SyncOperationError, SyncOutbox } from './syncOutbox';
import { SYNC_OUTBOX_UPDATED_EVENT } from './syncOutbox';

export type SyncDispatchResult =
  | { status: 'acknowledged' }
  | { status: 'conflict' | 'failed' | 'retry' | 'pause'; error: SyncOperationError; retryAfterMs?: number };

export interface SyncOutboxWorkerOptions {
  outbox: SyncOutbox;
  tournamentId: string;
  workerId: string;
  dispatch: (operation: PendingSyncOperation) => Promise<SyncDispatchResult>;
  onQueueChange?: (operations: PendingSyncOperation[]) => void;
  onAcknowledged?: (operation: PendingSyncOperation) => void;
  onError?: (error: unknown) => void;
  now?: () => number;
  pollIntervalMs?: number;
  pausedRetryMs?: number;
}

/**
 * One worker instance per authenticated tournament view. IndexedDB leases provide
 * cross-tab exclusion; the worker never removes an operation without a server ACK.
 */
export function createSyncOutboxWorker(options: SyncOutboxWorkerOptions) {
  const now = options.now ?? Date.now;
  const pollIntervalMs = options.pollIntervalMs ?? 30_000;
  const pausedRetryMs = options.pausedRetryMs ?? 60_000;
  let stopped = true;
  let inFlight: Promise<void> | null = null;
  let pollTimer: number | undefined;
  let wakeTimer: number | undefined;

  const refresh = async () => {
    const rows = await options.outbox.list(options.tournamentId);
    options.onQueueChange?.(rows);
    return rows;
  };

  const scheduleNextWake = async () => {
    if (stopped) return;
    if (wakeTimer !== undefined) window.clearTimeout(wakeTimer);
    const rows = await refresh();
    const next = rows.find((row) => row.status === 'pending');
    const delay = next ? Math.max(250, (next.nextAttemptAt ?? now()) - now()) : pollIntervalMs;
    wakeTimer = window.setTimeout(() => { void runOnce(); }, Math.min(delay, pollIntervalMs));
  };

  const runOnce = (force = false): Promise<void> => {
    if ((stopped && !force) || (typeof navigator !== 'undefined' && navigator.onLine === false)) return Promise.resolve();
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        await options.outbox.recoverExpiredLeases();
        while ((!stopped || force) && !(typeof navigator !== 'undefined' && navigator.onLine === false)) {
          const operation = await options.outbox.claimNext(options.tournamentId, options.workerId);
          if (!operation) break;
          await refresh();
          let result: SyncDispatchResult;
          try {
            result = await options.dispatch(operation);
          } catch (error) {
            result = {
              status: 'retry',
              error: {
                code: error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : 'WORKER_ERROR',
                message: error instanceof Error ? error.message : 'Error inesperado al sincronizar.',
              },
              retryAfterMs: error && typeof error === 'object' && 'retryAfterMs' in error
                ? Number((error as { retryAfterMs?: unknown }).retryAfterMs) || 0 : 0,
            };
          }

          if (result.status === 'acknowledged') {
            const acknowledged = await options.outbox.acknowledge(operation.operationId, options.workerId);
            if (acknowledged) options.onAcknowledged?.(operation);
            else options.onError?.(new Error('El servidor confirmó la operación, pero el lease local ya no pertenece a este worker.'));
          } else if (result.status === 'conflict') {
            await options.outbox.markConflict(operation.operationId, options.workerId, result.error);
            break;
          } else if (result.status === 'failed') {
            await options.outbox.markFailed(operation.operationId, options.workerId, result.error);
            break;
          } else {
            await options.outbox.retry(operation.operationId, options.workerId, result.error, operation.attempts, result.retryAfterMs ?? (result.status === 'pause' ? pausedRetryMs : 0));
            break;
          }
          await refresh();
        }
      } catch (error) {
        options.onError?.(error);
      } finally {
        inFlight = null;
        if (!stopped) void scheduleNextWake().catch((error) => options.onError?.(error));
      }
    })();
    return inFlight;
  };

  const wake = () => {
    if (wakeTimer !== undefined) window.clearTimeout(wakeTimer);
    wakeTimer = undefined;
    void runOnce();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') wake();
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      window.addEventListener('online', wake);
      window.addEventListener(SYNC_OUTBOX_UPDATED_EVENT, wake);
      window.addEventListener('focus', wake);
      document.addEventListener('visibilitychange', onVisibility);
      pollTimer = window.setInterval(wake, pollIntervalMs);
      void refresh().then(() => runOnce()).catch((error) => options.onError?.(error));
    },
    wake,
    async runOnce() { await runOnce(true); },
    async refresh() { return refresh(); },
    stop() {
      if (stopped) return;
      stopped = true;
      window.removeEventListener('online', wake);
      window.removeEventListener(SYNC_OUTBOX_UPDATED_EVENT, wake);
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', onVisibility);
      if (pollTimer !== undefined) window.clearInterval(pollTimer);
      if (wakeTimer !== undefined) window.clearTimeout(wakeTimer);
      pollTimer = undefined;
      wakeTimer = undefined;
    },
  };
}
