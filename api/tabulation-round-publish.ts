import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { ApiError, bool, num, str } from "./core.js";
import { assertSyncOperationAuthorized, SyncAuthorizationError } from "./sync-operation-policy.js";
import { validateSyncOperationEnvelope, type ValidatedSyncOperation } from "./sync-operation-validation.js";
import { SyncDomainValidationError, validatePublishedRoundPayload } from "./tabulation-sync-domain.js";

/**
 * Publishes a reviewed Tabulation round as official manager assignments.
 * The manager session is verified by the dispatcher before this function runs.
 * Identity, base revision, domain relations, round, assignments, audit and ACK
 * are committed atomically. No local/offline data is changed by this endpoint.
 */
export async function publishTabulationRound(rawOperation: unknown) {
  let operation: ValidatedSyncOperation;
  try {
    operation = validateSyncOperationEnvelope(rawOperation);
  } catch (error) {
    throw new ApiError("INVALID_PAYLOAD", error instanceof Error ? error.message : "La operación de publicación no es válida.");
  }
  if (operation.operation !== "publish-round" || operation.entityType !== "round") {
    throw new ApiError("OPERATION_NOT_ALLOWED", "La operación debe ser una publicación explícita de ronda.", 403);
  }
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(operation.entityId)) {
    throw new ApiError("INVALID_PAYLOAD", "El identificador de la ronda no es válido.");
  }
  const proposal = operation.payload;
  if (proposal.basePanelRevision !== operation.baseRevision) {
    throw new ApiError("INVALID_PAYLOAD", "La revisión del sobre y la revisión base de la propuesta no coinciden.");
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const settingsResult = await client.query(
      `SELECT ti.tournament_id::text AS tournament_id, ts.revision,
              floor(extract(epoch FROM ts.updated_at) * 1000)::bigint AS updated_at_ms,
              ts.minimum_judges_per_room
         FROM tournament_settings ts
         JOIN tournament_identity ti ON ti.id = 1
        WHERE ts.id = 1
        FOR UPDATE OF ts`,
    );
    const settings = settingsResult.rows[0] as Record<string, unknown> | undefined;
    if (!settings) throw new ApiError("DATABASE_NOT_INITIALIZED", "No existe la configuración canónica del torneo.", 503);
    const canonicalTournamentId = str(settings.tournament_id);
    const currentRevision = num(settings.revision);
    const currentUpdatedAt = num(settings.updated_at_ms);
    const scope = ["tabulation-publish-round", operation.tournamentId, operation.entityId, operation.payloadHash].join(":");

    const previous = await client.query(
      "SELECT scope, response FROM idempotency_keys WHERE operation_key = $1",
      [operation.operationId],
    );
    if (previous.rows[0]) {
      const prior = previous.rows[0] as { scope: string; response: unknown };
      if (prior.scope !== scope) throw new ApiError("IDEMPOTENCY_MISMATCH", "El operationId ya se utilizó con otra publicación o contenido.", 409);
      if (!prior.response) throw new ApiError("IDEMPOTENCY_INCOMPLETE", "La publicación anterior no tiene una confirmación recuperable. Requiere revisión.", 409);
      await client.query("COMMIT");
      return prior.response;
    }

    assertSyncOperationAuthorized(operation, { authenticatedManager: true, canonicalTournamentId });
    if (proposal.basePanelRevision !== currentRevision
      || (proposal.basePanelUpdatedAt !== undefined && proposal.basePanelUpdatedAt !== currentUpdatedAt)) {
      throw new ApiError("REVISION_CONFLICT", "El gestor ha cambiado desde que se generó la propuesta. Recarga el snapshot, revisa los cruces y vuelve a publicar.", 409);
    }

    const [roomsResult, teamsResult, judgesResult] = await Promise.all([
      client.query("SELECT id, active FROM physical_rooms"),
      client.query(`SELECT t.id, t.name, t.active, i.name AS institution, t.incompatible_judge_ids
                     FROM teams t LEFT JOIN institutions i ON i.id = t.institution_id`),
      client.query(`SELECT j.id, j.name, j.active, i.name AS institution, j.incompatible_judge_ids
                     FROM judges j LEFT JOIN institutions i ON i.id = j.institution_id`),
    ]);
    const validated = validatePublishedRoundPayload(proposal, {
      canonicalTournamentId,
      currentRevision,
      currentUpdatedAt,
      physicalRooms: roomsResult.rows.map((row) => ({ id: str(row.id), active: bool(row.active) })),
      teams: teamsResult.rows.map((row) => ({
        id: str(row.id), name: str(row.name), active: bool(row.active), institution: str(row.institution),
        incompatibleJudgeIds: Array.isArray(row.incompatible_judge_ids) ? row.incompatible_judge_ids.map(String) : [],
      })),
      judges: judgesResult.rows.map((row) => ({
        id: str(row.id), name: str(row.name), active: bool(row.active), institution: str(row.institution),
        incompatibleJudgeIds: Array.isArray(row.incompatible_judge_ids) ? row.incompatible_judge_ids.map(String) : [],
      })),
      minimumJudgesPerRoom: Math.max(1, num(settings.minimum_judges_per_room)),
    });

    const nextRoundNumber = await client.query("SELECT COALESCE(MAX(number), 0) + 1 AS next_number FROM rounds");
    if (validated.roundNumber !== num(nextRoundNumber.rows[0]?.next_number)) {
      throw new ApiError("REVISION_CONFLICT", "El número de ronda ya no es el siguiente disponible. Actualiza el torneo y vuelve a revisar la propuesta.", 409);
    }
    const existingRound = await client.query("SELECT id FROM rounds WHERE id = $1 OR number = $2", [operation.entityId, validated.roundNumber]);
    if (existingRound.rows.length) throw new ApiError("REVISION_CONFLICT", "Ya existe una ronda con ese identificador o número.", 409);

    // Every new assignment must inherit a real manager format snapshot. An empty
    // assignment_phases array would make the timer load with zero phases/seconds.
    const formatResult = await client.query("SELECT id FROM format_presets ORDER BY name, id LIMIT 1");
    const defaultFormatId = str(formatResult.rows[0]?.id);
    if (!defaultFormatId) throw new ApiError("FORMAT_NOT_CONFIGURED", "El gestor no tiene un formato de debate configurado. No se ha publicado la ronda.", 503);
    const phasesResult = await client.query(
      `SELECT phase_id, phase_order, name, side, speaker, description, duration_seconds,
              phase_type, warning_thresholds_seconds, allow_overtime_display
         FROM format_phases WHERE format_id = $1 ORDER BY phase_order`,
      [defaultFormatId],
    );
    const phases = phasesResult.rows as Array<Record<string, unknown>>;
    const firstPhaseDuration = num(phases[0]?.duration_seconds);
    if (!phases.length || !Number.isSafeInteger(firstPhaseDuration) || firstPhaseDuration < 1) {
      throw new ApiError("FORMAT_NOT_CONFIGURED", "El formato predeterminado del gestor no contiene intervenciones válidas. No se ha publicado la ronda.", 503);
    }

    const roundKind = validated.roundKind;
    await client.query(
      "INSERT INTO rounds(id, number, name, score_type, default_format_id, is_active) VALUES ($1, $2, $3, $4, $5, false)",
      [operation.entityId, validated.roundNumber, validated.roundName, roundKind, defaultFormatId],
    );
    await client.query(
      `INSERT INTO tabulation_round_metadata (tournament_id, manager_round_id, side_mode, team_metadata, updated_by)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [canonicalTournamentId, operation.entityId, validated.sideMode, JSON.stringify(validated.teamMetadata), "tabulation:" + operation.operationId],
    );
    await client.query(
      "INSERT INTO audit_events(event_key, event_type, round_id, details) VALUES ($1, $2, $3, $4::jsonb)",
      ["tabulation-metadata:" + operation.operationId, "tabulation_round_metadata_published", operation.entityId,
        JSON.stringify({ operationId: operation.operationId, tabTournamentId: validated.tabTournamentId,
          tabulationRoundId: validated.tabulationRoundId, sideMode: validated.sideMode,
          teamMetadata: validated.teamMetadata })],
    );

    const assignmentIds: string[] = [];
    for (const debate of validated.debates) {
      const assignmentId = randomUUID();
      assignmentIds.push(assignmentId);
      await client.query(
        `INSERT INTO room_assignments(id, round_id, physical_room_id, format_id, team_favor_id, team_contra_id, remaining_seconds, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [assignmentId, operation.entityId, debate.physicalRoomId, defaultFormatId, debate.teamFavorId, debate.teamContraId,
          firstPhaseDuration, debate.sidesProvisional ? "Posturas provisionales: revisar antes de activar la ronda." : ""],
      );
      // Persist the exact local→remote debate identity in the same transaction as its assignment.
      await client.query(
        `INSERT INTO tabulation_debate_assignments
          (tournament_id, tabulation_round_id, tabulation_debate_id, manager_round_id, assignment_id, chair_judge_id, sides_provisional)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [canonicalTournamentId, validated.tabulationRoundId, debate.tabulationDebateId, operation.entityId, assignmentId, debate.chairId || null, debate.sidesProvisional],
      );
      for (const phase of phases) {
        await client.query(
          `INSERT INTO assignment_phases(
             assignment_id, phase_id, phase_order, name, side, speaker, description, duration_seconds,
             phase_type, warning_thresholds_seconds, allow_overtime_display
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [assignmentId, str(phase.phase_id), num(phase.phase_order), str(phase.name), str(phase.side), str(phase.speaker),
            str(phase.description), num(phase.duration_seconds), str(phase.phase_type),
            Array.isArray(phase.warning_thresholds_seconds) ? phase.warning_thresholds_seconds.map(Number) : [],
            bool(phase.allow_overtime_display)],
        );
      }
      for (const judgeId of debate.judgeIds) {
        await client.query("INSERT INTO assignment_judges(assignment_id, judge_id) VALUES ($1, $2)", [assignmentId, judgeId]);
      }
      await client.query(
        "INSERT INTO audit_events(event_key, event_type, round_id, assignment_id, details) VALUES ($1, $2, $3, $4, $5::jsonb)",
        ["tabulation-publish:" + operation.operationId + ":" + assignmentId, "tabulation_round_assignment_published",
          operation.entityId, assignmentId, JSON.stringify({ operationId: operation.operationId, chairJudgeId: debate.chairId || null,
            sidesProvisional: debate.sidesProvisional, venueName: debate.venueName, tournamentId: canonicalTournamentId })],
      );
    }

    const nextRevision = currentRevision + 1;
    await client.query("UPDATE tournament_settings SET revision = $1, updated_at = now() WHERE id = 1", [nextRevision]);
    const response = {
      tournamentId: canonicalTournamentId, tabTournamentId: validated.tabTournamentId, tabulationRoundId: validated.tabulationRoundId,
      roundId: operation.entityId, roundNumber: validated.roundNumber,
      roundName: validated.roundName, roundKind, assignmentIds,
      debateAssignments: validated.debates.map((debate, index) => ({ tabulationDebateId: debate.tabulationDebateId, assignmentId: assignmentIds[index] })),
      revision: nextRevision, operationId: operation.operationId,
    };
    await client.query(
      "INSERT INTO idempotency_keys(operation_key, scope, response, completed_at) VALUES ($1, $2, $3::jsonb, now())",
      [operation.operationId, scope, JSON.stringify(response)],
    );
    await client.query(
      "INSERT INTO audit_events(event_key, event_type, round_id, details) VALUES ($1, $2, $3, $4::jsonb)",
      ["tabulation-round-published:" + operation.operationId, "tabulation_round_published", operation.entityId,
        JSON.stringify({ operationId: operation.operationId, tournamentId: canonicalTournamentId, roundNumber: validated.roundNumber,
          roundKind, sideMode: validated.sideMode, teamMetadataCount: validated.teamMetadata.length, assignmentCount: assignmentIds.length, revision: nextRevision, payloadHash: operation.payloadHash })],
    );
    await client.query("COMMIT");
    return response;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof ApiError) throw error;
    if (error instanceof SyncAuthorizationError) {
      throw new ApiError(error.code, error.message, error.status);
    }
    if (error instanceof SyncDomainValidationError) {
      throw new ApiError("INVALID_RELATION", error.issues.join(" "), 422);
    }
    if (error && typeof error === "object" && "code" in error && ["42P01", "42703"].includes(String((error as { code?: unknown }).code))) {
      throw new ApiError("MIGRATION_REQUIRED", "Falta aplicar una migración requerida para publicar rondas. No se ha modificado ningún dato.", 503);
    }
    if (error && typeof error === "object" && "code" in error && String((error as { code?: unknown }).code) === "23505") {
      throw new ApiError("REVISION_CONFLICT", "La publicación entra en conflicto con una asignación o ronda existente. Recarga y revisa la propuesta.", 409);
    }
    throw new ApiError("DATABASE_UNAVAILABLE", "No se ha podido publicar la ronda. La transacción se ha revertido.", 503);
  } finally {
    client.release();
  }
}
