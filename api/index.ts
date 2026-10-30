import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FormatPreset, Phase, PhysicalRoom, Room, Round, TimerState, Tournament } from "../src/domain.js";
import { checkDatabase, databaseConfigured, getPool } from "./db.js";
import { readTabulationActaHistory } from "./tabulation-acta-history.js";
import { presetSettings } from "../src/tabulation/presets.js";
import { validateTabulationSettings as validateTabulationSettingsPayload, TabulationSettingsValidationError } from "./tabulation-settings-validation.js";
import { TAB_SCHEMA_VERSION, type TabSettings } from "../src/tabulation/types.js";
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
    ...(configValue(config, "remoteId") ? { remoteId: configValue(config, "remoteId") } : {}),
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
    case "getTabulationSettings":
      await requireSession(payload.token);
      return getTabulationSettings();
    case "saveTabulationSettings":
      await requireSession(payload.token);
      return saveTabulationSettings(payload);
    case "getTabulationActaHistory":
      await requireSession(payload.token);
      return getTabulationActaHistory(payload);
    case "getPublicRoom":
      return publicRoomPayload(tournamentFromData(await loadSheetData()), str(payload.roomId));
    case "roomHeartbeat":
      return roomHeartbeat(payload);
    case "getRoomConnectionStatuses":
      await requireSession(payload.token);
      return getRoomConnectionStatuses();
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

type PersistedTabulationSettings = {
  schemaVersion: number;
  tournamentId: string;
  revision: number;
  settings: TabSettings;
  updatedAt: number | null;
  updatedBy: string;
};

const TABULATION_SETTINGS_DEFAULT_PRESET = "ledu-groups" as const;

function validateTabulationSettings(value: unknown): TabSettings {
  try {
    return validateTabulationSettingsPayload(value);
  } catch (error) {
    if (error instanceof TabulationSettingsValidationError) {
      throw new ApiError("INVALID_PAYLOAD", error.message);
    }
    throw error;
  }
}

function defaultPersistedTabulationSettings(tournamentId: string): PersistedTabulationSettings {
  return {
    schemaVersion: TAB_SCHEMA_VERSION,
    tournamentId,
    revision: 0,
    settings: presetSettings(TABULATION_SETTINGS_DEFAULT_PRESET),
    updatedAt: null,
    updatedBy: "system-default:" + TABULATION_SETTINGS_DEFAULT_PRESET,
  };
}

function isMissingTabulationSettingsMigration(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && ["42P01", "42703"].includes(String((error as { code?: unknown }).code)));
}

async function getTabulationSettings(): Promise<PersistedTabulationSettings> {
  const pool = getPool();
  let result;
  try {
    result = await pool.query("SELECT schema_version, revision, settings, updated_at, updated_by, tournament_id FROM tabulation_settings WHERE id = 1");
  } catch (error) {
    if (isMissingTabulationSettingsMigration(error)) throw new ApiError("MIGRATION_REQUIRED", "Falta aplicar las migraciones 0010_tabulation_settings.sql y 0011_tournament_identity.sql en la base de datos del entorno. No se ha modificado ningún dato.", 503);
    throw error;
  }
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row || !row.tournament_id) throw new ApiError("MIGRATION_REQUIRED", "Falta aplicar la migración 0011_tournament_identity.sql en la base de datos del entorno.", 503);
  if (!row.settings || Object.keys(row.settings as object).length === 0) return defaultPersistedTabulationSettings(str(row.tournament_id));
  const schemaVersion = num(row.schema_version);
  if (schemaVersion > TAB_SCHEMA_VERSION) {
    throw new ApiError("SCHEMA_TOO_NEW", "Las reglas fueron guardadas con una versión más reciente. Esta versión entra en solo lectura; actualiza la aplicación.", 409);
  }
  return {
    schemaVersion,
    tournamentId: str(row.tournament_id),
    revision: num(row.revision),
    settings: validateTabulationSettings(row.settings),
    updatedAt: row.updated_at ? new Date(String(row.updated_at)).getTime() : null,
    updatedBy: str(row.updated_by) || "unknown",
  };
}

async function getTabulationActaHistory(payload: Record<string, unknown>) {
  const assignmentId = str(payload.assignmentId).trim();
  if (!assignmentId || assignmentId.length > 128) {
    throw new ApiError("INVALID_PAYLOAD", "Indica una asignación válida para consultar su historial.");
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const history = await readTabulationActaHistory(client, assignmentId);
    await client.query("COMMIT");
    return history;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof ApiError) throw error;
    if (isMissingTabulationSettingsMigration(error)) {
      throw new ApiError("MIGRATION_REQUIRED", "Falta aplicar la migración 0012_tabulation_acta_sources.sql en la base de datos de este entorno. No se ha modificado ningún dato.", 503);
    }
    throw new ApiError("DATABASE_UNAVAILABLE", "No se ha podido consultar el historial de actas.", 503);
  } finally {
    client.release();
  }
}

async function saveTabulationSettings(payload: Record<string, unknown>): Promise<PersistedTabulationSettings> {
  const settings = validateTabulationSettings(payload.settings);
  const schemaVersion = num(payload.schemaVersion);
  if (schemaVersion !== TAB_SCHEMA_VERSION) throw new ApiError("SCHEMA_MISMATCH", "Actualiza la aplicación antes de guardar estas reglas.", 409);
  const expectedRevision = num(payload.expectedRevision);
  const operationId = str(payload.operationId);
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(operationId)) throw new ApiError("INVALID_PAYLOAD", "Falta un identificador de operación válido.");
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new ApiError("INVALID_PAYLOAD", "La revisión esperada no es válida.");
  const payloadHash = sha256(JSON.stringify({ schemaVersion, expectedRevision, settings }));
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const priorOperation = await client.query(
      "SELECT payload_hash, response FROM tabulation_settings_operations WHERE operation_id = $1",
      [operationId],
    );
    if (priorOperation.rows[0]) {
      const prior = priorOperation.rows[0] as { payload_hash: string; response: PersistedTabulationSettings };
      if (prior.payload_hash !== payloadHash) throw new ApiError("IDEMPOTENCY_MISMATCH", "El identificador de operación ya se utilizó con otro contenido.", 409);
      await client.query("COMMIT");
      return prior.response;
    }
    const currentResult = await client.query("SELECT revision, tournament_id FROM tabulation_settings WHERE id = 1 FOR UPDATE");
    // Another request may have committed the same operation while this request waited for the row lock.
    const replayAfterLock = await client.query(
      "SELECT payload_hash, response FROM tabulation_settings_operations WHERE operation_id = $1",
      [operationId],
    );
    if (replayAfterLock.rows[0]) {
      const prior = replayAfterLock.rows[0] as { payload_hash: string; response: PersistedTabulationSettings };
      if (prior.payload_hash !== payloadHash) throw new ApiError("IDEMPOTENCY_MISMATCH", "El identificador de operación ya se utilizó con otro contenido.", 409);
      await client.query("COMMIT");
      return prior.response;
    }
    const currentRow = currentResult.rows[0] as { revision?: unknown; tournament_id?: unknown } | undefined;
    const currentRevision = num(currentRow?.revision);
    const tournamentId = str(currentRow?.tournament_id);
    if (!tournamentId) throw new ApiError("MIGRATION_REQUIRED", "Falta aplicar la migración 0011_tournament_identity.sql en la base de datos del entorno.", 503);
    if (currentRevision !== expectedRevision) {
      throw new ApiError("REVISION_CONFLICT", "Las reglas han cambiado en otro dispositivo. Recarga la configuración antes de guardar.", 409);
    }
    const nextRevision = currentRevision + 1;
    const now = Date.now();
    const response: PersistedTabulationSettings = {
      schemaVersion: TAB_SCHEMA_VERSION, tournamentId, revision: nextRevision,
      settings, updatedAt: now, updatedBy: "admin",
    };
    await client.query(
      "UPDATE tabulation_settings SET schema_version = $1, revision = $2, settings = $3::jsonb, updated_at = now(), updated_by = $4 WHERE id = 1",
      [TAB_SCHEMA_VERSION, nextRevision, JSON.stringify(settings), "admin"],
    );
    await client.query(
      "INSERT INTO tabulation_settings_versions(tournament_id, revision, schema_version, settings, operation_id, updated_by) VALUES ($1, $2, $3, $4::jsonb, $5, $6)",
      [tournamentId, nextRevision, TAB_SCHEMA_VERSION, JSON.stringify(settings), operationId, "admin"],
    );
    await client.query(
      "INSERT INTO tabulation_settings_operations(operation_id, payload_hash, response) VALUES ($1, $2, $3::jsonb)",
      [operationId, payloadHash, JSON.stringify(response)],
    );
    await client.query(
      "INSERT INTO audit_events(event_key, event_type, details) VALUES ($1, $2, $3::jsonb)",
      ["tabulation-settings:" + operationId, "tabulation_settings_updated", JSON.stringify({ revision: nextRevision, schemaVersion: TAB_SCHEMA_VERSION, presetId: settings.presetId, operationId, updatedBy: "admin" })],
    );
    await client.query("UPDATE tournament_settings SET revision = revision + 1, updated_at = now() WHERE id = 1");
    await client.query("COMMIT");
    return response;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof ApiError) throw error;
    if (isMissingTabulationSettingsMigration(error)) {
      throw new ApiError("MIGRATION_REQUIRED", "Falta aplicar la migración 0010_tabulation_settings.sql en la base de datos del entorno. No se ha modificado ningún dato.", 503);
    }
    throw new ApiError("DATABASE_UNAVAILABLE", "No se han podido guardar las reglas de tabulación en PostgreSQL.", 503);
  } finally {
    client.release();
  }
}

async function saveTournament(payload: Record<string, unknown>): Promise<Tournament> {
  return withLock("database-transaction", async () => {
    const expectedRevision = num(payload.expectedRevision);
    const idempotencyScope = "saveTournament:" + expectedRevision;
    const idempotencyKey = sha256("saveTournament:" + expectedRevision + ":" + sha256(JSON.stringify(payload.tournament) || ""));
    const cachedResponse = await readIdempotentResponse(idempotencyKey, idempotencyScope);
    if (cachedResponse !== null) return cachedResponse as Tournament;
    const data = await loadSheetData(true);
    const current = tournamentFromData(data);
    if (expectedRevision !== current.revision) {
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

    const candidateReplacements: Partial<Record<SheetName, SheetRow[]>> = {
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

    // Compare persisted semantics, not transient updatedAt values. The API still
    // returns a complete tournament snapshot, but PostgreSQL only receives the
    // entity sets that actually changed.
    const sorted = <T>(items: T[], key: (item: T) => string) => [...items].sort((a, b) => key(a).localeCompare(key(b)));
    const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
    const roundsChanged = !sameValue(
      sorted(data.rows.Rondas, (row) => str(row.id)).map((row) => [str(row.id), num(row.number), str(row.name), bool(row.active), str(row.defaultFormatId), str(row.scoreType)]),
      sorted(candidateReplacements.Rondas!, (row) => str(row.id)).map((row) => [str(row.id), num(row.number), str(row.name), bool(row.active), str(row.defaultFormatId), str(row.scoreType)]),
    );
    const teamsChanged = !sameValue(
      sorted(data.rows.Equipos, (row) => str(row.id)).map((row) => [str(row.id), str(row.name), str(row.institution), bool(row.active), parseStringArray(row.incompatibleJudgeIds).sort()]),
      sorted(candidateReplacements.Equipos!, (row) => str(row.id)).map((row) => [str(row.id), str(row.name), str(row.institution), bool(row.active), parseStringArray(row.incompatibleJudgeIds).sort()]),
    );
    const judgesChanged = !sameValue(
      sorted(data.rows.Jueces, (row) => str(row.id)).map((row) => [str(row.id), str(row.name), str(row.institution), bool(row.active), parseStringArray(row.incompatibleJudgeIds).sort()]),
      sorted(candidateReplacements.Jueces!, (row) => str(row.id)).map((row) => [str(row.id), str(row.name), str(row.institution), bool(row.active), parseStringArray(row.incompatibleJudgeIds).sort()]),
    );
    const roomSignature = (row: SheetRow) => [
      str(row.id), str(row.roundId), str(row.physicalRoomId), str(row.formatId),
      str(row.teamFavorId), str(row.teamContraId), str(row.notes),
      parseJson<Phase[]>(row.phases, []),
      parseStringArray(row.judgeIds).sort(),
    ];
    const roomsChanged = !sameValue(
      sorted(data.rows.Salas, (row) => str(row.id)).map(roomSignature),
      sorted(candidateReplacements.Salas!, (row) => str(row.id)).map(roomSignature),
    );
    const timerSignature = (row: SheetRow) => [
      str(row.roomId), str(row.status), num(row.phaseIndex), num(row.remainingSeconds),
      num(row.startedAt), num(row.lastResumedAt), num(row.revision), num(row.updatedAt),
    ];
    const timersChanged = !sameValue(
      sorted(data.rows.Cronometros, (row) => str(row.roomId)).map(timerSignature),
      sorted(candidateReplacements.Cronometros!, (row) => str(row.roomId)).map(timerSignature),
    );
    const physicalRoomsChanged = !sameValue(
      sorted(data.rows.SalasFisicas, (row) => str(row.id)).map((row) => [str(row.id), str(row.slug), str(row.name), bool(row.active)]),
      sorted(candidateReplacements.SalasFisicas!, (row) => str(row.id)).map((row) => [str(row.id), str(row.slug), str(row.name), bool(row.active)]),
    );
    const formatsChanged = !sameValue(
      sorted(data.rows.Formatos, (row) => str(row.id)).map((row) => [str(row.id), str(row.name), num(row.version), parseJson<Phase[]>(row.phases, [])]),
      sorted(candidateReplacements.Formatos!, (row) => str(row.id)).map((row) => [str(row.id), str(row.name), num(row.version), parseJson<Phase[]>(row.phases, [])]),
    );

    const replacements: Partial<Record<SheetName, SheetRow[]>> = { Config: configRows };
    if (roundsChanged) replacements.Rondas = candidateReplacements.Rondas;
    if (teamsChanged) replacements.Equipos = candidateReplacements.Equipos;
    if (judgesChanged) replacements.Jueces = candidateReplacements.Jueces;
    if (roomsChanged) replacements.Salas = candidateReplacements.Salas;
    if (timersChanged) replacements.Cronometros = candidateReplacements.Cronometros;
    if (physicalRoomsChanged) replacements.SalasFisicas = candidateReplacements.SalasFisicas;
    if (formatsChanged) replacements.Formatos = candidateReplacements.Formatos;

    const response = tournamentFromData({ ...data, rows: { ...data.rows, ...candidateReplacements } });
    try {
      await writeTables(data, replacements, [
        randomBytes(16).toString("hex"),
        new Date(now).toISOString(),
        "",
        "",
        "",
        "",
        "tournament_saved",
        "",
        JSON.stringify({
          revision: nextRevision,
          teams: tournament.teams.length,
          judges: tournament.judges.length,
          rooms: finalRooms.length,
          rounds: tournament.rounds.length,
          idempotencyKey,
          idempotencyScope,
          idempotencyResponse: response,
        }),
      ]);
    } catch (error) {
      const committedResponse = await readIdempotentResponse(idempotencyKey, idempotencyScope);
      if (committedResponse !== null) return committedResponse as Tournament;
      throw error;
    }

    const newPhysicalIds = new Set(tournament.physicalRooms.map((room) => room.id));
    const removedPhysicalIds = data.rows.SalasFisicas.map((row) => str(row.id)).filter((id) => id && !newPhysicalIds.has(id));
    await Promise.all(removedPhysicalIds.map((id) =>
      redisCommand(["DEL", "ledu:room-control:" + sha256(id)]).catch(() => undefined)
    ));

    return response;
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
  const expectedActivationRevision = payload.expectedActivationRevision === undefined
    ? null
    : num(payload.expectedActivationRevision);
  if (!roundId) throw new ApiError("INVALID_ROUND", "Selecciona una ronda para activar.");
  const idempotencyScope = expectedActivationRevision === null ? "" : "activateRound:" + expectedActivationRevision;
  const idempotencyKey = expectedActivationRevision === null
    ? ""
    : sha256("activateRound:" + expectedActivationRevision + ":" + roundId + ":" + force);

  return withLock("database-transaction", async () => {
    if (idempotencyKey) {
      const cachedResponse = await readIdempotentResponse(idempotencyKey, idempotencyScope);
      if (cachedResponse !== null) return cachedResponse as Tournament;
    }
    const data = await loadSheetData(true);
    const tournament = tournamentFromData(data);
    if (expectedActivationRevision !== null && expectedActivationRevision !== tournament.activationRevision) {
      throw new ApiError("REVISION_CONFLICT", "La ronda activa ha cambiado desde que se preparó la activación. Actualiza la vista y vuelve a confirmar.", 409);
    }
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
    const persistedTimers = timerRowMap(data.rows.Cronometros);
    const rounds = tournament.rounds.map((round) => ({ ...round, active: round.id === roundId }));
    const nextRooms: Room[] = tournament.rooms.map((room) => {
      if (room.roundId === roundId) {
        const selectedFormatId = room.formatId || targetRound.defaultFormatId || tournament.formats[0]?.id || "";
        const format = formatsById.get(selectedFormatId);
        const phases = (format?.phases || room.phases || tournament.formatPhases || defaultPhases()).map((phase) => ({ ...phase }));
        validatePhases(phases);
        const previousRevision = persistedTimers.get(room.id)?.revision ?? room.timer.revision;
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
    const replacements: Partial<Record<SheetName, SheetRow[]>> = {
      Config: configRows,
      Rondas: rounds.map((round) => ({ id: round.id, number: round.number, name: round.name, active: round.id === roundId, defaultFormatId: round.defaultFormatId, scoreType: round.scoreType ?? "qualifying" })),
      Salas: nextRooms.map((room) => rowObjectForRoom(room, minimumJudges, now)),
      Cronometros: nextRooms.map((room) => rowObjectForTimer(room.id, room.timer)),
    };
    const response = tournamentFromData({ ...data, rows: { ...data.rows, ...replacements } });
    const eventDetails: Record<string, unknown> = {
      targetRoundName: targetRound.name,
      forced: pending.length > 0,
      pending: pendingDetails,
      activationRevision: (tournament.activationRevision || 0) + 1,
    };
    if (idempotencyKey) {
      eventDetails.idempotencyKey = idempotencyKey;
      eventDetails.idempotencyScope = idempotencyScope;
      eventDetails.idempotencyResponse = response;
    }
    const event = [
      randomBytes(16).toString("hex"),
      new Date(now).toISOString(),
      "round:" + roundId,
      roundId,
      "",
      "",
      pending.length ? "round_activated_forced" : "round_activated",
      "",
      JSON.stringify(eventDetails),
    ];
    try {
      await writeTables(data, replacements, event);
    } catch (error) {
      if (idempotencyKey) {
        const committedResponse = await readIdempotentResponse(idempotencyKey, idempotencyScope);
        if (committedResponse !== null) return committedResponse as Tournament;
      }
      throw error;
    }
    return response;
  });
}


function scorecardComparable(card: RoundScorecard): string {
  return JSON.stringify({
    id: card.id,
    roundId: card.roundId,
    roomId: card.roomId,
    teamFavorId: card.teamFavorId,
    teamContraId: card.teamContraId,
    judges: card.judges.map((judge) => judge.judgeId).sort(),
    teams: card.teams.map((team) => ({
      teamId: team.teamId,
      categoryScores: Object.fromEntries(Object.entries(team.categoryScores || {}).sort(([a], [b]) => a.localeCompare(b))),
      minorFaults: team.minorFaults,
      majorFaults: team.majorFaults,
    })).sort((a, b) => a.teamId.localeCompare(b.teamId)),
    speakers: card.speakers.map((speaker) => ({
      speakerId: speaker.speakerId,
      teamId: speaker.teamId,
      position: speaker.position,
      score: speaker.score,
    })).sort((a, b) => [a.teamId, a.position, a.speakerId].join(":").localeCompare([b.teamId, b.position, b.speakerId].join(":"))),
  });
}

async function saveScoreConfig(payload: Record<string, unknown>): Promise<Tournament> {
  return withLock("database-transaction", async () => {
    const expectedRevision = num(payload.expectedRevision);
    const idempotencyScope = "saveScoreConfig:" + expectedRevision;
    const idempotencyKey = sha256("saveScoreConfig:" + expectedRevision + ":" + sha256(JSON.stringify({ categories: payload.categories, scorecards: payload.scorecards })));
    const cachedResponse = await readIdempotentResponse(idempotencyKey, idempotencyScope);
    if (cachedResponse !== null) return cachedResponse as Tournament;
    const data = await loadSheetData(true);
    const current = tournamentFromData(data);
    if (expectedRevision !== current.revision) {
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
      const changed = !previousCard || scorecardComparable(previousCard) !== scorecardComparable(card);
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
    const response: Tournament = { ...current, scoring, revision: nextRevision, updatedAt: now, serverTime: now };
    try {
      await writeTables(data, { Config: configRows }, [
        randomBytes(16).toString("hex"), new Date(now).toISOString(), "scoring", "",
        "", "", "scorecard_saved", "", JSON.stringify({
          scorecards: savedScorecards.length,
          categories: candidate.categories.length,
          idempotencyKey,
          idempotencyScope,
          idempotencyResponse: response,
        }),
      ]);
    } catch (error) {
      const committedResponse = await readIdempotentResponse(idempotencyKey, idempotencyScope);
      if (committedResponse !== null) return committedResponse as Tournament;
      throw error;
    }
    return response;
  });
}

const ROOM_HEARTBEAT_TTL_SECONDS = 18;
const ROOM_HEARTBEAT_HISTORY_TTL_SECONDS = 604800;

async function roomHeartbeat(payload: Record<string, unknown>): Promise<{ serverTime: number }> {
  const roomSlugInput = str(payload.roomId);
  if (!roomSlugInput) throw new ApiError("INVALID_ACTION", "Falta el identificador de sala.");
  const tournament = tournamentFromData(await loadSheetData());
  const physical = tournament.physicalRooms.find((item) =>
    item.slug.toLocaleLowerCase("es-ES") === roomSlugInput.toLocaleLowerCase("es-ES") ||
    item.id.toLocaleLowerCase("es-ES") === roomSlugInput.toLocaleLowerCase("es-ES"));
  if (!physical) throw new ApiError("ROOM_NOT_FOUND", "No se encuentra esa sala física.", 404);
  const controlKey = str(payload.controlKey);
  const expectedToken = await redisCommand(["GET", "ledu:room-control:" + sha256(physical.id)]);
  if (!controlKey || typeof expectedToken !== "string" || !safeEquals(controlKey, expectedToken)) {
    throw new ApiError("UNAUTHORIZED", "El enlace de control de esta sala no es válido.", 401);
  }
  const key = "ledu:room-heartbeat:" + sha256(physical.id);
  const now = Date.now();
  await redisCommand(["SET", key + ":last", now, "EX", ROOM_HEARTBEAT_HISTORY_TTL_SECONDS]);
  await redisCommand(["SET", key + ":online", "1", "EX", ROOM_HEARTBEAT_TTL_SECONDS]);
  return { serverTime: now };
}

async function getRoomConnectionStatuses(): Promise<Array<{
  physicalRoomId: string; roomName: string; connected: boolean; lastSeenAt: number | null; disconnectedAt: number | null;
}>> {
  const tournament = tournamentFromData(await loadSheetData());
  return Promise.all(tournament.physicalRooms.map(async (physical) => {
    const key = "ledu:room-heartbeat:" + sha256(physical.id);
    const [online, lastSeenValue] = await Promise.all([
      redisCommand(["GET", key + ":online"]),
      redisCommand(["GET", key + ":last"]),
    ]);
    const parsedLastSeen = lastSeenValue === null || lastSeenValue === undefined || lastSeenValue === ""
      ? null : Number(lastSeenValue);
    const lastSeenAt = parsedLastSeen !== null && Number.isFinite(parsedLastSeen) ? parsedLastSeen : null;
    const connected = online === "1" && lastSeenAt !== null && Date.now() - lastSeenAt <= ROOM_HEARTBEAT_TTL_SECONDS * 1000;
    return {
      physicalRoomId: physical.id,
      roomName: physical.name,
      connected,
      lastSeenAt,
      disconnectedAt: connected || lastSeenAt === null ? null : lastSeenAt + ROOM_HEARTBEAT_TTL_SECONDS * 1000,
    };
  }));
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
    if (tournament.activatedAt > 0 && now < tournament.activatedAt + 45_000) {
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
