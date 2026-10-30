import { computeDebateOutcome } from "../src/tabulation/results.js";
import type { TabDebate, TabDebateResult, TabJudge, TabRound, TabSettings, TabSpeaker, TabTeam } from "../src/tabulation/types.js";

export interface TabulationActaDomainContext {
  canonicalTournamentId: string; currentRevision: number; currentUpdatedAt: number;
  settings: TabSettings;
  round: Pick<TabRound, "id" | "number" | "kind" | "sideMode">;
  debate: Pick<TabDebate, "id" | "teamIds" | "judgeIds" | "chairId" | "favorTeamId">;
  teams: TabTeam[]; judges: TabJudge[]; speakers: TabSpeaker[];
}
export interface ValidatedTabulationActa {
  tournamentId: string; basePanelRevision: number; basePanelUpdatedAt: number;
  roundId: string; debateId: string; result: TabDebateResult;
}
export class TabulationActaValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) { super(issues.join(" ")); this.name = "TabulationActaValidationError"; this.issues = issues; }
}
const record = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const onlyKeys = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every((key) => keys.includes(key));

function validateResult(value: unknown, context: TabulationActaDomainContext): TabDebateResult {
  if (!record(value)) throw new TabulationActaValidationError(["El resultado del acta debe ser un objeto."]);
  const issues: string[] = [];
  if (!record(value.lineup) || !Array.isArray(value.ballots) || !record(value.penalties)
    || typeof value.notes !== "string" || !finite(value.updatedAt) || value.updatedAt <= 0) {
    throw new TabulationActaValidationError(["La estructura básica del resultado no es válida."]);
  }
  if (value.joint !== undefined && !record(value.joint)) issues.push("El acta conjunta no es válida.");
  if (value.override !== undefined && !record(value.override)) issues.push("La decisión manual no es válida.");
  const [a, b] = context.debate.teamIds, teamIds = [a, b], judgeIds = new Set(context.debate.judgeIds);
  const speakers = new Map(context.speakers.map((speaker) => [speaker.id, speaker]));
  const lineup = value.lineup as Record<string, unknown>;
  if (!onlyKeys(lineup, teamIds)) issues.push("La alineación contiene equipos ajenos al debate.");
  const roles = ["introductor", "first_rebuttal", "second_rebuttal", "concluder"];
  for (const [teamId, row] of Object.entries(lineup)) {
    if (!teamIds.includes(teamId) || !record(row)) { issues.push("La alineación contiene una referencia no válida."); continue; }
    if (!onlyKeys(row, roles)) issues.push("La alineación contiene posiciones desconocidas.");
    for (const [role, speakerId] of Object.entries(row)) {
      if (!roles.includes(role) || !text(speakerId) || speakers.get(speakerId)?.teamId !== teamId) {
        issues.push("Cada orador de la alineación debe pertenecer al equipo y posición correspondientes.");
      }
    }
  }
  const penalties = value.penalties as Record<string, unknown>;
  if (!onlyKeys(penalties, teamIds)) issues.push("Las sanciones contienen equipos ajenos al debate.");
  for (const [teamId, p] of Object.entries(penalties)) {
    if (!teamIds.includes(teamId) || !record(p)
      || !Number.isInteger(p.warnings) || (p.warnings as number) < 0 || (p.warnings as number) > 100
      || !Number.isInteger(p.minors) || (p.minors as number) < 0 || (p.minors as number) > 100
      || !Number.isInteger(p.majors) || (p.majors as number) < 0 || (p.majors as number) > 100
      || typeof p.disqualified !== "boolean") issues.push("Las sanciones deben contener contadores enteros no negativos y una descalificación válida.");
  }
  const ballots = value.ballots as unknown[], seen = new Set<string>();
  for (const ballot of ballots) {
    if (!record(ballot) || !text(ballot.judgeId) || !judgeIds.has(ballot.judgeId)) {
      issues.push("Una papeleta pertenece a un juez que no está asignado al debate."); continue;
    }
    if (seen.has(ballot.judgeId)) issues.push("Un juez tiene más de una papeleta para el mismo debate.");
    seen.add(ballot.judgeId);
    if (!record(ballot.totals) || !record(ballot.speeches)) { issues.push("La papeleta contiene puntuaciones o intervenciones no válidas."); continue; }
    if (!onlyKeys(ballot.totals, teamIds) || !onlyKeys(ballot.speeches, teamIds)) issues.push("La papeleta contiene equipos ajenos al debate.");
    if (context.round.kind === "elimination") {
      if (ballot.winnerTeamId !== a && ballot.winnerTeamId !== b) issues.push("Cada papeleta eliminatoria debe votar por uno de los dos equipos.");
      if (Object.keys(ballot.totals).length) issues.push("Las eliminatorias registran votos, no puntuaciones de clasificatoria.");
    } else {
      if (ballot.winnerTeamId !== undefined) issues.push("Las papeletas clasificatorias no deben declarar un ganador manual.");
      if (!finite(ballot.totals[a]) || !finite(ballot.totals[b])) issues.push("Cada papeleta debe incluir la puntuación de ambos equipos.");
    }
  }
  if (context.settings.ballotMode === "joint") {
    if (ballots.length) issues.push("El modo de acta conjunta no admite papeletas individuales.");
    if (!record(value.joint)) issues.push("Falta el acta conjunta configurada para este torneo.");
  } else if (value.joint !== undefined) issues.push("El torneo está configurado para papeletas individuales, no para acta conjunta.");
  if (value.override !== undefined) {
    const override = value.override as Record<string, unknown>;
    if (!teamIds.includes(override.winnerTeamId as string) || !text(override.reason)) {
      issues.push("La decisión manual debe identificar un equipo del debate y justificar el motivo.");
    }
  }
  if (issues.length) throw new TabulationActaValidationError([...new Set(issues)]);
  return value as unknown as TabDebateResult;
}

/** Pure domain validation only; it does not write, replace scorecards, or acknowledge remote persistence. */
export function validateTabulationActaResult(value: unknown, context: TabulationActaDomainContext): ValidatedTabulationActa {
  if (!record(value)) throw new TabulationActaValidationError(["La propuesta de acta debe ser un objeto."]);
  const issues: string[] = [];
  if (value.tournamentId !== context.canonicalTournamentId) issues.push("El acta pertenece a otra identidad canónica de torneo.");
  if (value.basePanelRevision !== context.currentRevision) issues.push("La revisión base del acta está obsoleta.");
  if (value.basePanelUpdatedAt !== context.currentUpdatedAt) issues.push("La fecha base del acta está obsoleta.");
  if (value.roundId !== context.round.id || value.debateId !== context.debate.id) issues.push("El acta no corresponde a la ronda y debate seleccionados.");
  if (!Number.isSafeInteger(value.basePanelRevision) || (value.basePanelRevision as number) < 0) issues.push("La revisión base no es válida.");
  if (!finite(value.basePanelUpdatedAt) || value.basePanelUpdatedAt < 0) issues.push("La fecha base no es válida.");
  if (issues.length) throw new TabulationActaValidationError(issues);
  const result = validateResult(value.result, context);
  const outcome = computeDebateOutcome(
    { ...context.round },
    { ...context.debate, venueId: "", teamIds: [...context.debate.teamIds] as [string, string], judgeIds: [...context.debate.judgeIds], result } as TabDebate,
    { settings: context.settings, teams: new Map(context.teams.map((x) => [x.id, x] as [string, TabTeam])), judges: new Map(context.judges.map((x) => [x.id, x] as [string, TabJudge])), speakers: new Map(context.speakers.map((x) => [x.id, x] as [string, TabSpeaker])) },
  );
  if (outcome.status !== "complete") {
    const details = [...outcome.issues, ...outcome.missing];
    throw new TabulationActaValidationError(details.length ? details : ["El acta todavía no contiene un resultado completo."]);
  }
  return { tournamentId: value.tournamentId as string, basePanelRevision: value.basePanelRevision as number,
    basePanelUpdatedAt: value.basePanelUpdatedAt as number, roundId: value.roundId as string, debateId: value.debateId as string, result };
}
