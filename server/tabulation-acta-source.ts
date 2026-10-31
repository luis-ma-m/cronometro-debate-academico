import { ApiError } from "./core.js";
import { validateTabulationActaResult, type TabulationActaDomainContext, type ValidatedTabulationActa } from "./tabulation-acta-domain.js";
import { validateTabulationEliminationOutcome, type TabulationEliminationOutcome } from "./tabulation-elimination.js";

export type TabulationActaSourceMode = "judges" | "joint" | "elimination";

export interface ValidatedTabulationActaSource {
  sourceMode: TabulationActaSourceMode;
  roundKind: "qualifying" | "elimination";
  acta: ValidatedTabulationActa;
  eliminationResult: TabulationEliminationOutcome | null;
}

/**
 * Validates the immutable source envelope used by F4.
 * The mode is derived from the official round/settings, not trusted from the client.
 * For knockouts, the explicit progression result must agree with the validated
 * Tabulation outcome while the original ballots/joint acta remain in the source.
 */
export function validateTabulationActaSource(
  value: unknown,
  context: TabulationActaDomainContext,
): ValidatedTabulationActaSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("INVALID_ACTA_SOURCE", "La fuente del acta debe ser un objeto.");
  }
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => !["sourceMode", "acta", "eliminationResult"].includes(key))) {
    throw new ApiError("INVALID_ACTA_SOURCE", "La fuente del acta contiene campos desconocidos.");
  }

  const roundKind = context.round.kind;
  const expectedMode: TabulationActaSourceMode = roundKind === "elimination"
    ? "elimination"
    : context.settings.ballotMode;
  if (source.sourceMode !== expectedMode) {
    throw new ApiError("ACTA_SOURCE_MODE_MISMATCH", "El tipo de fuente no coincide con la modalidad de acta y ronda configurada.", 409);
  }

  const acta = validateTabulationActaResult(source.acta, context);
  if (roundKind !== "elimination") {
    if (source.eliminationResult !== undefined && source.eliminationResult !== null) {
      throw new ApiError("INVALID_ACTA_SOURCE", "Una ronda clasificatoria no puede incluir un resultado de eliminatoria.");
    }
    return { sourceMode: expectedMode, roundKind, acta, eliminationResult: null };
  }

  const eliminationResult = validateTabulationEliminationOutcome(source.eliminationResult, context.debate.teamIds);
  if (!acta.winnerTeamId) {
    throw new ApiError("INVALID_ELIMINATION_RESULT", "El acta validada no determina un ganador; no se puede publicar la progresión de la eliminatoria.");
  }
  if (eliminationResult.winnerTeamId !== acta.winnerTeamId) {
    throw new ApiError("ELIMINATION_RESULT_MISMATCH", "El ganador explícito no coincide con el resultado calculado a partir del acta y las reglas del torneo.", 409);
  }
  return { sourceMode: expectedMode, roundKind, acta, eliminationResult };
}
