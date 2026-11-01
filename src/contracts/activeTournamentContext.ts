import { canonicalId, type CanonicalId } from './identity';

/**
 * Shared identity/revision for the one tournament currently operated by this
 * application installation. This is a runtime contract, not a tournament
 * selector or a multi-tournament registry.
 */
export interface ActiveTournamentContext {
  readonly schemaVersion: 1;
  readonly tournamentId: CanonicalId<'tournament'>;
  /** Monotonic server revision observed by the client. */
  readonly revision: number;
  readonly source: 'server' | 'local';
  readonly updatedAt: number;
}

export class ActiveTournamentContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActiveTournamentContextError';
  }
}

function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Parse an untrusted context received from persistence, an API or a module boundary. */
export function parseActiveTournamentContext(value: unknown): ActiveTournamentContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ActiveTournamentContextError('El contexto del torneo debe ser un objeto.');
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1) {
    throw new ActiveTournamentContextError('La versión del contexto del torneo no está soportada.');
  }
  if (candidate.source !== 'server' && candidate.source !== 'local') {
    throw new ActiveTournamentContextError('El origen del contexto del torneo no es válido.');
  }
  if (!validRevision(candidate.revision)) {
    throw new ActiveTournamentContextError('La revisión del torneo debe ser un entero no negativo.');
  }
  if (!validTimestamp(candidate.updatedAt)) {
    throw new ActiveTournamentContextError('La fecha de actualización del torneo no es válida.');
  }

  try {
    return Object.freeze({
      schemaVersion: 1,
      tournamentId: canonicalId('tournament', candidate.tournamentId),
      revision: candidate.revision,
      source: candidate.source,
      updatedAt: candidate.updatedAt,
    });
  } catch {
    throw new ActiveTournamentContextError('El identificador canónico del torneo no es válido.');
  }
}

/** Construct a context through the same validation used at external boundaries. */
export function activeTournamentContext(
  tournamentId: unknown,
  revision: unknown,
  source: unknown,
  updatedAt: unknown,
): ActiveTournamentContext {
  return parseActiveTournamentContext({
    schemaVersion: 1,
    tournamentId,
    revision,
    source,
    updatedAt,
  });
}
