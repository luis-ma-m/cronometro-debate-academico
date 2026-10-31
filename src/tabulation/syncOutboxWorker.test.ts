import { describe, expect, it } from 'vitest';
import { createSyncOutbox, type PendingSyncOperation, type SyncOutboxRepository } from './syncOutbox';
import { createSyncOutboxWorker } from './syncOutboxWorker';

class MemoryRepository implements SyncOutboxRepository {
  rows = new Map<string, PendingSyncOperation>();
  async insert(row: PendingSyncOperation) {
    const existing = this.rows.get(row.operationId);
    if (existing) return structuredClone(existing);
    this.rows.set(row.operationId, structuredClone(row));
    return null;
  }
  async list(tournamentId: string) {
    return [...this.rows.values()].filter((row) => row.tournamentId === tournamentId)
      .sort((a, b) => a.createdAt - b.createdAt || a.operationId.localeCompare(b.operationId))
      .map((row) => structuredClone(row));
  }
  async claimNext(tournamentId: string, workerId: string, now: number, leaseMs: number) {
    const oldest = [...this.rows.values()].filter((row) => row.tournamentId === tournamentId)
      .sort((a, b) => a.createdAt - b.createdAt || a.operationId.localeCompare(b.operationId))[0];
    if (!oldest || oldest.status !== 'pending' || (oldest.nextAttemptAt ?? 0) > now) return null;
    const claimed = { ...oldest, status: 'sending' as const, attempts: oldest.attempts + 1, lastAttemptAt: now, workerId, leaseUntil: now + leaseMs };
    this.rows.set(claimed.operationId, claimed);
    return structuredClone(claimed);
  }
  async transition(id: string, workerId: string, status: 'pending' | 'conflict' | 'failed', error?: { code: string; message: string }, nextAttemptAt?: number) {
    const row = this.rows.get(id);
    if (!row || row.status !== 'sending' || row.workerId !== workerId) return false;
    this.rows.set(id, { ...row, status, lastError: error, workerId: undefined, leaseUntil: undefined, nextAttemptAt: status === 'pending' ? nextAttemptAt : undefined });
    return true;
  }
  async acknowledge(id: string, workerId: string) {
    const row = this.rows.get(id);
    if (!row || row.status !== 'sending' || row.workerId !== workerId) return false;
    this.rows.delete(id);
    return true;
  }
  async recoverExpired(now: number) {
    let count = 0;
    for (const [id, row] of this.rows) {
      if (row.status === 'sending' && (row.leaseUntil ?? 0) <= now) {
        this.rows.set(id, { ...row, status: 'pending', workerId: undefined, leaseUntil: undefined, nextAttemptAt: now + 2_000 });
        count++;
      }
    }
    return count;
  }
}

describe('automatic sync worker', () => {
  it('keeps ambiguous failures pending and retries the same operation only after backoff', async () => {
    const repository = new MemoryRepository();
    let now = 100;
    const outbox = createSyncOutbox(repository, { now: () => now, random: () => 0.5, createOperationId: () => 'stable-round-op' });
    const queued = await outbox.enqueue({
      tournamentId: 'tournament-1', entityType: 'round', entityId: 'round-1',
      operation: 'publish-round', baseRevision: 4, payload: { roundNumber: 2 },
    });
    let sends = 0;
    const worker = createSyncOutboxWorker({
      outbox, tournamentId: 'tournament-1', workerId: 'worker-tab-1',
      dispatch: async (operation) => {
        sends++;
        expect(operation.operationId).toBe(queued.operation.operationId);
        return sends === 1
          ? { status: 'retry', error: { code: 'NETWORK_ERROR', message: 'Timeout ambiguo' } }
          : { status: 'acknowledged' };
      },
      now: () => now,
    });

    await worker.runOnce();
    expect(sends).toBe(1);
    expect((await outbox.list('tournament-1'))[0]).toMatchObject({ status: 'pending', operationId: 'stable-round-op', nextAttemptAt: 2_100 });

    now = 2_099;
    await worker.runOnce();
    expect(sends).toBe(1);

    now = 2_100;
    await worker.runOnce();
    expect(sends).toBe(2);
    expect(await outbox.list('tournament-1')).toEqual([]);
    worker.stop();
  });

  it('uses the atomic claim as a cross-tab single-worker lease', async () => {
    const repository = new MemoryRepository();
    const outbox = createSyncOutbox(repository, { now: () => 700, createOperationId: () => 'single-claim' });
    await outbox.enqueue({ tournamentId: 't', entityType: 'round', entityId: 'r1', operation: 'publish-round', baseRevision: 1, payload: {} });
    let sends = 0;
    const dispatch = async () => { sends++; await Promise.resolve(); return { status: 'acknowledged' as const }; };
    const first = createSyncOutboxWorker({ outbox, tournamentId: 't', workerId: 'tab-a', dispatch });
    const second = createSyncOutboxWorker({ outbox, tournamentId: 't', workerId: 'tab-b', dispatch });
    await Promise.all([first.runOnce(), second.runOnce()]);
    expect(sends).toBe(1);
    expect(await outbox.list('t')).toEqual([]);
    first.stop();
    second.stop();
  });

  it('stops the dependent queue on a revision conflict without deleting the operation', async () => {
    const repository = new MemoryRepository();
    let id = 0;
    const outbox = createSyncOutbox(repository, { now: () => 500, createOperationId: () => 'op-' + ++id });
    const first = await outbox.enqueue({ tournamentId: 't', entityType: 'round', entityId: 'r1', operation: 'publish-round', baseRevision: 1, payload: {} });
    await outbox.enqueue({ tournamentId: 't', entityType: 'acta', entityId: 'a1', operation: 'replace-acta', baseRevision: 1, payload: {} });
    const worker = createSyncOutboxWorker({
      outbox, tournamentId: 't', workerId: 'worker',
      dispatch: async () => ({ status: 'conflict', error: { code: 'REVISION_CONFLICT', message: 'La revisión remota cambió.' } }),
    });
    await worker.runOnce();
    expect((await outbox.list('t')).map((row) => row.status)).toEqual(['conflict', 'pending']);
    expect((await outbox.list('t'))[0].operationId).toBe(first.operation.operationId);
    worker.stop();
  });
});
