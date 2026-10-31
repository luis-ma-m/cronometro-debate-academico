import { ApiError } from "./core.js";

export interface TabulationEliminationOutcome {
  winnerTeamId: string;
  loserTeamId: string;
  advancingTeamIds: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

/**
 * Validates the explicit bracket outcome independently from judge ballots.
 * Ballots remain in the immutable source payload; this object is the official
 * progression decision and must never be inferred from a scorecard projection.
 */
export function validateTabulationEliminationOutcome(
  value: unknown,
  assignedTeamIds: readonly string[],
): TabulationEliminationOutcome {
  if (!isRecord(value) || Object.keys(value).some((key) =>
    !["winnerTeamId", "loserTeamId", "advancingTeamIds"].includes(key))) {
    throw new ApiError("INVALID_ELIMINATION_RESULT", "El resultado de eliminatoria debe incluir ganador, perdedor y equipos que avanzan.");
  }
  const winnerTeamId = typeof value.winnerTeamId === "string" ? value.winnerTeamId.trim() : "";
  const loserTeamId = typeof value.loserTeamId === "string" ? value.loserTeamId.trim() : "";
  const advancingTeamIds = value.advancingTeamIds;
  if (assignedTeamIds.length !== 2 || new Set(assignedTeamIds).size !== 2
    || !assignedTeamIds.every((id) => typeof id === "string" && id.length > 0)) {
    throw new ApiError("INVALID_ASSIGNMENT", "La eliminatoria debe enfrentar exactamente a dos equipos distintos.");
  }
  if (!winnerTeamId || !loserTeamId || winnerTeamId === loserTeamId
    || !assignedTeamIds.includes(winnerTeamId) || !assignedTeamIds.includes(loserTeamId)) {
    throw new ApiError("INVALID_ELIMINATION_RESULT", "El ganador y el perdedor deben ser equipos distintos de la asignación.");
  }
  if (!Array.isArray(advancingTeamIds) || advancingTeamIds.length < 1 || advancingTeamIds.length > 2
    || advancingTeamIds.some((id) => typeof id !== "string" || !assignedTeamIds.includes(id))
    || new Set(advancingTeamIds).size !== advancingTeamIds.length
    || !advancingTeamIds.includes(winnerTeamId)) {
    throw new ApiError("INVALID_ELIMINATION_RESULT", "Los equipos que avanzan deben ser una lista única de equipos de la asignación e incluir al ganador.");
  }
  return { winnerTeamId, loserTeamId, advancingTeamIds: [...advancingTeamIds] as string[] };
}
