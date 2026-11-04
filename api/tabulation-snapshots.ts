import { createHash } from "node:crypto";
import { getPool } from "./db.js";
import { ApiError } from "./core.js";

type Snapshot = Record<string, unknown>;
type SnapshotRow = {
  tabTournamentId: string;
  tournamentName: string;
  schemaVersion: number;
  revision: number;
  snapshot: Snapshot;
  snapshotSha256: string;
  updatedAt: number;
};
const text = (value: unknown) => typeof value === "string" ? value : "";
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const object = value as Record<string, unknown>;
  return "{" + Object.keys(object).sort().map((key) => JSON.stringify(key) + ":" + canonical(object[key])).join(",") + "}";
};
const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");

let schemaReady: Promise<void> | null = null;
async function ensureSnapshotSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const pool = getPool();
      const tournamentTable = [
        "CREATE TABLE IF NOT EXISTS tabulation_tournaments (",
        "tab_tournament_id text PRIMARY KEY CHECK (length(btrim(tab_tournament_id)) BETWEEN 1 AND 200),",
        "tournament_name text NOT NULL CHECK (length(btrim(tournament_name)) BETWEEN 1 AND 200),",
        "schema_version integer NOT NULL CHECK (schema_version >= 1),",
        "revision bigint NOT NULL CHECK (revision >= 1),",
        "snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object' AND octet_length(snapshot::text) <= 4194304),",
        "snapshot_sha256 char(64) NOT NULL CHECK (snapshot_sha256 ~ '^[a-f0-9]{64}$'),",
        "published_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())",
      ].join(" ");
      const operationsTable = [
        "CREATE TABLE IF NOT EXISTS tabulation_publication_operations (",
        "operation_id varchar(128) PRIMARY KEY CHECK (operation_id ~ '^[a-zA-Z0-9_-]{8,128}$'),",
        "tab_tournament_id text NOT NULL CHECK (length(btrim(tab_tournament_id)) BETWEEN 1 AND 200),",
        "base_revision bigint NOT NULL CHECK (base_revision >= 0),",
        "committed_revision bigint NOT NULL CHECK (committed_revision >= 1),",
        "snapshot_sha256 char(64) NOT NULL CHECK (snapshot_sha256 ~ '^[a-f0-9]{64}$'),",
        "created_at timestamptz NOT NULL DEFAULT now())",
      ].join(" ");
      await pool.query(tournamentTable);
      await pool.query("CREATE INDEX IF NOT EXISTS tabulation_tournaments_updated_idx ON tabulation_tournaments(updated_at DESC)");
      await pool.query(operationsTable);
    })().catch((error) => { schemaReady = null; throw error; });
  }
  await schemaReady;
}

function validateSnapshot(input: Record<string, unknown>) {
  const id = text(input.tabTournamentId).trim();
  const operationId = text(input.operationId).trim();
  const expectedRevision = Number(input.expectedRevision);
  const snapshot = input.snapshot;
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id) || !/^[a-zA-Z0-9_-]{8,128}$/.test(operationId)
      || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
      || !snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new ApiError("INVALID_PAYLOAD", "La identidad, revisión u operación de Tabulación no son válidas.");
  }
  const value = snapshot as Snapshot;
  if (value.id !== id || typeof value.name !== "string" || !value.name.trim()
      || !Number.isSafeInteger(value.schemaVersion) || !value.settings || typeof value.settings !== "object"
      || !Array.isArray(value.teams) || !Array.isArray(value.speakers) || !Array.isArray(value.judges)
      || !Array.isArray(value.venues) || !Array.isArray(value.groups) || !Array.isArray(value.rounds)
      || !Array.isArray(value.breakSeeds) || !Array.isArray(value.manualOrder) || !Array.isArray(value.judgeConflicts)
      || !Array.isArray(value.logTail) || !Number.isSafeInteger(value.logSeq)) {
    throw new ApiError("INVALID_PAYLOAD", "El snapshot no contiene todos los datos del torneo de Tabulación.");
  }
  if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > 4 * 1024 * 1024) {
    throw new ApiError("PAYLOAD_TOO_LARGE", "El snapshot supera el límite de 4 MB.", 413);
  }
  return { id, operationId, expectedRevision, snapshot: value, hash: digest(value) };
}

function mapRow(row: Record<string, unknown>): SnapshotRow {
  const snapshot = row.snapshot as Snapshot;
  const hash = digest(snapshot);
  if (hash !== text(row.snapshot_sha256).trim()) {
    throw new ApiError("SNAPSHOT_CORRUPT", "El snapshot remoto no supera la comprobación de integridad.", 500);
  }
  return {
    tabTournamentId: text(row.tab_tournament_id),
    tournamentName: text(row.tournament_name),
    schemaVersion: Number(row.schema_version),
    revision: Number(row.revision),
    snapshot,
    snapshotSha256: hash,
    updatedAt: new Date(String(row.updated_at)).getTime(),
  };
}

export async function getTabulationSnapshot(id: string): Promise<SnapshotRow | null> {
  await ensureSnapshotSchema();
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id)) throw new ApiError("INVALID_PAYLOAD", "El identificador del torneo no es válido.");
  const result = await getPool().query(
    "SELECT tab_tournament_id,tournament_name,schema_version,revision,snapshot,snapshot_sha256,updated_at FROM tabulation_tournaments WHERE tab_tournament_id=$1",
    [id],
  );
  return result.rows[0] ? mapRow(result.rows[0] as Record<string, unknown>) : null;
}

export async function listTabulationSnapshots() {
  await ensureSnapshotSchema();
  const result = await getPool().query(
    "SELECT tab_tournament_id,tournament_name,schema_version,revision,snapshot_sha256,updated_at FROM tabulation_tournaments ORDER BY updated_at DESC",
  );
  return result.rows.map((row) => {
    const value = row as Record<string, unknown>;
    return {
      tabTournamentId: text(value.tab_tournament_id),
      tournamentName: text(value.tournament_name),
      schemaVersion: Number(value.schema_version),
      revision: Number(value.revision),
      snapshotSha256: text(value.snapshot_sha256).trim(),
      updatedAt: new Date(String(value.updated_at)).getTime(),
    };
  });
}

export async function publishTabulationSnapshot(payload: Record<string, unknown>, actor: string) {
  await ensureSnapshotSchema();
  const input = validateSnapshot(payload);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [input.id]);
    const prior = await client.query(
      "SELECT tab_tournament_id,base_revision,committed_revision,snapshot_sha256 FROM tabulation_publication_operations WHERE operation_id=$1 FOR UPDATE",
      [input.operationId],
    );
    if (prior.rows[0]) {
      const op = prior.rows[0] as Record<string, unknown>;
      if (text(op.tab_tournament_id) !== input.id || Number(op.base_revision) !== input.expectedRevision
          || text(op.snapshot_sha256).trim() !== input.hash) {
        throw new ApiError("IDEMPOTENCY_MISMATCH", "El identificador de operación ya se utilizó con otros datos.", 409);
      }
      const existing = await client.query(
        "SELECT tab_tournament_id,tournament_name,schema_version,revision,snapshot,snapshot_sha256,updated_at FROM tabulation_tournaments WHERE tab_tournament_id=$1 AND revision=$2",
        [input.id, Number(op.committed_revision)],
      );
      if (!existing.rows[0]) throw new ApiError("IDEMPOTENCY_INCOMPLETE", "No se puede recuperar la publicación confirmada.", 409);
      await client.query("COMMIT");
      return { ...mapRow(existing.rows[0] as Record<string, unknown>), created: Number(op.committed_revision) === 1 };
    }
    const current = await client.query(
      "SELECT revision FROM tabulation_tournaments WHERE tab_tournament_id=$1 FOR UPDATE",
      [input.id],
    );
    const currentRevision = current.rows[0] ? Number((current.rows[0] as Record<string, unknown>).revision) : 0;
    if (currentRevision !== input.expectedRevision) {
      throw new ApiError("REVISION_CONFLICT", "Neon contiene una revisión más reciente. Recarga o resuelve el conflicto antes de publicar.", 409);
    }
    const next = currentRevision + 1;
    const saveSql = [
      "INSERT INTO tabulation_tournaments(tab_tournament_id,tournament_name,schema_version,revision,snapshot,snapshot_sha256,published_by)",
      "VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)",
      "ON CONFLICT(tab_tournament_id) DO UPDATE SET tournament_name=EXCLUDED.tournament_name,",
      "schema_version=EXCLUDED.schema_version,revision=EXCLUDED.revision,snapshot=EXCLUDED.snapshot,",
      "snapshot_sha256=EXCLUDED.snapshot_sha256,published_by=EXCLUDED.published_by,updated_at=now()",
      "RETURNING tab_tournament_id,tournament_name,schema_version,revision,snapshot,snapshot_sha256,updated_at",
    ].join(" ");
    const saved = await client.query(saveSql, [
      input.id, text(input.snapshot.name).trim(), Number(input.snapshot.schemaVersion),
      next, JSON.stringify(input.snapshot), input.hash, actor,
    ]);
    await client.query(
      "INSERT INTO tabulation_publication_operations(operation_id,tab_tournament_id,base_revision,committed_revision,snapshot_sha256) VALUES($1,$2,$3,$4,$5)",
      [input.operationId, input.id, currentRevision, next, input.hash],
    );
    await client.query("COMMIT");
    return { ...mapRow(saved.rows[0] as Record<string, unknown>), created: currentRevision === 0 };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof ApiError) throw error;
    throw new ApiError("TABULATION_PUBLISH_FAILED", "No se ha podido guardar el snapshot en Neon.", 503);
  } finally {
    client.release();
  }
}
