import { describe, expect, it } from "vitest";
import { assertSyncOperationAuthorized, SyncAuthorizationError } from "../../server/sync-operation-policy.js";
import {
  canonicalSyncPayload,
  createSyncPayloadHash,
  validateSyncOperationEnvelope,
} from "../../server/sync-operation-validation.js";

const validEnvelope = (overrides: Record<string, unknown> = {}) => {
  const payload = { assignments: [{ teamIds: ["team-a", "team-b"] }] };
  return {
    protocolVersion: 1,
    operationId: "operation-0001",
    tournamentId: "00000000-0000-4000-8000-000000000001",
    entityType: "round",
    entityId: "round-1",
    operation: "publish-round",
    baseRevision: 12,
    payload,
    payloadHash: createSyncPayloadHash(payload),
    ...overrides,
  };
};

describe("sync operation transport contract", () => {
  it("accepts a valid revisioned operation and returns a validated copy", () => {
    const input = validEnvelope();
    const result = validateSyncOperationEnvelope(input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });

  it("uses the same deterministic JSON and SHA-256 contract as the browser outbox", () => {
    expect(canonicalSyncPayload({ z: 1, a: { y: 2, x: 3 } })).toBe('{"a":{"x":3,"y":2},"z":1}');
    expect(createSyncPayloadHash({ b: 2, a: 1 })).toBe(createSyncPayloadHash({ a: 1, b: 2 }));
  });

  it.each([
    null,
    [],
    { ...validEnvelope(), protocolVersion: 2 },
    { ...validEnvelope(), operationId: "short" },
    { ...validEnvelope(), tournamentId: "Torneo LEDU" },
    { ...validEnvelope(), entityType: "round/../../settings" },
    { ...validEnvelope(), entityId: "" },
    { ...validEnvelope(), baseRevision: -1 },
    { ...validEnvelope(), baseRevision: 1.5 },
    { ...validEnvelope(), operation: "delete" },
    { ...validEnvelope(), operation: "replace-acta", entityType: "round" },
    { ...validEnvelope(), operation: "publish-round", entityType: "acta" },
    { ...validEnvelope(), payload: [] },
    { ...validEnvelope(), payloadHash: "0".repeat(64) },
  ])("rejects malformed or inconsistent envelopes", (value) => {
    expect(() => validateSyncOperationEnvelope(value)).toThrow();
  });

  it("rejects payloads whose canonical hash does not match the envelope", () => {
    const envelope = validEnvelope({ payload: { assignments: [] } });
    expect(() => validateSyncOperationEnvelope(envelope)).toThrow("hash no coincide");
  });

  it("rejects non-JSON values and payloads over the transport limit", () => {
    expect(() => createSyncPayloadHash({ when: new Date() })).toThrow("objetos JSON planos");
    expect(() => createSyncPayloadHash({ value: Number.NaN })).toThrow("número no finito");
    expect(() => createSyncPayloadHash({ value: "x".repeat(1_048_577) })).toThrow("1 MB");
  });

  it("does not reinterpret special object keys while canonicalizing", () => {
    const payload = JSON.parse('{"__proto__":{"polluted":true},"safe":1}') as Record<string, unknown>;
    expect(canonicalSyncPayload(payload)).toBe('{"__proto__":{"polluted":true},"safe":1}');
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});


describe("sync operation authorization policy", () => {
  const operation = (overrides: Record<string, unknown> = {}) =>
    validateSyncOperationEnvelope(validEnvelope(overrides));

  const context = {
    authenticatedManager: true,
    canonicalTournamentId: "00000000-0000-4000-8000-000000000001",
  };

  it("allows only explicit round publication and acta replacement for the canonical tournament", () => {
    expect(() => assertSyncOperationAuthorized(operation(), context)).not.toThrow();
    const actaPayload = { source: "tabulation-acta" };
    expect(() => assertSyncOperationAuthorized(operation({
      entityType: "acta",
      entityId: "acta-1",
      operation: "replace-acta",
      payload: actaPayload,
      payloadHash: createSyncPayloadHash(actaPayload),
    }), context)).not.toThrow();
  });

  it.each([
    ["unauthenticated manager session", { authenticatedManager: false, canonicalTournamentId: context.canonicalTournamentId }, "UNAUTHORIZED"],
    ["different canonical tournament", { ...context, canonicalTournamentId: "00000000-0000-4000-8000-000000000002" }, "TOURNAMENT_MISMATCH"],
  ] as const)("rejects %s", (_label, authContext, code) => {
    try {
      assertSyncOperationAuthorized(operation(), authContext);
      throw new Error("Expected authorization to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(SyncAuthorizationError);
      expect((error as SyncAuthorizationError).code).toBe(code);
    }
  });

  it("rejects generic upserts because they could bypass manager-owned entity authority", () => {
    expect(() => assertSyncOperationAuthorized(operation({
      operation: "upsert",
      entityType: "team",
    }), context)).toThrowError(/upserts genéricos/);
  });

  it("rejects settings writes from Tabulation because the manager is the sole editor", () => {
    const payload = { presetId: "ledu-groups" };
    expect(() => assertSyncOperationAuthorized(operation({
      operation: "settings",
      entityType: "settings",
      payload,
      payloadHash: createSyncPayloadHash(payload),
    }), context)).toThrowError(/autoritativas en Gestor/);
  });

});
