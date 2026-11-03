import type { PoolClient } from "@neondatabase/serverless";
import { ApiError } from "./core.js";
import { getPool } from "./db.js";
import { validateSyncOperationEnvelope, type ValidatedSyncOperation } from "./sync-operation-validation.js";

export type JournalStatus = "pending" | "committed" | "conflict" | "rejected";
export interface JournalEntry {
  operationId: string;
  tournamentId: string;
  entityType: string;
  entityId: string;
  operation: string;
  baseRevision: number;
  payload: Record<string, unknown>;
  payloadHash: string;
  status: JournalStatus;
  result: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  committedAt: number | null;
}
const millis = (value: unknown): number => value ? new Date(String(value)).getTime() : 0;
const rowToEntry = (row: Record<string, unknown>): JournalEntry => ({
  operationId: String(row.operation_id),
  tournamentId: String(row.tournament_id),
  entityType: String(row.entity_type),
  entityId: String(row.entity_id),
  operation: String(row.operation_type),
  baseRevision: Number(row.base_revision),
  payload: row.payload as Record<string, unknown>,
  payloadHash: String(row.payload_hash).trim(),
  status: String(row.status) as JournalStatus,
  result: row.result ?? null,
  errorCode: row.error_code ? String(row.error_code) : null,
  errorMessage: row.error_message ? String(row.error_message) : null,
  createdAt: millis(row.created_at),
  updatedAt: millis(row.updated_at),
  committedAt: row.committed_at ? millis(row.committed_at) : null,
});
function statusFor(error: unknown): { status: "conflict" | "rejected"; code: string; message: string } {
  if (error instanceof ApiError && (error.status === 409 || error.code.endsWith("_CONFLICT") || error.code === "TOURNAMENT_MISMATCH")) {
    return { status: "conflict", code: error.code, message: error.message };
  }
  if (error instanceof ApiError) return { status: "rejected", code: error.code, message: error.message };
  return { status: "rejected", code: "INVALID_OPERATION", message: "La operación no cumple el contrato de sincronización." };
}
export function validateJournalOperation(value: unknown): ValidatedSyncOperation {
  try { return validateSyncOperationEnvelope(value); }
  catch (error) { throw new ApiError("INVALID_SYNC_OPERATION", error instanceof Error ? error.message : "La operación no es válida.", 422); }
}
async function lockIdentity(client: PoolClient, tournamentId: string): Promise<void> {
  const identity = await client.query("SELECT tournament_id::text AS tournament_id FROM tournament_identity WHERE id=1 FOR UPDATE");
  if (String(identity.rows[0]?.tournament_id ?? "") !== tournamentId) {
    throw new ApiError("TOURNAMENT_MISMATCH", "La operación pertenece a otro torneo.", 409);
  }
}
function assertOperationAllowed(operation: ValidatedSyncOperation): void {
  // Keep module authority strict. The generic journal records and acknowledges
  // only supported operation types; it does not enable generic writes to manager
  // entities or bypass the round/acta domain services.
  if (operation.operation === "publish-round" && operation.entityType === "round") return;
  if (operation.operation === "replace-acta" && operation.entityType === "acta") return;
  throw new ApiError("OPERATION_NOT_ALLOWED", "Este tipo de comando no tiene un adaptador de dominio autorizado.", 403);
}
export async function recordSyncOperation(value: unknown, authenticated: boolean): Promise<JournalEntry> {
  if (!authenticated) throw new ApiError("UNAUTHORIZED", "Se requiere una sesión privada del gestor.", 401);
  const operation = validateJournalOperation(value);
  assertOperationAllowed(operation);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockIdentity(client, operation.tournamentId);
    const previous = await client.query("SELECT * FROM sync_operations WHERE operation_id=$1 FOR UPDATE", [operation.operationId]);
    if (previous.rows[0]) {
      const existing = rowToEntry(previous.rows[0] as Record<string, unknown>);
      if (existing.payloadHash !== operation.payloadHash || existing.tournamentId !== operation.tournamentId
        || existing.entityType !== operation.entityType || existing.entityId !== operation.entityId
        || existing.operation !== operation.operation || existing.baseRevision !== operation.baseRevision) {
        throw new ApiError("IDEMPOTENCY_MISMATCH", "El operationId ya se utilizó con otro contenido.", 409);
      }
      await client.query("COMMIT");
      return existing;
    }
    const inserted = await client.query(
      `INSERT INTO sync_operations
        (operation_id,tournament_id,entity_type,entity_id,operation_type,base_revision,payload,payload_hash,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'pending') RETURNING *`,
      [operation.operationId, operation.tournamentId, operation.entityType, operation.entityId,
        operation.operation, operation.baseRevision, JSON.stringify(operation.payload), operation.payloadHash],
    );
    await client.query("COMMIT");
    return rowToEntry(inserted.rows[0] as Record<string, unknown>);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof ApiError) throw error;
    throw new ApiError("DATABASE_UNAVAILABLE", "No se ha podido registrar la operación de sincronización.", 503);
  } finally { client.release(); }
}
export async function getSyncOperations(tournamentId: string, authenticated: boolean, after = 0): Promise<JournalEntry[]> {
  if (!authenticated) throw new ApiError("UNAUTHORIZED", "Se requiere una sesión privada del gestor.", 401);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tournamentId)) {
    throw new ApiError("INVALID_PAYLOAD", "El ID canónico del torneo no es válido.");
  }
  const result = await getPool().query(
    "SELECT * FROM sync_operations WHERE tournament_id=$1 AND created_at >= to_timestamp($2/1000.0) ORDER BY created_at, operation_id LIMIT 500",
    [tournamentId, Math.max(0, after)],
  );
  return result.rows.map((row) => rowToEntry(row as Record<string, unknown>));
}
export async function transitionSyncOperation(
  operationId: string, expectedHash: string, status: "committed" | "conflict" | "rejected",
  result: unknown, error?: { code: string; message: string }, authenticated = false,
): Promise<JournalEntry> {
  if (!authenticated) throw new ApiError("UNAUTHORIZED", "Se requiere una sesión privada del gestor.", 401);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT * FROM sync_operations WHERE operation_id=$1 FOR UPDATE", [operationId]);
    if (!current.rows[0]) throw new ApiError("SYNC_OPERATION_NOT_FOUND", "No existe la operación solicitada.", 404);
    const row = rowToEntry(current.rows[0] as Record<string, unknown>);
    if (row.payloadHash !== expectedHash) throw new ApiError("IDEMPOTENCY_MISMATCH", "El hash de la operación no coincide.", 409);
    if (row.status === "committed") {
      await client.query("COMMIT");
      return row;
    }
    const committedAt = status === "committed" ? new Date() : null;
    const updated = await client.query(
      `UPDATE sync_operations SET status=$2,result=$3::jsonb,error_code=$4,error_message=$5,
        committed_at=$6,updated_at=now() WHERE operation_id=$1 RETURNING *`,
      [operationId,status,result === undefined ? null : JSON.stringify(result),error?.code ?? null,error?.message ?? null,committedAt],
    );
    await client.query("COMMIT");
    return rowToEntry(updated.rows[0] as Record<string, unknown>);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof ApiError) throw error;
    throw new ApiError("DATABASE_UNAVAILABLE", "No se ha podido actualizar el ACK de la operación.", 503);
  } finally { client.release(); }
}
export async function reconcileSyncOperation(
  operationId: string, expectedHash: string, response: unknown, error: unknown, authenticated: boolean,
): Promise<JournalEntry> {
  if (error === null || error === undefined) {
    return transitionSyncOperation(operationId, expectedHash, "committed", response, undefined, authenticated);
  }
  const mapped = statusFor(error);
  return transitionSyncOperation(operationId, expectedHash, mapped.status, null, { code: mapped.code, message: mapped.message }, authenticated);
}
