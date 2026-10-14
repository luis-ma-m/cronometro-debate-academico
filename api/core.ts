import type { Phase, PublicRoom, Room, TimerState, Tournament } from "../src/domain.js";
import type { TimerAction } from "../src/timer.js";
import { findAssignmentConflicts } from "../src/incompatibilities.js";

export const DEFAULT_SPREADSHEET_ID = "1YxqCaKESdneb42Oqty2pssnmm_LyiS2hhBs4plcequI";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export const SHEET_HEADERS = {
  Config: ["key", "value"],
  Rondas: ["id", "number", "name", "active", "defaultFormatId"],
  Equipos: ["id", "name", "institution", "active", "incompatibleJudgeIds"],
  Jueces: ["id", "name", "institution", "active", "incompatibleJudgeIds"],
  Salas: ["id", "name", "roundId", "teamFavorId", "teamContraId", "judgeIds", "status", "phases", "notes", "updatedAt", "physicalRoomId", "formatId"],
  SalasFisicas: ["id", "slug", "name", "active", "createdAt", "updatedAt"],
  Formatos: ["id", "name", "phases", "version", "createdAt", "updatedAt"],
  Cronometros: ["roomId", "status", "phaseIndex", "remainingSeconds", "startedAt", "lastResumedAt", "revision", "updatedAt"],
  Registro: ["event_id", "timestamp_utc", "room_round_id", "round_id", "room_id", "phase_index", "event_type", "elapsed_seconds", "details"],
} as const;

export type SheetName = keyof typeof SHEET_HEADERS;
export type SheetRow = Record<string, unknown>;

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export const str = (value: unknown): string => value === null || value === undefined ? "" : String(value);
export const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
export const bool = (value: unknown): boolean => value === true || String(value).toLowerCase() === "true";

export function parseJson<T>(value: unknown, fallback: T): T {
  try {
    if (typeof value !== "string") return (value || fallback) as T;
    return JSON.parse(value || JSON.stringify(fallback)) as T;
  } catch {
    return fallback;
  }
}

export function parseStringArray(value: unknown): string[] {
  const parsed = parseJson<unknown>(value, []);
  if (!Array.isArray(parsed)) return [];
  return [...new Set(parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0))];
}

export function objectsFromRows(values: unknown[][] | undefined): SheetRow[] {
  if (!values?.length) return [];
  const headers = values[0].map((item) => String(item ?? ""));
  return values.slice(1)
    .filter((row) => row.some((cell) => cell !== "" && cell !== null && cell !== undefined))
    .map((row) => {
      const item: SheetRow = {};
      headers.forEach((header, index) => { item[header] = row[index] ?? ""; });
      return item;
    });
}

export function rowsToValues(name: SheetName, objects: SheetRow[], existingDataRows: number): unknown[][] {
  const headers = SHEET_HEADERS[name] as readonly string[];
  const count = Math.max(objects.length, existingDataRows);
  const rows: unknown[][] = [];
  for (let index = 0; index < count; index += 1) {
    const object = objects[index];
    rows.push(headers.map((header) => object && object[header] !== undefined && object[header] !== null ? object[header] : ""));
  }
  return rows;
}

export function defaultPhases(): Phase[] {
  return [
    { id: "ledu-01", name: "Exposición inicial", side: "favor", speaker: "Equipo a favor", durationSeconds: 240, type: "opening", warningThresholdsSeconds: [60, 30, 10], allowOvertimeDisplay: true },
    { id: "ledu-02", name: "Examen cruzado", side: "contra", speaker: "En contra pregunta a A favor", durationSeconds: 120, type: "cross-examination", warningThresholdsSeconds: [30, 10], allowOvertimeDisplay: true },
    { id: "ledu-03", name: "Exposición inicial", side: "contra", speaker: "Equipo en contra", durationSeconds: 240, type: "opening", warningThresholdsSeconds: [60, 30, 10], allowOvertimeDisplay: true },
    { id: "ledu-04", name: "Examen cruzado", side: "favor", speaker: "A favor pregunta a En contra", durationSeconds: 120, type: "cross-examination", warningThresholdsSeconds: [30, 10], allowOvertimeDisplay: true },
    { id: "ledu-05", name: "Refutación 1", side: "favor", speaker: "Equipo a favor", durationSeconds: 300, type: "rebuttal", warningThresholdsSeconds: [60, 30, 10], allowOvertimeDisplay: true },
    { id: "ledu-06", name: "Refutación 1", side: "contra", speaker: "Equipo en contra", durationSeconds: 300, type: "rebuttal", warningThresholdsSeconds: [60, 30, 10], allowOvertimeDisplay: true },
    { id: "ledu-07", name: "Refutación 2", side: "favor", speaker: "Equipo a favor", durationSeconds: 300, type: "rebuttal", warningThresholdsSeconds: [60, 30, 10], allowOvertimeDisplay: true },
    { id: "ledu-08", name: "Refutación 2", side: "contra", speaker: "Equipo en contra", durationSeconds: 300, type: "rebuttal", warningThresholdsSeconds: [60, 30, 10], allowOvertimeDisplay: true },
    { id: "ledu-09", name: "Refutación cruzada", side: "favor", speaker: "Equipo a favor", durationSeconds: 90, type: "cross-rebuttal", warningThresholdsSeconds: [30, 10], allowOvertimeDisplay: true },
    { id: "ledu-10", name: "Refutación cruzada", side: "contra", speaker: "Equipo en contra", durationSeconds: 90, type: "cross-rebuttal", warningThresholdsSeconds: [30, 10], allowOvertimeDisplay: true },
    { id: "ledu-11", name: "Conclusión", side: "contra", speaker: "Equipo en contra", durationSeconds: 180, type: "conclusion", warningThresholdsSeconds: [60, 30, 10], allowOvertimeDisplay: true },
    { id: "ledu-12", name: "Conclusión", side: "favor", speaker: "Equipo a favor", durationSeconds: 180, type: "conclusion", warningThresholdsSeconds: [60, 30, 10], allowOvertimeDisplay: true },
  ];
}

export function timerFromRow(row: SheetRow): TimerState {
  const startedAtValue = row.startedAt;
  const resumedAtValue = row.lastResumedAt;
  return {
    status: (str(row.status) || "idle") as TimerState["status"],
    phaseIndex: num(row.phaseIndex),
    remainingSeconds: num(row.remainingSeconds),
    startedAt: startedAtValue === "" || startedAtValue === null || startedAtValue === undefined ? null : num(startedAtValue),
    lastResumedAt: resumedAtValue === "" || resumedAtValue === null || resumedAtValue === undefined ? null : num(resumedAtValue),
    revision: num(row.revision),
    updatedAt: num(row.updatedAt),
  };
}

export function initialTimer(phases: Phase[]): TimerState {
  return {
    status: "idle",
    phaseIndex: 0,
    remainingSeconds: phases.length ? num(phases[0].durationSeconds) : 0,
    startedAt: null,
    lastResumedAt: null,
    revision: 0,
    updatedAt: Date.now(),
  };
}

export function remainingSeconds(timer: TimerState, now: number): number {
  if (timer.status !== "running" || timer.lastResumedAt === null) return num(timer.remainingSeconds);
  return num(timer.remainingSeconds) - Math.floor((now - timer.lastResumedAt) / 1000);
}

export function transitionTimer(timer: TimerState, phases: Phase[], action: TimerAction, now: number): TimerState {
  const phase = phases[timer.phaseIndex];
  if (action === "finish") {
    if (timer.status === "finished") return timer;
    return { ...timer, status: "finished", remainingSeconds: 0, lastResumedAt: null, revision: timer.revision + 1, updatedAt: now };
  }
  if (action === "reset") {
    if (!phase) return timer;
    return { ...timer, status: "idle", remainingSeconds: num(phase.durationSeconds), startedAt: null, lastResumedAt: null, revision: timer.revision + 1, updatedAt: now };
  }
  if (action === "start") {
    if (timer.status === "running" || timer.status === "finished" || !phase) return timer;
    return { ...timer, status: "running", startedAt: timer.startedAt ?? now, lastResumedAt: now, revision: timer.revision + 1, updatedAt: now };
  }
  if (action === "pause") {
    if (timer.status !== "running") return timer;
    return { ...timer, status: "paused", remainingSeconds: remainingSeconds(timer, now), lastResumedAt: null, revision: timer.revision + 1, updatedAt: now };
  }
  if (timer.status === "finished") return timer;
  const nextIndex = action === "previous" ? timer.phaseIndex - 1 : timer.phaseIndex + 1;
  if (nextIndex < 0) return timer;
  if (nextIndex >= phases.length) {
    return { ...timer, status: "finished", remainingSeconds: 0, lastResumedAt: null, revision: timer.revision + 1, updatedAt: now };
  }
  return { ...timer, status: "idle", phaseIndex: nextIndex, remainingSeconds: num(phases[nextIndex].durationSeconds), startedAt: null, lastResumedAt: null, revision: timer.revision + 1, updatedAt: now };
}

export function deriveRoomStatus(room: Pick<Room, "timer" | "teamFavorId" | "teamContraId" | "judgeIds">, minimumJudges: number): Room["status"] {
  if (room.timer.status === "running") return "running";
  if (room.timer.status === "paused") return "paused";
  if (room.timer.status === "finished") return "finished";
  return room.teamFavorId && room.teamContraId && room.judgeIds.length >= minimumJudges ? "ready" : "unassigned";
}

export function validatePhases(phases: unknown): asserts phases is Phase[] {
  if (!Array.isArray(phases) || phases.length === 0) throw new ApiError("INVALID_PHASES", "El formato debe incluir al menos una intervención.");
  const seen = new Set<string>();
  phases.forEach((phase: Phase, index: number) => {
    if (!phase || !str(phase.id) || !str(phase.name).trim() || !str(phase.speaker).trim()) {
      throw new ApiError("INVALID_PHASES", "La intervención " + (index + 1) + " necesita identificador, nombre e interviniente.");
    }
    if (seen.has(str(phase.id))) throw new ApiError("INVALID_PHASES", "Hay identificadores de intervención duplicados.");
    seen.add(str(phase.id));
    if (phase.side !== "favor" && phase.side !== "contra") throw new ApiError("INVALID_PHASES", "Cada intervención debe asociarse a A favor o En contra.");
    if (!Number.isFinite(Number(phase.durationSeconds)) || Number(phase.durationSeconds) < 1 || Number(phase.durationSeconds) > 7200) {
      throw new ApiError("INVALID_PHASES", "La duración debe estar entre 1 y 7200 segundos.");
    }
    if (phase.warningThresholdsSeconds !== undefined && (!Array.isArray(phase.warningThresholdsSeconds) || phase.warningThresholdsSeconds.some((item) => !Number.isFinite(Number(item)) || Number(item) < 0))) {
      throw new ApiError("INVALID_PHASES", "Los umbrales de aviso deben contener segundos válidos.");
    }
  });
}

export function validateTournamentInput(value: unknown): asserts value is Tournament {
  const tournament = value as Tournament;
  if (!tournament || !Array.isArray(tournament.rooms) || !Array.isArray(tournament.teams) ||
      !Array.isArray(tournament.judges) || !Array.isArray(tournament.rounds) ||
      !Array.isArray(tournament.physicalRooms) || !Array.isArray(tournament.formats)) {
    throw new ApiError("INVALID_PAYLOAD", "Estructura del torneo inválida.");
  }
  if (typeof tournament.tournamentName !== "string" || tournament.tournamentName.length > 200) {
    throw new ApiError("INVALID_PAYLOAD", "El nombre del torneo es obligatorio y no puede superar 200 caracteres.");
  }
  const assertUniqueRecords = (items: Array<{ id: string; name: string }>, label: string) => {
    const ids = new Set<string>();
    for (const item of items) {
      const id = str(item?.id).trim();
      const name = str(item?.name).trim();
      if (!id || !name || id.length > 100 || name.length > 200 || ids.has(id)) {
        throw new ApiError("INVALID_PAYLOAD", label + " deben tener identificadores únicos y nombres no vacíos de hasta 200 caracteres.");
      }
      ids.add(id);
    }
  };
  assertUniqueRecords(tournament.rounds, "Las rondas");
  assertUniqueRecords(tournament.teams, "Los equipos");
  assertUniqueRecords(tournament.judges, "Los jueces");
  assertUniqueRecords(tournament.formats, "Los formatos");
  const physicalIds = new Set<string>();
  const physicalSlugs = new Set<string>();
  for (const physical of tournament.physicalRooms) {
    const id = str(physical?.id).trim();
    const slug = str(physical?.slug).trim().toLocaleLowerCase("es-ES");
    const name = str(physical?.name).trim();
    if (!id || !name || !slug || name.length > 200 || id.length > 100 || slug.length > 100 ||
        physicalIds.has(id) || physicalSlugs.has(slug) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new ApiError("INVALID_PHYSICAL_ROOM", "Las salas físicas deben tener nombres e identificadores únicos y un enlace válido.");
    }
    physicalIds.add(id);
    physicalSlugs.add(slug);
  }
  const formatIds = new Set(tournament.formats.map((format) => str(format.id)));
  for (const format of tournament.formats) validatePhases(format.phases);
  if (!Number.isFinite(Number(tournament.activationRevision)) || Number(tournament.activationRevision) < 0) {
    throw new ApiError("INVALID_ACTIVATION", "La revisión de activación no es válida.");
  }

  if (tournament.institutions !== undefined) {
    if (!Array.isArray(tournament.institutions)) {
      throw new ApiError("INVALID_INSTITUTIONS", "El catálogo de instituciones debe ser una lista.");
    }
    const catalog = new Set<string>();
    for (const item of tournament.institutions) {
      const name = str(item).trim();
      const key = name.toLocaleLowerCase("es-ES");
      if (!name || name.length > 200 || catalog.has(key)) {
        throw new ApiError("INVALID_INSTITUTIONS", "Las instituciones deben tener nombres no vacíos, únicos y de hasta 200 caracteres.");
      }
      catalog.add(key);
    }
    for (const person of [...tournament.teams, ...tournament.judges]) {
      const name = str(person.institution).trim();
      if (name && !catalog.has(name.toLocaleLowerCase("es-ES"))) {
        throw new ApiError("INVALID_INSTITUTIONS", "La institución de " + str(person.name) + " no pertenece al catálogo.");
      }
    }
  }

  const rounds = new Set(tournament.rounds.map((item) => str(item.id)).filter(Boolean));
  for (const round of tournament.rounds) {
    if (round.defaultFormatId && !formatIds.has(str(round.defaultFormatId))) {
      throw new ApiError("INVALID_FORMAT", "La ronda " + str(round.name) + " referencia un formato inexistente.");
    }
  }
  const roundTypes = new Set(["qualifying", "elimination"]);
  for (const round of tournament.rounds) {
    const scoreType = (round as typeof round & { scoreType?: unknown }).scoreType;
    if (scoreType !== undefined && !roundTypes.has(str(scoreType))) {
      throw new ApiError("INVALID_ROUND_TYPE", "El tipo de ronda debe ser clasificatoria o eliminatoria.");
    }
  }

  const speakers = tournament.speakers ?? [];
  if (!Array.isArray(speakers)) throw new ApiError("INVALID_SPEAKERS", "La lista de oradores debe ser una lista.");
  const speakerIds = new Set<string>();
  for (const speaker of speakers) {
    const id = str(speaker?.id).trim();
    const name = str(speaker?.name).trim();
    const teamId = str(speaker?.teamId).trim();
    if (!id || id.length > 100 || !name || name.length > 200 || speakerIds.has(id)) {
      throw new ApiError("INVALID_SPEAKERS", "Los oradores deben tener IDs únicos y nombres no vacíos de hasta 200 caracteres.");
    }
    if (!teamId || !tournament.teams.some((team) => team.id === teamId)) {
      throw new ApiError("INVALID_SPEAKERS", "Cada orador debe estar asociado a un equipo existente.");
    }
    speakerIds.add(id);
  }
  const teamIds = new Set(tournament.teams.map((item) => str(item.id)).filter(Boolean));
  const judgeIds = new Set(tournament.judges.map((item) => str(item.id)).filter(Boolean));
  for (const team of tournament.teams) {
    const raw=(team as typeof team & {incompatibleJudgeIds?:unknown}).incompatibleJudgeIds;
    if(raw===undefined) team.incompatibleJudgeIds=[];
    else if(!Array.isArray(raw)||raw.some(id=>typeof id!=="string")) throw new ApiError("INVALID_INCOMPATIBILITIES","La lista de jueces incompatibles del equipo "+str(team.name)+" no es válida.");
    if(new Set(team.incompatibleJudgeIds).size!==team.incompatibleJudgeIds.length) throw new ApiError("INVALID_INCOMPATIBILITIES","Hay jueces incompatibles duplicados en el equipo "+str(team.name)+".");
    for(const id of team.incompatibleJudgeIds) if(!judgeIds.has(id)) throw new ApiError("INVALID_INCOMPATIBILITIES","El equipo "+str(team.name)+" referencia un juez inexistente.");
  }
  for (const judge of tournament.judges) {
    const raw=(judge as typeof judge & {incompatibleJudgeIds?:unknown}).incompatibleJudgeIds;
    if(raw===undefined) judge.incompatibleJudgeIds=[];
    else if(!Array.isArray(raw)||raw.some(id=>typeof id!=="string")) throw new ApiError("INVALID_INCOMPATIBILITIES","La lista de jueces incompatibles de "+str(judge.name)+" no es válida.");
    if(new Set(judge.incompatibleJudgeIds).size!==judge.incompatibleJudgeIds.length) throw new ApiError("INVALID_INCOMPATIBILITIES","Hay jueces incompatibles duplicados en "+str(judge.name)+".");
    for(const id of judge.incompatibleJudgeIds){if(!judgeIds.has(id)) throw new ApiError("INVALID_INCOMPATIBILITIES","El juez "+str(judge.name)+" referencia un juez inexistente.");if(id===judge.id) throw new ApiError("INVALID_INCOMPATIBILITIES","Un juez no puede ser incompatible consigo mismo.");}
  }
  const symmetric=new Map<string,Set<string>>(tournament.judges.map(j=>[j.id,new Set(j.incompatibleJudgeIds)]));
  for(const judge of tournament.judges) for(const id of judge.incompatibleJudgeIds) symmetric.get(id)?.add(judge.id);
  for(const judge of tournament.judges) judge.incompatibleJudgeIds=[...(symmetric.get(judge.id)??[])].sort();
  const teamBookings = new Set<string>();
  const judgeBookings = new Set<string>();
  const physicalRoundBookings = new Set<string>();
  const roomIds = new Set<string>();

  for (const room of tournament.rooms) {
    if (!room || !str(room.id) || roomIds.has(str(room.id))) throw new ApiError("INVALID_ASSIGNMENT", "Las salas deben tener identificadores únicos.");
    roomIds.add(str(room.id));
    if (!rounds.has(str(room.roundId))) throw new ApiError("INVALID_ASSIGNMENT", "La sala " + str(room.name) + " tiene una ronda inexistente.");
    if (!physicalIds.has(str(room.physicalRoomId))) throw new ApiError("INVALID_ASSIGNMENT", "La asignación " + str(room.name) + " no tiene una sala física válida.");
    if (room.formatId && !formatIds.has(str(room.formatId))) throw new ApiError("INVALID_FORMAT", "La sala " + str(room.name) + " referencia un formato inexistente.");
    const physicalRoundKey = str(room.physicalRoomId) + ":" + str(room.roundId);
    if (physicalRoundBookings.has(physicalRoundKey)) throw new ApiError("DUPLICATE_ROOM_ASSIGNMENT", "Una sala física no puede tener dos asignaciones en la misma ronda.");
    physicalRoundBookings.add(physicalRoundKey);
    if (room.teamFavorId && room.teamFavorId === room.teamContraId) throw new ApiError("INVALID_ASSIGNMENT", "Un equipo no puede debatir contra sí mismo.");
    for (const teamId of [room.teamFavorId, room.teamContraId].filter(Boolean)) {
      if (!teamIds.has(str(teamId))) throw new ApiError("INVALID_ASSIGNMENT", "Una sala contiene un equipo inexistente.");
      const bookingKey = str(room.roundId) + ":" + str(teamId);
      if (teamBookings.has(bookingKey)) throw new ApiError("TEAM_DOUBLE_BOOKED", "Un equipo está asignado a dos salas de la misma ronda.");
      teamBookings.add(bookingKey);
    }
    const inRoom = new Set<string>();
    if (!Array.isArray(room.judgeIds)) throw new ApiError("INVALID_ASSIGNMENT", "La lista de jueces de una sala no es válida.");
    // Evaluate every rule for the room and report every blocking reason in one response.
    const roomConflicts = findAssignmentConflicts({ teams: tournament.teams, judges: tournament.judges, rooms: [room] });
    if (roomConflicts.length) {
      const code = roomConflicts.some((conflict) => conflict.type === "institution")
        ? "INSTITUTION_CONFLICT"
        : roomConflicts.some((conflict) => conflict.type === "team-judge")
          ? "TEAM_JUDGE_CONFLICT"
          : "JUDGE_JUDGE_CONFLICT";
      throw new ApiError(code, room.name + ": " + [...new Set(roomConflicts.map((conflict) => conflict.message))].join(" "));
    }
    for (const judgeId of room.judgeIds) {
      if (!judgeIds.has(str(judgeId))) throw new ApiError("INVALID_ASSIGNMENT", "La sala " + str(room.name) + " referencia un juez inexistente.");
      if (inRoom.has(str(judgeId))) throw new ApiError("DUPLICATE_JUDGE_ASSIGNMENT", "Un juez no puede estar asignado dos veces a la misma sala.");
      inRoom.add(str(judgeId));
      const bookingKey = str(room.roundId) + ":" + str(judgeId);
      if (judgeBookings.has(bookingKey)) throw new ApiError("JUDGE_DOUBLE_BOOKED", "Un juez está asignado a dos salas de la misma ronda.");
      judgeBookings.add(bookingKey);
    }
    validatePhases(room.phases);
  }
  if (tournament.formatPhases?.length) validatePhases(tournament.formatPhases);
  const minimum = Number(tournament.minimumJudgesPerRoom ?? 1);
  if (!Number.isInteger(minimum) || minimum < 1 || minimum > 25) {
    throw new ApiError("INVALID_CONFIGURATION", "El mínimo de jueces por sala debe ser un número entre 1 y 25.");
  }
}

export function publicRoomData(room: Room): Omit<Room, "notes"> {
  const safeRoom = { ...room } as Partial<Room>;
  delete safeRoom.notes;
  return safeRoom as Omit<Room, "notes">;
}

export function publicRoomPayload(tournament: Tournament, roomSlug: string): PublicRoom {
  if (!roomSlug) throw new ApiError("INVALID_ROOM", "Falta el identificador de sala.");
  const physical = tournament.physicalRooms.find((item) =>
    item.slug.toLocaleLowerCase("es-ES") === roomSlug.toLocaleLowerCase("es-ES") ||
    item.id.toLocaleLowerCase("es-ES") === roomSlug.toLocaleLowerCase("es-ES"));
  if (!physical) throw new ApiError("ROOM_NOT_FOUND", "No se encuentra esa sala física.", 404);
  const activeRoundId = tournament.activeRoundId || tournament.rounds.find((item) => item.active)?.id || "";
  const round = tournament.rounds.find((item) => item.id === activeRoundId);
  const assignment = tournament.rooms.find((item) => item.physicalRoomId === physical.id && item.roundId === activeRoundId);
  const phases = assignment?.phases?.length
    ? assignment.phases
    : tournament.formats.find((item) => item.id === round?.defaultFormatId)?.phases ?? tournament.formatPhases ?? defaultPhases();
  const now = Date.now();
  const room: Room = assignment ? assignment : {
    id: "unassigned-" + physical.id,
    name: physical.name,
    roundId: activeRoundId,
    physicalRoomId: physical.id,
    formatId: round?.defaultFormatId ?? "",
    teamFavorId: "",
    teamContraId: "",
    judgeIds: [],
    status: "unassigned",
    phases,
    timer: initialTimer(phases),
    notes: "",
    updatedAt: now,
  };
  // An assignment row is pre-created for every physical room in many rounds.
  // It is only a public debate assignment when someone has actually been allocated.
  const hasAssignment = Boolean(assignment && (assignment.teamFavorId || assignment.teamContraId || assignment.judgeIds.length > 0));
  const favor = tournament.teams.find((item) => item.id === room.teamFavorId);
  const contra = tournament.teams.find((item) => item.id === room.teamContraId);
  const judges = room.judgeIds.map((id) => tournament.judges.find((item) => item.id === id)?.name ?? "").filter(Boolean);
  return {
    tournamentName: tournament.tournamentName,
    roundName: round?.name ?? "Sin ronda activa",
    room: publicRoomData(room) as Room,
    hasAssignment,
    physicalRoomId: physical.id,
    roomSlug: physical.slug,
    physicalRoomName: physical.name,
    activationRevision: tournament.activationRevision ?? 0,
    activatedAt: tournament.activatedAt ?? 0,
    teamFavor: favor?.name ?? "",
    teamContra: contra?.name ?? "",
    judges,
    minimumJudgesPerRoom: tournament.minimumJudgesPerRoom,
    serverTime: now,
  };
}
