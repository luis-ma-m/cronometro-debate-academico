import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { Client } from "@neondatabase/serverless";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error("Falta DATABASE_URL. Configura una conexión PostgreSQL privada antes de migrar.");
  process.exit(1);
}
const url = new URL(connectionString);
if (!["postgres:", "postgresql:"].includes(url.protocol)) {
  console.error("DATABASE_URL debe ser una URL PostgreSQL válida.");
  process.exit(1);
}
if (process.env.VERCEL_ENV === "production" && process.env.ALLOW_PRODUCTION_DB_MIGRATIONS !== "1") {
  console.error("Migración bloqueada desde el entorno de aplicación Production. Ejecuta el comando manual desde un entorno administrativo y habilita ALLOW_PRODUCTION_DB_MIGRATIONS=1 solo para esa ejecución.");
  process.exit(1);
}

const migrationPath = resolve("db/migrations/0001_initial_schema.sql");
const migrationSql = await readFile(migrationPath, "utf8");
const checksum = createHash("sha256").update(migrationSql).digest("hex");
const client = new Client(connectionString);
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      name text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  // Advisory lock prevents two administrative runners from applying a migration together.
  await client.query("SELECT pg_advisory_xact_lock(hashtext('ledu-schema-migrations'))");
  const current = await client.query("SELECT checksum FROM schema_migrations WHERE version = $1", ["0001"]);
  if (current.rows.length) {
    if (current.rows[0].checksum !== checksum) throw new Error("La migración 0001 ya existe con otro checksum; no se ejecutarán cambios.");
    await client.query("COMMIT");
    console.log("Migración 0001 ya aplicada; no hay cambios pendientes.");
  } else {
    await client.query(migrationSql);
    await client.query(
      "INSERT INTO schema_migrations(version, name, checksum) VALUES ($1, $2, $3)",
      ["0001", "initial_relational_schema", checksum],
    );
    await client.query("INSERT INTO tournament_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
    await client.query("COMMIT");
    console.log("Migración 0001 aplicada. No se han importado, borrado ni modificado datos de Google Sheets.");
  }
  if (process.argv.includes("--status")) {
    const status = await client.query("SELECT version, name, applied_at FROM schema_migrations ORDER BY version");
    console.log(JSON.stringify(status.rows, null, 2));
  }
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error("Error durante la migración PostgreSQL:", error instanceof Error ? error.message : "error desconocido");
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
