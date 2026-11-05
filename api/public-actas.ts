import { createHash } from "node:crypto";
import { getPool } from "./db.js";
import { ApiError } from "./core.js";
import { getTabulationSnapshot } from "./tabulation-snapshots.js";
import { actaDebateRef, readActaCode } from "../src/tabulation/whatsapp.js";
import type { TabTournament } from "../src/tabulation/types.js";

export type PublicActaSubmission = {
  id: string;
  tournamentId: string;
  roundNumber: number;
  roundName: string;
  debateRef: string;
  judgeName: string;
  code: string;
  createdAt: number;
};

let schemaReady: Promise<void> | null = null;
async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await getPool().query(`
        CREATE TABLE IF NOT EXISTS public_acta_submissions (
          id varchar(80) PRIMARY KEY CHECK (id ~ '^[a-zA-Z0-9_-]{8,80}$'),
          tournament_id varchar(200) NOT NULL CHECK (tournament_id ~ '^[a-zA-Z0-9_-]{1,200}$'),
          round_number integer NOT NULL CHECK (round_number >= 1),
          round_name varchar(120) NOT NULL,
          debate_ref varchar(80) NOT NULL CHECK (debate_ref ~ '^[a-zA-Z0-9_-]{1,80}$'),
          judge_name varchar(120) NOT NULL,
          acta_code text NOT NULL CHECK (length(acta_code) BETWEEN 20 AND 30000),
          code_sha256 char(64) NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (tournament_id, debate_ref)
        )
      `);
      await getPool().query("CREATE INDEX IF NOT EXISTS public_acta_submissions_tournament_idx ON public_acta_submissions(tournament_id, created_at DESC)");
    })().catch((error) => { schemaReady = null; throw error; });
  }
  await schemaReady;
}

const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";

export async function submitPublicActa(input: Record<string, unknown>): Promise<{ id: string; createdAt: number; duplicate: boolean }> {
  await ensureSchema();
  const id = text(input.submissionId, 80);
  const tournamentId = text(input.tournamentId, 200);
  const roundNumber = Number(input.roundNumber);
  const roundName = text(input.roundName, 120);
  const debateRef = text(input.debateRef, 80);
  const judgeName = text(input.judgeName, 120);
  const code = text(input.code, 30000);
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id) || !/^[a-zA-Z0-9_-]{1,200}$/.test(tournamentId)
      || !Number.isSafeInteger(roundNumber) || roundNumber < 1
      || !roundName || !/^[a-zA-Z0-9_-]{1,80}$/.test(debateRef)
      || !judgeName || !/^ACTA[12]-[0-9A-Za-z]+-[a-f0-9]{14}$/i.test(code)) {
    throw new ApiError("INVALID_PUBLIC_ACTA", "Los datos del acta no son válidos.");
  }
  const remote = await getTabulationSnapshot(tournamentId);
  if (!remote) throw new ApiError("TOURNAMENT_NOT_FOUND", "La tabulación de este torneo aún no está sincronizada con Neon.", 409);
  const tournament = remote.snapshot as unknown as TabTournament;
  const received = readActaCode(tournament, code);
  if (received.error || !received.payload || !received.roundId || !received.debateId) {
    throw new ApiError("INVALID_PUBLIC_ACTA", received.error || "El código no corresponde a un debate válido.", 422);
  }
  const round = tournament.rounds.find((item) => item.id === received.roundId);
  if (!round || round.number !== roundNumber || round.name !== roundName
      || received.payload.signedBy.trim() !== judgeName) {
    throw new ApiError("ACTA_METADATA_MISMATCH", "El juez o la ronda no coinciden con el código del acta.", 422);
  }
  // The debate ID comes from the validated code, never from the public request metadata.
  const debateId = received.debateId;
  if (actaDebateRef(tournament, debateId) !== debateRef) {
    throw new ApiError("ACTA_DEBATE_MISMATCH", "La referencia del enlace no coincide con el debate del acta.", 422);
  }
  const hash = createHash("sha256").update(code).digest("hex");
  const pool = getPool();
  const inserted = await pool.query(
    "INSERT INTO public_acta_submissions(id,tournament_id,round_number,round_name,debate_ref,judge_name,acta_code,code_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tournament_id,debate_ref) DO NOTHING RETURNING id,created_at",
    [id, tournamentId, roundNumber, roundName, debateId, judgeName, code, hash],
  );
  if (inserted.rows[0]) {
    return { id, createdAt: new Date(String((inserted.rows[0] as Record<string, unknown>).created_at)).getTime(), duplicate: false };
  }
  const existing = await pool.query(
    "SELECT id,created_at,code_sha256 FROM public_acta_submissions WHERE tournament_id=$1 AND debate_ref=$2",
    [tournamentId, debateId],
  );
  const row = existing.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new ApiError("PUBLIC_ACTA_SAVE_FAILED", "No se ha podido confirmar el guardado del acta.", 503);
  if (String(row.code_sha256).trim() !== hash) {
    throw new ApiError("ACTA_ALREADY_SUBMITTED", "Este debate ya tiene un acta recibida. Contacta con la mesa para corregirla.", 409);
  }
  return { id: String(row.id), createdAt: new Date(String(row.created_at)).getTime(), duplicate: true };
}

export async function publicActaAlreadySubmitted(tournamentIdValue: string, publicDebateRefValue: string): Promise<boolean> {
  await ensureSchema();
  const tournamentId = text(tournamentIdValue, 200);
  const publicDebateRef = text(publicDebateRefValue, 80);
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(tournamentId) || !/^[a-zA-Z0-9_-]{1,80}$/.test(publicDebateRef)) {
    throw new ApiError("INVALID_PAYLOAD", "El enlace del acta no es válido.");
  }
  const remote = await getTabulationSnapshot(tournamentId);
  if (!remote) return false;
  const tournament = remote.snapshot as unknown as TabTournament;
  const debate = tournament.rounds.flatMap((round) => round.debates)
    .find((item) => item.id === publicDebateRef || actaDebateRef(tournament, item.id) === publicDebateRef);
  if (!debate) return false;
  const result = await getPool().query(
    "SELECT 1 FROM public_acta_submissions WHERE tournament_id=$1 AND debate_ref=$2 LIMIT 1",
    [tournamentId, debate.id],
  );
  return result.rows.length > 0;
}

export async function listPublicActas(tournamentIdValue: string): Promise<PublicActaSubmission[]> {
  await ensureSchema();
  const tournamentId = text(tournamentIdValue, 200);
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(tournamentId)) throw new ApiError("INVALID_PAYLOAD", "El torneo no es válido.");
  const result = await getPool().query(
    "SELECT id,tournament_id,round_number,round_name,debate_ref,judge_name,acta_code,created_at FROM public_acta_submissions WHERE tournament_id=$1 ORDER BY created_at ASC",
    [tournamentId],
  );
  return result.rows.map((value) => {
    const row = value as Record<string, unknown>;
    return {
      id: String(row.id), tournamentId: String(row.tournament_id), roundNumber: Number(row.round_number),
      roundName: String(row.round_name), debateRef: String(row.debate_ref), judgeName: String(row.judge_name),
      code: String(row.acta_code), createdAt: new Date(String(row.created_at)).getTime(),
    };
  });
}
