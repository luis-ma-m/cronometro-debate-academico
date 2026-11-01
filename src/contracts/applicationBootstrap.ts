import { parseManagerSession, type ManagerSession } from './managerSession';
import { parseActiveTournamentContext, type ActiveTournamentContext } from './activeTournamentContext';
import { parseParticipantSnapshot, type ParticipantSnapshot } from './participantSnapshot';

/**
 * One validated runtime projection shared by both application shells.
 * It deliberately does not own persistence, routing or authorization:
 * the server remains the authority for every protected operation.
 */
export interface ApplicationBootstrap {
  readonly schemaVersion: 1;
  readonly session: ManagerSession | null;
  readonly activeTournament: ActiveTournamentContext | null;
  readonly participants: ParticipantSnapshot | null;
}

export interface ApplicationBootstrapInput {
  session: unknown;
  activeTournament: unknown;
  participants?: unknown;
}

export class ApplicationBootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApplicationBootstrapError';
  }
}

export function createApplicationBootstrap(input: ApplicationBootstrapInput, now = Date.now()): ApplicationBootstrap {
  const session = parseManagerSession(input.session, now);
  const activeTournament = input.activeTournament === null || input.activeTournament === undefined
    ? null
    : parseActiveTournamentContext(input.activeTournament);
  const participants = input.participants === null || input.participants === undefined
    ? null
    : parseParticipantSnapshot(input.participants);

  if (participants && !activeTournament) {
    throw new ApplicationBootstrapError('No se puede cargar un snapshot de participantes sin torneo activo.');
  }
  if (participants && activeTournament && participants.tournamentId !== activeTournament.tournamentId) {
    throw new ApplicationBootstrapError('El snapshot de participantes no pertenece al torneo activo.');
  }

  return Object.freeze({ schemaVersion: 1, session, activeTournament, participants });
}
