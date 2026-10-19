import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FormatPreset, Phase, PhysicalRoom, Room, Round, TimerState, Tournament } from "../src/domain.js";
import { checkDatabase, databaseConfigured } from "./db.js";
import { loadPostgresSheetData, readIdempotentResponse, writePostgresTables, type PostgresSheetData } from "./postgres-store.js";
import type { TimerAction } from "../src/timer.js";
import { findAssignmentConflicts } from "../src/incompatibilities.js";
import { emptyScoringConfig, parseScoringConfig, sumCategoryScores, validateScorecard, type RoundScorecard, type ScoringConfig } from "../src/scoring.js";
import {
  ApiError,
  SESSION_TTL_SECONDS,
  bool,
  defaultPhases,
  deriveRoomStatus,
  initialTimer,
  num,
  parseJson,
  parseStringArray,
  publicRoomPayload,
  remainingSeconds,
  str,
  timerFromRow,
  transitionTimer,
  validatePhases,
  validateTournamentInput,
  type SheetName,
  type SheetRow,
} from "./core.js";

type RequestLike = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
};
type ResponseLike = {
  status(code: number): ResponseLike;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
  end(): void;
};

type SheetData = PostgresSheetData;

function env(name: string): string {
  return (process.env[name] || "").trim();
}

function requiredEnvironment(): string[] {
  const names = [
    "ADMIN_PASSWORD",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
  ];
  const missing = names.filter((name) => !env(name));
  if (!databaseConfigured()) missing.push("NEON_DATABASE_URL (o DATABASE_URL)");
  return missing;
}

function ensureConfigured(): void {
  const missing = requiredEnvironment();
  if (missing.length) {
    throw new ApiError(
      "NOT_CONFIGURED",
      "La API de Vercel aún no está configurada. Faltan variables privadas: " + missing.join(", ") + ". Consulta docs/NEON_MIGRATION.md.",
      503,
    );
  }
  if (env("ADMIN_PASSWORD").length > 1024) {
    throw new ApiError("NOT_CONFIGURED", "ADMIN_PASSWORD no puede superar 1024 caracteres.", 503);
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEquals(left: string, right: string): boolean {
  // Reuse the private panel password as the single authentication secret.
  // Domain separation prevents this derived key from being reused elsewhere.
  const key = createHash("sha256").update("LEDU Control auth key v1\0").update(env("ADMIN_PASSWORD")).digest();
  const leftDigest = createHmac("sha256", key).update(left).digest();
  const rightDigest = createHmac("sha256", key).update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

async function loadSheetData(_skipEnsure = false): Promise<SheetData> {
  // Compatibility shape for existing domain rules; all reads now come from normalized PostgreSQL.
  return loadPostgresSheetData();
}

function configValue(configRows: SheetRow[], key: string): string {
  const item = configRows.find((row) => str(row.key) === key);
  return item ? str(item.value) : "";
}

function timerRowMap(rows: SheetRow[]): Map<string, TimerState> {
  const result = new Map<string, TimerState>();
  for (const row of rows) result.set(str(row.roomId), timerFromRow(row));
  return result;
}

function tournamentFromData(data: SheetData): Tournament {
  const config = data.rows.Config;
  const activeRoundId = configValue(config, "activeRoundId");
  // Keep round classification in Config so existing Rondas headers remain unchanged.
  // Legacy tournaments default to qualifying without a schema migration.
  const roundTypes = parseJson<Record<string, unknown>>(configValue(config, "roundTypes"), {});
  const rounds = data.rows.Rondas.map((row) => ({
    id: str(row.id), number: num(row.number), name: str(row.name),
    active: activeRoundId ? str(row.id) === activeRoundId : bool(row.active),
    defaultFormatId: str(row.defaultFormatId),
    scoreType: (str(roundTypes[str(row.id)] ?? row.scoreType) === "elimination" ? "elimination" : "qualifying") as Round["scoreType"],
  }));
  const teams = data.rows.Equipos.map((row) => ({
    id: str(row.id), name: str(row.name), institution: str(row.institution), active: bool(row.active),
    incompatibleJudgeIds: parseStringArray(row.incompatibleJudgeIds),
  }));
  const scoring = parseScoringConfig(parseJson<unknown>(configValue(config, "scoring"), emptyScoringConfig()));
  const parsedSpeakers = parseJson<unknown>(configValue(config, "speakers"), []);
  const speakers = Array.isArray(parsedSpeakers)
    ? parsedSpeakers.filter((speaker): speaker is { id: string; teamId: string; name: string } => Boolean(speaker && typeof speaker === "object" && typeof (speaker as { id?: unknown }).id === "string" && typeof (speaker as { teamId?: unknown }).teamId === "string" && typeof (speaker as { name?: unknown }).name === "string" && teams.some((team) => team.id === (speaker as { teamId: string }).teamId)))
    : [];
  const judges = data.rows.Jueces.map((row) => ({
    id: str(row.id), name: str(row.name), institution: str(row.institution), active: bool(row.active),
    incompatibleJudgeIds: parseStringArray(row.incompatibleJudgeIds),
  }));
  const institutionsMap = new Map<string, string>();
  for (const rawName of [
    ...parseJson<string[]>(configValue(config, "institutions"), []),
    ...teams.map((team) => team.institution),
    ...judges.map((judge) => judge.institution),
  ]) {
    const name = str(rawName).trim();
    const key = name.toLocaleLowerCase("es-ES");
    if (name && !institutionsMap.has(key)) institutionsMap.set(key, name);
  }
  const institutions = [...institutionsMap.values()].sort((a, b) => a.localeCompare(b, "es"));
  const canonicalInstitutions = new Map(institutions.map((name) => [name.toLocaleLowerCase("es-ES"), name] as const));
  teams.forEach((team) => { team.institution = canonicalInstitutions.get(team.institution.trim().toLocaleLowerCase("es-ES")) ?? team.institution; });
  judges.forEach((judge) => { judge.institution = canonicalInstitutions.get(judge.institution.trim().toLocaleLowerCase("es-ES")) ?? judge.institution; });

  const physicalRooms: PhysicalRoom[] = data.rows.SalasFisicas.map((row) => ({
    id: str(row.id), slug: str(row.slug), name: str(row.name), active: bool(row.active),
    createdAt: num(row.createdAt), updatedAt: num(row.updatedAt),
  }));
  const formats: FormatPreset[] = data.rows.Formatos.map((row) => ({
    id: str(row.id), name: str(row.name), phases: parseJson<Phase[]>(row.phases, defaultPhases()),
    version: Math.max(1, num(row.version) || 1), createdAt: num(row.createdAt), updatedAt: num(row.updatedAt),
  }));
  const minimumJudges = Math.max(1, num(configValue(config, "minimumJudgesPerRoom")) || 1);
  const timers = timerRowMap(data.rows.Cronometros);
  const rooms = data.rows.Salas.map((row) => {
    const phases = parseJson<Phase[]>(row.phases, []);
    const timer = timers.get(str(row.id)) || initialTimer(phases);
    const room: Room = {
      id: str(row.id),
      name: str(row.name),
      roundId: str(row.roundId),
      physicalRoomId: str(row.physicalRoomId),
      formatId: str(row.formatId),
      teamFavorId: str(row.teamFavorId),
      teamContraId: str(row.teamContraId),
      judgeIds: parseJson<string[]>(row.judgeIds, []),
      status: "unassigned",
      phases,
      timer,
      notes: str(row.notes),
      updatedAt: num(row.updatedAt),
    };
    room.status = deriveRoomStatus(room, minimumJudges);
    return room;
  });
  return {
    tournamentName: str(configValue(config, "tournamentName")) || "Torneo LEDU",
    rounds,
    scoring,
    teams,
    speakers,
    judges,
    rooms,
    physicalRooms,
    formats,
    activeRoundId,
    activationRevision: num(configValue(config, "activationRevision")),
    activatedAt: num(configValue(config, "activatedAt")),
    institutions,
    formatPhases: parseJson<Phase[]>(configValue(config, "formatPhases"), defaultPhases()),
    minimumJudgesPerRoom: minimumJudges,
    revision: num(configValue(config, "revision")) || 1,
    updatedAt: num(configValue(config, "updatedAt")) || Date.now(),
    serverTime: Date.now(),
  };
}
function rowObjectForRoom(room: Room, minimumJudges: number, timestamp: number): SheetRow {
  return {
    id: room.id,
    name: room.name,
    roundId: room.roundId,
    teamFavorId: room.teamFavorId || "",
    teamContraId: room.teamContraId || "",
    judgeIds: JSON.stringify(room.judgeIds || []),
    status: deriveRoomStatus(room, minimumJudges),
    phases: JSON.stringify(room.phases || []),
    notes: room.notes || "",
    updatedAt: timestamp,
    physicalRoomId: room.physicalRoomId,
    formatId: room.formatId || "",
  };
}

function rowObjectForTimer(roomId: string, timer: TimerState): SheetRow {
  return {
    roomId,
    status: timer.status,
    phaseIndex: timer.phaseIndex,
    remainingSeconds: timer.remainingSeconds,
    startedAt: timer.startedAt ?? "",
    lastResumedAt: timer.lastResumedAt ?? "",
    revision: timer.revision,
    updatedAt: timer.updatedAt || Date.now(),
  };
}

function setConfig(rows: SheetRow[], key: string, value: string): void {
  const existing = rows.find((row) => str(row.key) === key);
  if (existing) existing.value = value;
  else rows.push({ key, value });
}

async function writeTables(data: SheetData, replacements: Partial<Record<SheetName, SheetRow[]>>, appendEvent?: unknown[]): Promise<void> {
  await writePostgresTables(data, replacements, appendEvent);
}

async function redisCommand(command: Array<string | number>): Promise<unknown> {
  const url = env("UPSTASH_REDIS_REST_URL");
  const token = env("UPSTASH_REDIS_REST_TOKEN");
  if (!url || !token) throw new ApiError("NOT_CONFIGURED", "Faltan las credenciales privadas de Redis compartido en Vercel.", 503);
  let response: Response;
  try {
    response = await fetch(url.replace(/\/+$/, ""), {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(command.map(String)),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new ApiError("COORDINATION_UNAVAILABLE", "El servicio de coordinación de Vercel no responde. No se ha modificado el torneo.", 503);
  }
  const payload = await response.json().catch(() => ({})) as { result?: unknown; error?: string };
  if (!response.ok || payload.error) {
    throw new ApiError("COORDINATION_UNAVAILABLE", "Redis ha rechazado la operación de coordinación. Comprueba la conexión de Vercel.", 503);
  }
  return payload.result;
}

async function withLock<T>(_name: string, operation: () => Promise<T>): Promise<T> {
  // PostgreSQL row locks, revision checks and transactions replace the former
  // global Redis write lock. Redis is reserved for auth and room-control keys.
  return operation();
}

async function createSession(password: string, ip: string): Promise<{ token: string; expiresAt: number }> {
  if (!env("ADMIN_PASSWORD")) throw new ApiError("NOT_CONFIGURED", "Configura ADMIN_PASSWORD en las variables privadas de Vercel.", 503);
  if (password.length > 1024) throw new ApiError("INVALID_PAYLOAD", "La contraseña es demasiado larga.");
  const count = num(await redisCommand(["GET", "ledu:login-failures:" + sha256(ip)]));
  if (count >= 10) throw new ApiError("RATE_LIMITED", "Demasiados intentos de acceso. Espera 15 minutos antes de volver a intentarlo.", 429);
  if (!safeEquals(password, env("ADMIN_PASSWORD"))) {
    const failureKey = "ledu:login-failures:" + sha256(ip);
    const failures = num(await redisCommand(["INCR", failureKey]));
    if (failures === 1) await redisCommand(["EXPIRE", failureKey, 900]);
    throw new ApiError("UNAUTHORIZED", "Contraseña incorrecta.", 401);
  }
  await redisCommand(["DEL", "ledu:login-failures:" + sha256(ip)]);
  const token = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  await redisCommand(["SET", "ledu:session:" + sha256(token), JSON.stringify({
    expiresAt,
    passwordHash: sha256(env("ADMIN_PASSWORD")),
  }), "EX", SESSION_TTL_SECONDS]);
  return { token, expiresAt };
}

async function requireSession(tokenValue: unknown): Promise<void> {
  const token = str(tokenValue);
  if (!token || token.length > 200) throw new ApiError("UNAUTHORIZED", "Sesión caducada o no válida. Vuelve a iniciar sesión.", 401);
  const raw = await redisCommand(["GET", "ledu:session:" + sha256(token)]);
  if (typeof raw !== "string") throw new ApiError("UNAUTHORIZED", "Sesión caducada o no válida. Vuelve a iniciar sesión.", 401);
  try {
    const session = JSON.parse(raw) as { expiresAt?: number; passwordHash?: string };
    if (
      !session.expiresAt ||
      session.expiresAt <= Date.now() ||
      session.passwordHash !== sha256(env("ADMIN_PASSWORD"))
    ) throw new Error("expired or password changed");
  } catch {
    throw new ApiError("UNAUTHORIZED", "Sesión caducada o no válida. Vuelve a iniciar sesión.", 401);
  }
}

async function roomControllerToken(p: Record<string, unknown>): Promise<{ token: string }> {
  await requireSession(p.token);
  return withLock("database-transaction", async () => {
    const tournament = tournamentFromData(await loadSheetData(true));
    const input = str(p.roomId).toLocaleLowerCase("es-ES");
    const physical = tournament.physicalRooms.find((item) =>
      item.slug.toLocaleLowerCase("es-ES") === input || item.id.toLocaleLowerCase("es-ES") === input);
    if (!physical) throw new ApiError("ROOM_NOT_FOUND", "Guarda primero la sala física en el catálogo.", 404);
    const key = "ledu:room-control:" + sha256(physical.id);
    const current = await redisCommand(["GET", key]);
    const rotate = p.rotate === true || String(p.rotate).toLowerCase() === "true";
    if (typeof current === "string" && current && !rotate) return { token: current };
    const token = randomBytes(32).toString("hex");
    await redisCommand(["SET", key, token]);
    return { token };
  });
}


function requestIp(req: RequestLike): string {
  const forwarded = req.headers?.["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return (first || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
}

function headerValue(req: RequestLike, name: string): string {
  const value = req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function parseRequestBody(body: unknown): { action?: string; payload?: Record<string, unknown> } {
  if (typeof body === "string") {
    try { return JSON.parse(body) as { action?: string; payload?: Record<string, unknown> }; }
    catch { throw new ApiError("INVALID_JSON", "El cuerpo de la solicitud no es JSON válido."); }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  return body as { action?: string; payload?: Record<string, unknown> };
}

async function dispatch(action: string, payload: Record<string, unknown>, req: RequestLike): Promise<unknown> {
  switch (action) {
    case "login":
      return createSession(str(payload.password), requestIp(req));
    case "logout":
      if (payload.token) await redisCommand(["DEL", "ledu:session:" + sha256(str(payload.token))]);
      return { loggedOut: true };
    case "getTournament":
      await requireSession(payload.token);
      return tournamentFromData(await loadSheetData());
    case "getPublicRoom":
      return publicRoomPayload(tournamentFromData(await loadSheetData()), str(payload.roomId));
    case "getRoomControllerToken":
      return roomControllerToken(payload);
    case "saveTournament":
      await requireSession(payload.token);
      return saveTournament(payload);
    case "saveScoreConfig":
      await requireSession(payload.token);
      return saveScoreConfig(payload);
    case "getRoundActivationPreview":
      await requireSession(payload.token);
      return getRoundActivationPreview(str(payload.roundId));
    case "activateRound":
      await requireSession(payload.token);
      return activateRound(payload);
    case "updateRoomTimer":
      return updateRoomTimer(payload);
    default:
      throw new ApiError("UNKNOWN_ACTION", "Acción no reconocida.");
  }
}

async function saveTournament(payload: Record<string, unknown>): Promise<Tournament> {
  return withLock("database-transaction", async () => {
    const data = await loadSheetData(true);
    const current = tournamentFromData(data);
    if (num(payload.expectedRevision) !== current.revision) {
      throw new ApiError("REVISION_CONFLICT", "El torneo cambió en otro dispositivo. Actualiza los datos antes de guardar.", 409);
    }
    validateTournamentInput(payload.tournament);
    const tournament = payload.tournament as Tournament;
    const phases = Array.isArray(tournament.formatPhases) && tournament.formatPhases.length
      ? tournament.formatPhases
      : tournament.formats[0]?.phases || defaultPhases();
    validatePhases(phases);
    const minimumJudges = Number(tournament.minimumJudgesPerRoom === undefined ? 1 : tournament.minimumJudgesPerRoom);
    if (!Number.isInteger(minimumJudges) || minimumJudges < 1 || minimumJudges > 25) {
      throw new ApiError("INVALID_CONFIGURATION", "El mínimo de jueces por sala debe estar entre 1 y 25.");
    }

    const oldRoomRows = data.rows.Salas;
    const persistedTimers = timerRowMap(data.rows.Cronometros);
    const now = Date.now();
    const finalRooms: Room[] = tournament.rooms.map((room) => {
      const round = tournament.rounds.find((item) => item.id === room.roundId);
      const selectedFormatId = room.formatId || round?.defaultFormatId || "";
      const selectedFormat = tournament.formats.find((item) => item.id === selectedFormatId);
      const roomPhases = room.phases?.length ? room.phases : selectedFormat?.phases || phases;
      validatePhases(roomPhases);
      const old = oldRoomRows.find((row) => str(row.id) === str(room.id));
      const previous = persistedTimers.get(room.id);
      const oldPhases = parseJson<Phase[]>(old?.phases, []);
      const phaseDefinitionChanged = Boolean(old) && JSON.stringify(oldPhases) !== JSON.stringify(roomPhases);
      if (phaseDefinitionChanged && previous && (previous.status === "running" || previous.status === "paused")) {
        throw new ApiError("ACTIVE_TIMERS", "No se puede cambiar el formato efectivo de una asignación mientras su cronómetro está en curso o pausado.", 409);
      }
      let timer = previous || room.timer || initialTimer(roomPhases);
      if (phaseDefinitionChanged || timer.phaseIndex >= roomPhases.length) {
        timer = { ...initialTimer(roomPhases), revision: previous ? previous.revision + 1 : 0, updatedAt: now };
      }
      const updated = { ...room, formatId: room.formatId || "", phases: roomPhases, timer, updatedAt: now };
      updated.status = deriveRoomStatus(updated, minimumJudges);
      return updated;
    });

    const configRows = data.rows.Config.map((row) => ({ ...row }));
    const nextRevision = current.revision + 1;
    setConfig(configRows, "tournamentName", tournament.tournamentName || "Torneo LEDU");
    setConfig(configRows, "formatPhases", JSON.stringify(phases));
    setConfig(configRows, "institutions", JSON.stringify(tournament.institutions ?? []));
    setConfig(configRows, "speakers", JSON.stringify(tournament.speakers ?? []));
    setConfig(configRows, "scoring", JSON.stringify(current.scoring ?? emptyScoringConfig()));
    setConfig(configRows, "roundTypes", JSON.stringify(Object.fromEntries(
      tournament.rounds.map((round) => [round.id, round.scoreType ?? current.rounds.find((item) => item.id === round.id)?.scoreType ?? "qualifying"]),
    )));
    setConfig(configRows, "minimumJudgesPerRoom", String(minimumJudges));
    setConfig(configRows, "schemaVersion", "3");
    // Only activateRound may change the globally active round or activation revision.
    setConfig(configRows, "activeRoundId", current.activeRoundId || "");
    setConfig(configRows, "activationRevision", String(current.activationRevision || 0));
    setConfig(configRows, "activatedAt", String(current.activatedAt || 0));
    setConfig(configRows, "revision", String(nextRevision));
    setConfig(configRows, "updatedAt", String(now));

    const replacements: Partial<Record<SheetName, SheetRow[]>> = {
      Config: configRows,
      Rondas: tournament.rounds.map((round) => ({
        id: round.id, number: round.number, name: round.name,
        active: round.id === current.activeRoundId,
        defaultFormatId: round.defaultFormatId || tournament.formats[0]?.id || "",
        scoreType: round.scoreType ?? "qualifying",
      })),
      Equipos: tournament.teams.map((team) => ({ id: team.id, name: team.name, institution: team.institution, active: team.active, incompatibleJudgeIds: JSON.stringify(team.incompatibleJudgeIds ?? []) })),
      Jueces: tournament.judges.map((judge) => ({ id: judge.id, name: judge.name, institution: judge.institution, active: judge.active, incompatibleJudgeIds: JSON.stringify(judge.incompatibleJudgeIds ?? []) })),
      Salas: finalRooms.map((room) => rowObjectForRoom(room, minimumJudges, now)),
      Cronometros: finalRooms.map((room) => rowObjectForTimer(room.id, room.timer)),
      SalasFisicas: tournament.physicalRooms.map((room) => ({ ...room, updatedAt: now })),
      Formatos: tournament.formats.map((format) => ({ ...format, phases: JSON.stringify(format.phases) })),
    };
    await writeTables(data, replacements, [
      randomBytes(16).toString("hex"),
      new Date(now).toISOString(),
      "",
      "",
      "",
      "",
      "tournament_saved",
      "",
      JSON.stringify({ revision: nextRevision, teams: tournament.teams.length, judges: tournament.judges.length, rooms: finalRooms.length, rounds: tournament.rounds.length }),
    ]);

    const newPhysicalIds = new Set(tournament.physicalRooms.map((room) => room.id));
    const removedPhysicalIds = data.rows.SalasFisicas.map((row) => str(row.id)).filter((id) => id && !newPhysicalIds.has(id));
    await Promise.all(removedPhysicalIds.map((id) =>
      redisCommand(["DEL", "ledu:room-control:" + sha256(id)]).catch(() => undefined)
    ));

    return tournamentFromData(await loadSheetData(true));
  });
}


function formatTimerStatus(status: TimerState["status"]): string {
  if (status === "running") return "en marcha";
  if (status === "paused") return "pausado";
  if (status === "finished") return "finalizado";
  return "preparado/sin iniciar";
}

function pendingDebates(tournament: Tournament, now = Date.now()) {
  const activeRoundId = tournament.activeRoundId || tournament.rounds.find((round) => round.active)?.id || "";
  return tournament.rooms
    .filter((room) => room.roundId === activeRoundId && (room.teamFavorId || room.teamContraId))
    .filter((room) => room.timer.status !== "finished")
    .map((room) => {
      const phases = room.phases || [];
      const phase = phases[room.timer.phaseIndex];
      return {
        assignmentId: room.id,
        physicalRoomId: room.physicalRoomId,
        roomName: tournament.physicalRooms.find((item) => item.id === room.physicalRoomId)?.name || room.name,
        teamFavor: tournament.teams.find((item) => item.id === room.teamFavorId)?.name || "Equipo sin asignar",
        teamContra: tournament.teams.find((item) => item.id === room.teamContraId)?.name || "Equipo sin asignar",
        phaseName: phase?.name || "Sin fase",
        status: room.timer.status,
        statusLabel: formatTimerStatus(room.timer.status),
        remainingSeconds: remainingSeconds(room.timer, now),
      };
    });
}

async function getRoundActivationPreview(roundId: string) {
  if (!roundId) throw new ApiError("INVALID_ROUND", "Selecciona una ronda para activar.");
  const tournament = tournamentFromData(await loadSheetData());
  const round = tournament.rounds.find((item) => item.id === roundId);
  if (!round) throw new ApiError("ROUND_NOT_FOUND", "No se encuentra la ronda seleccionada.", 404);
  const activeRound = tournament.rounds.find((item) => item.id === tournament.activeRoundId);
  return {
    activeRoundId: tournament.activeRoundId,
    activeRoundName: activeRound?.name ?? "Ninguna",
    targetRoundId: round.id,
    targetRoundName: round.name,
    alreadyActive: round.id === tournament.activeRoundId,
    pending: pendingDebates(tournament),
    activationRevision: tournament.activationRevision,
    serverTime: Date.now(),
  };
}

async function activateRound(payload: Record<string, unknown>): Promise<Tournament> {
  const roundId = str(payload.roundId);
  const force = payload.force === true || String(payload.force).toLowerCase() === "true";
  if (!roundId) throw new ApiError("INVALID_ROUND", "Selecciona una ronda para activar.");
  return withLock("database-transaction", async () => {
    const data = await loadSheetData(true);
    const tournament = tournamentFromData(data);
    const targetRound = tournament.rounds.find((item) => item.id === roundId);
    if (!targetRound) throw new ApiError("ROUND_NOT_FOUND", "No se encuentra la ronda seleccionada.", 404);
    if (roundId === tournament.activeRoundId) throw new ApiError("ROUND_ALREADY_ACTIVE", "Esa ronda ya está activa.", 409);
    validateTournamentInput(tournament);
    const pending = pendingDebates(tournament);
    if (pending.length && !force) {
      throw new ApiError("PENDING_DEBATES", "Quedan " + pending.length + " debate(s) sin finalizar. Confirma expresamente la activación forzada.", 409);
    }

    const targetRooms = tournament.rooms.filter((room) => room.roundId === roundId);
    const minimumJudges = tournament.minimumJudgesPerRoom || 1;
    for (const room of targetRooms) {
      const hasAnyAssignment = Boolean(room.teamFavorId || room.teamContraId || room.judgeIds.length);
      if (!hasAnyAssignment) continue;
      if (!room.teamFavorId || !room.teamContraId || room.teamFavorId === room.teamContraId || room.judgeIds.length < minimumJudges) {
        throw new ApiError("INVALID_ASSIGNMENT", "La asignación de " + room.name + " está incompleta. Cada debate debe tener dos equipos distintos y al menos " + minimumJudges + " juez(es).");
      }
    }

    const now = Date.now();
    const formatsById = new Map(tournament.formats.map((format) => [format.id, format] as const));
    const rounds = tournament.rounds.map((round) => ({ ...round, active: round.id === roundId }));
    const nextRooms: Room[] = tournament.rooms.map((room) => {
      if (room.roundId === roundId) {
        const selectedFormatId = room.formatId || targetRound.defaultFormatId || tournament.formats[0]?.id || "";
        const format = formatsById.get(selectedFormatId);
        const phases = (format?.phases || room.phases || tournament.formatPhases || defaultPhases()).map((phase) => ({ ...phase }));
        validatePhases(phases);
        const previousRevision = timerRowMap(data.rows.Cronometros).get(room.id)?.revision ?? room.timer.revision;
        const timer = { ...initialTimer(phases), revision: previousRevision + 1, updatedAt: now };
        const next = { ...room, formatId: room.formatId || "", phases, timer, updatedAt: now };
        next.status = deriveRoomStatus(next, minimumJudges);
        return next;
      }
      if (room.roundId === tournament.activeRoundId && room.timer.status !== "finished") {
        let timer = room.timer;
        if (timer.status === "running") timer = transitionTimer(timer, room.phases, "pause", now);
        else if (timer.status === "paused") timer = { ...timer, revision: timer.revision + 1, updatedAt: now };
        const next = { ...room, timer, updatedAt: now };
        next.status = deriveRoomStatus(next, minimumJudges);
        return next;
      }
      return room;
    });

    const pendingDetails = pending.map((item) => ({
      room: item.roomName,
      teams: [item.teamFavor, item.teamContra],
      phase: item.phaseName,
      status: item.statusLabel,
      remainingSeconds: item.remainingSeconds,
    }));
    const configRows = data.rows.Config.map((row) => ({ ...row }));
    setConfig(configRows, "roundTypes", JSON.stringify(Object.fromEntries(rounds.map((round) => [round.id, round.scoreType ?? "qualifying"]))));
    setConfig(configRows, "activeRoundId", roundId);
    setConfig(configRows, "activationRevision", String((tournament.activationRevision || 0) + 1));
    setConfig(configRows, "activatedAt", String(now));
    setConfig(configRows, "revision", String(tournament.revision + 1));
    setConfig(configRows, "updatedAt", String(now));
    const event = [
      randomBytes(16).toString("hex"),
      new Date(now).toISOString(),
      "round:" + roundId,
      roundId,
      "",
      "",
      pending.length ? "round_activated_forced" : "round_activated",
      "",
      JSON.stringify({ targetRoundName: targetRound.name, forced: pending.length > 0, pending: pendingDetails, activationRevision: (tournament.activationRevision || 0) + 1 }),
    ];
    const replacements: Partial<Record<SheetName, SheetRow[]>> = {
      Config: configRows,
      Rondas: rounds.map((round) => ({ id: round.id, number: round.number, name: round.name, active: round.id === roundId, defaultFormatId: round.defaultFormatId, scoreType: round.scoreType ?? "qualifying" })),
      Salas: nextRooms.map((room) => rowObjectForRoom(room, minimumJudges, now)),
      Cronometros: nextRooms.map((room) => rowObjectForTimer(room.id, room.timer)),
    };
    await writeTables(data, replacements, event);
    return tournamentFromData(await loadSheetData(true));
  });
}



async function saveScoreConfig(payload: Record<string, unknown>): Promise<Tournament> {
  return withLock("database-transaction", async () => {
    const data = await loadSheetData(true);
    const current = tournamentFromData(data);
    if (num(payload.expectedRevision) !== current.revision) {
      throw new ApiError("REVISION_CONFLICT", "El torneo cambió en otro dispositivo. Actualiza antes de registrar puntuaciones.", 409);
    }

    const categories = payload.categories;
    const scorecards = payload.scorecards;
    if (!Array.isArray(categories) || !Array.isArray(scorecards)) {
      throw new ApiError("INVALID_SCORING", "Las categorías y actas deben ser listas válidas.");
    }
    const candidate = parseScoringConfig({ categories, scorecards });
    if (!candidate.categories.length || candidate.categories.length > 30) {
      throw new ApiError("INVALID_SCORE_CATEGORIES", "Debe haber entre 1 y 30 categorías de puntuación.");
    }
    const categoryIds = new Set<string>();
    const categoryNames = new Set<string>();
    for (const category of candidate.categories) {
      const id = str(category.id).trim();
      const name = str(category.name).trim();
      const normalizedName = name.toLocaleLowerCase("es-ES");
      if (!id || !name || name.length > 100 || categoryIds.has(id) || categoryNames.has(normalizedName) ||
          !Number.isInteger(category.order) || category.order < 0) {
        throw new ApiError("INVALID_SCORE_CATEGORIES", "Las categorías deben tener IDs y nombres únicos, nombres no vacíos y orden válido.");
      }
      categoryIds.add(id);
      categoryNames.add(normalizedName);
    }
    if (candidate.scorecards.length > 10000) throw new ApiError("INVALID_SCORING", "Se ha superado el límite de actas.");
    const previous = current.scoring ?? emptyScoringConfig();
    const savedIds = new Set<string>();
    const savedRoomIds = new Set<string>();
    if (candidate.scorecards.length !== scorecards.length) {
      throw new ApiError("INVALID_SCORING", "Una o más actas tienen una estructura inválida.");
    }
    for (const card of candidate.scorecards) {
      if (!card.id || savedIds.has(card.id) || !card.roomId || savedRoomIds.has(card.roomId)) {
        throw new ApiError("INVALID_SCORECARD", "Debe existir como máximo un acta por asignación, con identificadores únicos.");
      }
      savedIds.add(card.id);
      savedRoomIds.add(card.roomId);
      const previousCard = previous.scorecards.find((item) => item.id === card.id);
      const changed = !previousCard || previousCard.updatedAt !== card.updatedAt;
      if (changed) {
        const issues = validateScorecard(card, candidate.categories, {
          rounds: current.rounds,
          rooms: current.rooms,
          teams: current.teams,
          judges: current.judges,
          speakers: current.speakers ?? [],
        });
        if (issues.length) throw new ApiError("INVALID_SCORECARD", issues.slice(0, 5).join(" "));
      }
    }
    // Category IDs are immutable links. Removing one still referenced by an act
    // would make historical totals and criteria impossible to interpret.
    const removedInUse = previous.categories.filter((category) =>
      !categoryIds.has(category.id) && previous.scorecards.some((card) =>
        card.teams.some((team) => Object.prototype.hasOwnProperty.call(team.categoryScores, category.id))));
    if (removedInUse.length) {
      throw new ApiError("SCORE_CATEGORY_IN_USE", "No se puede eliminar una categoría usada por actas históricas (" +
        removedInUse.map((item) => item.name).join(", ") + "). Renómbrala o consérvala para proteger el historial.");
    }

    const now = Date.now();
    const savedScorecards = candidate.scorecards.map((card) => {
      const existing = previous.scorecards.find((item) => item.id === card.id);
      return {
        ...card,
        createdAt: existing?.createdAt ?? card.createdAt ?? now,
        updatedAt: now,
        teams: card.teams.map((team) => ({
          ...team,
          teamName: current.teams.find((item) => item.id === team.teamId)?.name ?? team.teamName,
          total: sumCategoryScores(team.categoryScores, candidate.categories),
        })) as RoundScorecard["teams"],
        roundName: current.rounds.find((item) => item.id === card.roundId)?.name ?? card.roundName,
        roomName: current.rooms.find((item) => item.id === card.roomId)?.name ?? card.roomName,
        judges: card.judges.map((judge) => ({
          judgeId: judge.judgeId,
          judgeName: current.judges.find((item) => item.id === judge.judgeId)?.name ?? judge.judgeName,
        })),
        speakers: card.speakers.map((speaker) => ({
          ...speaker,
          speakerName: (current.speakers ?? []).find((item) => item.id === speaker.speakerId)?.name ?? speaker.speakerName,
        })),
      };
    });
    const scoring: ScoringConfig = { categories: candidate.categories, scorecards: savedScorecards };
    const configRows = data.rows.Config.map((row) => ({ ...row }));
    setConfig(configRows, "scoring", JSON.stringify(scoring));
    const nextRevision = current.revision + 1;
    setConfig(configRows, "revision", String(nextRevision));
    setConfig(configRows, "updatedAt", String(now));
    await writeTables(data, { Config: configRows }, [
      randomBytes(16).toString("hex"), new Date(now).toISOString(), "scoring", "",
      "", "", "scorecard_saved", "", JSON.stringify({ scorecards: savedScorecards.length, categories: candidate.categories.length }),
    ]);
    return tournamentFromData(await loadSheetData(true));
  });
}

async function updateRoomTimer(payload: Record<string, unknown>): Promise<unknown> {
  const roomSlugInput = str(payload.roomId);
  const action = str(payload.action) as TimerAction;
  if (!roomSlugInput || !["start", "pause", "reset", "next", "previous", "finish"].includes(action)) {
    throw new ApiError("INVALID_ACTION", "La acción de cronómetro o el identificador de sala no son válidos.");
  }
  return withLock("room-timer", async () => {
    const data = await loadSheetData(true);
    const tournament = tournamentFromData(data);
    const physical = tournament.physicalRooms.find((item) =>
      item.slug.toLocaleLowerCase("es-ES") === roomSlugInput.toLocaleLowerCase("es-ES") ||
      item.id.toLocaleLowerCase("es-ES") === roomSlugInput.toLocaleLowerCase("es-ES"));
    if (!physical) throw new ApiError("ROOM_NOT_FOUND", "No se encuentra esa sala física.", 404);

    const controlKey = str(payload.controlKey);
    const expectedToken = await redisCommand(["GET", "ledu:room-control:" + sha256(physical.id)]);
    if (!controlKey || typeof expectedToken !== "string" || !safeEquals(controlKey, expectedToken)) {
      throw new ApiError("UNAUTHORIZED", "Abre esta sala desde el panel de organización para controlar el cronómetro.", 401);
    }

    // A deterministic key makes a retried request return the already committed
    // response, even if the first HTTP response was lost after COMMIT.
    const requestedAssignmentId = str(payload.assignmentId);
    const idempotencyScope = "timer:" + physical.id + ":" + requestedAssignmentId;
    const idempotencyKey = sha256([idempotencyScope, str(payload.expectedRevision), action].join(":"));
    const previousResponse = await readIdempotentResponse(idempotencyKey, idempotencyScope);
    if (previousResponse !== null) return previousResponse;

    const activeRoundId = tournament.activeRoundId || tournament.rounds.find((round) => round.active)?.id || "";
    const room = tournament.rooms.find((item) => item.physicalRoomId === physical.id && item.roundId === activeRoundId);
    if (!room) throw new ApiError("NO_ASSIGNMENT", "Esta sala no tiene debate asignado en la ronda activa.", 409);
    if (requestedAssignmentId !== room.id || num(payload.expectedActivationRevision) !== tournament.activationRevision) {
      throw new ApiError("STALE_ASSIGNMENT", "La ronda o asignación ha cambiado. Se han recargado los datos; vuelve a intentarlo.", 409);
    }
    if (payload.expectedRevision === undefined || num(payload.expectedRevision) !== room.timer.revision) {
      throw new ApiError("REVISION_CONFLICT", "El cronómetro cambió en otro dispositivo. Actualiza el estado.", 409);
    }
    const now = Date.now();
    if (tournament.activatedAt > 0 && now < tournament.activatedAt + 20_000) {
      throw new ApiError("ROUND_TRANSITION", "La nueva ronda se está anunciando en las pantallas. Los controles del cronómetro estarán disponibles al terminar la transición de 20 segundos.", 409);
    }
    if (action === "start") {
      if (!room.teamFavorId || !room.teamContraId || room.teamFavorId === room.teamContraId || room.judgeIds.length < (tournament.minimumJudgesPerRoom || 1)) {
        throw new ApiError("INVALID_ASSIGNMENT", "Asigna dos equipos distintos y al menos " + (tournament.minimumJudgesPerRoom || 1) + " juez(es) antes de iniciar.");
      }
      const conflicts = findAssignmentConflicts({ teams: tournament.teams, judges: tournament.judges, rooms: [room] });
      if (conflicts.length) {
        const code = conflicts.some((conflict) => conflict.type === "institution")
          ? "INSTITUTION_CONFLICT"
          : conflicts.some((conflict) => conflict.type === "team-judge")
            ? "TEAM_JUDGE_CONFLICT"
            : "JUDGE_JUDGE_CONFLICT";
        throw new ApiError(code, room.name + ": " + [...new Set(conflicts.map((conflict) => conflict.message))].join(" "));
      }
      validatePhases(room.phases);
    }

    const beforeStatus = room.timer.status;
    const beforeRemaining = remainingSeconds(room.timer, now);
    const previousIndex = room.timer.phaseIndex;
    const nextTimer = transitionTimer(room.timer, room.phases, action, now);
    if (nextTimer.revision === room.timer.revision) return publicRoomPayload(tournament, physical.slug);
    const updatedRoom: Room = {
      ...room,
      timer: nextTimer,
      status: deriveRoomStatus({ ...room, timer: nextTimer }, tournament.minimumJudgesPerRoom || 1),
      updatedAt: now,
    };
    const rooms = tournament.rooms.map((item) => item.id === room.id ? updatedRoom : item);
    const timers = data.rows.Cronometros.map((row) => ({ ...row }));
    const existingTimerIndex = timers.findIndex((row) => str(row.roomId) === room.id);
    const timerRow = rowObjectForTimer(room.id, nextTimer);
    if (existingTimerIndex < 0) timers.push(timerRow);
    else timers[existingTimerIndex] = timerRow;
    const roomRows = data.rows.Salas.map((row) => ({ ...row }));
    const existingRoomIndex = roomRows.findIndex((row) => str(row.id) === room.id);
    const newRoomRow = rowObjectForRoom(updatedRoom, tournament.minimumJudgesPerRoom || 1, now);
    if (existingRoomIndex < 0) throw new ApiError("SCHEMA_MISMATCH", "La asignación no tiene una fila persistida.", 503);
    roomRows[existingRoomIndex] = newRoomRow;

    const response = publicRoomPayload({ ...tournament, rooms }, physical.slug);
    const phase = room.phases[previousIndex];
    const eventNames: Record<TimerAction, string> = {
      start: beforeStatus === "paused" ? "resumed" : "started",
      pause: "paused",
      reset: "reset",
      next: nextTimer.status === "finished" ? "finished" : "phase_advanced",
      previous: "phase_rewound",
      finish: "finished",
    };
    const elapsed = Math.max(0, num(phase?.durationSeconds) - beforeRemaining);
    const event = [
      randomBytes(16).toString("hex"),
      new Date(now).toISOString(),
      room.id,
      room.roundId,
      physical.id,
      previousIndex,
      eventNames[action],
      Math.round(elapsed),
      JSON.stringify({
        action, fromStatus: beforeStatus, toStatus: nextTimer.status,
        revision: nextTimer.revision, activationRevision: tournament.activationRevision,
        idempotencyKey, idempotencyScope, idempotencyResponse: response,
      }),
    ];
    try {
      await writeTables(data, { Salas: roomRows, Cronometros: timers }, event);
    } catch (error) {
      const committedResponse = await readIdempotentResponse(idempotencyKey, idempotencyScope);
      if (committedResponse !== null) return committedResponse;
      throw error;
    }
    return response;
  });
}


async function health(): Promise<unknown> {
  ensureConfigured();
  const database = await checkDatabase();
  const ping = await redisCommand(["PING"]);
  if (ping !== "PONG") throw new ApiError("COORDINATION_UNAVAILABLE", "No se ha podido verificar el servicio de coordinación.", 503);
  return {
    status: "ok",
    service: "LEDU Tournament Desk API",
    database: "Neon PostgreSQL",
    serverTime: database.serverTime,
    now: Date.now(),
  };
}

function statusForError(error: unknown): number {
  if (error instanceof ApiError) return error.status;
  return 500;
}

function errorPayload(error: unknown): { ok: false; error: { code: string; message: string } } {
  if (error instanceof ApiError) return { ok: false, error: { code: error.code, message: error.message } };
  return { ok: false, error: { code: "INTERNAL_ERROR", message: "Se ha producido un error inesperado. No se ha podido confirmar la operación." } };
}

export default async function handler(req: RequestLike, res: ResponseLike): Promise<void> {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  try {
    if (req.method === "GET") {
      const action = Array.isArray(req.query?.action) ? req.query?.action[0] : req.query?.action;
      if (action !== "health") throw new ApiError("METHOD_NOT_ALLOWED", "Usa POST para operar con la API.", 405);
      const result = await health();
      res.status(200).json({ ok: true, data: result });
      return;
    }
    if (req.method !== "POST") throw new ApiError("METHOD_NOT_ALLOWED", "Método HTTP no permitido.", 405);

    const origin = headerValue(req, "origin");
    const host = headerValue(req, "host");
    if (origin && host) {
      try {
        if (new URL(origin).host !== host) throw new ApiError("ORIGIN_NOT_ALLOWED", "Origen no permitido.", 403);
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError("ORIGIN_NOT_ALLOWED", "Origen no permitido.", 403);
      }
    }

    ensureConfigured();
    const body = parseRequestBody(req.body);
    const action = str(body.action);
    const payload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
      ? body.payload
      : {};
    const result = await dispatch(action, payload, req);
    res.status(200).json({ ok: true, data: result });
  } catch (error) {
    if (!(error instanceof ApiError)) console.error("[ledu-api] Unexpected request failure", error);
    const result = errorPayload(error);
    res.status(statusForError(error)).json(result);
  }
}
