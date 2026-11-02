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
});
