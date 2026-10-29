import { toCsv } from './csv';
import { formatLogTime } from './log';
import { isFallenAt, type TabLogEntry, type TabRound, type TabTournament } from './types';

/** One debate of a published round: who debates where and who judges. Never any result. */
export interface RoundSheetRow { venue: string; teams: [string, string]; side: string; chair: string; wings: string[]; note: string }
export interface RoundSheet { tournament: string; title: string; rows: RoundSheetRow[] }

export const naturalCompare = (x: string, y: string) => x.localeCompare(y, 'es', { numeric: true, sensitivity: 'base' });

/**
 * Debates in natural room order (Aula 2 before Aula 10), so the order never reveals the ranking; debates that are
 * not held (fallen teams) or have no room go last.
 */
export function roundSheet(tournament: TabTournament, round: TabRound): RoundSheet {
  const teams = new Map(tournament.teams.map((team) => [team.id, team]));
  const judges = new Map(tournament.judges.map((judge) => [judge.id, judge.name]));
  const venues = new Map(tournament.venues.map((venue) => [venue.id, venue.name]));
  const teamName = (id: string) => teams.get(id)?.name ?? 'Equipo desconocido';
  const rows = round.debates.map((debate) => {
    const fallen = debate.teamIds.filter((id) => isFallenAt(teams.get(id), round.number));
    // A debate that is not held sends nobody to a room, even if it still had one or a jury.
    const venue = fallen.length ? '' : venues.get(debate.venueId) ?? '';
    const note = fallen.length === 2 ? 'No se disputa: los dos equipos están caídos.'
      : fallen.length === 1 ? 'No se disputa: «' + teamName(fallen[0]) + '» está caído.'
        : !venue ? 'Sin sala asignada.' : '';
    const side = fallen.length ? '' : debate.favorTeamId ? 'A favor: ' + teamName(debate.favorTeamId) : round.sideMode === 'draw' ? 'Se sortea en la sala' : 'Por decidir';
    return {
      venue,
      teams: [teamName(debate.teamIds[0]), teamName(debate.teamIds[1])] as [string, string],
      side,
      chair: !fallen.length && debate.chairId ? judges.get(debate.chairId) ?? 'Juez desconocido' : '',
      wings: fallen.length ? [] : debate.judgeIds.filter((id) => id !== debate.chairId).map((id) => judges.get(id) ?? 'Juez desconocido'),
      note,
      held: !fallen.length,
    };
  });
  const sorted = [...rows].sort((x, y) => Number(!x.held || !x.venue) - Number(!y.held || !y.venue) || naturalCompare(x.venue, y.venue));
  return { tournament: tournament.name, title: round.name + ' · emparejamientos', rows: sorted.map(({ held: _held, ...row }) => row) };
}

export interface LogStamp { seq: number; hash: string }

/** The last sealed log entry: printed on every export, it ties the paper to the log. */
export function latestLogStamp(entries: TabLogEntry[]): LogStamp | null {
  const last = [...entries].reverse().find((entry) => entry.hash);
  return last ? { seq: last.seq, hash: last.hash } : null;
}

export function stampText(stamp: LogStamp | null, now: number): string {
  return 'Generado el ' + formatLogTime(now) + (stamp ? ' · registro n.º ' + stamp.seq + ' · huella ' + stamp.hash : ' · registro sin entradas');
}

export function roundCsv(tournament: TabTournament, round: TabRound, stamp: LogStamp | null, now: number): string {
  const sheet = roundSheet(tournament, round);
  return toCsv([
    [sheet.tournament],
    [sheet.title],
    [stampText(stamp, now)],
    [],
    ['Sala', 'Equipo 1', 'Equipo 2', 'Postura', 'Juez principal', 'Vocales', 'Observaciones'],
    ...sheet.rows.map((row) => [row.venue, row.teams[0], row.teams[1], row.side, row.chair, row.wings.join(', '), row.note]),
  ]);
}

export function roundTxt(tournament: TabTournament, round: TabRound, stamp: LogStamp | null, now: number): string {
  const sheet = roundSheet(tournament, round);
  const lines = [sheet.tournament, sheet.title, stampText(stamp, now), ''];
  const held = sheet.rows.filter((row) => !row.note || row.note === 'Sin sala asignada.');
  const notHeld = sheet.rows.filter((row) => !held.includes(row));
  for (const row of held) {
    lines.push(row.venue || 'Sin sala');
    lines.push('  ' + row.teams[0] + '  –  ' + row.teams[1]);
    lines.push('  Postura: ' + row.side.charAt(0).toLowerCase() + row.side.slice(1));
    lines.push('  Jurado: ' + (row.chair ? row.chair + ' (principal)' : 'sin asignar') + (row.wings.length ? ', ' + row.wings.join(', ') : ''));
    lines.push('');
  }
  if (notHeld.length) {
    lines.push('No se disputan:');
    for (const row of notHeld) lines.push('  ' + row.teams[0] + ' – ' + row.teams[1] + '. ' + row.note);
    lines.push('');
  }
  return lines.join('\r\n');
}

/** Lowercase ASCII words joined by hyphens, safe for any file system. */
export function asciiSlug(text: string): string {
  return text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'torneo';
}
