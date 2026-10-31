import { ApiError } from "./core.js";

export interface TabulationActaIdMap {
  teams: Record<string, string>;
  judges: Record<string, string>;
  speakers: Record<string, string>;
}

export interface TabulationActaCanonicalTargets {
  tournamentId: string;
  roundId: string;
  debateId: string;
  teamIds: readonly string[];
  judgeIds: readonly string[];
  speakerIds: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

function mappedId(
  localId: unknown,
  mapping: Record<string, string>,
  allowedRemoteIds: readonly string[],
  label: string,
): string {
  if (typeof localId !== "string" || !localId.trim()) {
    throw new ApiError("INVALID_ACTA_IDENTITY", "La referencia local de " + label + " no es válida.");
  }
  const remoteId = mapping[localId];
  if (typeof remoteId !== "string" || !remoteId.trim() || !allowedRemoteIds.includes(remoteId)) {
    throw new ApiError("ACTA_IDENTITY_REVIEW_REQUIRED", "No existe una correspondencia revisada y válida para " + label + ". Revisa el vínculo de entidades antes de enviar el acta.", 409);
  }
  return remoteId;
}

function mapTeamRecord(
  value: unknown,
  mapping: Record<string, string>,
  allowed: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!isRecord(value)) throw new ApiError("INVALID_ACTA_IDENTITY", "La estructura de " + label + " no es válida.");
  const result: Record<string, unknown> = {};
  for (const [localId, entry] of Object.entries(value)) {
    const remoteId = mappedId(localId, mapping, allowed, label);
    if (Object.prototype.hasOwnProperty.call(result, remoteId)) throw new ApiError("INVALID_ACTA_IDENTITY", "Dos referencias locales de " + label + " apuntan a la misma entidad remota.");
    result[remoteId] = entry;
  }
  return result;
}

/**
 * Translate Tabulation-local references using the explicitly reviewed idMap.
 * No names, institutions, ordering or fuzzy matching are ever used to infer identity.
 * The assignment/round/debate scope is supplied by the manager-side lookup and
 * overwrites client-provided scope identifiers.
 */
export function canonicalizeTabulationActa(
  value: unknown,
  idMap: TabulationActaIdMap,
  targets: TabulationActaCanonicalTargets,
): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value.result)) {
    throw new ApiError("INVALID_ACTA_SOURCE", "La propuesta de acta no tiene una estructura válida.");
  }
  for (const kind of ["teams", "judges", "speakers"] as const) {
    if (!isRecord(idMap?.[kind])) throw new ApiError("ACTA_IDENTITY_REVIEW_REQUIRED", "Falta el mapa de identidad revisado para " + kind + ".", 409);
  }

  const result = structuredClone(value.result) as Record<string, unknown>;
  if (!isRecord(result.lineup) || !Array.isArray(result.ballots) || !isRecord(result.penalties)) {
    throw new ApiError("INVALID_ACTA_SOURCE", "La propuesta de acta no contiene alineación, papeletas y sanciones válidas.");
  }

  const mappedLineup = mapTeamRecord(result.lineup, idMap.teams, targets.teamIds, "equipos de la alineación");
  for (const [teamId, lineup] of Object.entries(mappedLineup)) {
    if (!isRecord(lineup)) throw new ApiError("INVALID_ACTA_SOURCE", "La alineación de un equipo no es válida.");
    const mapped: Record<string, unknown> = {};
    for (const [role, speakerId] of Object.entries(lineup)) {
      mapped[role] = mappedId(speakerId, idMap.speakers, targets.speakerIds, "oradores");
    }
    mappedLineup[teamId] = mapped;
  }
  result.lineup = mappedLineup;

  result.penalties = mapTeamRecord(result.penalties, idMap.teams, targets.teamIds, "equipos sancionados");
  const ballots = result.ballots as unknown[];
  result.ballots = ballots.map((raw) => {
    if (!isRecord(raw)) throw new ApiError("INVALID_ACTA_SOURCE", "Una papeleta no tiene una estructura válida.");
    const ballot = { ...raw };
    ballot.judgeId = mappedId(ballot.judgeId, idMap.judges, targets.judgeIds, "jueces de las papeletas");
    ballot.totals = mapTeamRecord(ballot.totals, idMap.teams, targets.teamIds, "puntuaciones por equipo");
    ballot.speeches = mapTeamRecord(ballot.speeches, idMap.teams, targets.teamIds, "puntuaciones de oradores");
    if (ballot.winnerTeamId !== undefined) ballot.winnerTeamId = mappedId(ballot.winnerTeamId, idMap.teams, targets.teamIds, "ganador de papeleta");
    return ballot;
  });

  if (result.override !== undefined) {
    if (!isRecord(result.override)) throw new ApiError("INVALID_ACTA_SOURCE", "La decisión manual de ganador no es válida.");
    result.override = { ...result.override, winnerTeamId: mappedId(result.override.winnerTeamId, idMap.teams, targets.teamIds, "ganador de la decisión manual") };
  }

  if (result.joint !== undefined) {
    if (!isRecord(result.joint)) throw new ApiError("INVALID_ACTA_SOURCE", "El acta conjunta no es válida.");
    const joint = { ...result.joint };
    joint.winnerTeamId = mappedId(joint.winnerTeamId, idMap.teams, targets.teamIds, "ganador del acta conjunta");
    for (const field of ["items", "quickTotals", "writtenTotals", "speakers"] as const) {
      if (joint[field] === undefined) continue;
      const mappedTeams = mapTeamRecord(joint[field], idMap.teams, targets.teamIds, "datos de " + field);
      if (field === "speakers") {
        for (const [teamId, entries] of Object.entries(mappedTeams)) {
          if (!Array.isArray(entries)) throw new ApiError("INVALID_ACTA_SOURCE", "La lista de oradores del acta conjunta no es válida.");
          mappedTeams[teamId] = entries.map((entry) => {
            if (!isRecord(entry)) throw new ApiError("INVALID_ACTA_SOURCE", "Una puntuación de orador no es válida.");
            return { ...entry, speakerId: mappedId(entry.speakerId, idMap.speakers, targets.speakerIds, "oradores del acta conjunta") };
          });
        }
      }
      joint[field] = mappedTeams;
    }
    result.joint = joint;
  }

  let eliminationResult = value.eliminationResult;
  if (eliminationResult !== undefined && eliminationResult !== null) {
    if (!isRecord(eliminationResult) || !Array.isArray(eliminationResult.advancingTeamIds)) {
      throw new ApiError("INVALID_ACTA_SOURCE", "El resultado explícito de eliminatoria no es válido.");
    }
    eliminationResult = {
      winnerTeamId: mappedId(eliminationResult.winnerTeamId, idMap.teams, targets.teamIds, "ganador de eliminatoria"),
      loserTeamId: mappedId(eliminationResult.loserTeamId, idMap.teams, targets.teamIds, "perdedor de eliminatoria"),
      advancingTeamIds: eliminationResult.advancingTeamIds.map((teamId) =>
        mappedId(teamId, idMap.teams, targets.teamIds, "equipos que avanzan en eliminatoria")),
    };
  }

  const acta = {
    ...value,
    ...(eliminationResult === undefined ? {} : { eliminationResult }),
    tournamentId: targets.tournamentId,
    roundId: targets.roundId,
    debateId: targets.debateId,
    result,
  };
  return acta;
}
