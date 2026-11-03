import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FormatPreset, Phase, PhysicalRoom, Room, Round, TimerState, Tournament } from "../src/domain.js";
import { createTabulationParticipantUpdate } from "../server/tabulation-participant-write.js";
import { checkDatabase, databaseConfigured, getPool } from "../server/db.js";
import { readTabulationActaHistory, readTabulationActaVersion } from "../server/tabulation-acta-history.js";
import { previewTabulationActa, saveTabulationActa } from "../server/tabulation-acta-write.js";
import { publishTabulationRound as publishTabulationRoundOperation } from "../server/tabulation-round-publish.js";
import { presetSettings } from "../src/tabulation/presets.js";
import { validateTabulationSettings as validateTabulationSettingsPayload, TabulationSettingsValidationError } from "../server/tabulation-settings-validation.js";
import { TAB_SCHEMA_VERSION, type TabSettings } from "../src/tabulation/types.js";
import { loadPostgresSheetData, readIdempotentResponse, writePostgresTables, type PostgresSheetData } from "../server/postgres-store.js";
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
} from "../server/core.js";
import { recordSyncOperation, getSyncOperations, transitionSyncOperation } from "../server/sync-operation-journal.js";

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

/** Read-only recovery after a domain commit whose HTTP acknowledgement was lost. */
async function getTabulationSyncOperationStatus(payload: Record<string, unknown>) {
  const operationId = str(payload.operationId);
  const entityId = str(payload.entityId);
  const tournamentId = str(payload.tournamentId);
  const entityType = str(payload.entityType);
  const payloadHash = str(payload.payloadHash);
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(operationId)
    || !/^[a-zA-Z0-9_-]{1,128}$/.test(entityId)
    || !/^[0-9a-fA-F-]{36}$/.test(tournamentId)
    || !/^[a-f0-9]{64}$/.test(payloadHash)
    || !["round", "acta"].includes(entityType)) {
    throw new ApiError("INVALID_PAYLOAD", "La identidad de la operación de sincronización no es válida.");
  }
  const client = await getPool().connect();
  try {
    const identity = await client.query("SELECT tournament_id::text AS id FROM tournament_identity WHERE id=1");
    if (str(identity.rows[0]?.id) !== tournamentId) {
      throw new ApiError("TOURNAMENT_MISMATCH", "La operación pertenece a otro torneo.", 409);
    }
    const journal = await client.query(
      "SELECT tournament_id::text AS tournament_id, entity_type, entity_id, operation_type, payload_hash FROM sync_operations WHERE operation_id=$1",
      [operationId],
    );
    if (!journal.rows.length) return { found: false };
    const entry = journal.rows[0];
    const expectedOperation = entityType === "round" ? "publish-round" : "replace-acta";
    if (str(entry.tournament_id) !== tournamentId || str(entry.entity_type) !== entityType
      || str(entry.entity_id) !== entityId || str(entry.operation_type) !== expectedOperation
      || str(entry.payload_hash).trim() !== payloadHash) {
      throw new ApiError("IDEMPOTENCY_MISMATCH", "El operationId no coincide con el contenido original.", 409);
    }
    const found = await client.query("SELECT scope, response FROM idempotency_keys WHERE operation_key=$1", [operationId]);
    if (!found.rows.length) return { found: false };
    const scope = str(found.rows[0].scope);
    const validScope = entityType === "round"
      ? scope === ["tabulation-publish-round", tournamentId, entityId, payloadHash].join(":")
      : scope.startsWith("tabulation-save-acta:" + entityId + ":");
    if (!validScope) throw new ApiError("IDEMPOTENCY_MISMATCH", "El operationId pertenece a otra operación.", 409);
    if (found.rows[0].response === null || found.rows[0].response === undefined) {
      throw new ApiError("IDEMPOTENCY_INCOMPLETE", "La operación no tiene confirmación recuperable.", 409);
    }
    return { found: true, response: found.rows[0].response };
  } finally {
    client.release();
  }
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
    case "recordSyncOperation":
      await requireSession(payload.token);
      return recordSyncOperation(payload.operation, true);
    case "getSyncOperations":
      await requireSession(payload.token);
      return getSyncOperations(str(payload.tournamentId), true, num(payload.after));
    case "ackSyncOperation":
      await requireSession(payload.token);
      if (payload.status !== "committed" && payload.status !== "conflict" && payload.status !== "rejected") {
        throw new ApiError("INVALID_PAYLOAD", "El estado final del ACK no es válido.");
      }
      return transitionSyncOperation(str(payload.operationId), str(payload.payloadHash),
        payload.status, payload.result,
        payload.error && typeof payload.error === "object" ? payload.error as { code: string; message: string } : undefined, true);
    case "getTabulationSyncOperationStatus":
      await requireSession(payload.token);
      return getTabulationSyncOperationStatus(payload);
    case "createActaShortLink": await requireSession(payload.token); return createActaShortLink(payload);
    case "listActaShortLinks": await requireSession(payload.token); return listActaShortLinks(payload);
    case "updateActaShortLinkExpiry": await requireSession(payload.token); return updateActaShortLinkExpiry(payload);
    case "revokeActaShortLinks": await requireSession(payload.token); return revokeActaShortLinks(payload);
    case "recordTabulationSnapshotImport":
      await requireSession(payload.token);
      return recordTabulationSnapshotImport(payload);
    case "listAuthoritativeTabulationSnapshots":
      await requireSession(payload.token);
      return listAuthoritativeTabulationSnapshots();
    case "publishTabulationSnapshot":
      await requireSession(payload.token);
      return publishAuthoritativeTabulationSnapshot(payload, "authenticated-manager");
    case "getAuthoritativeTabulationSnapshot":
      await requireSession(payload.token);
      return getAuthoritativeTabulationSnapshot(str(payload.tabTournamentId));
    case "getTabulationSettings":
      await requireSession(payload.token);
      return getTabulationSettings();
    case "getTabulationPublishedRounds":
      await requireSession(payload.token);
      return getTabulationPublishedRounds(payload.tournamentId);
    case "saveTabulationSettings":
      await requireSession(payload.token);
      return saveTabulationSettings(payload);
    case "getTabulationActaHistory":
      await requireSession(payload.token);
      return getTabulationActaHistory(payload);
    case "getTabulationActaVersion":
      await requireSession(payload.token);
      return getTabulationActaVersion(payload);
    case "previewTabulationActa":
      await requireSession(payload.token);
      return previewTabulationActa({ assignmentId: str(payload.assignmentId), source: payload.source });
    case "saveTabulationActa":
      await requireSession(payload.token);
      return saveTabulationActa({
        operationId: str(payload.operationId),
        assignmentId: str(payload.assignmentId),
        source: payload.source,
        expectedCurrentSourceId: payload.expectedCurrentSourceId === null ? null : str(payload.expectedCurrentSourceId),
        confirmReplace: payload.confirmReplace === true,
        expectedSettingsRevision: num(payload.expectedSettingsRevision),
      });
    case "publishTabulationRound":
      await requireSession(payload.token);
      return publishTabulationRoundOperation(payload.operation);
    case "getPublicRoom":
      return publicRoomPayload(tournamentFromData(await loadSheetData()), str(payload.roomId));
    case "roomHeartbeat":
      return roomHeartbeat(payload);
    case "getRoomConnectionStatuses":
      await requireSession(payload.token);
      return getRoomConnectionStatuses();
    case "getRoomControllerToken":
      return roomControllerToken(payload);
    case "replaceActiveTournament":
      await requireSession(payload.token);
      return replaceActiveTournament(payload);
    case "saveTabulationParticipants":
      await requireSession(payload.token);
      return saveTabulationParticipants(payload);
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


type AuthoritativeTabulationDocument = {
  tabTournamentId: string;
  tournamentName: string;
  schemaVersion: number;
  revision: number;
  snapshot: Record<string, unknown>;
  snapshotSha256: string;
  updatedAt: number;
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const object = value as Record<string, unknown>;
  return "{" + Object.keys(object).sort().map((key) => JSON.stringify(key) + ":" + canonicalJson(object[key])).join(",") + "}";
}

function validateAuthoritativeTabulationSnapshot(payload: Record<string, unknown>): {
  tabTournamentId: string; expectedRevision: number; operationId: string; snapshot: Record<string, unknown>;
} {
  const tabTournamentId = str(payload.tabTournamentId).trim();
  const operationId = str(payload.operationId).trim();
  const expectedRevision = num(payload.expectedRevision);
  const snapshot = payload.snapshot;
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(tabTournamentId)) throw new ApiError("INVALID_PAYLOAD", "El identificador de Tabulación no es válido.");
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(operationId)) throw new ApiError("INVALID_PAYLOAD", "El operationId de publicación no es válido.");
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new ApiError("INVALID_PAYLOAD", "La revisión base no es válida.");
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new ApiError("INVALID_PAYLOAD", "El snapshot completo de Tabulación debe ser un objeto.");
  const value = snapshot as Record<string, unknown>;
  if (value.id !== tabTournamentId || typeof value.name !== "string" || !value.name.trim()
      || !Number.isSafeInteger(value.schemaVersion) || typeof value.settings !== "object"
      || !Array.isArray(value.teams) || !Array.isArray(value.speakers) || !Array.isArray(value.judges)
      || !Array.isArray(value.venues) || !Array.isArray(value.groups) || !Array.isArray(value.rounds)
      || !Array.isArray(value.breakSeeds) || !Array.isArray(value.manualOrder) || !Array.isArray(value.judgeConflicts)) {
    throw new ApiError("INVALID_PAYLOAD", "El snapshot no contiene el agregado completo y válido de Tabulación.");
  }
  const bytes = Buffer.byteLength(JSON.stringify(snapshot), "utf8");
  if (bytes > 4 * 1024 * 1024) throw new ApiError("PAYLOAD_TOO_LARGE", "El snapshot supera el límite de 4 MB.", 413);
  return { tabTournamentId, expectedRevision, operationId, snapshot: value };
}

async function getAuthoritativeTabulationSnapshot(tabTournamentId: string): Promise<AuthoritativeTabulationDocument | null> {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(tabTournamentId)) throw new ApiError("INVALID_PAYLOAD", "La identidad de Tabulación no es válida.");
  const result = await getPool().query(
    `SELECT tab_tournament_id, tournament_name, schema_version, revision, snapshot,
            snapshot_sha256, floor(extract(epoch FROM updated_at) * 1000)::bigint AS updated_at
       FROM tabulation_tournaments WHERE tab_tournament_id = $1`,
    [tabTournamentId],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const snapshot = row.snapshot as Record<string, unknown>;
  const digest = sha256(canonicalJson(snapshot));
  if (digest !== str(row.snapshot_sha256)) throw new ApiError("SNAPSHOT_CORRUPT", "El snapshot guardado no supera la comprobación de integridad.", 500);
  return { tabTournamentId: str(row.tab_tournament_id), tournamentName: str(row.tournament_name),
    schemaVersion: num(row.schema_version), revision: num(row.revision), snapshot, snapshotSha256: digest, updatedAt: num(row.updated_at) };
}


async function recordTabulationSnapshotImport(payload: Record<string, unknown>) {
  const managerTournamentId = str(payload.managerTournamentId).trim();
  const tabTournamentId = str(payload.tabTournamentId).trim();
  const revision = num(payload.revision);
  const snapshotSha256 = str(payload.snapshotSha256).trim();
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(managerTournamentId)
      || !/^[a-zA-Z0-9_-]{1,200}$/.test(tabTournamentId)
      || !Number.isSafeInteger(revision) || revision < 1
      || !/^[a-f0-9]{64}$/.test(snapshotSha256)) {
    throw new ApiError("INVALID_PAYLOAD", "Los datos de procedencia de la importación no son válidos.");
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const published = await client.query(
      "SELECT revision, snapshot_sha256 FROM tabulation_tournaments WHERE tab_tournament_id = $1 FOR SHARE",
      [tabTournamentId],
    );
    const row = published.rows[0] as Record<string, unknown> | undefined;
    if (!row || num(row.revision) !== revision || str(row.snapshot_sha256) !== snapshotSha256) {
      throw new ApiError("REVISION_CONFLICT", "La publicación de Tabulación cambió antes de registrar su importación.", 409);
    }
    const saved = await client.query(
      `INSERT INTO tabulation_manager_imports(manager_tournament_id, tab_tournament_id, imported_revision, snapshot_sha256, imported_by)
       VALUES ($1,$2,$3,$4,'authenticated-manager')
       ON CONFLICT (manager_tournament_id) DO UPDATE SET
         tab_tournament_id = EXCLUDED.tab_tournament_id,
         imported_revision = EXCLUDED.imported_revision,
         snapshot_sha256 = EXCLUDED.snapshot_sha256,
         imported_by = EXCLUDED.imported_by,
         imported_at = now()
       WHERE tabulation_manager_imports.imported_revision <= EXCLUDED.imported_revision
       RETURNING manager_tournament_id, tab_tournament_id, imported_revision, snapshot_sha256,
                 floor(extract(epoch FROM imported_at) * 1000)::bigint AS imported_at`,
      [managerTournamentId, tabTournamentId, revision, snapshotSha256],
    );
    if (!saved.rows[0]) throw new ApiError("STALE_IMPORT", "Gestión ya tiene registrada una revisión más reciente de Tabulación.", 409);
    await client.query("COMMIT");
    const result = saved.rows[0] as Record<string, unknown>;
    return { managerTournamentId: str(result.manager_tournament_id), tabTournamentId: str(result.tab_tournament_id),
      revision: num(result.imported_revision), snapshotSha256: str(result.snapshot_sha256), importedAt: num(result.imported_at) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof ApiError) throw error;
    throw new ApiError("TABULATION_IMPORT_RECORD_FAILED", "No se ha podido registrar la revisión importada en Gestión.", 503);
  } finally { client.release(); }
}

async function listAuthoritativeTabulationSnapshots(): Promise<Array<Pick<AuthoritativeTabulationDocument, "tabTournamentId" | "tournamentName" | "schemaVersion" | "revision" | "snapshotSha256" | "updatedAt">>> {
  const result = await getPool().query(
    `SELECT tab_tournament_id, tournament_name, schema_version, revision, snapshot_sha256,
            floor(extract(epoch FROM updated_at) * 1000)::bigint AS updated_at
       FROM tabulation_tournaments ORDER BY updated_at DESC`,
  );
  return result.rows.map((row) => ({
    tabTournamentId: str(row.tab_tournament_id),
    tournamentName: str(row.tournament_name),
    schemaVersion: num(row.schema_version),
    revision: num(row.revision),
    snapshotSha256: str(row.snapshot_sha256),
    updatedAt: num(row.updated_at),
  }));
}

async function publishAuthoritativeTabulationSnapshot(payload: Record<string, unknown>, actor: string) {
  const input = validateAuthoritativeTabulationSnapshot(payload);
  const digest = sha256(canonicalJson(input.snapshot));
  const tournamentName = str(input.snapshot.name).trim();
  const schemaVersion = num(input.snapshot.schemaVersion);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // Serialize even the first publication for a given tournament ID.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [input.tabTournamentId]);
    const previous = await client.query(
      "SELECT tab_tournament_id, base_revision, committed_revision, snapshot_sha256 FROM tabulation_publication_operations WHERE operation_id = $1 FOR UPDATE",
      [input.operationId],
    );
    if (previous.rows[0]) {
      const prior = previous.rows[0] as Record<string, unknown>;
      if (str(prior.tab_tournament_id) !== input.tabTournamentId
          || num(prior.base_revision) !== input.expectedRevision || str(prior.snapshot_sha256) !== digest) {
        throw new ApiError("IDEMPOTENCY_MISMATCH", "El operationId ya se utilizó con otra identidad, revisión o snapshot.", 409);
      }
      const exact = await client.query(
        `SELECT tournament_name, schema_version, snapshot, snapshot_sha256,
                floor(extract(epoch FROM updated_at) * 1000)::bigint AS updated_at
           FROM tabulation_tournaments WHERE tab_tournament_id = $1 AND revision = $2`,
        [input.tabTournamentId, num(prior.committed_revision)],
      );
      const row = exact.rows[0] as Record<string, unknown> | undefined;
      if (!row || str(row.snapshot_sha256) !== digest) throw new ApiError("IDEMPOTENCY_INCOMPLETE", "La revisión publicada no conserva un snapshot recuperable.", 409);
      await client.query("COMMIT");
      return { tabTournamentId: input.tabTournamentId, tournamentName: str(row.tournament_name), schemaVersion: num(row.schema_version),
        revision: num(prior.committed_revision), snapshot: row.snapshot, snapshotSha256: digest, updatedAt: num(row.updated_at), created: num(prior.committed_revision) === 1 };
    }
    const current = await client.query("SELECT revision FROM tabulation_tournaments WHERE tab_tournament_id = $1 FOR UPDATE", [input.tabTournamentId]);
    const currentRevision = current.rows[0] ? num(current.rows[0].revision) : 0;
    if (currentRevision !== input.expectedRevision) {
      throw new ApiError("REVISION_CONFLICT", "Tabulación ya tiene una publicación más reciente. Recarga el snapshot antes de volver a publicar.", 409);
    }
    const nextRevision = currentRevision + 1;
    const saved = await client.query(
      `INSERT INTO tabulation_tournaments(tab_tournament_id, tournament_name, schema_version, revision, snapshot, snapshot_sha256, published_by)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
       ON CONFLICT (tab_tournament_id) DO UPDATE SET
         tournament_name = EXCLUDED.tournament_name, schema_version = EXCLUDED.schema_version,
         revision = EXCLUDED.revision, snapshot = EXCLUDED.snapshot,
         snapshot_sha256 = EXCLUDED.snapshot_sha256, published_by = EXCLUDED.published_by, updated_at = now()
       RETURNING floor(extract(epoch FROM updated_at) * 1000)::bigint AS updated_at`,
      [input.tabTournamentId, tournamentName, schemaVersion, nextRevision, JSON.stringify(input.snapshot), digest, actor],
    );
    await client.query(
      "INSERT INTO tabulation_publication_operations(operation_id, tab_tournament_id, base_revision, committed_revision, snapshot_sha256) VALUES ($1,$2,$3,$4,$5)",
      [input.operationId, input.tabTournamentId, currentRevision, nextRevision, digest],
    );
    await client.query("COMMIT");
    return { tabTournamentId: input.tabTournamentId, tournamentName, schemaVersion, revision: nextRevision,
      snapshot: input.snapshot, snapshotSha256: digest, updatedAt: num(saved.rows[0]?.updated_at), created: currentRevision === 0 };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof ApiError) throw error;
    throw new ApiError("TABULATION_PUBLISH_FAILED", "No se ha podido guardar el snapshot autoritativo de Tabulación.", 503);
  } finally { client.release(); }
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

async function getTabulationPublishedRounds(tournamentIdInput: unknown) {
  const tournamentId = str(tournamentIdInput);
  if (!/^[0-9a-fA-F-]{36}$/.test(tournamentId)) {
    throw new ApiError("INVALID_PAYLOAD", "La identidad del torneo no es válida.");
  }
  const pool = getPool();
  try {
    const identity = await pool.query("SELECT tournament_id::text AS id FROM tournament_identity WHERE id = 1");
    if (str(identity.rows[0]?.id) !== tournamentId) {
      throw new ApiError("TOURNAMENT_MISMATCH", "La consulta pertenece a otro torneo.", 409);
    }
    const result = await pool.query(
      `SELECT b.tab_tournament_id, b.tabulation_round_id, b.tabulation_debate_id,
              b.manager_round_id, b.assignment_id, b.chair_judge_id, b.sides_provisional,
              r.number AS round_number, r.name AS round_name, r.score_type AS round_kind,
              m.side_mode, m.team_metadata, m.entity_id_map,
              ra.physical_room_id, ra.team_favor_id, ra.team_contra_id,
              COALESCE(jsonb_agg(DISTINCT aj.judge_id) FILTER (WHERE aj.judge_id IS NOT NULL), '[]'::jsonb) AS judge_ids,
              s.source_payload AS current_source_payload,
              h.source_id::text AS current_source_id
         FROM tabulation_debate_assignments b
         JOIN rounds r ON r.id = b.manager_round_id
         JOIN room_assignments ra ON ra.id = b.assignment_id AND ra.round_id = b.manager_round_id
         JOIN tabulation_round_metadata m ON m.tournament_id = b.tournament_id AND m.manager_round_id = b.manager_round_id
         LEFT JOIN assignment_judges aj ON aj.assignment_id = b.assignment_id
         LEFT JOIN tabulation_acta_heads h ON h.assignment_id = b.assignment_id
         LEFT JOIN tabulation_acta_sources s ON s.id = h.source_id AND s.assignment_id = b.assignment_id
        WHERE b.tournament_id = $1
        GROUP BY b.tab_tournament_id, b.tabulation_round_id, b.tabulation_debate_id,
                 b.manager_round_id, b.assignment_id, b.chair_judge_id, b.sides_provisional,
                 r.number, r.name, r.score_type, m.side_mode, m.team_metadata, m.entity_id_map,
                 ra.physical_room_id, ra.team_favor_id, ra.team_contra_id, s.source_payload, h.source_id
        ORDER BY r.number, b.tabulation_round_id, b.tabulation_debate_id`,
      [tournamentId],
    );
    return result.rows.map((row) => ({
      tabTournamentId: str(row.tab_tournament_id),
      tabulationRoundId: str(row.tabulation_round_id),
      tabulationDebateId: str(row.tabulation_debate_id),
      managerRoundId: str(row.manager_round_id),
      assignmentId: str(row.assignment_id),
      chairJudgeId: str(row.chair_judge_id),
      sidesProvisional: bool(row.sides_provisional),
      roundNumber: num(row.round_number),
      roundName: str(row.round_name),
      roundKind: str(row.round_kind) === "elimination" ? "elimination" : "qualifying",
      sideMode: str(row.side_mode) === "draw" ? "draw" : "balanced",
      teamMetadata: parseJson(row.team_metadata, []),
      entityIdMap: parseJson(row.entity_id_map, {}),
      physicalRoomId: str(row.physical_room_id),
      teamFavorId: str(row.team_favor_id),
      teamContraId: str(row.team_contra_id),
      judgeIds: parseJson(row.judge_ids, []),
      currentSourceId: row.current_source_id ? str(row.current_source_id) : null,
      currentSourcePayload: row.current_source_payload ?? null,
    }));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error && typeof error === "object" && "code" in error && ["42P01", "42703"].includes(String((error as { code?: unknown }).code))) {
      throw new ApiError("MIGRATION_REQUIRED", "Faltan las migraciones de sincronización de rondas y actas. No se han modificado datos.", 503);
    }
    throw new ApiError("DATABASE_UNAVAILABLE", "No se han podido recuperar las rondas publicadas de Tabulación.", 503);
  }
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

async function getTabulationActaVersion(payload: Record<string, unknown>) {
  const assignmentId = str(payload.assignmentId).trim();
  const versionId = str(payload.versionId).trim();
  if (!assignmentId || assignmentId.length > 128 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(versionId)) {
    throw new ApiError("INVALID_PAYLOAD", "La asignación o versión solicitada no es válida.");
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const version = await readTabulationActaVersion(client, assignmentId, versionId);
    await client.query("COMMIT");
    return version;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof ApiError) throw error;
    if (isMissingTabulationSettingsMigration(error)) {
      throw new ApiError("MIGRATION_REQUIRED", "Falta aplicar las migraciones 0012_tabulation_acta_sources.sql y 0013_tabulation_elimination_sources.sql en la base de datos de este entorno. No se ha modificado ningún dato.", 503);
    }
    throw new ApiError("DATABASE_UNAVAILABLE", "No se ha podido consultar el detalle de la versión del acta.", 503);
  } finally {
    client.release();
  }
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
      throw new ApiError("MIGRATION_REQUIRED", "Falta aplicar las migraciones 0012_tabulation_acta_sources.sql y 0013_tabulation_elimination_sources.sql en la base de datos de este entorno. No se ha modificado ningún dato.", 503);
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

async function replaceActiveTournament(payload: Record<string, unknown>): Promise<{ tournament: Tournament; archiveId: string }> {
  const operationId = str(payload.operationId).trim();
  const expectedRevision = num(payload.expectedRevision);
  const settings = validateTabulationSettings(payload.settings);
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(operationId)) {
    throw new ApiError("INVALID_PAYLOAD", "La sustitución requiere un identificador idempotente válido.");
  }
  const operationKey = sha256("replaceActiveTournament:" + operationId);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    const cached = await client.query("SELECT response FROM idempotency_keys WHERE operation_key=$1 AND scope='replaceActiveTournament' AND response IS NOT NULL", [operationKey]);
    if (cached.rows[0]?.response) {
      await client.query("COMMIT");
      return cached.rows[0].response as { tournament: Tournament; archiveId: string };
    }
    const locked = await client.query(
      `SELECT ti.tournament_id::text AS tournament_id, ti.generation, ts.revision, ts.tournament_name
         FROM tournament_identity ti JOIN tournament_settings ts ON ts.id=1
        WHERE ti.id=1 FOR UPDATE OF ti, ts`,
    );
    const currentIdentity = locked.rows[0] as Record<string, unknown> | undefined;
    if (!currentIdentity) throw new ApiError("DATABASE_NOT_INITIALIZED", "No existe una identidad canónica activa.", 503);
    try {
      const imported = await client.query(
        "SELECT tab_tournament_id FROM tabulation_manager_imports WHERE manager_tournament_id = $1 FOR SHARE",
        [str(currentIdentity.tournament_id)],
      );
      if (imported.rows[0]) {
        throw new ApiError("TABULATION_AUTHORITATIVE", "No se puede sustituir el torneo desde Gestión: la identidad maestra pertenece a Tabulación. Realiza el cambio en Tabulación y publica una nueva revisión.", 409);
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if ((error as { code?: string })?.code !== "42P01") throw error;
    }
    // Re-check after acquiring the singleton lock: a concurrent retry may have
    // completed the same operation while this request was waiting.
    const lockedCached = await client.query("SELECT response FROM idempotency_keys WHERE operation_key=$1 AND scope='replaceActiveTournament' AND response IS NOT NULL", [operationKey]);
    if (lockedCached.rows[0]?.response) {
      await client.query("COMMIT");
      return lockedCached.rows[0].response as { tournament: Tournament; archiveId: string };
    }
    if (num(currentIdentity.revision) !== expectedRevision) {
      throw new ApiError("REVISION_CONFLICT", "El torneo activo cambió antes de la sustitución. Actualiza y vuelve a confirmar.", 409);
    }

    const data = await loadPostgresSheetData(client);
    const oldTournamentId = str(currentIdentity.tournament_id);
    const oldGeneration = num(currentIdentity.generation);
    const newTournamentId = randomBytes(16).toString("hex").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
    const nextGeneration = oldGeneration + 1;
    const now = Date.now();

    const [actaSources, settingsVersions, settingsOperations, debateAssignments, roundMetadata, identityMaps, syncOperations, shortLinks, shortLinkEvents, idempotencyRows, tabulationSettings] = await Promise.all([
      client.query("SELECT * FROM tabulation_acta_sources WHERE tournament_id=$1::uuid ORDER BY created_at,id", [oldTournamentId]),
      client.query("SELECT * FROM tabulation_settings_versions ORDER BY revision"),
      client.query("SELECT * FROM tabulation_settings_operations ORDER BY created_at"),
      client.query("SELECT * FROM tabulation_debate_assignments WHERE tournament_id=$1::uuid ORDER BY tabulation_round_id,tabulation_debate_id", [oldTournamentId]),
      client.query("SELECT * FROM tabulation_round_metadata WHERE tournament_id=$1::uuid ORDER BY manager_round_id", [oldTournamentId]),
      client.query("SELECT * FROM tabulation_entity_identity_maps WHERE tournament_id=$1::uuid ORDER BY tab_tournament_id,entity_kind,local_id", [oldTournamentId]),
      client.query("SELECT * FROM sync_operations WHERE tournament_id=$1::uuid ORDER BY created_at,operation_id", [oldTournamentId]),
      client.query("SELECT * FROM acta_short_links ORDER BY created_at,id"),
      client.query("SELECT * FROM acta_short_link_events ORDER BY occurred_at,id"),
      client.query("SELECT * FROM idempotency_keys ORDER BY created_at,operation_key"),
      client.query("SELECT * FROM tabulation_settings WHERE id=1"),
    ]);
    const snapshot = {
      schemaVersion: 1,
      tournament: data.rows,
      raw: data.raw,
      tabulationActaSources: actaSources.rows,
      tabulationSettingsVersions: settingsVersions.rows,
      tabulationSettingsOperations: settingsOperations.rows,
      tabulationDebateAssignments: debateAssignments.rows,
      tabulationRoundMetadata: roundMetadata.rows,
      tabulationEntityIdentityMaps: identityMaps.rows,
      syncOperations: syncOperations.rows,
      shortLinks: shortLinks.rows,
      shortLinkEvents: shortLinkEvents.rows,
      idempotencyKeys: idempotencyRows.rows,
      tabulationSettings: tabulationSettings.rows,
    };
    const snapshotJson = JSON.stringify(snapshot);
    const snapshotHash = sha256(snapshotJson);
    const archived = await client.query(
      `INSERT INTO tournament_archives
        (tournament_id,generation,tournament_name,snapshot,snapshot_sha256,replaced_by_tournament_id,operation_id,created_by)
       VALUES($1::uuid,$2,$3,$4::jsonb,$5,$6::uuid,$7,'manager-session')
       RETURNING archive_id::text`,
      [oldTournamentId, oldGeneration, str(currentIdentity.tournament_name) || "Torneo LEDU", snapshotJson, snapshotHash, newTournamentId, operationId],
    );
    const archiveId = str(archived.rows[0]?.archive_id);

    // Keep immutable acta source rows and their old tournament UUID in the registry.
    // Remove only their mutable heads and the active projections.
    await client.query("DELETE FROM tabulation_acta_heads");
    await client.query("DELETE FROM tabulation_debate_assignments");
    await client.query("DELETE FROM tabulation_round_metadata");
    await client.query("DELETE FROM tabulation_entity_identity_maps");
    await client.query("DELETE FROM sync_operations");
    await client.query("DELETE FROM tabulation_settings_operations");
    await client.query("DELETE FROM tabulation_settings_versions");
    await client.query(
      `WITH revoked AS (
         UPDATE acta_short_links SET revoked_at=COALESCE(revoked_at,now()),updated_at=now()
          WHERE tournament_id=$1 AND revoked_at IS NULL RETURNING id
       )
       INSERT INTO acta_short_link_events(link_id,event_type,actor,details)
       SELECT id,'revoked','manager-session',$2::jsonb FROM revoked`,
      [oldTournamentId, JSON.stringify({ reason: "tournament_replaced", operationId })],
    );
    await client.query("DELETE FROM scorecard_category_scores");
    await client.query("DELETE FROM scorecard_team_scores");
    await client.query("DELETE FROM scorecard_judges");
    await client.query("DELETE FROM scorecard_speaker_scores");
    await client.query("DELETE FROM scorecards");
    await client.query("DELETE FROM room_assignments");
    // Release RESTRICT references before the normalised writer prunes the old institution catalogue.
    await client.query("DELETE FROM speakers");
    await client.query("DELETE FROM team_judge_incompatibilities");
    await client.query("DELETE FROM judge_incompatibilities");
    await client.query("DELETE FROM teams");
    await client.query("DELETE FROM judges");
    await client.query("DELETE FROM audit_events");

    await client.query(
      "UPDATE tournament_identity_registry SET archived=true,archived_at=now() WHERE tournament_id=$1::uuid",
      [oldTournamentId],
    );
    await client.query(
      "INSERT INTO tournament_identity_registry(tournament_id,generation,tournament_name) VALUES($1::uuid,$2,$3)",
      [newTournamentId, nextGeneration, str(payload.tournamentName).trim() || "Nuevo torneo"],
    );
    await client.query(
      "UPDATE tournament_identity SET tournament_id=$1::uuid,generation=$2,updated_at=now() WHERE id=1",
      [newTournamentId, nextGeneration],
    );
    await client.query("UPDATE tournament_settings SET tournament_id=$1::uuid WHERE id=1", [newTournamentId]);
    await client.query(
      `UPDATE tabulation_settings SET tournament_id=$1::uuid,revision=0,schema_version=$2,
              settings=$3::jsonb,updated_by='manager-session',updated_at=now() WHERE id=1`,
      [newTournamentId, TAB_SCHEMA_VERSION, JSON.stringify(settings)],
    );

    const configRows = data.rows.Config.map((row) => ({ ...row }));
    const set = (key: string, value: string) => {
      const row = configRows.find((item) => str(item.key) === key);
      if (row) row.value = value;
      else configRows.push({ key, value });
    };
    const tournamentName = str(payload.tournamentName).trim() || "Nuevo torneo";
    set("tournamentName", tournamentName);
    set("activeRoundId", "");
    set("activationRevision", "0");
    set("activatedAt", "0");
    set("revision", "1");
    set("updatedAt", String(now));
    set("institutions", "[]");
    set("speakers", "[]");
    set("scoring", JSON.stringify(emptyScoringConfig()));
    set("roundTypes", "{}");
    const replacements: Partial<Record<SheetName, SheetRow[]>> = {
      Config: configRows,
      Rondas: [],
      Equipos: [],
      Jueces: [],
      Salas: [],
      Cronometros: [],
      SalasFisicas: [],
      Formatos: data.rows.Formatos,
    };
    await writePostgresTables(data, replacements, undefined, client);
    await client.query(
      "INSERT INTO audit_events(event_key,event_type,details) VALUES($1,'tournament.replaced',$2::jsonb)",
      ["tournament-replaced:" + operationId, JSON.stringify({ oldTournamentId, newTournamentId, generation: nextGeneration, archiveId, snapshotHash })],
    );

    const tournament = tournamentFromData(await loadPostgresSheetData(client));
    const response = { tournament, archiveId };
    await client.query(
      "INSERT INTO idempotency_keys(operation_key,scope,response,completed_at) VALUES($1,'replaceActiveTournament',$2::jsonb,now())",
      [operationKey, JSON.stringify(response)],
    );
    await client.query("COMMIT");
    return response;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof ApiError) throw error;
    const code = (error as { code?: string })?.code;
    if (code === "23505" || code === "23503" || code === "23514") {
      throw new ApiError("DATABASE_CONSTRAINT", "La sustitución ha incumplido una restricción de integridad y se ha revertido íntegramente.", 409);
    }
    throw new ApiError("DATABASE_REPLACEMENT_FAILED", "No se ha podido sustituir el torneo. La transacción se ha revertido.", 503);
  } finally {
    client.release();
  }
}

async function saveTabulationParticipants(payload: Record<string, unknown>): Promise<Tournament> {
  const expectedRevision = num(payload.expectedRevision);
  const current = tournamentFromData(await loadSheetData(true));
  const update = createTabulationParticipantUpdate(current, expectedRevision, payload.snapshot);
  // This bypass is private to this server action; the candidate was derived
  // from a validated participant snapshot, not accepted as a client aggregate.
  return saveTournament({ ...payload, expectedRevision, tournament: update.tournament }, { allowTabulationMasterWrite: true });
}

async function saveTournament(
  payload: Record<string, unknown>,
  options: { allowTabulationMasterWrite?: boolean } = {},
): Promise<Tournament> {
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
    if (current.remoteId && !options.allowTabulationMasterWrite) {
      try {
        const imported = await getPool().query(
          "SELECT tab_tournament_id, imported_revision FROM tabulation_manager_imports WHERE manager_tournament_id = $1",
          [current.remoteId],
        );
        if (imported.rows[0]) {
          const normalizedRounds = (rounds: Round[]) => rounds.map(({ id, number, name, defaultFormatId, scoreType }) =>
            ({ id, number, name, defaultFormatId, scoreType: scoreType ?? "qualifying" }));
          const masterChanged = canonicalJson({
            tournamentName: tournament.tournamentName,
            teams: tournament.teams,
            speakers: tournament.speakers ?? [],
            judges: tournament.judges,
            rounds: normalizedRounds(tournament.rounds),
          }) !== canonicalJson({
            tournamentName: current.tournamentName,
            teams: current.teams,
            speakers: current.speakers ?? [],
            judges: current.judges,
            rounds: normalizedRounds(current.rounds),
          });
          if (masterChanged) {
            throw new ApiError("TABULATION_AUTHORITATIVE", "Este torneo está vinculado a una publicación de Tabulación. Los equipos, oradores, jueces y rondas solo pueden modificarse desde Tabulación; Gestión conserva las asignaciones y los cronómetros.", 409);
          }
        }
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if ((error as { code?: string })?.code !== "42P01") throw error;
        // A preview without migration 0025 retains legacy behavior; the new
        // snapshot API itself remains unavailable until the migration is applied.
      }
    }
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



type ShortLinkRow = { id:string; tournament_id:string; debate_id:string; snapshot:unknown; snapshot_sha256:string; expires_at:Date|string|null; revoked_at:Date|string|null; created_at:Date|string };
function canonicalShortLinkJson(value:unknown):string {
  if(Array.isArray(value)) return "["+value.map(canonicalShortLinkJson).join(",")+"]";
  if(value && typeof value==="object"){const r=value as Record<string,unknown>;return "{"+Object.keys(r).sort().map(k=>JSON.stringify(k)+":"+canonicalShortLinkJson(r[k])).join(",")+"}";}
  return JSON.stringify(value) ?? "null";
}
export function validActaSnapshot(value:unknown):value is Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const v=value as Record<string,unknown>;
  const round=v.round&&typeof v.round==="object"&&!Array.isArray(v.round)?v.round as Record<string,unknown>:null;
  const rules=v.rules&&typeof v.rules==="object"&&!Array.isArray(v.rules)?v.rules as Record<string,unknown>:null;
  if((v.version!==1&&v.version!==2)||typeof v.tournament!=="string"||v.tournament.length>160
    ||typeof v.debate!=="string"||!v.debate.trim()||v.debate.length>200
    ||typeof v.key!=="string"||!v.key||v.key.length>100
    ||!round||!Number.isSafeInteger(round.number)||(round.number as number)<1||(round.number as number)>10000
    ||typeof round.name!=="string"||!round.name.trim()||round.name.length>160||typeof round.elimination!=="boolean"
    ||typeof v.venue!=="string"||v.venue.length>240||typeof v.desk!=="string"||v.desk.length>40
    ||!Array.isArray(v.teams)||v.teams.length!==2||!Array.isArray(v.jury)||v.jury.length>20
    ||!v.jury.every(n=>typeof n==="string"&&n.length<=160)||!rules)return false;
  const teamIds=new Set<string>(),speakerIds=new Set<string>();
  for(const rawTeam of v.teams){
    if(!rawTeam||typeof rawTeam!=="object"||Array.isArray(rawTeam))return false;
    const team=rawTeam as Record<string,unknown>;
    if(typeof team.id!=="string"||!team.id.trim()||team.id.length>128||teamIds.has(team.id)
      ||typeof team.name!=="string"||!team.name.trim()||team.name.length>200
      ||!Array.isArray(team.members)||team.members.length>32)return false;
    teamIds.add(team.id);
    for(const rawSpeaker of team.members){
      if(!rawSpeaker||typeof rawSpeaker!=="object"||Array.isArray(rawSpeaker))return false;
      const speaker=rawSpeaker as Record<string,unknown>;
      if(typeof speaker.id!=="string"||!speaker.id.trim()||speaker.id.length>128||speakerIds.has(speaker.id)
        ||typeof speaker.name!=="string"||!speaker.name.trim()||speaker.name.length>160)return false;
      speakerIds.add(speaker.id);
    }
  }
  // A2 links omit rules equal to the ADUMA defaults; the client expands those defaults.
  if(rules.rubric!==undefined){
    if(!Array.isArray(rules.rubric)||rules.rubric.length>100)return false;
    const rubricIds=new Set<string>();
    for(const item of rules.rubric){
      if(!item||typeof item!=="object"||Array.isArray(item))return false;
      const rubricItem=item as Record<string,unknown>;
      if(typeof rubricItem.id!=="string"||!rubricItem.id.trim()||rubricIds.has(rubricItem.id)
        ||typeof rubricItem.name!=="string"||!rubricItem.name.trim()
        ||typeof rubricItem.section!=="string"||!rubricItem.section.trim()
        ||(rubricItem.description!==undefined&&typeof rubricItem.description!=="string"))return false;
      rubricIds.add(rubricItem.id);
    }
  }
  const numericRules=["itemMin","itemMax","speakerScoreMin","speakerScoreMax","speakerScoreStep","minorPoints","minorsPerMajor","majorPoints"];
  if(numericRules.some(key=>rules[key]!==undefined&&(typeof rules[key]!=="number"||!Number.isFinite(rules[key]))))return false;
  if(rules.itemMin!==undefined&&rules.itemMax!==undefined&&Number(rules.itemMin)>Number(rules.itemMax))return false;
  if(rules.speakerScoreStep!==undefined&&Number(rules.speakerScoreStep)<=0)return false;
  if(rules.minorsPerMajor!==undefined&&(!Number.isInteger(rules.minorsPerMajor)||Number(rules.minorsPerMajor)<1))return false;
  if(["minorPoints","majorPoints"].some(key=>rules[key]!==undefined&&Number(rules[key])<0))return false;
  if(rules.speakerScores!==undefined&&typeof rules.speakerScores!=="boolean")return false;
  if(rules.warningConversion!==undefined&&!["ledu","pairs","aduma","none"].includes(String(rules.warningConversion)))return false;
  if(rules.minorEscalation!==undefined&&!["blocks","aduma"].includes(String(rules.minorEscalation)))return false;
  if(rules.majorMode!==undefined&&!["forfeit","points"].includes(String(rules.majorMode)))return false;
  return true;
}
function shortLinkId():string{const a="0123456789ABCDEFGHJKMNPQRSTVWXYZ";let n=0n;for(const b of randomBytes(5))n=(n<<8n)|BigInt(b);let s="";for(let i=0;i<8;i++){s=a[Number(n&31n)]+s;n>>=5n;}return s;}
function expiryDate(value:unknown):Date{const d=Number(value);if(![1,7,30,90,365].includes(d))throw new ApiError("INVALID_EXPIRY","Elige una caducidad de 1, 7, 30, 90 o 365 días.");return new Date(Date.now()+d*86400000);}
function shortLinkPublic(r:ShortLinkRow){return{id:r.id,tournamentId:r.tournament_id,debateId:r.debate_id,createdAt:new Date(r.created_at).getTime(),expiresAt:r.expires_at?new Date(r.expires_at).getTime():null,revokedAt:r.revoked_at?new Date(r.revoked_at).getTime():null};}
async function createActaShortLink(p:Record<string,unknown>):Promise<unknown>{
 const tournamentId=str(p.tournamentId).trim(),debateId=str(p.debateId).trim(),snapshot=p.snapshot;
 if(!/^[a-zA-Z0-9_-]{1,128}$/.test(tournamentId)||!/^[a-zA-Z0-9_-]{1,200}$/.test(debateId)||!validActaSnapshot(snapshot))throw new ApiError("INVALID_SHORT_LINK","El snapshot del acta no es válido.");
 const json=canonicalShortLinkJson(snapshot);if(new TextEncoder().encode(json).byteLength>32768)throw new ApiError("SHORT_LINK_TOO_LARGE","El acta supera el tamaño máximo permitido.");
 const rawIdem=str(p.idempotencyKey).trim();if(!/^[a-zA-Z0-9_-]{8,128}$/.test(rawIdem))throw new ApiError("INVALID_IDEMPOTENCY_KEY","Clave de idempotencia no válida.");const hash=sha256(json),idem=sha256("acta-short-link:v1|"+tournamentId+"|"+debateId+"|"+rawIdem),expires=expiryDate(p.expiryDays??30),client=await getPool().connect();
 try{
  await client.query("BEGIN");
  const prior=await client.query("SELECT * FROM acta_short_links WHERE tournament_id=$1 AND idempotency_key=$2 FOR UPDATE",[tournamentId,idem]);
  if(prior.rows[0]){const row=prior.rows[0] as ShortLinkRow;if(row.snapshot_sha256!==hash)throw new ApiError("IDEMPOTENCY_CONFLICT","La clave de idempotencia tiene otro contenido.",409);await client.query("COMMIT");return shortLinkPublic(row);}
  let created:ShortLinkRow|undefined;
  for(let i=0;i<8&&!created;i++){const r=await client.query("INSERT INTO acta_short_links(id,tournament_id,debate_id,snapshot,snapshot_sha256,idempotency_key,created_by,expires_at) VALUES($1,$2,$3,$4::jsonb,$5,$6,'manager',$7) ON CONFLICT DO NOTHING RETURNING *",[shortLinkId(),tournamentId,debateId,json,hash,idem,expires]);if(r.rows[0])created=r.rows[0] as ShortLinkRow;else{const raced=await client.query("SELECT * FROM acta_short_links WHERE tournament_id=$1 AND idempotency_key=$2 FOR UPDATE",[tournamentId,idem]);if(raced.rows[0]){const prior=raced.rows[0] as ShortLinkRow;if(prior.snapshot_sha256!==hash)throw new ApiError("IDEMPOTENCY_CONFLICT","La clave de idempotencia tiene otro contenido.",409);await client.query("COMMIT");return shortLinkPublic(prior);}}}
  if(!created)throw new ApiError("SHORT_LINK_COLLISION","No se ha podido reservar un identificador único.",503);
  await client.query("INSERT INTO acta_short_link_events(link_id,event_type,actor,details) VALUES($1,'created','manager',$2::jsonb)",[created.id,JSON.stringify({expiresAt:expires.toISOString(),snapshotHash:hash})]);
  await client.query("COMMIT");return shortLinkPublic(created);
 }catch(e){await client.query("ROLLBACK").catch(()=>undefined);throw e;}finally{client.release();}
}
async function listActaShortLinks(p:Record<string,unknown>):Promise<unknown>{const id=str(p.tournamentId).trim();if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id))throw new ApiError("INVALID_TOURNAMENT","Torneo no válido.");const r=await getPool().query("SELECT l.id,l.tournament_id,l.debate_id,l.created_at,l.expires_at,l.revoked_at,COALESCE((SELECT json_agg(json_build_object('eventType',e.event_type,'actor',e.actor,'occurredAt',e.occurred_at,'details',e.details) ORDER BY e.occurred_at) FROM acta_short_link_events e WHERE e.link_id=l.id),'[]'::json) AS events FROM acta_short_links l WHERE l.tournament_id=$1 ORDER BY l.created_at DESC LIMIT 1000",[id]);return r.rows.map((x)=>({...shortLinkPublic(x as ShortLinkRow),events:Array.isArray(x.events)?x.events:[]}));}
async function updateActaShortLinkExpiry(p:Record<string,unknown>):Promise<unknown>{const tournamentId=str(p.tournamentId),id=str(p.id).toUpperCase(),expires=expiryDate(p.expiryDays);if(!/^[0-9A-HJKMNP-TV-Z]{8}$/.test(id))throw new ApiError("INVALID_SHORT_LINK","Identificador no válido.");const c=await getPool().connect();try{await c.query("BEGIN");const r=await c.query("UPDATE acta_short_links SET expires_at=$3,updated_at=now() WHERE id=$1 AND tournament_id=$2 AND revoked_at IS NULL RETURNING *",[id,tournamentId,expires]);if(!r.rows[0])throw new ApiError("SHORT_LINK_NOT_FOUND","No existe un enlace activo.",404);await c.query("INSERT INTO acta_short_link_events(link_id,event_type,actor,details) VALUES($1,'expiry_updated','manager',$2::jsonb)",[id,JSON.stringify({expiresAt:expires.toISOString()})]);await c.query("COMMIT");return shortLinkPublic(r.rows[0] as ShortLinkRow);}catch(e){await c.query("ROLLBACK").catch(()=>undefined);throw e;}finally{c.release();}}
export async function revokeActaShortLinks(p:Record<string,unknown>):Promise<unknown>{
 const tid=str(p.tournamentId).trim(),all=p.all===true;
 const ids=Array.isArray(p.ids)?Array.from(new Set(p.ids.filter(x=>typeof x==="string").map(x=>(x as string).toUpperCase()))):[];
 if(!/^[a-zA-Z0-9_-]{1,128}$/.test(tid))throw new ApiError("INVALID_TOURNAMENT","Torneo no válido.");
 if(!all&&(!ids.length||ids.length>200||ids.some(x=>!/^[0-9A-HJKMNP-TV-Z]{8}$/.test(x))))
  throw new ApiError("INVALID_SHORT_LINKS","Selecciona entre 1 y 200 enlaces válidos.");
 const reason=str(p.reason).trim().slice(0,300),c=await getPool().connect();
 try{
  await c.query("BEGIN");
  // UPDATE ... RETURNING is the serialization point: concurrent revocations
  // cannot both emit a revocation event for the same link.
  const updated=await c.query(
   all
    ? "UPDATE acta_short_links SET revoked_at=now(),updated_at=now() WHERE tournament_id=$1 AND revoked_at IS NULL RETURNING id"
    : "UPDATE acta_short_links SET revoked_at=now(),updated_at=now() WHERE tournament_id=$1 AND revoked_at IS NULL AND id=ANY($2::text[]) RETURNING id",
   all?[tid]:[tid,ids],
  );
  const affected=updated.rows.map(x=>String(x.id));
  for(const id of affected){
   await c.query("INSERT INTO acta_short_link_events(link_id,event_type,actor,details) VALUES($1,'revoked','manager',$2::jsonb)",[id,JSON.stringify({reason,bulk:all})]);
  }
  await c.query("COMMIT");
  return{revoked:affected.length,ids:affected};
 }catch(e){await c.query("ROLLBACK").catch(()=>undefined);throw e;}finally{c.release();}
}
async function resolveActaShortLink(req:RequestLike):Promise<unknown>{
 if(!databaseConfigured())throw new ApiError("NOT_CONFIGURED","La base de datos de enlaces no está configurada.",503);
 const ipHash=sha256(requestIp(req));
 const pool=getPool();
 let limit;
 try {
  limit=await pool.query(
   `INSERT INTO acta_short_link_resolution_limits(ip_hash,window_started_at,request_count)
    VALUES($1,date_trunc('minute',now()),1)
    ON CONFLICT(ip_hash) DO UPDATE SET
      request_count=CASE WHEN acta_short_link_resolution_limits.window_started_at < date_trunc('minute',now()) THEN 1 ELSE acta_short_link_resolution_limits.request_count+1 END,
      window_started_at=CASE WHEN acta_short_link_resolution_limits.window_started_at < date_trunc('minute',now()) THEN date_trunc('minute',now()) ELSE acta_short_link_resolution_limits.window_started_at END
    RETURNING request_count`,
   [ipHash],
  );
 } catch(error) {
  if(error&&typeof error==="object"&&"code" in error&&String((error as {code?:unknown}).code)==="42P01")
   throw new ApiError("MIGRATION_REQUIRED","Falta aplicar la migración 0021_acta_short_link_rate_limits.sql.",503);
  throw error;
 }
 const requestCount=num(limit.rows[0]?.request_count);
 if(requestCount%100===1)await pool.query("DELETE FROM acta_short_link_resolution_limits WHERE window_started_at < now()-interval '1 day'");
 if(requestCount>60)throw new ApiError("RATE_LIMITED","Demasiadas consultas de enlaces. Espera al siguiente minuto.",429);
 const raw=Array.isArray(req.query?.id)?req.query?.id[0]:req.query?.id;
 const id=str(raw).toUpperCase();
 if(!/^[0-9A-HJKMNP-TV-Z]{8}$/.test(id))throw new ApiError("SHORT_LINK_NOT_FOUND","El enlace no existe o no está disponible.",404);
 const r=await pool.query("SELECT * FROM acta_short_links WHERE id=$1",[id]);
 const row=r.rows[0] as ShortLinkRow|undefined;
 if(!row)throw new ApiError("SHORT_LINK_NOT_FOUND","El enlace no existe o no está disponible.",404);
 if(row.revoked_at)throw new ApiError("SHORT_LINK_REVOKED","Este enlace ha sido revocado por la mesa.",410);
 if(row.expires_at&&new Date(row.expires_at).getTime()<=Date.now())throw new ApiError("SHORT_LINK_EXPIRED","Este enlace ha caducado. Pide a la mesa que genere uno nuevo.",410);
 if(!validActaSnapshot(row.snapshot)||sha256(canonicalShortLinkJson(row.snapshot))!==row.snapshot_sha256)
  throw new ApiError("SHORT_LINK_CORRUPT","El contenido del enlace no supera la comprobación de integridad.",500);
 return{snapshot:row.snapshot,expiresAt:row.expires_at?new Date(row.expires_at).getTime():null};
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
      if (action === "resolveActaShortLink") { const result = await resolveActaShortLink(req); res.status(200).json({ ok: true, data: result }); return; }
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
