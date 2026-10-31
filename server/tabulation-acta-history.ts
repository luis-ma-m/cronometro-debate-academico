import { ApiError } from "./core.js";

export interface ActaHistoryQueryResult {
  rows: Array<Record<string, unknown>>;
}

export interface ActaHistoryQueryable {
  query(sql: string, values?: unknown[]): Promise<ActaHistoryQueryResult>;
}

export interface TabulationActaHistoryVersion {
  id: string;
  sourceMode: "judges" | "joint" | "elimination";
  roundKind: "qualifying" | "elimination";
  baseRevision: number;
  sourceHash: string;
  eliminationResult?: Record<string, unknown> | null;
  operationId: string;
  supersedesSourceId: string | null;
  createdBy: string;
  createdAt: number;
}

export interface TabulationActaHistory {
  tournamentId: string;
  assignmentId: string;
  currentVersionId: string | null;
  totalVersions: number;
  rewriteCount: number;
  truncated: boolean;
  versions: TabulationActaHistoryVersion[];
}

const asText = (value: unknown): string => typeof value === "string" ? value : "";
const asObject = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const asMillis = (value: unknown): number => {
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(String(value ?? "")).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Read the immutable source history and its current pointer from one caller-owned snapshot transaction. */
export async function readTabulationActaHistory(
  db: ActaHistoryQueryable,
  assignmentId: string,
): Promise<TabulationActaHistory> {
  const assignment = await db.query("SELECT id FROM room_assignments WHERE id = $1", [assignmentId]);
  if (!assignment.rows.length) throw new ApiError("NOT_FOUND", "La asignación solicitada no existe.", 404);

  const identity = await db.query("SELECT tournament_id FROM tournament_identity WHERE id = 1");
  const tournamentId = asText(identity.rows[0]?.tournament_id);
  if (!tournamentId) throw new ApiError("MIGRATION_REQUIRED", "Falta aplicar la migración 0011_tournament_identity.sql.", 503);

  const [countResult, headResult, historyResult] = await Promise.all([
    db.query(
      "SELECT count(*)::int AS total_versions, count(*) FILTER (WHERE supersedes_source_id IS NOT NULL)::int AS rewrite_count FROM tabulation_acta_sources WHERE assignment_id = $1 AND tournament_id = $2",
      [assignmentId, tournamentId],
    ),
    db.query(
      "SELECT source_id::text AS source_id FROM tabulation_acta_heads WHERE assignment_id = $1",
      [assignmentId],
    ),
    db.query(
      "SELECT id::text AS id, source_mode, round_kind, base_revision, source_hash, elimination_result, operation_id, supersedes_source_id::text AS supersedes_source_id, created_by, created_at FROM tabulation_acta_sources WHERE assignment_id = $1 AND tournament_id = $2 ORDER BY created_at DESC, id DESC LIMIT 101",
      [assignmentId, tournamentId],
    ),
  ]);

  const count = countResult.rows[0] ?? {};
  const totalVersions = Number(count.total_versions ?? 0);
  const rewriteCount = Number(count.rewrite_count ?? 0);
  if (!Number.isSafeInteger(totalVersions) || totalVersions < 0 || !Number.isSafeInteger(rewriteCount) || rewriteCount < 0 || rewriteCount > totalVersions) {
    throw new ApiError("DATABASE_INTEGRITY", "El historial de actas contiene contadores no válidos.", 500);
  }

  const rows = historyResult.rows.slice(0, 100);
  const versions = rows.map((row): TabulationActaHistoryVersion => ({
    id: asText(row.id),
    sourceMode: row.source_mode === "joint" ? "joint" : row.source_mode === "elimination" ? "elimination" : "judges",
    roundKind: row.round_kind === "elimination" ? "elimination" : "qualifying",
    baseRevision: Number(row.base_revision),
    sourceHash: asText(row.source_hash),
    eliminationResult: row.elimination_result && typeof row.elimination_result === "object" ? asObject(row.elimination_result) : null,
    operationId: asText(row.operation_id),
    supersedesSourceId: asText(row.supersedes_source_id) || null,
    createdBy: asText(row.created_by),
    createdAt: asMillis(row.created_at),
  }));

  return {
    tournamentId,
    assignmentId,
    currentVersionId: asText(headResult.rows[0]?.source_id) || null,
    totalVersions,
    rewriteCount,
    truncated: totalVersions > 100,
    versions,
  };
}

export interface TabulationActaVersionDetail {
  id: string;
  assignmentId: string;
  tournamentId: string;
  sourceMode: "judges" | "joint" | "elimination";
  roundKind: "qualifying" | "elimination";
  baseRevision: number;
  sourceHash: string;
  sourcePayload: Record<string, unknown>;
  eliminationResult: Record<string, unknown> | null;
  rulesSnapshot: Record<string, unknown>;
  operationId: string;
  supersedesSourceId: string | null;
  createdBy: string;
  createdAt: number;
}

/** Fetch the potentially large immutable payload only when an operator opens one history entry. */
export async function readTabulationActaVersion(
  db: ActaHistoryQueryable,
  assignmentId: string,
  versionId: string,
): Promise<TabulationActaVersionDetail> {
  const result = await db.query(
    "SELECT s.id::text AS id, s.assignment_id, s.tournament_id::text AS tournament_id, s.source_mode, s.round_kind, s.base_revision, s.source_hash, s.source_payload, s.rules_snapshot, s.elimination_result, s.operation_id, s.supersedes_source_id::text AS supersedes_source_id, s.created_by, s.created_at FROM tabulation_acta_sources s JOIN tournament_identity ti ON ti.tournament_id = s.tournament_id WHERE ti.id = 1 AND s.assignment_id = $1 AND s.id = $2",
    [assignmentId, versionId],
  );
  const row = result.rows[0];
  if (!row) throw new ApiError("NOT_FOUND", "La versión de acta no existe para esta asignación.", 404);
  return {
    id: asText(row.id),
    assignmentId: asText(row.assignment_id),
    tournamentId: asText(row.tournament_id),
    sourceMode: row.source_mode === "joint" ? "joint" : row.source_mode === "elimination" ? "elimination" : "judges",
    roundKind: row.round_kind === "elimination" ? "elimination" : "qualifying",
    baseRevision: Number(row.base_revision),
    sourceHash: asText(row.source_hash),
    sourcePayload: asObject(row.source_payload),
    eliminationResult: row.elimination_result && typeof row.elimination_result === "object" ? asObject(row.elimination_result) : null,
    rulesSnapshot: asObject(row.rules_snapshot),
    operationId: asText(row.operation_id),
    supersedesSourceId: asText(row.supersedes_source_id) || null,
    createdBy: asText(row.created_by),
    createdAt: asMillis(row.created_at),
  };
}
