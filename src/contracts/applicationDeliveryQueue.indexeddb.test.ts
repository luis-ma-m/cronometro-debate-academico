import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createIndexedDbApplicationDeliveryQueue } from './applicationDeliveryQueue';

const input = {
  deliveryId: 'indexeddb-delivery-1',
  source: 'manager' as const,
  target: 'tabulation' as const,
  kind: 'participant-handoff',
  createdAt: 10,
  payload: { tournamentId: 'tournament-1', teams: [{ id: 'team-1' }] },
};

describe('IndexedDB application delivery queue', () => {
  it('persists deliveries across independent queue instances and serializes competing claims', async () => {
    const factory = new IDBFactory();
    const firstTab = createIndexedDbApplicationDeliveryQueue(factory);
    const secondTab = createIndexedDbApplicationDeliveryQueue(factory);

    await firstTab.enqueue(input);

    const [firstClaim, secondClaim] = await Promise.all([
      firstTab.claimNext({ consumer: 'tab-1', target: 'tabulation', now: 100, leaseMs: 5_000 }),
      secondTab.claimNext({ consumer: 'tab-2', target: 'tabulation', now: 100, leaseMs: 5_000 }),
    ]);

    expect([firstClaim, secondClaim].filter(Boolean)).toHaveLength(1);
    const claim = firstClaim ?? secondClaim;
    expect(claim).toMatchObject({ deliveryId: input.deliveryId, status: 'claimed', attempts: 1 });
    const owner = claim!.leaseOwner!;
    const ownerQueue = owner === 'tab-1' ? firstTab : secondTab;
    const otherQueue = owner === 'tab-1' ? secondTab : firstTab;

    expect(await otherQueue.acknowledge(input.deliveryId, owner === 'tab-1' ? 'tab-2' : 'tab-1', 200)).toBe(false);
    expect(await ownerQueue.acknowledge(input.deliveryId, owner, 200)).toBe(true);

    const reopened = createIndexedDbApplicationDeliveryQueue(factory);
    expect(await reopened.get(input.deliveryId)).toMatchObject({
      deliveryId: input.deliveryId,
      status: 'acked',
      attempts: 1,
      ackedAt: 200,
    });
  });

  it('allows another tab to reclaim an expired lease without losing the delivery', async () => {
    const factory = new IDBFactory();
    const firstTab = createIndexedDbApplicationDeliveryQueue(factory);
    const secondTab = createIndexedDbApplicationDeliveryQueue(factory);

    await firstTab.enqueue(input);
    const original = await firstTab.claimNext({
      consumer: 'tab-1', target: 'tabulation', now: 100, leaseMs: 1_000,
    });
    expect(original?.leaseUntil).toBe(1_100);

    const recovered = await secondTab.claim(input.deliveryId, 'tab-2', 1_101, 1_000);
    expect(recovered).toMatchObject({
      deliveryId: input.deliveryId,
      status: 'claimed',
      attempts: 2,
      leaseOwner: 'tab-2',
      leaseUntil: 2_101,
    });
    expect(await firstTab.acknowledge(input.deliveryId, 'tab-1', 1_102)).toBe(false);
    expect(await secondTab.acknowledge(input.deliveryId, 'tab-2', 1_102)).toBe(true);
  });
});
