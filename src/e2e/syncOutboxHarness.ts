import { createIndexedDbSyncOutboxRepository, createSyncOutbox } from '../tabulation/syncOutbox';

export interface SyncOutboxUpgradeResult {
  migratedCount: number;
  migratedOperationId: string | undefined;
  migratedPayload: unknown;
  recoveredLeases: number;
  claimCount: number;
  upgraded: { version: number; indexes: string[] };
}

/**
 * Test-only browser harness. It is included only in the E2E production build and
 * exercises the same IndexedDB repository implementation used by the manager.
 */
export async function runSyncOutboxUpgradeScenario(): Promise<SyncOutboxUpgradeResult> {
  const databaseName = 'ledu-tabulation-sync-v1';
  const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('operations', { keyPath: 'operationId' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  await new Promise<void>((resolve, reject) => {
    const transaction = legacy.transaction('operations', 'readwrite');
    transaction.objectStore('operations').put({
      operationId: 'legacy-pending-operation',
      tournamentId: 'legacy-tournament',
      entityType: 'round',
      entityId: 'legacy-round',
      operation: 'publish-round',
      baseRevision: 7,
      payload: { roundName: 'Ronda conservada' },
      payloadHash: 'a'.repeat(64),
      status: 'sending',
      attempts: 1,
      workerId: 'stale-worker',
      leaseUntil: 1,
      createdAt: 100,
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  legacy.close();

  const firstRepository = createIndexedDbSyncOutboxRepository();
  const migratedRows = await firstRepository.list('legacy-tournament');
  const recoveryTime = Date.now();
  const recoveryOutbox = createSyncOutbox(firstRepository, { now: () => recoveryTime });
  const recoveredLeases = await recoveryOutbox.recoverExpiredLeases();
  // Expired leases intentionally enter backoff; advance the test clock to its first retry slot.
  const firstOutbox = createSyncOutbox(firstRepository, { now: () => recoveryTime + 2_000 });
  const secondOutbox = createSyncOutbox(createIndexedDbSyncOutboxRepository(), { now: () => recoveryTime + 2_000 });
  const [firstClaim, secondClaim] = await Promise.all([
    firstOutbox.claimNext('legacy-tournament', 'browser-tab-a'),
    secondOutbox.claimNext('legacy-tournament', 'browser-tab-b'),
  ]);

  const upgraded = await new Promise<{ version: number; indexes: string[] }>((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('operations', 'readonly');
      const indexes = Array.from(transaction.objectStore('operations').indexNames);
      const version = db.version;
      db.close();
      resolve({ version, indexes });
    };
    request.onerror = () => reject(request.error);
  });

  return {
    migratedCount: migratedRows.length,
    migratedOperationId: migratedRows[0]?.operationId,
    migratedPayload: migratedRows[0]?.payload,
    recoveredLeases,
    claimCount: Number(Boolean(firstClaim)) + Number(Boolean(secondClaim)),
    upgraded,
  };
}

export function installSyncOutboxE2EHarness(): void {
  (window as Window & { __LEDU_E2E_SYNC_OUTBOX__?: { run: typeof runSyncOutboxUpgradeScenario } })
    .__LEDU_E2E_SYNC_OUTBOX__ = { run: runSyncOutboxUpgradeScenario };
}
