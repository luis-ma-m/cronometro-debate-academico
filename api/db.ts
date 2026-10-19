import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let cachedClient: NeonQueryFunction<false, false> | undefined;

function getConnectionString(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("Falta DATABASE_URL para conectar con Neon PostgreSQL.");
  return value;
}

/** Server-only Neon HTTP client; do not import this module in browser code. */
export function getSql(): NeonQueryFunction<false, false> {
  if (!cachedClient) cachedClient = neon(getConnectionString());
  return cachedClient;
}

export async function checkDatabase(): Promise<{ ok: true; serverTime: string }> {
  const sql = getSql();
  const rows = await sql`SELECT now()::text AS server_time`;
  const first = rows[0] as { server_time: string } | undefined;
  if (!first?.server_time) throw new Error("Neon no devolvió la hora del servidor.");
  return { ok: true, serverTime: first.server_time };
}

export function databaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}
