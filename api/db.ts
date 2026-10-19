import { neon, Pool, type NeonQueryFunction } from "@neondatabase/serverless";

let cachedClient: NeonQueryFunction<false, false> | undefined;\nlet cachedPool: Pool | undefined;

function getConnectionString(): string {
  const value = (process.env.NEON_DATABASE_URL || process.env.DATABASE_URL)?.trim();
  if (!value) throw new Error("Falta NEON_DATABASE_URL (o DATABASE_URL) para conectar con Neon PostgreSQL.");
  return value;
}

/** Server-only Neon HTTP client; do not import this module in browser code. */
export function getSql(): NeonQueryFunction<false, false> {
  if (!cachedClient) cachedClient = neon(getConnectionString());
  return cachedClient;
}

export function getPool(): Pool {\n  if (!cachedPool) cachedPool = new Pool({ connectionString: getConnectionString(), max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000 });\n  return cachedPool;\n}\n\nexport async function checkDatabase(): Promise<{ ok: true; serverTime: string }> {
  const sql = getSql();
  const rows = await sql`SELECT now()::text AS server_time`;
  const first = rows[0] as { server_time: string } | undefined;
  if (!first?.server_time) throw new Error("Neon no devolvió la hora del servidor.");
  return { ok: true, serverTime: first.server_time };
}

export function databaseConfigured(): boolean {
  return Boolean((process.env.NEON_DATABASE_URL || process.env.DATABASE_URL)?.trim());
}
