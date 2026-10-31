import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let claimed = false;
  const events: string[] = [];
  const query = vi.fn(async (sql: string) => {
    const statement = String(sql).trim();
    if (statement === "BEGIN" || statement === "COMMIT" || statement === "ROLLBACK") return { rows: [] };
    if (statement.startsWith("UPDATE acta_short_links")) {
      if (claimed) return { rows: [] };
      claimed = true;
      return { rows: [{ id: "12345678" }] };
    }
    if (statement.startsWith("INSERT INTO acta_short_link_events")) {
      events.push(statement);
      return { rows: [] };
    }
    throw new Error("Unexpected query: " + statement);
  });
  const client = { query, release: vi.fn() };
  return { query, client, events, reset: () => { claimed = false; events.length = 0; query.mockClear(); } };
});

vi.mock("../../server/db.js", () => ({
  getPool: () => ({ connect: async () => mocks.client }),
}));

import { revokeActaShortLinks } from "../../api/index.js";

describe("short-link revocation concurrency", () => {
  beforeEach(() => mocks.reset());

  it("writes one revocation event when two operators revoke the same link concurrently", async () => {
    const request = { tournamentId: "tournament-1", ids: ["12345678"], all: false, reason: "test" };
    const results = await Promise.all([revokeActaShortLinks(request), revokeActaShortLinks(request)]);
    expect(results.map((result) => (result as { revoked: number }).revoked).sort()).toEqual([0, 1]);
    expect(mocks.events).toHaveLength(1);
  });

  it("uses an atomic update-returning operation for bulk revocation", async () => {
    const result = await revokeActaShortLinks({ tournamentId: "tournament-1", all: true });
    expect(result).toMatchObject({ revoked: 1, ids: ["12345678"] });
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes("RETURNING id"))).toBe(true);
  });
});
