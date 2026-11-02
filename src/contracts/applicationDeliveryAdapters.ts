import {
  createIndexedDbApplicationDeliveryQueue,
  type ApplicationDelivery,
  type ApplicationDeliveryQueue,
} from './applicationDeliveryQueue';
import {
  parsePanelHandoff,
  parsePanelOutbox,
  type PanelHandoff,
  type PanelOutbox,
  type PanelPublishAcknowledgement,
} from '../tabulation/panelBridge';

export const PANEL_HANDOFF_DELIVERY = 'panel-handoff';
export const PANEL_OUTBOX_DELIVERY = 'panel-round-proposal';
export const PANEL_PUBLISH_ACK_DELIVERY = 'panel-round-published';
export const APPLICATION_DELIVERY_LEASE_MS = 120_000;

let browserQueue: ApplicationDeliveryQueue | null = null;

export function getApplicationDeliveryQueue(): ApplicationDeliveryQueue {
  if (!browserQueue) browserQueue = createIndexedDbApplicationDeliveryQueue();
  return browserQueue;
}

export function createDeliveryConsumerId(module: 'manager' | 'tabulation'): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) throw new Error('El navegador no ofrece aleatoriedad criptográfica para identificar al consumidor.');
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  return module + ':' + Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function createDeliveryId(): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) throw new Error('El navegador no ofrece aleatoriedad criptográfica para identificar la entrega.');
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function enqueuePanelHandoff(
  handoff: PanelHandoff,
  queue = getApplicationDeliveryQueue(),
): Promise<ApplicationDelivery<PanelHandoff>> {
  return queue.enqueue({
    deliveryId: createDeliveryId(), source: 'manager', target: 'tabulation',
    kind: PANEL_HANDOFF_DELIVERY, createdAt: Date.now(), payload: handoff,
  });
}

export async function enqueuePanelOutbox(
  outbox: PanelOutbox,
  queue = getApplicationDeliveryQueue(),
): Promise<ApplicationDelivery<PanelOutbox>> {
  return queue.enqueue({
    deliveryId: createDeliveryId(), source: 'tabulation', target: 'manager',
    kind: PANEL_OUTBOX_DELIVERY, createdAt: Date.now(), payload: outbox,
  });
}

export async function enqueuePanelPublishAck(
  acknowledgement: PanelPublishAcknowledgement,
  queue = getApplicationDeliveryQueue(),
): Promise<ApplicationDelivery<PanelPublishAcknowledgement>> {
  return queue.enqueue({
    deliveryId: acknowledgement.operationId, source: 'manager', target: 'tabulation',
    kind: PANEL_PUBLISH_ACK_DELIVERY, createdAt: Date.now(), payload: acknowledgement,
  });
}

export async function claimPanelHandoff(
  consumer: string,
  queue = getApplicationDeliveryQueue(),
): Promise<ApplicationDelivery<PanelHandoff> | null> {
  const delivery = await queue.claimNext<unknown>({
    consumer, target: 'tabulation', now: Date.now(), leaseMs: APPLICATION_DELIVERY_LEASE_MS,
  });
  if (!delivery) return null;
  if (delivery.kind !== PANEL_HANDOFF_DELIVERY) {
    await queue.release(delivery.deliveryId, consumer);
    return null;
  }
  const handoff = parsePanelHandoff(delivery.payload);
  if (!handoff) {
    await queue.release(delivery.deliveryId, consumer);
    throw new Error('La entrega de participantes está dañada o no cumple el contrato esperado.');
  }
  return { ...delivery, payload: handoff };
}

export async function claimPanelOutbox(
  consumer: string,
  queue = getApplicationDeliveryQueue(),
): Promise<ApplicationDelivery<PanelOutbox> | null> {
  const delivery = await queue.claimNext<unknown>({
    consumer, target: 'manager', now: Date.now(), leaseMs: APPLICATION_DELIVERY_LEASE_MS,
  });
  if (!delivery) return null;
  if (delivery.kind !== PANEL_OUTBOX_DELIVERY) {
    await queue.release(delivery.deliveryId, consumer);
    return null;
  }
  const outbox = parsePanelOutbox(delivery.payload);
  if (!outbox) {
    await queue.release(delivery.deliveryId, consumer);
    throw new Error('La propuesta de ronda está dañada o no cumple el contrato esperado.');
  }
  return { ...delivery, payload: outbox };
}

export function parsePanelPublishAck(value: unknown): PanelPublishAcknowledgement | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (item.version !== 1 || typeof item.operationId !== 'string' || !item.operationId.trim()
    || typeof item.tabTournamentId !== 'string' || !item.tabTournamentId.trim()
    || typeof item.tabulationRoundId !== 'string' || !item.tabulationRoundId.trim()
    || typeof item.managerRoundId !== 'string' || !item.managerRoundId.trim()
    || !Number.isSafeInteger(item.revision) || (item.revision as number) < 1
    || (item.updatedAt !== undefined && (!Number.isSafeInteger(item.updatedAt) || (item.updatedAt as number) < 0))
    || !Array.isArray(item.debateAssignments)) return null;
  const seen = new Set<string>();
  const assignments: PanelPublishAcknowledgement['debateAssignments'] = [];
  for (const raw of item.debateAssignments) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const mapping = raw as Record<string, unknown>;
    if (typeof mapping.tabulationDebateId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(mapping.tabulationDebateId)
      || seen.has(mapping.tabulationDebateId) || typeof mapping.assignmentId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(mapping.assignmentId)) return null;
    seen.add(mapping.tabulationDebateId);
    assignments.push({ tabulationDebateId: mapping.tabulationDebateId, assignmentId: mapping.assignmentId });
  }
  return {
    version: 1, operationId: item.operationId, tabTournamentId: item.tabTournamentId,
    tabulationRoundId: item.tabulationRoundId, managerRoundId: item.managerRoundId,
    revision: item.revision as number,
    ...(typeof item.updatedAt === 'number' ? { updatedAt: item.updatedAt } : {}),
    debateAssignments: assignments,
  };
}

export async function claimPanelPublishAck(
  consumer: string,
  queue = getApplicationDeliveryQueue(),
): Promise<ApplicationDelivery<PanelPublishAcknowledgement> | null> {
  const delivery = await queue.claimNext<unknown>({
    consumer, target: 'tabulation', now: Date.now(), leaseMs: APPLICATION_DELIVERY_LEASE_MS,
  });
  if (!delivery) return null;
  if (delivery.kind !== PANEL_PUBLISH_ACK_DELIVERY) {
    await queue.release(delivery.deliveryId, consumer);
    return null;
  }
  const acknowledgement = parsePanelPublishAck(delivery.payload);
  if (!acknowledgement || acknowledgement.operationId !== delivery.deliveryId) {
    await queue.release(delivery.deliveryId, consumer);
    throw new Error('El ACK de publicación no cumple el contrato esperado.');
  }
  return { ...delivery, payload: acknowledgement };
}
