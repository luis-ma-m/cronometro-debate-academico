import { createHash } from "node:crypto";

export type SyncOperationKind = "upsert" | "publish-round" | "replace-acta" | "settings";

export interface ValidatedSyncOperation {
  protocolVersion: 1;
  operationId: string;
  tournamentId: string;
  entityType: string;
  entityId: string;
  operation: SyncOperationKind;
  baseRevision: number;
  payload: Record<string, unknown>;
  payloadHash: string;
}

const MAX_PAYLOAD_BYTES = 1024 * 1024;
const OPERATION_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENTITY_TYPE_PATTERN = /^[a-z][a-zA-Z0-9_-]{0,63}$/;

function invalid(message: string): never {
  throw new Error(message);
}

/** Canonical JSON shared with the browser outbox: sorted object keys, no lossy coercions. */
export function canonicalSyncPayload(value: unknown, ancestors = new Set<object>()): string {
  const normalize = (item: unknown): unknown => {
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) invalid("El payload contiene un número no finito.");
      return item;
    }
    if (typeof item !== "object") invalid("El payload contiene un valor que no pertenece a JSON.");
    if (ancestors.has(item)) invalid("El payload contiene una referencia circular.");
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        const keys = Reflect.ownKeys(item);
        if (keys.some((key) => typeof key === "symbol" || (key !== "length" && (!/^\d+$/.test(key)test(key) || Number(key) >= item.length)))) {
          invalid("El payload contiene propiedades de array no serializables.");
        }
        const result: unknown[] = [];
        for (let index = 0; index < item.length; index++) {
          if (!Object.prototype.hasOwnProperty.call(item, index)) invalid("El payload contiene un array disperso.");
          result.push(normalize(item[index]));
        }
        return result;
      }
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) invalid("El payload solo admite objetos JSON planos.");
      const keys = Reflect.ownKeys(item);
      if (keys.some((key) => typeof key === "symbol")) invalid("El payload contiene claves no serializables.");
      const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const key of (keys as string[]).sort()) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalid("El payload contiene propiedades no serializables.");
        result[key] = normalize(descriptor.value);
      }
      return result;
    } finally {
      ancestors.delete(item);
    }
  };
  const serialized = JSON.stringify(normalize(value));
  if (typeof serialized !== "string") invalid("El payload no se puede serializar como JSON.");
  if (Buffer.byteLength(serialized, "utf8") > MAX_PAYLOAD_BYTES) invalid("El payload supera el límite de 1 MB.");
  return serialized;
}

export function createSyncPayloadHash(payload: unknown): string {
  return createHash("sha256").update(canonicalSyncPayload(payload), "utf8").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Validates only the transport envelope. Operation-specific payload semantics and
 * database writes remain separate and must be checked inside their own transaction.
 */
export function validateSyncOperationEnvelope(value: unknown): ValidatedSyncOperation {
  if (!isRecord(value)) invalid("La operación de sincronización debe ser un objeto.");
  const protocolVersion = value.protocolVersion;
  if (protocolVersion !== 1) invalid("La versión del protocolo de sincronización no está soportada.");
  const operationId = value.operationId;
  const tournamentId = value.tournamentId;
  const entityType = value.entityType;
  const entityId = value.entityId;
  const operation = value.operation;
  const baseRevision = value.baseRevision;
  const payload = value.payload;
  const payloadHash = value.payloadHash;

  if (typeof operationId !== "string" || !OPERATION_ID_PATTERN.test(operationId)) invalid("El operationId no es válido.");
  if (typeof tournamentId !== "string" || !UUID_PATTERN.test(tournamentId)) invalid("El tournamentId debe ser la identidad UUID canónica.");
  if (typeof entityType !== "string" || !ENTITY_TYPE_PATTERN.test(entityType)) invalid("El entityType no es válido.");
  if (typeof entityId !== "string" || !entityId.trim() || entityId.length > 128) invalid("El entityId no es válido.");
  if (!["upsert", "publish-round", "replace-acta", "settings"].includes(String(operation))) invalid("El tipo de operación no está soportado.");
  if (!Number.isSafeInteger(baseRevision) || (baseRevision as number) < 0) invalid("La revisión base debe ser un entero no negativo.");
  if (!isRecord(payload)) invalid("El payload de la operación debe ser un objeto JSON.");
  if (typeof payloadHash !== "string" || !/^[a-f0-9]{64}$/.test(payloadHash)) invalid("El hash del payload no es válido.");

  const typedOperation = operation as SyncOperationKind;
  if (typedOperation === "publish-round" && entityType !== "round") invalid("publish-round solo puede operar sobre una ronda.");
  if (typedOperation === "replace-acta" && entityType !== "acta") invalid("replace-acta solo puede operar sobre un acta.");
  if (typedOperation === "settings" && entityType !== "settings") invalid("settings solo puede operar sobre la configuración.");

  const actualHash = createSyncPayloadHash(payload);
  if (actualHash !== payloadHash) invalid("El hash no coincide con el payload recibido.");

  return {
    protocolVersion: 1,
    operationId,
    tournamentId,
    entityType,
    entityId,
    operation: typedOperation,
    baseRevision: baseRevision as number,
    payload,
    payloadHash,
  };
}
