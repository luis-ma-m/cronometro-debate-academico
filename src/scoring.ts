import type { Room, Round, Speaker, Team, Judge } from "./domain";

export type RoundType = "qualifying" | "elimination";
export type SpeakerPosition = "introductor" | "first_rebuttal" | "second_rebuttal" | "concluder";

export interface ScoreCategory {
  id: string;
  name: string;
  order: number;
}

export interface TeamScore {
  teamId: string;
  teamName: string;
  categoryScores: Record<string, number>;
  total: number;
  minorFaults: number;
  majorFaults: number;
}

export interface SpeakerScore {
  speakerId: string;
  speakerName: string;
  teamId: string;
  position: SpeakerPosition;
  score: number;
}

export interface RoundScorecard {
  id: string;
  roundId: string;
  roundName: string;
  roomId: string;
  roomName: string;
  teamFavorId: string;
  teamContraId: string;
  judges: Array<{ judgeId: string; judgeName: string }>;
  teams: [TeamScore, TeamScore];
  speakers: SpeakerScore[];
  createdAt: number;
  updatedAt: number;
}

export interface ScoringConfig {
  categories: ScoreCategory[];
  scorecards: RoundScorecard[];
}

export const DEFAULT_SCORE_CATEGORIES: ScoreCategory[] = [
  { id: "form", name: "Forma", order: 0 },
  { id: "evidence", name: "Evidencias", order: 1 },
  { id: "rebuttal", name: "Refutaciones", order: 2 },
];

export const SPEAKER_POSITIONS: Array<{ value: SpeakerPosition; label: string }> = [
  { value: "introductor", label: "Introductor" },
  { value: "first_rebuttal", label: "1.er refutador" },
  { value: "second_rebuttal", label: "2.º refutador" },
  { value: "concluder", label: "Conclusor" },
];

export function emptyScoringConfig(): ScoringConfig {
  return { categories: DEFAULT_SCORE_CATEGORIES.map((category) => ({ ...category })), scorecards: [] };
}

export function parseScoringConfig(value: unknown): ScoringConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyScoringConfig();
  const input = value as Partial<ScoringConfig>;
  const categories = Array.isArray(input.categories) ? input.categories : DEFAULT_SCORE_CATEGORIES;
  const scorecards = Array.isArray(input.scorecards) ? input.scorecards : [];
  const normalizedCategories = categories.filter((item): item is ScoreCategory =>
    Boolean(item && typeof item.id === "string" && typeof item.name === "string" && Number.isFinite(Number(item.order))))
    .map((item) => ({ id: item.id, name: item.name, order: Number(item.order) }))
    .sort((a, b) => a.order - b.order);
  const normalizedScorecards = scorecards.filter((item): item is RoundScorecard => Boolean(
    item && typeof item === "object" && typeof item.id === "string" && typeof item.roundId === "string" &&
    typeof item.roomId === "string" && Array.isArray(item.teams) && item.teams.length === 2 &&
    Array.isArray(item.judges) && Array.isArray(item.speakers) &&
    Number.isFinite(Number(item.createdAt)) && Number.isFinite(Number(item.updatedAt))
  ));
  return {
    categories: normalizedCategories.length ? normalizedCategories : DEFAULT_SCORE_CATEGORIES.map((category) => ({ ...category })),
    scorecards: normalizedScorecards,
  };
}

export function sumCategoryScores(scores: Record<string, number>, categories: ScoreCategory[]): number {
  return categories.reduce((total, category) => total + (Number(scores[category.id]) || 0), 0);
}

export interface ScoreValidationContext {
  rounds: Round[];
  rooms: Room[];
  teams: Team[];
  judges: Judge[];
  speakers: Speaker[];
}

export function validateScorecard(
  scorecard: RoundScorecard,
  categories: ScoreCategory[],
  context: ScoreValidationContext,
): string[] {
  const issues: string[] = [];
  const round = context.rounds.find((item) => item.id === scorecard.roundId);
  const room = context.rooms.find((item) => item.id === scorecard.roomId);
  if (!round) issues.push("La puntuación referencia una ronda inexistente.");
  else if ((round.scoreType ?? "qualifying") !== "qualifying") issues.push("Las rondas eliminatorias no admiten puntuaciones.");
  if (!room) issues.push("La puntuación referencia una asignación inexistente.");
  else {
    if (room.roundId !== scorecard.roundId) issues.push("La asignación no pertenece a la ronda seleccionada.");
    if (room.timer.status !== "finished") issues.push("Solo se pueden puntuar debates finalizados.");
    if (!room.teamFavorId || !room.teamContraId || room.teamFavorId === room.teamContraId) issues.push("El debate debe tener dos equipos distintos.");
    if (room.teamFavorId !== scorecard.teamFavorId || room.teamContraId !== scorecard.teamContraId) {
      issues.push("Los equipos del acta no coinciden con la asignación registrada.");
    }
    const assigned = [...room.judgeIds].sort();
    const recorded = scorecard.judges.map((judge) => judge.judgeId).sort();
    if (JSON.stringify(assigned) !== JSON.stringify(recorded)) issues.push("El acta debe identificar exactamente a los jueces asignados al debate.");
  }
  if (!Array.isArray(scorecard.teams) || scorecard.teams.length !== 2) issues.push("El acta debe puntuar a ambos equipos.");
  const teamIds = new Set(context.teams.map((item) => item.id));
  const categoryIds = new Set(categories.map((item) => item.id));
  const scoredTeamIds = (scorecard.teams ?? []).map((item) => item.teamId);
  if (new Set(scoredTeamIds).size !== 2 ||
      !scoredTeamIds.includes(scorecard.teamFavorId) ||
      !scoredTeamIds.includes(scorecard.teamContraId)) {
    issues.push("El acta debe incluir una puntuación distinta para cada uno de los dos equipos enfrentados.");
  }
  for (const item of scorecard.teams ?? []) {
    if (!teamIds.has(item.teamId)) issues.push("La puntuación referencia un equipo inexistente.");
    const expected = item.teamId === scorecard.teamFavorId || item.teamId === scorecard.teamContraId;
    if (!expected) issues.push("Solo se pueden puntuar los equipos enfrentados en esta sala.");
    for (const [categoryId, value] of Object.entries(item.categoryScores ?? {})) {
      if (!categoryIds.has(categoryId)) issues.push("La puntuación incluye una categoría inexistente.");
      if (!Number.isFinite(value) || value < 0 || value > 1000) issues.push("Cada puntuación de categoría debe ser un número entre 0 y 1000.");
    }
    for (const category of categories) {
      if (!Number.isFinite(item.categoryScores?.[category.id])) issues.push("Falta una puntuación para la categoría " + category.name + ".");
    }
    if (item.total !== sumCategoryScores(item.categoryScores ?? {}, categories)) issues.push("El sumatorio de categorías debe coincidir con el total calculado.");
    for (const faults of [item.minorFaults, item.majorFaults]) {
      if (!Number.isInteger(faults) || faults < 0 || faults > 100) issues.push("Las faltas deben ser enteros entre 0 y 100.");
    }
  }
  const judgeIds = new Set(context.judges.map((item) => item.id));
  if (new Set(scorecard.judges.map((item) => item.judgeId)).size !== scorecard.judges.length ||
      scorecard.judges.some((item) => !judgeIds.has(item.judgeId))) issues.push("La lista de jueces del acta contiene referencias no válidas.");
  if (!Array.isArray(scorecard.speakers) || scorecard.speakers.length > 8) issues.push("El acta admite hasta ocho puntuaciones de orador.");
  const speakerIds = new Set<string>();
  for (const item of scorecard.speakers ?? []) {
    const speaker = context.speakers.find((candidate) => candidate.id === item.speakerId);
    if (!speaker || speaker.teamId !== item.teamId) issues.push("Cada orador debe coincidir con el registro de su equipo.");
    if (item.teamId !== scorecard.teamFavorId && item.teamId !== scorecard.teamContraId) issues.push("El orador no pertenece a ninguno de los equipos enfrentados.");
    if (speakerIds.has(item.speakerId)) issues.push("No se puede puntuar dos veces al mismo orador en una ronda.");
    speakerIds.add(item.speakerId);
    if (!SPEAKER_POSITIONS.some((position) => position.value === item.position)) issues.push("La posición de orador no es válida.");
    if (!Number.isFinite(item.score) || item.score < 0 || item.score > 10 || Math.round(item.score * 2) !== item.score * 2) {
      issues.push("La puntuación de orador debe estar entre 0 y 10 y admitir intervalos de 0,5.");
    }
  }
  return [...new Set(issues)];
}
