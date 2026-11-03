import { describe, expect, it } from 'vitest';
import { createMemoryApplicationDeliveryQueue } from './applicationDeliveryQueue';
import { enqueuePanelHandoff, enqueuePanelOutbox, enqueuePanelPublishAck } from './applicationDeliveryAdapters';
import type { PanelHandoff, PanelOutbox, PanelPublishAcknowledgement } from '../tabulation/panelBridge';

const handoff: PanelHandoff = {
  format: 'ledu-tabulacion-handoff', version: 1, createdAt: 100,
  tournamentId: 'tournament-1', revision: 4, updatedAt: 100,
  tournamentName: 'Torneo de prueba', teams: [], speakers: [], judges: [], venues: [],
};

const outbox: PanelOutbox = {
  format: 'ledu-tabulacion-outbox', version: 1, tabTournamentId: 'tab-1',
  tabulationRoundId: 'round-1', createdAt: 200, tournamentId: 'tournament-1',
  tabTournamentName: 'Torneo de prueba', panelTournamentName: 'Torneo de prueba',
  roundName: 'Ronda 1', roundNumber: 1, roundKind: 'qualifying', sideMode: 'draw',
  teamMetadata: [], entityIdMap: { teams: {}, speakers: {}, judges: {}, venues: {} }, debates: [],
};

const acknowledgement: PanelPublishAcknowledgement = {
  version: 1, operationId: 'publish-operation-1', tabTournamentId: 'tab-1',
  tabulationRoundId: 'round-1', managerRoundId: 'manager-round-1',
  revision: 5, updatedAt: 300, debateAssignments: [],
};

describe('application delivery adapters', () => {
  it('uses deterministic IDs for repeated participant handoffs', async () => {
    const queue = createMemoryApplicationDeliveryQueue();
    const [first, second] = await Promise.all([
      enqueuePanelHandoff(handoff, queue),
      enqueuePanelHandoff(handoff, queue),
    ]);
    expect(second.deliveryId).toBe(first.deliveryId);
    expect(await queue.list('tabulation')).toHaveLength(1);
  });

  it('uses deterministic IDs for repeated round proposals', async () => {
    const queue = createMemoryApplicationDeliveryQueue();
    const [first, second] = await Promise.all([
      enqueuePanelOutbox(outbox, queue),
      enqueuePanelOutbox(outbox, queue),
    ]);
    expect(second.deliveryId).toBe(first.deliveryId);
    expect(await queue.list('manager')).toHaveLength(1);
  });

  it('uses the server operation ID for idempotent publication ACKs', async () => {
    const queue = createMemoryApplicationDeliveryQueue();
    const [first, second] = await Promise.all([
      enqueuePanelPublishAck(acknowledgement, queue),
      enqueuePanelPublishAck(acknowledgement, queue),
    ]);
    expect(first.deliveryId).toBe('publish-operation-1');
    expect(second).toEqual(first);
    expect(await queue.list('tabulation')).toHaveLength(1);
  });

  it('coalesces newer edits into one pending proposal for the same round', async () => {
    const queue = createMemoryApplicationDeliveryQueue();
    const first = await enqueuePanelOutbox(outbox, queue);
    const latestOutbox = { ...outbox, createdAt: 250, roundName: 'Ronda 1 revisada' };
    const latest = await enqueuePanelOutbox(latestOutbox, queue);

    expect(latest.deliveryId).toBe(first.deliveryId);
    expect(latest.payload.roundName).toBe('Ronda 1 revisada');
    expect(latest.createdAt).toBe(250);
    expect(await queue.list('manager')).toHaveLength(1);
  });

  it('keeps a proposal already claimed by a reviewer and queues the newer edit separately', async () => {
    const queue = createMemoryApplicationDeliveryQueue();
    const first = await enqueuePanelOutbox(outbox, queue);
    const claimed = await queue.claimNext({
      consumer: 'manager-reviewer', target: 'manager', kind: 'panel-round-proposal', now: 210, leaseMs: 5_000,
    });
    expect(claimed?.deliveryId).toBe(first.deliveryId);

    const latest = await enqueuePanelOutbox({ ...outbox, createdAt: 250, roundName: 'Ronda 1 revisada' }, queue);
    expect(latest.deliveryId).not.toBe(first.deliveryId);
    expect(latest.status).toBe('pending');
    expect(await queue.get(first.deliveryId)).toMatchObject({ status: 'claimed', leaseOwner: 'manager-reviewer' });
    expect(await queue.list('manager')).toHaveLength(2);
  });
});
