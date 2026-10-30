export interface PublishedRoundDebate {
  physicalRoomId: string;
  venueName: string;
  teamFavorId: string;
  teamContraId: string;
  judgeIds: string[];
  chairId: string;
  sidesProvisional: boolean;
}

export interface PublishedRoundPayload {
  format: "ledu-tabulacion-outbox";
  version: 1;
  createdAt: number;
  tournamentId?: string;
  basePanelRevision?: number;
  basePanelUpdatedAt?: number;
  tabTournamentName: string;
  panelTournamentName: string | null;
  roundName: string;
  debates: PublishedRoundDebate[];
}

export interface PublishedRoundDomainContext {
  canonicalTournamentId: string;
  currentRevision: number;
  currentUpdatedAt: number;
  physicalRooms: Array<{ id: string; active: boolean }>;
  teams: Array<{ id: string; active: boolean; name: string; institution?: string; incompatibleJudgeIds?: string[] }>;
  judges: Array<{ id: string; active: boolean; name: string; institution?: string; incompatibleJudgeIds?: string[] }>;
  minimumJudgesPerRoom: number;
}

export class SyncDomainValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join(" "));
    this.name = "SyncDomainValidationError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validates the exact proposal produced by src/tabulation/panelBridge.ts/buildOutbox.
 * It deliberately does not write assignments: publication remains a separate,
 * explicit manager action after a current-revision check and operator review.
 */
export function validatePublishedRoundPayload(
  value: unknown,
  context: PublishedRoundDomainContext,
): PublishedRoundPayload {
  const issues: string[] = [];
  if (!isRecord(value)) throw new SyncDomainValidationError(["La propuesta de ronda debe ser un objeto."]);

  if (value.format !== "ledu-tabulacion-outbox" || value.version !== 1) {
    issues.push("El formato o la versión de la propuesta de ronda no están soportados.");
  }
  if (!Number.isSafeInteger(value.createdAt) || (value.createdAt as number) < 0) {
    issues.push("La fecha de creación de la propuesta no es válida.");
  }
  if (!nonEmptyString(value.roundName)) issues.push("La propuesta debe identificar la ronda.");
  if (!nonEmptyString(value.tabTournamentName)) issues.push("La propuesta debe identificar el torneo de Tabulación.");
  if (value.tournamentId !== context.canonicalTournamentId) {
    issues.push("La propuesta no pertenece a la identidad canónica del torneo.");
  }
  if (value.basePanelRevision !== context.currentRevision) {
    issues.push("La revisión base de la propuesta está obsoleta o no coincide con la revisión actual del gestor.");
  }
  if (value.basePanelUpdatedAt !== undefined && value.basePanelUpdatedAt !== context.currentUpdatedAt) {
    issues.push("La fecha base de la propuesta no coincide con la última actualización del gestor.");
  }
  if (!Array.isArray(value.debates) || value.debates.length === 0) {
    issues.push("La propuesta debe contener al menos un debate.");
  }

  const rooms = new Map(context.physicalRooms.map((item) => [item.id, item]));
  const teams = new Map(context.teams.map((item) => [item.id, item]));
  const judges = new Map(context.judges.map((item) => [item.id, item]));
  const usedRooms = new Set<string>();
  const usedTeams = new Set<string>();
  const usedJudges = new Set<string>();

  if (Array.isArray(value.debates)) {
    for (const [index, raw] of value.debates.entries()) {
      const prefix = "Debate " + (index + 1) + ": ";
      if (!isRecord(raw)) {
        issues.push(prefix + "el elemento no es válido.");
        continue;
      }
      const { physicalRoomId, venueName, teamFavorId, teamContraId, judgeIds, chairId, sidesProvisional } = raw;
      if (!nonEmptyString(physicalRoomId) || !rooms.has(physicalRoomId)) {
        issues.push(prefix + "la sala física no existe en el gestor.");
      } else if (!rooms.get(physicalRoomId)?.active) {
        issues.push(prefix + "se ha asignado una sala física inactiva.");
      } else if (usedRooms.has(physicalRoomId)) {
        issues.push(prefix + "la misma sala aparece en más de un debate.");
      } else {
        usedRooms.add(physicalRoomId);
      }
      if (!nonEmptyString(venueName)) issues.push(prefix + "falta el nombre de la sala.");
      if (!nonEmptyString(teamFavorId) || !teams.has(teamFavorId)) {
        issues.push(prefix + "el equipo A favor no existe en el gestor.");
      }
      if (!nonEmptyString(teamContraId) || !teams.has(teamContraId)) {
        issues.push(prefix + "el equipo En contra no existe en el gestor.");
      }
      if (teamFavorId === teamContraId) issues.push(prefix + "un equipo no puede debatir contra sí mismo.");
      for (const teamId of [teamFavorId, teamContraId]) {
        if (typeof teamId !== "string" || !teams.has(teamId)) continue;
        if (usedTeams.has(teamId)) issues.push(prefix + "un equipo aparece en más de un debate de la misma ronda.");
        usedTeams.add(teamId);
        if (!teams.get(teamId)?.active) issues.push(prefix + "se ha asignado un equipo inactivo.");
      }
      if (!Array.isArray(judgeIds) || judgeIds.length < context.minimumJudgesPerRoom) {
        issues.push(prefix + "no alcanza el mínimo de jueces requerido.");
      } else {
        const seenJudges = new Set<string>();
        for (const judgeId of judgeIds) {
          if (!nonEmptyString(judgeId) || !judges.has(judgeId)) {
            issues.push(prefix + "contiene un juez que no existe en el gestor.");
            continue;
          }
          if (seenJudges.has(judgeId)) issues.push(prefix + "contiene jueces duplicados.");
          const candidateJudge = judges.get(judgeId);
          for (const previousJudgeId of seenJudges) {
            const previousJudge = judges.get(previousJudgeId);
            if (candidateJudge?.incompatibleJudgeIds?.includes(previousJudgeId)
              || previousJudge?.incompatibleJudgeIds?.includes(judgeId)) {
              issues.push(prefix + "hay dos jueces incompatibles en el mismo panel.");
            }
          }
          if (usedJudges.has(judgeId)) issues.push(prefix + "un juez aparece asignado en más de un debate de la misma ronda.");
          seenJudges.add(judgeId);
          usedJudges.add(judgeId);
          const judge = judges.get(judgeId);
          if (!judge?.active) issues.push(prefix + "se ha asignado un juez inactivo.");
          if (judge) {
            for (const teamId of [teamFavorId, teamContraId]) {
              if (typeof teamId !== "string") continue;
              const team = teams.get(teamId);
              if (!team) continue;
              const judgeInstitution = judge.institution?.trim().toLocaleLowerCase("es-ES") ?? "";
              const teamInstitution = team.institution?.trim().toLocaleLowerCase("es-ES") ?? "";
              if (judgeInstitution && teamInstitution && judgeInstitution === teamInstitution) {
                issues.push(prefix + judge.name + " y " + team.name + " comparten institución.");
              }
              if (team.incompatibleJudgeIds?.includes(judgeId)) {
                issues.push(prefix + judge.name + " es incompatible con el equipo " + team.name + ".");
              }
            }
          }
        }
        if (seenJudges.size > 0 && (!nonEmptyString(chairId) || !seenJudges.has(chairId))) {
          issues.push(prefix + "la presidencia debe ser uno de los jueces asignados.");
        }
        if (seenJudges.size === 0 && chairId !== "") {
          issues.push(prefix + "no puede indicar presidencia si no hay jueces asignados.");
        }
      }
      if (typeof sidesProvisional !== "boolean") issues.push(prefix + "el indicador de postura provisional no es válido.");
    }
  }

  if (issues.length) throw new SyncDomainValidationError([...new Set(issues)]);

  return {
    format: "ledu-tabulacion-outbox",
    version: 1,
    createdAt: value.createdAt as number,
    tournamentId: value.tournamentId as string,
    basePanelRevision: value.basePanelRevision as number,
    ...(typeof value.basePanelUpdatedAt === "number" ? { basePanelUpdatedAt: value.basePanelUpdatedAt } : {}),
    tabTournamentName: value.tabTournamentName as string,
    panelTournamentName: typeof value.panelTournamentName === "string" ? value.panelTournamentName : null,
    roundName: value.roundName as string,
    debates: (value.debates as Record<string, unknown>[]).map((item) => ({
      physicalRoomId: item.physicalRoomId as string,
      venueName: item.venueName as string,
      teamFavorId: item.teamFavorId as string,
      teamContraId: item.teamContraId as string,
      judgeIds: [...(item.judgeIds as string[])],
      chairId: item.chairId as string,
      sidesProvisional: item.sidesProvisional as boolean,
    })),
  };
}
