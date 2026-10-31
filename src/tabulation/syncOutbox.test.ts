import { describe, expect, it } from 'vitest';
import { createSyncPayloadHash as createServerSyncPayloadHash } from '../../api/sync-operation-validation.js';
import {
  createSyncOutbox, hashSyncPayload, serializeSyncPayload,
  type PendingSyncOperation, type SyncOutboxRepository,
} from './syncOutbox';

class MemoryOutboxRepository implements SyncOutboxRepository {
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
    const oldest = (await this.list(tournamentId))[0];
    if (!oldest || oldest.status !== 'pending' || (oldest.nextAttemptAt ?? 0) > now) return null;
    const claimed: PendingSyncOperation = {
      ...oldest, status: 'sending', attempts: oldest.attempts + 1,
      workerId, lastAttemptAt: now, leaseUntil: now + leaseMs,
    };
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
    let recovered = 0;
    for (const [id, row] of this.rows) {
      if (row.status === 'sending' && (row.leaseUntil ?? 0) <= now) {
        this.rows.set(id, { ...row, status: 'pending', workerId: undefined, leaseUntil: undefined, nextAttemptAt: now + 2_000 });
        recovered++;
      }
    }
    return recovered;
  }
}

describe('durable sync outbox contract', () => {
  it('serializes object keys deterministically and hashes equivalent payloads equally', async () => {
    expect(serializeSyncPayload({ z: 1, a: { y: 2, x: 3 } })).toBe('{"a":{"x":3,"y":2},"z":1}');
    expect(await hashSyncPayload({ b: 2, a: 1 })).toBe(await hashSyncPayload({ a: 1, b: 2 }));
  });

  it('stores a revisioned, hashed operation envelope before any network action', async () => {
    const repository = new MemoryOutboxRepository();
    const outbox = createSyncOutbox(repository, { now: () => 100, createOperationId: () => 'op-1' });
    const result = await outbox.enqueue({
      tournamentId: 'tournament-uuid', entityType: 'round', entityId: 'round-1',
      operation: 'publish-round', baseRevision: 7, payload: { assignments: [{ teamIds: ['a', 'b'] }] },
    });
    expect(result.duplicate).toBe(false);
    expect(result.operation).toMatchObject({ operationId: 'op-1', status: 'pending', attempts: 0, createdAt: 100, baseRevision: 7 });
    expect(result.operation.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await outbox.list('tournament-uuid')).toHaveLength(1);
  });

  it('rejects reuse of an operation id with a different payload', async () => {
    const repository = new MemoryOutboxRepository();
    const outbox = createSyncOutbox(repository, { createOperationId: () => 'same-id' });
    const input = { tournamentId: 't', entityType: 'settings', entityId: 'settings', operation: 'settings' as const, baseRevision: 1 };
    await outbox.enqueue({ ...input, payload: { version: 1 } });
    await expect(outbox.enqueue({ ...input, payload: { version: 2 } })).rejects.toThrow('IDEMPOTENCY_MISMATCH');
  });

  it('serializes operations FIFO per tournament and blocks dependent operations on conflict', async () => {
    const repository = new MemoryOutboxRepository();
    let id = 0;
    const outbox = createSyncOutbox(repository, { now: () => 200, createOperationId: () => 'op-' + ++id });
    const first = await outbox.enqueue({ tournamentId: 't1', entityType: 'round', entityId: 'r1', operation: 'publish-round', baseRevision: 1, payload: {} });
    await outbox.enqueue({ tournamentId: 't1', entityType: 'acta', entityId: 'a1', operation: 'replace-acta', baseRevision: 1, payload: {} });
    const claimed = await outbox.claimNext('t1', 'worker-a');
    expect(claimed?.operationId).toBe(first.operation.operationId);
    expect(await outbox.claimNext('t1', 'worker-b')).toBeNull();
    expect(await outbox.markConflict(first.operation.operationId, 'worker-a', { code: 'REVISION_CONFLICT', message: 'Cambió el gestor.' })).toBe(true);
    expect(await outbox.claimNext('t1', 'worker-a')).toBeNull();
    expect((await outbox.list('t1')).map((row) => row.status)).toEqual(['conflict', 'pending']);
  });

  it('retries with the same operation id and deletes only after confirmed acknowledgement', async () => {
    const repository = new MemoryOutboxRepository();
    let now = 300;
    const outbox = createSyncOutbox(repository, { now: () => now, random: () => 0.5, createOperationId: () => 'stable-op' });
    const { operation } = await outbox.enqueue({ tournamentId: 't1', entityType: 'settings', entityId: 'settings', operation: 'settings', baseRevision: 2, payload: { rules: 1 } });
    const claimed = await outbox.claimNext('t1', 'worker');
    expect(claimed?.operationId).toBe(operation.operationId);
    expect(await outbox.retry(operation.operationId, 'wrong-worker')).toBe(false);
    expect(await outbox.retry(operation.operationId, 'worker', { code: 'NETWORK', message: 'Timeout ambiguo.' })).toBe(true);
    expect((await outbox.list('t1'))[0]).toMatchObject({ operationId: 'stable-op', status: 'pending', attempts: 1, nextAttemptAt: 2_300 });
    expect(await outbox.claimNext('t1', 'worker')).toBeNull();
    now = 2_300;
    expect((await outbox.claimNext('t1', 'worker'))?.operationId).toBe('stable-op');
    expect(await outbox.acknowledge('stable-op', 'worker')).toBe(true);
    expect(await outbox.list('t1')).toEqual([]);
  });

  it('recovers expired leases but does not steal a live worker operation', async () => {
    const repository = new MemoryOutboxRepository();
    let now = 1000;
    const outbox = createSyncOutbox(repository, { now: () => now, leaseMs: 100, createOperationId: () => 'op' });
    await outbox.enqueue({ tournamentId: 't1', entityType: 'round', entityId: 'r1', operation: 'publish-round', baseRevision: 0, payload: {} });
    await outbox.claimNext('t1', 'worker');
    expect(await outbox.recoverExpiredLeases()).toBe(0);
    now = 1100;
    expect(await outbox.recoverExpiredLeases()).toBe(1);
    expect((await outbox.list('t1'))[0]).toMatchObject({ status: 'pending' });
    expect((await outbox.list('t1'))[0].nextAttemptAt).toBeGreaterThan(1_100);
  });

  it('honors Retry-After even when it exceeds the exponential delay', async () => {
    const repository = new MemoryOutboxRepository();
    const outbox = createSyncOutbox(repository, { now: () => 1_000, random: () => 0.5, createOperationId: () => 'retry-after-op' });
    await outbox.enqueue({ tournamentId: 't1', entityType: 'round', entityId: 'r1', operation: 'publish-round', baseRevision: 0, payload: {} });
    const claimed = await outbox.claimNext('t1', 'worker');
    await outbox.retry('retry-after-op', 'worker', { code: 'RATE_LIMITED', message: 'Espera' }, claimed?.attempts, 8_000);
    expect((await outbox.list('t1'))[0].nextAttemptAt).toBe(9_000);
  });

  it('rejects invalid revisions and unserializable or oversized payloads', async () => {
    const outbox = createSyncOutbox(new MemoryOutboxRepository());
    await expect(outbox.enqueue({ tournamentId: 't', entityType: 'round', entityId: 'r', operation: 'publish-round', baseRevision: -1, payload: {} })).rejects.toThrow('revisión base');
    expect(() => serializeSyncPayload({ bad: undefined })).toThrow('no serializable');
    expect(() => serializeSyncPayload({ text: 'x'.repeat(1_048_577) })).toThrow('1 MB');
  });

  it('produces the same payload hash in browser and server implementations', async () => {
    const payload = JSON.parse('{"__proto__":{"x":1},"nested":{"b":2,"a":1}}') as Record<string, unknown>;
    expect(await hashSyncPayload(payload)).toBe(createServerSyncPayloadHash(payload));
  });

  it('preserves special object keys identically to the server canonicalizer', () => {
    const payload = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"safe":1}') as Record<string, unknown>;
    expect(serializeSyncPayload(payload)).toBe('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"safe":1}');
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('rejects values that JSON.stringify would silently coerce or discard', () => {
    expect(() => serializeSyncPayload({ date: new Date('2026-01-01T00:00:00Z') })).toThrow('objetos JSON planos');
    expect(() => serializeSyncPayload({ map: new Map([['a', 1]]) })).toThrow('objetos JSON planos');
    expect(() => serializeSyncPayload({ value: Number.NaN })).toThrow('número no finito');
    expect(() => serializeSyncPayload({ value: Infinity })).toThrow('número no finito');
    expect(() => serializeSyncPayload({ value: undefined })).toThrow('no serializable');
    expect(() => serializeSyncPayload([, 'value'])).toThrow('array disperso');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => serializeSyncPayload(circular)).toThrow('referencia circular');
  });
});
