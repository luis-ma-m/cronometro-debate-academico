import { createHash } from "node:crypto";
import { getPool } from "./db.js";
import { ApiError, bool, num, str } from "./core.js";
import { validateTabulationSettings as validateSettings, TabulationSettingsValidationError } from "./tabulation-settings-validation.js";
import { canonicalizeTabulationActa, type TabulationActaIdMap } from "./tabulation-acta-identity.js";
import { validateTabulationActaSource } from "./tabulation-acta-source.js";
import { TabulationActaValidationError, type TabulationActaDomainContext } from "./tabulation-acta-domain.js";
import type { TabJudge, TabSettings, TabSpeaker, TabTeam } from "../src/tabulation/types.js";
import { presetSettings } from "../src/tabulation/presets.js";

type Db = { query(sql: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const parseJson = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value) as unknown; } catch { return null; }
};
const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const uuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function buildActaDiff(before: unknown, after: unknown, limit = 40): Array<{ path: string; before: unknown; after: unknown }> {
  const changes: Array<{ path: string; before: unknown; after: unknown }> = [];
  const visit = (left: unknown, right: unknown, path: string) => {
    if (changes.length >= limit) return;
    if (JSON.stringify(left) === JSON.stringify(right)) return;
    if (isRecord(left) && isRecord(right)) {
      for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
        visit(left[key], right[key], path ? path + "." + key : key);
        if (changes.length >= limit) break;
      }
      return;
    }
    changes.push({ path: path || "acta", before: left === undefined ? null : left, after: right === undefined ? null : right });
  };
  visit(before, after, "");
  return changes;
}


interface LoadedActaContext {
  context: TabulationActaDomainContext;
  idMap: TabulationActaIdMap;
  assignmentId: string;
  managerRoundId: string;
  tournamentId: string;
  currentSourceId: string | null;
  settingsRevision: number;
  rulesSnapshot: Record<string, unknown>;
}

/** Load all authoritative inputs from PostgreSQL. No outcome-affecting metadata is accepted from the acta request. */
async function loadActaContext(db: Db, assignmentId: string): Promise<LoadedActaContext> {
  const assignmentResult = await db.query(
    `SELECT b.tournament_id::text AS tournament_id, b.tabulation_round_id, b.tabulation_debate_id,
            b.manager_round_id, b.assignment_id, b.chair_judge_id, b.sides_provisional,
            r.number AS round_number, r.score_type AS round_kind,
            ra.team_favor_id, ra.team_contra_id, m.side_mode, m.team_metadata, m.entity_id_map,
            ti.tournament_id::text AS canonical_tournament_id, ts.revision,
            floor(extract(epoch FROM ts.updated_at) * 1000)::bigint AS updated_at_ms,
            h.source_id::text AS current_source_id
       FROM tabulation_debate_assignments b
       JOIN tournament_identity ti ON ti.tournament_id = b.tournament_id AND ti.id = 1
       JOIN room_assignments ra ON ra.id = b.assignment_id AND ra.round_id = b.manager_round_id
       JOIN rounds r ON r.id = b.manager_round_id
       JOIN tabulation_round_metadata m ON m.tournament_id = b.tournament_id AND m.manager_round_id = b.manager_round_id
       JOIN tournament_settings ts ON ts.id = 1
       LEFT JOIN tabulation_acta_heads h ON h.assignment_id = b.assignment_id
      WHERE b.assignment_id = $1
      FOR UPDATE OF ra FOR SHARE OF ts`,
    [assignmentId],
  );
  const row = assignmentResult.rows[0];
  if (!row) throw new ApiError("ACTA_CONTEXT_NOT_FOUND", "No existe una relación publicada entre este debate de Tabulación y la asignación del Gestor, o faltan sus metadatos persistidos.", 409);

  const teamFavorId = str(row.team_favor_id), teamContraId = str(row.team_contra_id);
  if (!teamFavorId || !teamContraId || teamFavorId === teamContraId) {
    throw new ApiError("ACTA_CONTEXT_INVALID", "La asignación del Gestor no contiene dos equipos válidos.", 409);
  }
  const entityIdMap = parseJson(row.entity_id_map);
  const metadata = parseJson(row.team_metadata);
  if (!isRecord(entityIdMap) || !isRecord(entityIdMap.teams) || !isRecord(entityIdMap.judges) || !isRecord(entityIdMap.speakers)) {
    throw new ApiError("ACTA_IDENTITY_REVIEW_REQUIRED", "La publicación no conserva un mapa de identidades completo. Vuelve a publicar la ronda con la versión actual.", 409);
  }
  if (!Array.isArray(metadata)) throw new ApiError("ACTA_CONTEXT_INVALID", "La instantánea de metadatos de equipos no es válida.", 500);
  const idMap: TabulationActaIdMap = {
    teams: entityIdMap.teams as Record<string, string>,
    judges: entityIdMap.judges as Record<string, string>,
    speakers: entityIdMap.speakers as Record<string, string>,
  };

  const [teamsResult, judgesResult, speakersResult, settingsResult] = await Promise.all([
    db.query(`SELECT t.id, t.name, t.active, COALESCE(i.name, '') AS institution, t.incompatible_judge_ids
             FROM teams t LEFT JOIN institutions i ON i.id = t.institution_id`),
    db.query(`SELECT j.id, j.name, j.active, COALESCE(i.name, '') AS institution, j.incompatible_judge_ids
             FROM judges j LEFT JOIN institutions i ON i.id = j.institution_id
             JOIN assignment_judges aj ON aj.judge_id = j.id WHERE aj.assignment_id = $1`, [assignmentId]),
    db.query(`SELECT s.id, s.team_id, s.name FROM speakers s WHERE s.team_id = ANY($1::text[])`, [[teamFavorId, teamContraId]]),
    db.query("SELECT schema_version, revision, settings FROM tabulation_settings WHERE id = 1 FOR SHARE"),
  ]);
  const settingsRow = settingsResult.rows[0];
  if (!settingsRow) throw new ApiError("MIGRATION_REQUIRED", "Falta la configuración persistida de Tabulación. No se puede validar un acta sin sus reglas.", 503);
  let settings: TabSettings;
  try { settings = !settingsRow.settings || (isRecord(settingsRow.settings) && Object.keys(settingsRow.settings).length === 0)
    ? presetSettings("ledu-groups") : validateSettings(settingsRow.settings); }
  catch (error) {
    if (error instanceof TabulationSettingsValidationError) throw new ApiError("ACTA_RULES_INVALID", "Las reglas persistidas de Tabulación no son válidas: " + error.message, 409);
    throw error;
  }

  const teamMetadata = new Map<string, Record<string, unknown>>();
  for (const entry of metadata) {
    if (!isRecord(entry) || typeof entry.teamId !== "string" || teamMetadata.has(entry.teamId)) {
      throw new ApiError("ACTA_CONTEXT_INVALID", "La instantánea de metadatos contiene referencias duplicadas o inválidas.", 500);
    }
    teamMetadata.set(entry.teamId, entry);
  }
  const teams: TabTeam[] = teamsResult.rows.filter((team) => teamMetadata.has(str(team.id))).map((team) => {
    const saved = teamMetadata.get(str(team.id))!;
    return {
      id: str(team.id), name: str(team.name), institution: str(team.institution), active: bool(team.active),
      swing: saved.swing === true, breakEligible: saved.breakEligible === true,
      incompatibleJudgeIds: Array.isArray(team.incompatible_judge_ids) ? team.incompatible_judge_ids.map(String) : [],
      ...(Number.isSafeInteger(saved.fallenFromRound) ? { fallenFromRound: Number(saved.fallenFromRound) } : {}),
    };
  });
  const judges: TabJudge[] = judgesResult.rows.map((judge) => ({
    id: str(judge.id), name: str(judge.name), institution: str(judge.institution), active: bool(judge.active),
    rating: 3, canChair: str(judge.id) === str(row.chair_judge_id),
    incompatibleJudgeIds: Array.isArray(judge.incompatible_judge_ids) ? judge.incompatible_judge_ids.map(String) : [],
    unavailableRoundIds: [],
  }));
  const speakers: TabSpeaker[] = speakersResult.rows.map((speaker) => ({
    id: str(speaker.id), teamId: str(speaker.team_id), name: str(speaker.name),
  }));
  const judgeIds = judges.map((judge) => judge.id);
  const allowedTeams = new Set(teams.map((team) => team.id));
  const allowedJudges = new Set(judgeIds);
  const allowedSpeakers = new Set(speakers.map((speaker) => speaker.id));
  // The stored id map covers the whole tournament. Only references actually used
  // by this acta are resolved below, against the exact assignment membership.
  void allowedTeams; void allowedJudges; void allowedSpeakers;

  const revision = num(row.revision);
  const updatedAt = num(row.updated_at_ms);
  const roundKind = str(row.round_kind) === "elimination" ? "elimination" : "qualifying";
  const sideMode = str(row.side_mode) === "draw" ? "draw" : "balanced";
  const context: TabulationActaDomainContext = {
    canonicalTournamentId: str(row.canonical_tournament_id),
    currentRevision: revision,
    currentUpdatedAt: updatedAt,
    settings,
    round: { id: str(row.manager_round_id), number: num(row.round_number), kind: roundKind, sideMode },
    debate: {
      id: str(row.tabulation_debate_id),
      teamIds: [teamFavorId, teamContraId],
      judgeIds,
      chairId: str(row.chair_judge_id),
      favorTeamId: teamFavorId,
    },
    teams, judges, speakers,
  };
  const rulesSnapshot = {
    settings,
    round: context.round,
    debate: { id: context.debate.id, teamIds: context.debate.teamIds, judgeIds, chairId: context.debate.chairId, favorTeamId: teamFavorId },
    teams: teams.map(({ id, swing, breakEligible, fallenFromRound }) => ({ id, swing, breakEligible, fallenFromRound: fallenFromRound ?? null })),
    entityIdMap: idMap,
    sidesProvisional: bool(row.sides_provisional),
  };
  return {
    context, idMap, assignmentId, managerRoundId: str(row.manager_round_id),
    tournamentId: str(row.canonical_tournament_id),
    currentSourceId: str(row.current_source_id) || null,
    settingsRevision: num(settingsRow.revision),
    rulesSnapshot,
  };
}

export interface PreviewTabulationActaInput {
  assignmentId: string;
  source: unknown;
}

/** Read-only comparison preparation against the latest authoritative manager context. */
export async function previewTabulationActa(input: PreviewTabulationActaInput) {
  if (!uuid(input.assignmentId)) throw new ApiError("INVALID_PAYLOAD", "La asignación del acta no es válida.");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const loaded = await loadActaContext(client, input.assignmentId);
    if (!isRecord(input.source) || !isRecord(input.source.acta)) throw new ApiError("INVALID_ACTA_SOURCE", "La fuente del acta no tiene una estructura válida.");
    const canonicalActa = canonicalizeTabulationActa(
      { ...input.source.acta, ...(input.source.eliminationResult === undefined ? {} : { eliminationResult: input.source.eliminationResult }) },
      loaded.idMap,
      {
        tournamentId: loaded.tournamentId, roundId: loaded.managerRoundId, debateId: loaded.context.debate.id,
        teamIds: loaded.context.debate.teamIds, judgeIds: loaded.context.debate.judgeIds,
        speakerIds: loaded.context.speakers.map((speaker) => speaker.id),
      },
    );
    canonicalActa.basePanelRevision = loaded.context.currentRevision;
    canonicalActa.basePanelUpdatedAt = loaded.context.currentUpdatedAt;
    const validated = validateTabulationActaSource({
      sourceMode: input.source.sourceMode,
      acta: canonicalActa,
      eliminationResult: canonicalActa.eliminationResult ?? input.source.eliminationResult,
    }, loaded.context);
    const proposedSource = {
      sourceMode: validated.sourceMode,
      acta: canonicalActa,
      eliminationResult: validated.eliminationResult,
    };
    let currentSource: Record<string, unknown> | null = null;
    if (loaded.currentSourceId) {
      const existing = await client.query(
        "SELECT id::text AS id, source_mode, source_payload, source_hash, created_at FROM tabulation_acta_sources WHERE id = $1 AND assignment_id = $2",
        [loaded.currentSourceId, input.assignmentId],
      );
      const row = existing.rows[0];
      if (!row) throw new ApiError("DATABASE_INTEGRITY", "El historial apunta a una versión inexistente.", 500);
      currentSource = {
        id: str(row.id), sourceMode: str(row.source_mode), sourcePayload: row.source_payload,
        sourceHash: str(row.source_hash),
        createdAt: row.created_at instanceof Date ? row.created_at.getTime() : new Date(String(row.created_at)).getTime(),
      };
    }
    await client.query("COMMIT");
    return {
      assignmentId: input.assignmentId, tournamentId: loaded.tournamentId,
      roundId: loaded.managerRoundId, debateId: loaded.context.debate.id,
      basePanelRevision: loaded.context.currentRevision, basePanelUpdatedAt: loaded.context.currentUpdatedAt,
      settingsRevision: loaded.settingsRevision,
      currentSourceId: loaded.currentSourceId, currentSource,
      changes: currentSource ? buildActaDiff(currentSource.sourcePayload, proposedSource) : [],
      proposedSource, sourceMode: validated.sourceMode, winnerTeamId: validated.acta.winnerTeamId,
      requiresReplacementConfirmation: Boolean(loaded.currentSourceId),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof ApiError) throw error;
    if (error instanceof TabulationActaValidationError) throw new ApiError("INVALID_ACTA", error.message, 422);
    if (error instanceof TabulationSettingsValidationError) throw new ApiError("ACTA_RULES_INVALID", error.message, 409);
    if (error && typeof error === "object" && "code" in error && ["42P01", "42703"].includes(String((error as { code?: unknown }).code))) {
      throw new ApiError("MIGRATION_REQUIRED", "Faltan las migraciones F4 0012–0016 en este entorno. No se ha guardado ni modificado el acta.", 503);
    }
    throw error;
  } finally {
    client.release();
  }
}

export interface SaveTabulationActaInput {
  operationId: string;
  assignmentId: string;
  source: unknown;
  expectedCurrentSourceId: string | null;
  confirmReplace: boolean;
  expectedSettingsRevision: number;
}

/** First-save/replacement transaction. Immutable source, head trigger, audit and idempotency commit together. */
export async function saveTabulationActa(input: SaveTabulationActaInput) {
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(input.operationId)) throw new ApiError("INVALID_PAYLOAD", "El identificador de operación del acta no es válido.");
  if (!uuid(input.assignmentId)) throw new ApiError("INVALID_PAYLOAD", "La asignación del acta no es válida.");
  if (input.expectedCurrentSourceId !== null && !uuid(input.expectedCurrentSourceId)) throw new ApiError("INVALID_PAYLOAD", "La versión vigente esperada no es válida.");
  if (typeof input.confirmReplace !== "boolean") throw new ApiError("INVALID_PAYLOAD", "Falta la confirmación explícita de sustitución.");
  if (!Number.isSafeInteger(input.expectedSettingsRevision) || input.expectedSettingsRevision < 0) throw new ApiError("INVALID_PAYLOAD", "La revisión de reglas esperada no es válida.");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const loaded = await loadActaContext(client, input.assignmentId);
    const scope = "tabulation-save-acta:" + input.assignmentId + ":" + hash({
      source: input.source, expectedCurrentSourceId: input.expectedCurrentSourceId, confirmReplace: input.confirmReplace,
    });
    const prior = await client.query("SELECT scope, response FROM idempotency_keys WHERE operation_key = $1", [input.operationId]);
    if (prior.rows[0]) {
      if (str(prior.rows[0].scope) !== scope) throw new ApiError("IDEMPOTENCY_MISMATCH", "El operationId ya se utilizó con otra acta.", 409);
      if (!prior.rows[0].response) throw new ApiError("IDEMPOTENCY_INCOMPLETE", "La operación previa no tiene una confirmación recuperable.", 409);
      await client.query("COMMIT");
      return prior.rows[0].response;
    }
    if (loaded.settingsRevision !== input.expectedSettingsRevision) throw new ApiError("ACTA_RULES_REVISION_CONFLICT", "Las reglas de Tabulación han cambiado desde la comparación. Vuelve a revisar el acta con las reglas actuales.", 409);
    if (loaded.currentSourceId !== input.expectedCurrentSourceId) {
      throw new ApiError("ACTA_REVISION_CONFLICT", "El acta vigente ha cambiado desde la última comparación. Recarga el historial y vuelve a revisar la sustitución.", 409);
    }
    if (loaded.currentSourceId && !input.confirmReplace) {
      throw new ApiError("ACTA_REPLACEMENT_CONFIRMATION_REQUIRED", "Ya existe un acta oficial. Debes revisar la comparación y confirmar expresamente su sustitución.", 409);
    }
    if (!loaded.currentSourceId && input.confirmReplace) {
      throw new ApiError("ACTA_REPLACEMENT_CONFIRMATION_INVALID", "No existe un acta vigente que pueda sustituirse.", 409);
    }
    if (!isRecord(input.source) || !isRecord(input.source.acta)) throw new ApiError("INVALID_ACTA_SOURCE", "La fuente del acta no tiene una estructura válida.");
    const canonicalActa = canonicalizeTabulationActa(
      { ...input.source.acta, ...(input.source.eliminationResult === undefined ? {} : { eliminationResult: input.source.eliminationResult }) },
      loaded.idMap,
      {
        tournamentId: loaded.tournamentId, roundId: loaded.managerRoundId, debateId: loaded.context.debate.id,
        teamIds: loaded.context.debate.teamIds, judgeIds: loaded.context.debate.judgeIds,
        speakerIds: loaded.context.speakers.map((speaker) => speaker.id),
      },
    );
    const validated = validateTabulationActaSource({
      sourceMode: input.source.sourceMode,
      acta: canonicalActa,
      eliminationResult: canonicalActa.eliminationResult ?? input.source.eliminationResult,
    }, loaded.context);
    const sourcePayload = {
      sourceMode: validated.sourceMode,
      acta: canonicalActa,
      eliminationResult: validated.eliminationResult,
    };
    const sourceHash = hash(sourcePayload);
    const inserted = await client.query(
      `INSERT INTO tabulation_acta_sources
        (tournament_id, assignment_id, source_mode, round_kind, base_revision, source_hash,
         source_payload, rules_snapshot, operation_id, supersedes_source_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, 'admin')
       RETURNING id::text AS id, created_at`,
      [loaded.tournamentId, input.assignmentId, validated.sourceMode, validated.roundKind,
        validated.acta.basePanelRevision, sourceHash, JSON.stringify(sourcePayload),
        JSON.stringify(loaded.rulesSnapshot), input.operationId, loaded.currentSourceId],
    );
    const sourceId = str(inserted.rows[0]?.id);
    const count = await client.query(
      "SELECT count(*)::int AS total_versions, count(*) FILTER (WHERE supersedes_source_id IS NOT NULL)::int AS rewrite_count FROM tabulation_acta_sources WHERE assignment_id = $1",
      [input.assignmentId],
    );
    const response = {
      assignmentId: input.assignmentId, tournamentId: loaded.tournamentId,
      sourceId, currentVersionId: sourceId,
      sourceMode: validated.sourceMode, winnerTeamId: validated.acta.winnerTeamId,
      rewriteCount: num(count.rows[0]?.rewrite_count), totalVersions: num(count.rows[0]?.total_versions),
      replacedSourceId: loaded.currentSourceId, operationId: input.operationId,
      createdAt: inserted.rows[0]?.created_at instanceof Date ? (inserted.rows[0].created_at as Date).getTime() : Date.now(),
    };
    await client.query(
      "INSERT INTO audit_events(event_key, event_type, round_id, assignment_id, details) VALUES ($1, $2, $3, $4, $5::jsonb)",
      ["tabulation-acta:" + input.operationId, loaded.currentSourceId ? "tabulation_acta_replaced" : "tabulation_acta_saved",
        loaded.managerRoundId, input.assignmentId,
        JSON.stringify({ operationId: input.operationId, sourceId, sourceHash, sourceMode: validated.sourceMode,
          winnerTeamId: validated.acta.winnerTeamId, replacedSourceId: loaded.currentSourceId,
          rewriteCount: response.rewriteCount })],
    );
    await client.query(
      "INSERT INTO idempotency_keys(operation_key, scope, response, completed_at) VALUES ($1, $2, $3::jsonb, now())",
      [input.operationId, scope, JSON.stringify(response)],
    );
    await client.query("COMMIT");
    return response;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof ApiError) throw error;
    if (error instanceof TabulationActaValidationError) throw new ApiError("INVALID_ACTA", error.message, 422);
    if (error instanceof TabulationSettingsValidationError) throw new ApiError("ACTA_RULES_INVALID", error.message, 409);
    if (error && typeof error === "object" && "code" in error && ["42P01", "42703"].includes(String((error as { code?: unknown }).code))) {
      throw new ApiError("MIGRATION_REQUIRED", "Faltan las migraciones F4 0012–0016 en este entorno. No se ha guardado ni modificado el acta.", 503);
    }
    throw error;
  } finally {
    client.release();
  }
}
