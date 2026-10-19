import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import { Client } from "@neondatabase/serverless";

const connectionString = (process.env.NEON_DATABASE_URL || process.env.DATABASE_URL)?.trim();
if (!connectionString) {
  console.error("Falta NEON_DATABASE_URL (o DATABASE_URL). Configura una conexión PostgreSQL privada antes de migrar.");
  process.exit(1);
}
let url;
try { url = new URL(connectionString); } catch {
  console.error("NEON_DATABASE_URL/DATABASE_URL no es una URL válida.");
  process.exit(1);
}
if (!["postgres:", "postgresql:"].includes(url.protocol)) {
  console.error("NEON_DATABASE_URL/DATABASE_URL debe ser una URL PostgreSQL válida.");
  process.exit(1);
}
if (process.env.VERCEL_ENV === "production" && process.env.ALLOW_PRODUCTION_DB_MIGRATIONS !== "1") {
  console.error("Migración bloqueada desde el entorno de aplicación Production. Ejecuta el comando desde un entorno administrativo aislado.");
  process.exit(1);
}

const directory = resolve("db/migrations");
const files = (await readdir(directory))
  .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
  .sort();
if (!files.length) throw new Error("No hay migraciones SQL versionadas.");

const migrations = await Promise.all(files.map(async (file) => {
  const sql = await readFile(resolve(directory, file), "utf8");
  return {
    version: file.slice(0, 4),
    name: basename(file, ".sql").slice(5),
    sql,
    checksum: createHash("sha256").update(sql).digest("hex"),
  };
}));

const client = new Client(connectionString);
let transactionOpen = false;
try {
  await client.connect();
  await client.query("BEGIN");
  transactionOpen = true;
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      name text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query("SELECT pg_advisory_xact_lock(hashtext('ledu-schema-migrations'))");
  const appliedResult = await client.query("SELECT version, name, checksum FROM schema_migrations ORDER BY version");
  const applied = new Map(appliedResult.rows.map((row) => [row.version, row]));

  for (const migration of migrations) {
    const previous = applied.get(migration.version);
    if (previous) {
      if (previous.checksum !== migration.checksum) {
        throw new Error(`La migración ${migration.version} ya existe con otro checksum. No se ejecutarán cambios; añade una nueva migración.`);
      }
      continue;
    }

    // Each migration and its ledger entry commit atomically. Keep the advisory
    // transaction lock for the whole run to prevent competing deploy runners.
    await client.query(migration.sql);
    await client.query(
      "INSERT INTO schema_migrations(version, name, checksum) VALUES ($1, $2, $3)",
      [migration.version, migration.name, migration.checksum],
    );
    if (migration.version === "0001") {
      await client.query("INSERT INTO tournament_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
    }
    console.log(`Migración ${migration.version} (${migration.name}) aplicada.`);
  }
  await client.query("COMMIT");
  transactionOpen = false;

  const status = await client.query("SELECT version, name, applied_at FROM schema_migrations ORDER BY version");
  if (process.argv.includes("--status")) console.log(JSON.stringify(status.rows, null, 2));
  else console.log(`Migraciones verificadas: ${status.rows.length}. No se han importado datos de Google Sheets.`);
} catch (error) {
  if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
  console.error("Error durante la migración PostgreSQL:", error instanceof Error ? error.message : "error desconocido");
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
