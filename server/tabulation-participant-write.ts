import type { Tournament } from "../src/domain.js";
import { applyTabulationParticipantSnapshot } from "../src/contracts/tabulationParticipantSync.js";
import { parseParticipantSnapshot, type ParticipantSnapshot } from "../src/contracts/participantSnapshot.js";
import { ApiError } from "./core.js";

/**
 * Derive a participant-only update from a validated Tabulation snapshot.
 * Manager-owned operational state is preserved by the projection helper.
 */
export function createTabulationParticipantUpdate(
  current: Tournament,
  expectedRevision: number,
  input: unknown,
): { snapshot: ParticipantSnapshot; tournament: Tournament } {
  let snapshot: ParticipantSnapshot;
  try {
    snapshot = parseParticipantSnapshot(input);
  } catch (error) {
    throw new ApiError("INVALID_PAYLOAD", error instanceof Error ? error.message : "El snapshot de participantes no es válido.");
  }
  if (!current.remoteId || current.remoteId !== snapshot.tournamentId) {
    throw new ApiError("TOURNAMENT_MISMATCH", "El snapshot de participantes pertenece a otro torneo.", 409);
  }
  if (snapshot.revision !== expectedRevision || current.revision !== expectedRevision) {
    throw new ApiError("REVISION_CONFLICT", "El torneo cambió en otro dispositivo. Actualiza Tabulación antes de sincronizar participantes.", 409);
  }
  try {
    return { snapshot, tournament: applyTabulationParticipantSnapshot(current, snapshot) };
  } catch (error) {
    throw new ApiError("INVALID_PAYLOAD", error instanceof Error ? error.message : "No se pudo aplicar el snapshot de participantes.");
  }
}
