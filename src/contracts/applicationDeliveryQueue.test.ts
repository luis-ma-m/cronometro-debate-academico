import { describe, expect, it } from 'vitest';
import { ApplicationPersistenceError } from './applicationPersistence';
import { createMemoryApplicationDeliveryQueue } from './applicationDeliveryQueue';

const delivery = (deliveryId: string, createdAt = 10) => ({
  deliveryId, source: 'manager' as const, target: 'tabulation' as const,
  kind: 'participant-handoff', createdAt, payload: { tournamentId: 't-1', teams: [{ id: 'team-1' }] },
});

describe('application delivery queue', () => {
  it('stores multiple independent deliveries in creation order', async () => {
    const queue = createMemoryApplicationDeliveryQueue();
    await queue.enqueue(delivery('delivery-b', 20));
    await queue.enqueue(delivery('delivery-a', 10));
    expect((await queue.list('tabulation')).map(item => item.deliveryId)).toEqual(['delivery-a', 'delivery-b']);
  });

  it('makes enqueue idempotent for the same ID and payload', async () => {
    const queue = createMemoryApplicationDeliveryQueue();
    const first = await queue.enqueue(delivery('delivery-1'));
    const second = await queue.enqueue(delivery('delivery-1'));
    expect(second).toEqual(first);
    await expect(queue.enqueue({ ...delivery('delivery-1'), payload: { tournamentId: 'other' } }))
      .rejects.toBeInstanceOf(ApplicationPersistenceError);
  });

  it('claims once, rejects another consumer, and acknowledges only by the lease owner', async () => {
    const queue = createMemoryApplicationDeliveryQueue();
    await queue.enqueue(delivery('delivery-1'));
    const claimed = await queue.claimNext({ consumer: 'tabulation-tab-1', now: 100, leaseMs: 5000 });
    expect(claimed).toMatchObject({ status: 'claimed', attempts: 1, leaseOwner: 'tabulation-tab-1', leaseUntil: 5100 });
    expect(await queue.claimNext({ consumer: 'tabulation-tab-2', now: 101, leaseMs: 5000 })).toBeNull();
    expect(await queue.acknowledge('delivery-1', 'tabulation-tab-2', 102)).toBe(false);
    expect(await queue.acknowledge('delivery-1', 'tabulation-tab-1', 103)).toBe(true);
    expect(await queue.acknowledge('delivery-1', 'tabulation-tab-1', 104)).toBe(false);
    expect(await queue.get('delivery-1')).toMatchObject({ status: 'acked', ackedAt: 103, attempts: 1 });
  });

  it('recovers an expired claim with the same delivery identity', async () => {
    const queue = createMemoryApplicationDeliveryQueue();
    await queue.enqueue(delivery('delivery-1'));
    await queue.claimNext({ consumer: 'tab-1', now: 100, leaseMs: 50 });
    const recovered = await queue.claimNext({ consumer: 'tab-2', now: 150, leaseMs: 50 });
    expect(recovered).toMatchObject({ deliveryId: 'delivery-1', status: 'claimed', attempts: 2, leaseOwner: 'tab-2' });
    expect(await queue.acknowledge('delivery-1', 'tab-1', 151)).toBe(false);
    expect(await queue.acknowledge('delivery-1', 'tab-2', 152)).toBe(true);
  });

  it('allows the current lease owner to release for retry', async () => {
    const queue = createMemoryApplicationDeliveryQueue();
    await queue.enqueue(delivery('delivery-1'));
    await queue.claimNext({ consumer: 'tab-1', now: 100, leaseMs: 500 });
    expect(await queue.release('delivery-1', 'wrong-tab')).toBe(false);
    expect(await queue.release('delivery-1', 'tab-1')).toBe(true);
    expect(await queue.get('delivery-1')).toMatchObject({ status: 'pending', attempts: 1 });
    expect(await queue.claimNext({ consumer: 'tab-2', now: 101, leaseMs: 500 })).toMatchObject({ attempts: 2 });
  });

  it('validates payloads, endpoints, lease duration, and identifiers', async () => {
    const queue = createMemoryApplicationDeliveryQueue();
    await expect(queue.enqueue({ ...delivery(' ')})).rejects.toBeInstanceOf(ApplicationPersistenceError);
    await expect(queue.enqueue({ ...delivery('same'), source: 'manager', target: 'manager' } as never))
      .rejects.toBeInstanceOf(ApplicationPersistenceError);
    await expect(queue.enqueue({ ...delivery('undefined'), payload: undefined })).rejects.toBeInstanceOf(ApplicationPersistenceError);
    await expect(queue.claimNext({ consumer: 'tab', now: 0, leaseMs: 0 })).rejects.toBeInstanceOf(ApplicationPersistenceError);
  });
});
