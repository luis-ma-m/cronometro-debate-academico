import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { getPool } from "./db.js";
import {
  ApiError, SHEET_HEADERS, type SheetName, type SheetRow,
  defaultPhases, parseJson, parseStringArray, str, num, bool,
} from "./core.js";
import type { Phase } from "../src/domain.js";
import { emptyScoringConfig, parseScoringConfig, type RoundScorecard, type ScoringConfig } from "../src/scoring.js";

type MetadataSheet = { properties: { sheetId: number; title: string; gridProperties?: { rowCount?: number; columnCount?: number } } };
type SpreadsheetMetadata = { spreadsheetId: string; properties?: { title?: string }; sheets?: MetadataSheet[] };
export type PostgresSheetData = {
  metadata: SpreadsheetMetadata;
  raw: Record<SheetName, unknown[][]>;
  rows: Record<SheetName, SheetRow[]>;
};

const SHEET_NAMES = Object.keys(SHEET_HEADERS) as SheetName[];
const json = (value: unknown, fallback: unknown = null): unknown => {
  if (typeof value !== "string") return value ?? fallback;
  try { return JSON.parse(value); } catch { return fallback; }
};
const millis = (value: unknown): number => {
  if (value === null || value === undefined || value === "") return 0;
  const date = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isFinite(date) ? date : num(value);
};
const iso = (value: unknown): string => value ? new Date(millis(value)).toISOString() : "";
const institutionId = (name: string): string =>
  "inst-" + createHash("sha256").update(name.trim().toLocaleLowerCase("es-ES")).digest("hex").slice(0, 24);

function phasesFromRows(rows: Record<string, unknown>[], formatId: string): Phase[] {
  return rows.filter((row) => str(row.format_id) === formatId).sort((a, b) => num(a.phase_order) - num(b.phase_order)).map((row) => ({
    id: str(row.id), name: str(row.name), side: str(row.side) as Phase["side"], speaker: str(row.speaker),
    durationSeconds: num(row.duration_seconds), type: str(row.phase_type) as Phase["type"],
    warningThresholdsSeconds: Array.isArray(row.warning_thresholds_seconds) ? row.warning_thresholds_seconds.map(Number) : [],
    allowOvertimeDisplay: bool(row.allow_overtime_display),
  }));
}

function rawFromRows(rows: SheetRow[], headers: readonly string[]): unknown[][] {
  return [Array.from(headers), ...rows.map((row) => headers.map((header) => row[header] ?? ""))];
}

async function readSnapshot(client: PoolClient): Promise<PostgresSheetData> {
  const [settingsQ, institutionsQ, roundsQ, teamsQ, teamIncompatQ, judgesQ, judgeIncompatQ, speakersQ, physicalQ, formatsQ, formatPhasesQ, assignmentsQ, assignmentJudgesQ, assignmentPhasesQ, categoriesQ, cardsQ, teamScoresQ, categoryScoresQ, cardJudgesQ, speakerScoresQ, eventsQ] = await Promise.all([
    client.query("SELECT * FROM tournament_settings WHERE id=1"),
    client.query("SELECT * FROM institutions ORDER BY name"),
    client.query("SELECT * FROM rounds ORDER BY number"),
    client.query("SELECT t.*, i.name AS institution FROM teams t LEFT JOIN institutions i ON i.id=t.institution_id ORDER BY t.name"),
    client.query("SELECT team_id,judge_id FROM team_judge_incompatibilities ORDER BY team_id,judge_id"),
    client.query("SELECT j.*, i.name AS institution FROM judges j LEFT JOIN institutions i ON i.id=j.institution_id ORDER BY j.name"),
    client.query("SELECT judge_id,incompatible_judge_id FROM judge_incompatibilities ORDER BY judge_id,incompatible_judge_id"),
    client.query("SELECT * FROM speakers ORDER BY team_id, name"),
    client.query("SELECT * FROM physical_rooms ORDER BY name"),
    client.query("SELECT * FROM format_presets ORDER BY name"),
    client.query("SELECT * FROM format_phases ORDER BY format_id, phase_order"),
    client.query("SELECT * FROM room_assignments ORDER BY round_id, physical_room_id"),
    client.query("SELECT * FROM assignment_judges ORDER BY assignment_id, judge_id"),
    client.query("SELECT * FROM assignment_phases ORDER BY assignment_id, phase_order"),
    client.query("SELECT * FROM score_categories ORDER BY category_order"),
    client.query("SELECT * FROM scorecards ORDER BY created_at"),
    client.query("SELECT * FROM scorecard_team_scores"),
    client.query("SELECT * FROM scorecard_category_scores"),
    client.query("SELECT * FROM scorecard_judges"),
    client.query("SELECT * FROM scorecard_speaker_scores"),
    client.query("SELECT * FROM audit_events ORDER BY occurred_at"),
  ]);
  const settings = settingsQ.rows[0] as Record<string, unknown> | undefined;
  if (!settings) throw new ApiError("DATABASE_NOT_INITIALIZED", "Neon está conectado, pero falta inicializar el esquema y los valores base. Ejecuta db:migrate y db:seed en la base correcta.", 503);
  const settingsJson = settings ? (settings.settings as Record<string, unknown> || {}) : {};
  const institutions = institutionsQ.rows as Record<string, unknown>[];
  const rounds = roundsQ.rows as Record<string, unknown>[];
  const teamIncompatibilities = teamIncompatQ.rows as Record<string, unknown>[];
  const judgeIncompatibilities = judgeIncompatQ.rows as Record<string, unknown>[];
  const teams = (teamsQ.rows as Record<string, unknown>[]).map((row) => ({ ...row, incompatible_judge_ids: teamIncompatibilities.filter((item) => str(item.team_id) === str(row.id)).map((item) => str(item.judge_id)) }));
  const judges = (judgesQ.rows as Record<string, unknown>[]).map((row) => ({ ...row, incompatible_judge_ids: judgeIncompatibilities.filter((item) => str(item.judge_id) === str(row.id)).map((item) => str(item.incompatible_judge_id)) }));
  const speakers = speakersQ.rows as Record<string, unknown>[];
  const physicalRooms = physicalQ.rows as Record<string, unknown>[];
  const formatRows = formatsQ.rows as Record<string, unknown>[];
  const formatPhases = formatPhasesQ.rows as Record<string, unknown>[];
  const assignments = assignmentsQ.rows as Record<string, unknown>[];
  const assignmentJudges = assignmentJudgesQ.rows as Record<string, unknown>[];
  const assignmentPhases = assignmentPhasesQ.rows as Record<string, unknown>[];
  const categories = categoriesQ.rows as Record<string, unknown>[];
  const cards = cardsQ.rows as Record<string, unknown>[];
  const teamScores = teamScoresQ.rows as Record<string, unknown>[];
  const categoryScores = categoryScoresQ.rows as Record<string, unknown>[];
  const cardJudges = cardJudgesQ.rows as Record<string, unknown>[];
  const speakerScores = speakerScoresQ.rows as Record<string, unknown>[];

  const scorecards: RoundScorecard[] = cards.map((card) => {
    const teamRows = teamScores.filter((score) => str(score.scorecard_id) === str(card.id));
    const teamsScored = teamRows.map((score) => {
      const categoryValues = categoryScores.filter((value) => str(value.scorecard_id) === str(card.id) && str(value.team_id) === str(score.team_id));
      const team = teams.find((item) => str(item.id) === str(score.team_id));
      return {
        teamId: str(score.team_id), teamName: str(team?.name), total: num(score.total),
        minorFaults: num(score.minor_faults), majorFaults: num(score.major_faults),
        categoryScores: Object.fromEntries(categoryValues.map((value) => [str(value.category_id), num(value.score)])),
      };
    });
    const assignment = assignments.find((item) => str(item.id) === str(card.assignment_id));
    const round = rounds.find((item) => str(item.id) === str(card.round_id));
    const physical = physicalRooms.find((item) => str(item.id) === str(assignment?.physical_room_id));
    const judgesForCard = cardJudges.filter((item) => str(item.scorecard_id) === str(card.id)).map((item) => {
      const judge = judges.find((candidate) => str(candidate.id) === str(item.judge_id));
      return { judgeId: str(item.judge_id), judgeName: str(judge?.name) };
    });
    const speakersForCard = speakerScores.filter((item) => str(item.scorecard_id) === str(card.id)).map((item) => {
      const speaker = speakers.find((candidate) => str(candidate.id) === str(item.speaker_id));
      return { speakerId: str(item.speaker_id), speakerName: str(speaker?.name), teamId: str(item.team_id), position: str(item.position) as RoundScorecard["speakers"][number]["position"], score: num(item.score) };
    });
    const favorId = str(card.team_favor_id);
    const contraId = str(card.team_contra_id);
    const fallback = (teamId: string) => ({ teamId, teamName: str(teams.find((item) => str(item.id) === teamId)?.name), categoryScores: {}, total: 0, minorFaults: 0, majorFaults: 0 });
    const byId = new Map(teamsScored.map((item) => [item.teamId, item]));
    return {
      id: str(card.id), roundId: str(card.round_id), roundName: str(round?.name),
      roomId: str(card.assignment_id), roomName: str(physical?.name),
      teamFavorId: favorId, teamContraId: contraId, judges: judgesForCard,
      teams: [byId.get(favorId) || fallback(favorId), byId.get(contraId) || fallback(contraId)],
      speakers: speakersForCard, createdAt: millis(card.created_at), updatedAt: millis(card.updated_at),
    };
  });
  const scoring: ScoringConfig = parseScoringConfig({
    categories: categories.map((category) => ({ id: str(category.id), name: str(category.name), order: num(category.category_order) })),
    scorecards,
  });
  const config: SheetRow[] = [
    { key: "tournamentName", value: str(settings?.tournament_name) || "Torneo LEDU" },
    { key: "activeRoundId", value: str(settings?.active_round_id) },
    { key: "activationRevision", value: str(settings?.activation_revision ?? 0) },
    { key: "activatedAt", value: str(millis(settings?.activated_at)) },
    { key: "revision", value: str(settings?.revision ?? 1) },
    { key: "updatedAt", value: str(millis(settings?.updated_at)) },
    { key: "minimumJudgesPerRoom", value: str(settings?.minimum_judges_per_room ?? 1) },
    { key: "institutions", value: JSON.stringify(institutions.map((row) => str(row.name))) },
    { key: "speakers", value: JSON.stringify(speakers.map((row) => ({ id: str(row.id), teamId: str(row.team_id), name: str(row.name) }))) },
    { key: "formatPhases", value: JSON.stringify(parseJson(settingsJson.formatPhases, defaultPhases())) },
    { key: "scoring", value: JSON.stringify(scoring) },
    { key: "roundTypes", value: JSON.stringify(Object.fromEntries(rounds.map((round) => [str(round.id), str(round.score_type) === "elimination" ? "elimination" : "qualifying"]))) },
    { key: "schemaVersion", value: "4" },
  ];
  const roundRows = rounds.map((row) => ({ id: str(row.id), number: num(row.number), name: str(row.name), active: bool(row.is_active), defaultFormatId: str(row.default_format_id), scoreType: str(row.score_type) }));
  const teamRows = teams.map((row) => ({ id: str(row.id), name: str(row.name), institution: str(row.institution), active: bool(row.active), incompatibleJudgeIds: JSON.stringify(parseStringArray(row.incompatible_judge_ids)) }));
  const judgeRows = judges.map((row) => ({ id: str(row.id), name: str(row.name), institution: str(row.institution), active: bool(row.active), incompatibleJudgeIds: JSON.stringify(parseStringArray(row.incompatible_judge_ids)) }));
  const physicalRows = physicalRooms.map((row) => ({ id: str(row.id), slug: str(row.slug), name: str(row.name), active: bool(row.active), createdAt: millis(row.created_at), updatedAt: millis(row.updated_at) }));
  const formatObjects = formatRows.map((row) => ({ id: str(row.id), name: str(row.name), phases: JSON.stringify(phasesFromRows(formatPhases, str(row.id))), version: num(row.version), createdAt: millis(row.created_at), updatedAt: millis(row.updated_at) }));
  const roomRows = assignments.map((row) => {
    const phaseRows = assignmentPhases.filter((phase) => str(phase.assignment_id) === str(row.id)).map((phase) => ({
      id: str(phase.phase_id), name: str(phase.name), side: str(phase.side), speaker: str(phase.speaker),
      durationSeconds: num(phase.duration_seconds), type: str(phase.phase_type),
      warningThresholdsSeconds: Array.isArray(phase.warning_thresholds_seconds) ? phase.warning_thresholds_seconds.map(Number) : [],
      allowOvertimeDisplay: bool(phase.allow_overtime_display),
    }));
    return {
      id: str(row.id), name: str(physicalRooms.find((physical) => str(physical.id) === str(row.physical_room_id))?.name),
      roundId: str(row.round_id), teamFavorId: str(row.team_favor_id), teamContraId: str(row.team_contra_id),
      judgeIds: JSON.stringify(assignmentJudges.filter((item) => str(item.assignment_id) === str(row.id)).map((item) => str(item.judge_id))),
      status: str(row.timer_status), phases: JSON.stringify(phaseRows), notes: str(row.notes),
      updatedAt: millis(row.updated_at), physicalRoomId: str(row.physical_room_id), formatId: str(row.format_id),
    };
  });
  const timerRows = assignments.map((row) => ({
    roomId: str(row.id), status: str(row.timer_status), phaseIndex: num(row.phase_index),
    remainingSeconds: num(row.remaining_seconds), startedAt: row.started_at ? millis(row.started_at) : "",
    lastResumedAt: row.last_resumed_at ? millis(row.last_resumed_at) : "",
    revision: num(row.timer_revision), updatedAt: millis(row.timer_updated_at),
  }));
  const eventRows = (eventsQ.rows as Record<string, unknown>[]).map((row) => ({
    event_id: str(row.event_key), timestamp_utc: iso(row.occurred_at), room_round_id: str(row.assignment_id),
    round_id: str(row.round_id), room_id: str(row.assignment_id), phase_index: str(row.phase_index ?? ""),
    event_type: str(row.event_type), elapsed_seconds: "", details: JSON.stringify(row.details ?? {}),
  }));
  const rows = {
    Config: config, Rondas: roundRows, Equipos: teamRows, Jueces: judgeRows, Salas: roomRows,
    SalasFisicas: physicalRows, Formatos: formatObjects, Cronometros: timerRows, Registro: eventRows,
  } as Record<SheetName, SheetRow[]>;
  const raw = {} as Record<SheetName, unknown[][]>;
  for (const name of SHEET_NAMES) raw[name] = rawFromRows(rows[name], SHEET_HEADERS[name]);
  return {
    metadata: { spreadsheetId: "postgresql", properties: { title: "LEDU Control PostgreSQL" }, sheets: SHEET_NAMES.map((name, index) => ({ properties: { sheetId: index + 1, title: name, gridProperties: { rowCount: rows[name].length + 1, columnCount: SHEET_HEADERS[name].length } } })) },
    raw, rows,
  };
}

export async function loadPostgresSheetData(): Promise<PostgresSheetData> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const data = await readSnapshot(client);
    await client.query("COMMIT");
    return data;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof ApiError) throw error;
    throw new ApiError("DATABASE_UNAVAILABLE", "No se ha podido leer el estado del torneo en PostgreSQL.", 503);
  } finally {
    client.release();
  }
}

function getConfig(rows: SheetRow[], key: string): string {
  return str(rows.find((row) => str(row.key) === key)?.value);
}
function getRow(rows: SheetRow[], id: string, key = "id"): SheetRow | undefined {
  return rows.find((row) => str(row[key]) === id);
}
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

async function persistConfig(client: PoolClient, oldRows: SheetRow[], newRows: SheetRow[]): Promise<void> {
  const oldRevision = num(getConfig(oldRows, "revision")) || 1;
  const nextRevision = num(getConfig(newRows, "revision")) || oldRevision;
  const oldActive = getConfig(oldRows, "activeRoundId") || null;
  const nextActive = getConfig(newRows, "activeRoundId") || null;
  const settings = {
    formatPhases: json(getConfig(newRows, "formatPhases"), defaultPhases()),
    roundTypes: json(getConfig(newRows, "roundTypes"), {}),
    schemaVersion: getConfig(newRows, "schemaVersion") || "4",
  };
  const result = await client.query(
    `UPDATE tournament_settings SET tournament_name=$1, active_round_id=$2,
       activation_revision=$3, activated_at=CASE WHEN $4::bigint=0 THEN NULL ELSE to_timestamp($4::double precision/1000) END,
       revision=$5, minimum_judges_per_room=$6, settings=$7::jsonb,
       updated_at=CASE WHEN $8::bigint=0 THEN now() ELSE to_timestamp($8::double precision/1000) END
     WHERE id=1 AND revision=$9`,
    [getConfig(newRows, "tournamentName") || "Torneo LEDU", nextActive,
      num(getConfig(newRows, "activationRevision")), num(getConfig(newRows, "activatedAt")),
      nextRevision, Math.max(1, Math.min(25, num(getConfig(newRows, "minimumJudgesPerRoom")) || 1)),
      JSON.stringify(settings), num(getConfig(newRows, "updatedAt")), oldRevision],
  );
  if (result.rowCount !== 1) throw new ApiError("REVISION_CONFLICT", "El torneo cambió en otro dispositivo. Actualiza los datos antes de guardar.", 409);
  if (oldActive !== nextActive) {
    await client.query("UPDATE rounds SET is_active=false WHERE is_active=true");
    if (nextActive) {
      const active = await client.query("UPDATE rounds SET is_active=true, updated_at=now() WHERE id=$1", [nextActive]);
      if (active.rowCount !== 1) throw new ApiError("ROUND_NOT_FOUND", "La ronda activa no existe.", 404);
    }
  }
}

async function persistInstitutions(client: PoolClient, value: string): Promise<void> {
  const names = parseJson<unknown>(value, []);
  if (!Array.isArray(names)) throw new ApiError("INVALID_INSTITUTIONS", "El catálogo de instituciones debe ser una lista.", 400);
  const normalized = [...new Set(names.filter((name): name is string => typeof name === "string").map((name) => name.trim()).filter(Boolean))];
  for (const name of normalized) await upsertInstitution(client, name);
  const ids = normalized.map(institutionId);
  if (ids.length) await client.query("DELETE FROM institutions WHERE NOT (id = ANY($1::text[]))", [ids]);
  else await client.query("DELETE FROM institutions");
}

async function upsertInstitution(client: PoolClient, nameValue: unknown): Promise<string | null> {
  const name = str(nameValue).trim();
  if (!name) return null;
  const id = institutionId(name);
  await client.query(
    "INSERT INTO institutions(id,name) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name, updated_at=now()",
    [id, name],
  );
  return id;
}

async function persistRounds(client: PoolClient, rows: SheetRow[]): Promise<void> {
  await client.query("UPDATE rounds SET is_active=false WHERE is_active=true");
  await client.query("UPDATE rounds SET number=number+100000");
  for (const row of rows) {
    await client.query(
      `INSERT INTO rounds(id,number,name,is_active,score_type,default_format_id)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(id) DO UPDATE SET number=EXCLUDED.number,name=EXCLUDED.name,is_active=EXCLUDED.is_active,
       score_type=EXCLUDED.score_type,default_format_id=EXCLUDED.default_format_id,updated_at=now()`,
      [str(row.id), num(row.number), str(row.name), bool(row.active), str(row.scoreType) === "elimination" ? "elimination" : "qualifying", str(row.defaultFormatId) || null],
    );
  }
}

async function persistTeams(client: PoolClient, rows: SheetRow[], judges: boolean): Promise<void> {
  for (const row of rows) {
    const institution = await upsertInstitution(client, row.institution);
    const table = judges ? "judges" : "teams";
    await client.query(
      `INSERT INTO ${table}(id,name,institution_id,active)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,institution_id=EXCLUDED.institution_id,
       active=EXCLUDED.active,updated_at=now()`,
      [str(row.id), str(row.name).trim(), institution, bool(row.active)],
    );

  }
}

async function persistIncompatibilities(client: PoolClient, teams: SheetRow[], judges: SheetRow[]): Promise<void> {
  // Rebuild both relation sets only after every referenced team and judge exists.
  // This is one transaction, so no caller can observe an intermediate empty set.
  await client.query("DELETE FROM team_judge_incompatibilities");
  await client.query("DELETE FROM judge_incompatibilities");
  for (const team of teams) {
    for (const judgeId of parseStringArray(team.incompatibleJudgeIds)) {
      await client.query("INSERT INTO team_judge_incompatibilities(team_id,judge_id) VALUES($1,$2)", [str(team.id), judgeId]);
    }
  }
  for (const judge of judges) {
    for (const incompatibleJudgeId of parseStringArray(judge.incompatibleJudgeIds)) {
      await client.query("INSERT INTO judge_incompatibilities(judge_id,incompatible_judge_id) VALUES($1,$2)", [str(judge.id), incompatibleJudgeId]);
    }
  }
}

async function persistFormats(client: PoolClient, rows: SheetRow[]): Promise<void> {
  for (const row of rows) {
    const id = str(row.id);
    await client.query(
      "INSERT INTO format_presets(id,name,version) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,version=EXCLUDED.version,updated_at=now()",
      [id, str(row.name), Math.max(1, num(row.version) || 1)],
    );
    await client.query("DELETE FROM format_phases WHERE format_id=$1", [id]);
    const phases = parseJson<Phase[]>(row.phases, []);
    for (let i = 0; i < phases.length; i += 1) {
      const phase = phases[i];
      await client.query(
        `INSERT INTO format_phases(format_id,id,phase_order,name,side,speaker,duration_seconds,phase_type,warning_thresholds_seconds,allow_overtime_display)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::int[],$10)`,
        [id, phase.id, i, phase.name, phase.side, phase.speaker || "Interviniente no especificado", phase.durationSeconds, phase.type || "opening", phase.warningThresholdsSeconds || [], phase.allowOvertimeDisplay !== false],
      );
    }
  }
}

async function persistPhysicalRooms(client: PoolClient, rows: SheetRow[]): Promise<void> {
  for (const row of rows) await client.query(
    `INSERT INTO physical_rooms(id,slug,name,active,created_at,updated_at) VALUES($1,$2,$3,$4,
       CASE WHEN $5::bigint=0 THEN now() ELSE to_timestamp($5::double precision/1000) END,
       CASE WHEN $6::bigint=0 THEN now() ELSE to_timestamp($6::double precision/1000) END)
     ON CONFLICT(id) DO UPDATE SET slug=EXCLUDED.slug,name=EXCLUDED.name,active=EXCLUDED.active,updated_at=EXCLUDED.updated_at`,
    [str(row.id), str(row.slug), str(row.name), bool(row.active), num(row.createdAt), num(row.updatedAt)],
  );
}

async function persistAssignments(client: PoolClient, rooms: SheetRow[], timers: SheetRow[], oldRooms: SheetRow[], oldTimers: SheetRow[], forceRelations = false): Promise<void> {
  const timerById = new Map(timers.map((row) => [str(row.roomId), row]));
  for (const row of rooms) {
    const id = str(row.id);
    const timer = timerById.get(id) || getRow(oldTimers, id, "roomId");
    const oldRoom = getRow(oldRooms, id);
    const staticChanged = forceRelations || !oldRoom || ["roundId","physicalRoomId","formatId","teamFavorId","teamContraId","notes"].some((key) => str(oldRoom[key]) !== str(row[key])) || !same(parseJson(oldRoom.phases, []), parseJson(row.phases, [])) || !same(parseStringArray(oldRoom.judgeIds), parseStringArray(row.judgeIds));
    if (!staticChanged) continue;
    await client.query(
      `INSERT INTO room_assignments(id,round_id,physical_room_id,format_id,team_favor_id,team_contra_id,notes,timer_status,phase_index,remaining_seconds,started_at,last_resumed_at,timer_revision,timer_updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
       CASE WHEN $11::bigint=0 THEN NULL ELSE to_timestamp($11::double precision/1000) END,
       CASE WHEN $12::bigint=0 THEN NULL ELSE to_timestamp($12::double precision/1000) END,
       $13,CASE WHEN $14::bigint=0 THEN now() ELSE to_timestamp($14::double precision/1000) END)
       ON CONFLICT(id) DO UPDATE SET round_id=EXCLUDED.round_id,physical_room_id=EXCLUDED.physical_room_id,format_id=EXCLUDED.format_id,
       team_favor_id=EXCLUDED.team_favor_id,team_contra_id=EXCLUDED.team_contra_id,notes=EXCLUDED.notes,
       updated_at=now()`,
      [id, str(row.roundId), str(row.physicalRoomId), str(row.formatId) || null, str(row.teamFavorId) || null, str(row.teamContraId) || null,
       str(row.notes), str(timer?.status || "idle"), num(timer?.phaseIndex), num(timer?.remainingSeconds), num(timer?.startedAt), num(timer?.lastResumedAt),
       num(timer?.revision), num(timer?.updatedAt)],
    );
    const phases = parseJson<Phase[]>(row.phases, []);
    await client.query("DELETE FROM assignment_phases WHERE assignment_id=$1", [id]);
    for (let i = 0; i < phases.length; i += 1) {
      const phase = phases[i];
      await client.query(
        `INSERT INTO assignment_phases(assignment_id,phase_id,phase_order,name,side,speaker,duration_seconds,phase_type,warning_thresholds_seconds,allow_overtime_display)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::int[],$10)`,
        [id, phase.id, i, phase.name, phase.side, phase.speaker || "Interviniente no especificado", phase.durationSeconds, phase.type || "opening", phase.warningThresholdsSeconds || [], phase.allowOvertimeDisplay !== false],
      );
    }
    await client.query("DELETE FROM assignment_judges WHERE assignment_id=$1", [id]);
    const judgeIds = parseStringArray(row.judgeIds);
    for (const judgeId of judgeIds) await client.query("INSERT INTO assignment_judges(assignment_id,judge_id) VALUES($1,$2)", [id, judgeId]);
  }
  // Timer updates are optimistic and row-scoped. A stale timer revision cannot overwrite another device.
  for (const timer of timers) {
    const id = str(timer.roomId);
    const old = getRow(oldTimers, id, "roomId");
    const changed = !old || !same(old, timer);
    if (!changed) continue;
    if (!old) continue; // New assignments already received their initial timer in the INSERT above.
    const oldRevision = num(old.revision);
    const result = await client.query(
      `UPDATE room_assignments SET timer_status=$1,phase_index=$2,remaining_seconds=$3,
       started_at=CASE WHEN $4::bigint=0 THEN NULL ELSE to_timestamp($4::double precision/1000) END,
       last_resumed_at=CASE WHEN $5::bigint=0 THEN NULL ELSE to_timestamp($5::double precision/1000) END,
       timer_revision=$6,timer_updated_at=CASE WHEN $7::bigint=0 THEN now() ELSE to_timestamp($7::double precision/1000) END,
       updated_at=now()
       WHERE id=$8 AND timer_revision=$9`,
      [str(timer.status), num(timer.phaseIndex), num(timer.remainingSeconds), num(timer.startedAt), num(timer.lastResumedAt), num(timer.revision), num(timer.updatedAt), id, oldRevision],
    );
    if (result.rowCount !== 1) throw new ApiError("REVISION_CONFLICT", "El cronómetro cambió en otro dispositivo. Actualiza el estado.", 409);
  }
}

async function persistSpeakers(client: PoolClient, value: string): Promise<void> {
  const parsed = parseJson<unknown>(value, []);
  const speakers = Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : [];
  for (const speaker of speakers) await client.query(
    "INSERT INTO speakers(id,team_id,name) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET team_id=EXCLUDED.team_id,name=EXCLUDED.name,updated_at=now()",
    [str(speaker.id), str(speaker.teamId), str(speaker.name).trim()],
  );
  const ids = speakers.map((speaker) => str(speaker.id));
  if (ids.length) await client.query("DELETE FROM speakers WHERE NOT (id = ANY($1::text[]))", [ids]);
  else await client.query("DELETE FROM speakers");
}

async function persistScoring(client: PoolClient, value: string): Promise<void> {
  const scoring = parseScoringConfig(parseJson(value, emptyScoringConfig()));
  await client.query("UPDATE score_categories SET category_order=category_order+1000");
  for (const category of scoring.categories) await client.query(
    "INSERT INTO score_categories(id,name,category_order) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,category_order=EXCLUDED.category_order,updated_at=now()",
    [category.id, category.name, category.order],
  );
  const categoryIds = scoring.categories.map((category) => category.id);
  const cardIds = scoring.scorecards.map((card) => card.id);
  // Remove obsolete scorecards first so their dependent category rows do not
  // block deletion of a category that is no longer referenced by retained acts.
  if (cardIds.length) await client.query("DELETE FROM scorecards WHERE NOT (id = ANY($1::text[]))", [cardIds]);
  else await client.query("DELETE FROM scorecards");
  if (categoryIds.length) await client.query("DELETE FROM score_categories WHERE NOT (id = ANY($1::text[]))", [categoryIds]);
  for (const card of scoring.scorecards) {
    await client.query(
      `INSERT INTO scorecards(id,assignment_id,round_id,team_favor_id,team_contra_id,status,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,'submitted',to_timestamp($6::double precision/1000),to_timestamp($7::double precision/1000))
       ON CONFLICT(id) DO UPDATE SET assignment_id=EXCLUDED.assignment_id,round_id=EXCLUDED.round_id,
       team_favor_id=EXCLUDED.team_favor_id,team_contra_id=EXCLUDED.team_contra_id,updated_at=EXCLUDED.updated_at`,
      [card.id, card.roomId, card.roundId, card.teamFavorId, card.teamContraId, card.createdAt, card.updatedAt],
    );
    await client.query("DELETE FROM scorecard_team_scores WHERE scorecard_id=$1", [card.id]);
    for (const team of card.teams) {
      await client.query(
        "INSERT INTO scorecard_team_scores(scorecard_id,team_id,total,minor_faults,major_faults) VALUES($1,$2,$3,$4,$5)",
        [card.id, team.teamId, team.total, team.minorFaults, team.majorFaults],
      );
      for (const [categoryId, score] of Object.entries(team.categoryScores)) await client.query(
        "INSERT INTO scorecard_category_scores(scorecard_id,team_id,category_id,score) VALUES($1,$2,$3,$4)",
        [card.id, team.teamId, categoryId, score],
      );
    }
    await client.query("DELETE FROM scorecard_judges WHERE scorecard_id=$1", [card.id]);
    for (const judge of card.judges) await client.query("INSERT INTO scorecard_judges(scorecard_id,judge_id) VALUES($1,$2)", [card.id, judge.judgeId]);
    await client.query("DELETE FROM scorecard_speaker_scores WHERE scorecard_id=$1", [card.id]);
    for (const speaker of card.speakers) await client.query(
      "INSERT INTO scorecard_speaker_scores(scorecard_id,speaker_id,team_id,position,score) VALUES($1,$2,$3,$4,$5)",
      [card.id, speaker.speakerId, speaker.teamId, speaker.position, speaker.score],
    );
  }
}

async function persistEvent(client: PoolClient, event: unknown[]): Promise<void> {
  const details = json(event[8], {});
  const eventKey = str(event[0]) || randomBytes(16).toString("hex");
  const assignmentId = str(event[2]).startsWith("round:") || str(event[2]) === "scoring" ? null : str(event[2]) || null;
  const roundId = str(event[3]) || null;
  const eventType = str(event[6]) || "unknown";
  await client.query(
    `INSERT INTO audit_events(event_key,event_type,occurred_at,assignment_id,round_id,phase_index,details)
     VALUES($1,$2,COALESCE(NULLIF($3,'')::timestamptz,now()),$4,$5,NULLIF($6,'')::integer,$7::jsonb)
     ON CONFLICT(event_key) DO NOTHING`,
    [eventKey, eventType, str(event[1]), assignmentId, roundId, str(event[5]), JSON.stringify(details)],
  );
  const idempotency = details && typeof details === "object" ? details as Record<string, unknown> : {};
  if (typeof idempotency.idempotencyKey === "string" && idempotency.idempotencyResponse !== undefined) {
    await client.query(
      "INSERT INTO idempotency_keys(operation_key,scope,response,completed_at) VALUES($1,$2,$3::jsonb,now()) ON CONFLICT(operation_key) DO NOTHING",
      [str(idempotency.idempotencyKey), str(idempotency.idempotencyScope), JSON.stringify(idempotency.idempotencyResponse)],
    );
  }
}

export async function readIdempotentResponse(operationKey: string, scope: string): Promise<unknown | null> {
  const client = await getPool().connect();
  try {
    const result = await client.query("SELECT scope,response FROM idempotency_keys WHERE operation_key=$1", [operationKey]);
    if (!result.rows.length) return null;
    if (str(result.rows[0].scope) !== scope) throw new ApiError("IDEMPOTENCY_KEY_REUSED", "La clave de idempotencia ya se utilizó para otra operación.", 409);
    return result.rows[0].response ?? null;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("DATABASE_UNAVAILABLE", "No se ha podido comprobar la idempotencia de la operación.", 503);
  } finally {
    client.release();
  }
}

export async function writePostgresTables(data: PostgresSheetData, replacements: Partial<Record<SheetName, SheetRow[]>>, appendEvent?: unknown[]): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    if (replacements.Config) await persistConfig(client, data.rows.Config, replacements.Config);
    if (replacements.Rondas) await persistRounds(client, replacements.Rondas);
    if (replacements.Equipos) await persistTeams(client, replacements.Equipos, false);
    if (replacements.Jueces) await persistTeams(client, replacements.Jueces, true);
    if (replacements.Equipos && replacements.Jueces) await persistIncompatibilities(client, replacements.Equipos, replacements.Jueces);
    if (replacements.SalasFisicas) await persistPhysicalRooms(client, replacements.SalasFisicas);
    if (replacements.Formatos) await persistFormats(client, replacements.Formatos);
    if (replacements.Equipos) {
      // Release derived cross-side claims and judge slots before a full roster
      // replacement; the assignment triggers rebuild them transactionally.
      await client.query("DELETE FROM round_team_claims");
      await client.query("DELETE FROM assignment_judges");
    }
    if (replacements.Salas || replacements.Cronometros) {
      await persistAssignments(client, replacements.Salas || data.rows.Salas, replacements.Cronometros || data.rows.Cronometros,
        data.rows.Salas, data.rows.Cronometros, Boolean(replacements.Equipos));
    }
    if (replacements.Config) {
      const config = replacements.Config;
      if (!same(parseJson(getConfig(config, "institutions"), []), parseJson(getConfig(data.rows.Config, "institutions"), []))) {
        await persistInstitutions(client, getConfig(config, "institutions"));
      }
      if (!same(parseJson(getConfig(config, "speakers"), []), parseJson(getConfig(data.rows.Config, "speakers"), []))) {
        await persistSpeakers(client, getConfig(config, "speakers"));
      }
      if (!same(parseJson(getConfig(config, "scoring"), emptyScoringConfig()), parseJson(getConfig(data.rows.Config, "scoring"), emptyScoringConfig()))) {
        await persistScoring(client, getConfig(config, "scoring"));
      }
    }
    if (replacements.Equipos || replacements.Jueces || replacements.SalasFisicas || replacements.Rondas) {
      // A complete tournament save includes Equipos; only then are omitted assignments treated as removed.
      if (replacements.Equipos) {
        const ids = (replacements.Salas || []).map((row) => str(row.id));
        if (ids.length) await client.query("DELETE FROM room_assignments WHERE NOT (id = ANY($1::text[]))", [ids]);
        else await client.query("DELETE FROM room_assignments");
        const teamIds = replacements.Equipos.map((row) => str(row.id));
        if (teamIds.length) await client.query("DELETE FROM teams WHERE NOT (id = ANY($1::text[]))", [teamIds]);
        else await client.query("DELETE FROM teams");
        const judgeIds = (replacements.Jueces || []).map((row) => str(row.id));
        if (judgeIds.length) await client.query("DELETE FROM judges WHERE NOT (id = ANY($1::text[]))", [judgeIds]);
        else await client.query("DELETE FROM judges");
        const roomIds = (replacements.SalasFisicas || []).map((row) => str(row.id));
        if (roomIds.length) await client.query("DELETE FROM physical_rooms WHERE NOT (id = ANY($1::text[]))", [roomIds]);
        else await client.query("DELETE FROM physical_rooms");
        const roundIds = (replacements.Rondas || []).map((row) => str(row.id));
        if (roundIds.length) await client.query("DELETE FROM rounds WHERE NOT (id = ANY($1::text[]))", [roundIds]);
        else await client.query("DELETE FROM rounds");
      }
    }
    if (appendEvent) await persistEvent(client, appendEvent);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof ApiError) throw error;
    const code = (error as { code?: string })?.code;
    if (code === "23505" || code === "23503" || code === "23514") {
      throw new ApiError("DATABASE_CONSTRAINT", "La operación contradice una regla de integridad del torneo. Actualiza los datos y vuelve a intentarlo.", 409);
    }
    throw new ApiError("DATABASE_WRITE_FAILED", "No se ha podido guardar el torneo en PostgreSQL. No se ha confirmado ningún cambio.", 503);
  } finally {
    client.release();
  }
}
