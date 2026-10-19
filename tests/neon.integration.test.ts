import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { Client } from "@neondatabase/serverless";

const connectionString = process.env.NEON_TEST_DATABASE_URL?.trim();
const explicitlyIsolated = process.env.NEON_TEST_DATABASE_ISOLATED === "1";
const runIntegration = Boolean(connectionString && explicitlyIsolated);
const schema = "ledu_it_" + randomBytes(6).toString("hex");
let client: Client | undefined;

describe.skipIf(!runIntegration)("Neon PostgreSQL integration invariants", () => {
  beforeAll(async () => {
    if (!connectionString || !explicitlyIsolated) throw new Error("Set NEON_TEST_DATABASE_URL and NEON_TEST_DATABASE_ISOLATED=1 for an isolated test database.");
    client = new Client(connectionString);
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    for (const file of ["0001_initial_schema.sql", "0002_integrity_constraints.sql"]) {
      await client.query(await readFile(resolve("db/migrations", file), "utf8"));
    }
    await client.query("INSERT INTO tournament_settings(id) VALUES(1)");
    await client.query("INSERT INTO teams(id,name) VALUES('t1','Equipo 1'),('t2','Equipo 2'),('t3','Equipo 3'),('t4','Equipo 4')");
    await client.query("INSERT INTO judges(id,name) VALUES('j1','Juez 1'),('j2','Juez 2')");
    await client.query("INSERT INTO physical_rooms(id,slug,name) VALUES('p1','sala-1','Sala 1'),('p2','sala-2','Sala 2')");
    await client.query("INSERT INTO rounds(id,number,name) VALUES('r1',1,'Ronda 1')");
    await client.query("INSERT INTO room_assignments(id,round_id,physical_room_id,team_favor_id,team_contra_id) VALUES('a1','r1','p1','t1','t2'),('a2','r1','p2','t3','t4')");
    await client.query("INSERT INTO assignment_judges(assignment_id,judge_id) VALUES('a1','j1'),('a2','j2')");
  }, 30_000);

  afterAll(async () => {
    if (!client) return;
    await client.query("RESET search_path").catch(() => undefined);
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await client.end();
  }, 30_000);

  it("rejects cross-side duplicate teams and a judge assigned twice in one round", async () => {
    await expect(client!.query("UPDATE room_assignments SET team_favor_id='t2' WHERE id='a2'"))
      .rejects.toMatchObject({ code: "23505" });
    await expect(client!.query("INSERT INTO assignment_judges(assignment_id,judge_id) VALUES('a2','j1')"))
      .rejects.toMatchObject({ code: "23505" });
  });

  it("rejects a scorecard whose teams do not match the assignment", async () => {
    await expect(client!.query(
      "INSERT INTO scorecards(id,assignment_id,round_id,team_favor_id,team_contra_id) VALUES('sc-bad','a1','r1','t3','t2')",
    )).rejects.toMatchObject({ code: "23514" });
  });

  it("uses timer revision compare-and-swap and rolls back timer plus audit together", async () => {
    const first = await client!.query("UPDATE room_assignments SET timer_revision=timer_revision+1 WHERE id='a1' AND timer_revision=0");
    const stale = await client!.query("UPDATE room_assignments SET timer_revision=timer_revision+1 WHERE id='a1' AND timer_revision=0");
    expect(first.rowCount).toBe(1);
    expect(stale.rowCount).toBe(0);

    await client!.query("BEGIN");
    await client!.query("UPDATE room_assignments SET timer_revision=timer_revision+1 WHERE id='a1' AND timer_revision=1");
    await client!.query(
      "INSERT INTO audit_events(event_key,event_type,assignment_id,round_id) VALUES('rollback-event','timer-test','a1','r1')",
    );
    await client!.query("ROLLBACK");
    const state = await client!.query("SELECT timer_revision FROM room_assignments WHERE id='a1'");
    const event = await client!.query("SELECT event_key FROM audit_events WHERE event_key='rollback-event'");
    expect(Number(state.rows[0].timer_revision)).toBe(1);
    expect(event.rowCount).toBe(0);
  });
});
