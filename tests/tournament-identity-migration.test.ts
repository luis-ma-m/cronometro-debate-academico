import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('stable tournament identity migration', () => {
  it('creates one persistent identity without deriving it from the tournament name', async () => {
    const sql = await readFile(resolve('db/migrations/0011_tournament_identity.sql'), 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS tournament_identity');
    expect(sql).toContain('tournament_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE');
    expect(sql).toContain('INSERT INTO tournament_identity(id) VALUES (1) ON CONFLICT (id) DO NOTHING');
    expect(sql).not.toMatch(/tournament_name.*gen_random_uuid|gen_random_uuid.*tournament_name/is);
  });

  it('backfills the existing manager and tabulation settings to the same identity', async () => {
    const sql = await readFile(resolve('db/migrations/0011_tournament_identity.sql'), 'utf8');
    expect(sql).toContain('UPDATE tournament_settings');
    expect(sql).toContain('UPDATE tabulation_settings');
    expect(sql).toContain('tournament_settings_tournament_identity_fk');
    expect(sql).toContain('tabulation_settings_tournament_identity_fk');
    expect(sql).toContain("WHERE tournament_id = 'default'");
  });

  it('preserves prior settings history and idempotent responses when replacing the legacy sentinel', async () => {
    const sql = await readFile(resolve('db/migrations/0011_tournament_identity.sql'), 'utf8');
    expect(sql).toContain('UPDATE tabulation_settings_versions');
    expect(sql).toContain('UPDATE tabulation_settings_operations');
    expect(sql).toContain("'{tournamentId}'");
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
  });
});
