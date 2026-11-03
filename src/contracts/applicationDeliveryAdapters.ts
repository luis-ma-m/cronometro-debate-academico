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

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).sort().map((key) => JSON.stringify(key) + ':' + canonicalJson(record[key])).join(',') + '}';
  }
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string') throw new Error('El payload no admite una identidad de entrega estable.');
  return serialized;
}

function stableDeliveryId(kind: string, payload: unknown): string {
  const source = kind + ':' + canonicalJson(payload);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + index), 0x85ebca6b);
  }
  const fingerprint = (first >>> 0).toString(16).padStart(8, '0') + (second >>> 0).toString(16).padStart(8, '0');
  return kind + ':' + fingerprint;
}

export async function enqueuePanelHandoff(
  handoff: PanelHandoff,
  queue = getApplicationDeliveryQueue(),
): Promise<ApplicationDelivery<PanelHandoff>> {
  return queue.enqueue({
    deliveryId: stableDeliveryId(PANEL_HANDOFF_DELIVERY, handoff), source: 'manager', target: 'tabulation',
    kind: PANEL_HANDOFF_DELIVERY, createdAt: handoff.createdAt, payload: handoff,
  });
}

export async function enqueuePanelOutbox(
  outbox: PanelOutbox,
  queue = getApplicationDeliveryQueue(),
): Promise<ApplicationDelivery<PanelOutbox>> {
  const input = {
    deliveryId: stableDeliveryId(PANEL_OUTBOX_DELIVERY, {
      tabTournamentId: outbox.tabTournamentId,
      tabulationRoundId: outbox.tabulationRoundId,
    }),
    source: 'tabulation' as const,
    target: 'manager' as const,
    kind: PANEL_OUTBOX_DELIVERY,
    createdAt: outbox.createdAt,
    payload: outbox,
  };

  // Upgrade an older fingerprinted pending proposal for this round in place.
  const pending = (await queue.list<unknown>('manager'))
    .filter((item) => item.kind === PANEL_OUTBOX_DELIVERY && item.status === 'pending')
    .reverse();
  for (const item of pending) {
    const previous = parsePanelOutbox(item.payload);
    if (previous?.tabTournamentId !== outbox.tabTournamentId
      || previous.tabulationRoundId !== outbox.tabulationRoundId) continue;
    const replaced = await queue.replacePending(item.deliveryId, { ...input, deliveryId: item.deliveryId });
    if (replaced) return replaced as ApplicationDelivery<PanelOutbox>;
  }

  try {
    return await queue.enqueue(input);
  } catch (error) {
    // A concurrent first enqueue may have won the stable round key. Replace it
    // only while pending; if a reviewer already claimed it, preserve it and
    // append a separate proposal for the newer snapshot.
    const replaced = await queue.replacePending(input.deliveryId, input);
    if (replaced) return replaced;
    return queue.enqueue({ ...input, deliveryId: stableDeliveryId(PANEL_OUTBOX_DELIVERY, outbox) });
  }
}

export async function enqueuePanelPublishAck(
  acknowledgement: PanelPublishAcknowledgement,
  queue = getApplicationDeliveryQueue(),
): Promise<ApplicationDelivery<PanelPublishAcknowledgement>> {
  return queue.enqueue({
    deliveryId: acknowledgement.operationId, source: 'manager', target: 'tabulation',
    kind: PANEL_PUBLISH_ACK_DELIVERY, createdAt: acknowledgement.updatedAt ?? acknowledgement.revision, payload: acknowledgement,
  });
}

export async function claimPanelHandoff(
  consumer: string,
  queue = getApplicationDeliveryQueue(),
): Promise<ApplicationDelivery<PanelHandoff> | null> {
  const delivery = await queue.claimNext<unknown>({
    consumer, target: 'tabulation', kind: PANEL_HANDOFF_DELIVERY, now: Date.now(), leaseMs: APPLICATION_DELIVERY_LEASE_MS,
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
    consumer, target: 'manager', kind: PANEL_OUTBOX_DELIVERY, now: Date.now(), leaseMs: APPLICATION_DELIVERY_LEASE_MS,
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
    consumer, target: 'tabulation', kind: PANEL_PUBLISH_ACK_DELIVERY, now: Date.now(), leaseMs: APPLICATION_DELIVERY_LEASE_MS,
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


export async function acknowledgeApplicationDelivery(
  deliveryId: string,
  consumer: string,
  queue = getApplicationDeliveryQueue(),
): Promise<boolean> {
  const now = Date.now();
  const current = await queue.get(deliveryId);
  if (!current || current.status === 'acked') return false;
  const owned = current.status === 'claimed' && current.leaseOwner === consumer && (current.leaseUntil ?? 0) > now;
  if (!owned && !await queue.claim(deliveryId, consumer, now, APPLICATION_DELIVERY_LEASE_MS)) return false;
  return queue.acknowledge(deliveryId, consumer, Date.now());
}

export async function releaseApplicationDelivery(
  deliveryId: string,
  consumer: string,
  queue = getApplicationDeliveryQueue(),
): Promise<boolean> {
  return queue.release(deliveryId, consumer);
}
