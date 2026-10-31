import type { ValidatedSyncOperation } from "./sync-operation-validation.js";

export type SyncAuthorizationErrorCode =
  | "UNAUTHORIZED"
  | "TOURNAMENT_MISMATCH"
  | "OPERATION_NOT_ALLOWED";

export class SyncAuthorizationError extends Error {
  readonly code: SyncAuthorizationErrorCode;
  readonly status: number;

  constructor(code: SyncAuthorizationErrorCode, message: string, status: number) {
    super(message);
    this.name = "SyncAuthorizationError";
    this.code = code;
    this.status = status;
  }
}

export interface SyncAuthorizationContext {
  /** Must be set only after the existing private manager session has been verified. */
  authenticatedManager: boolean;
  /** Canonical UUID loaded from tournament_identity inside the server boundary. */
  canonicalTournamentId: string;
}

/**
 * Applies the approved authority matrix to inbound Tabulation -> Manager operations.
 *
 * This is deliberately stricter than the transport envelope validator:
 * - rounds may only enter through explicit publication;
 * - actas may only enter through the explicit replacement workflow;
 * - generic upserts are rejected because they could bypass manager authority;
 * - settings are manager-owned and are never pushed from Tabulation.
 *
 * Call only after validating the envelope and verifying the private manager session.
 * This function does not perform persistence, revision checks, or ACKs.
 */
export function assertSyncOperationAuthorized(
  operation: ValidatedSyncOperation,
  context: SyncAuthorizationContext,
): void {
  if (!context.authenticatedManager) {
    throw new SyncAuthorizationError("UNAUTHORIZED", "Se requiere una sesión privada del gestor.", 401);
  }

  if (operation.tournamentId !== context.canonicalTournamentId) {
    throw new SyncAuthorizationError(
      "TOURNAMENT_MISMATCH",
      "La operación pertenece a una identidad de torneo distinta a la del gestor.",
      409,
    );
  }

  if (operation.operation === "publish-round" && operation.entityType === "round") return;
  if (operation.operation === "replace-acta" && operation.entityType === "acta") return;

  if (operation.operation === "settings") {
    throw new SyncAuthorizationError(
      "OPERATION_NOT_ALLOWED",
      "Las reglas son autoritativas en Gestor → Configuración y Tabulación solo puede leerlas.",
      403,
    );
  }

  if (operation.operation === "upsert") {
    throw new SyncAuthorizationError(
      "OPERATION_NOT_ALLOWED",
      "No se permiten upserts genéricos: las entidades compartidas son autoritativas en el gestor y requieren operaciones tipadas.",
      403,
    );
  }

  throw new SyncAuthorizationError(
    "OPERATION_NOT_ALLOWED",
    "La operación no está autorizada para sincronización desde Tabulación.",
    403,
  );
}
