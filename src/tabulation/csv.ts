import type { SpeakerRanking, TeamStanding } from './standings';
import { makeTabId, type ConflictLevel, type TabJudgeConflict, type TabTournament } from './types';
import { whatsAppNumber } from './whatsapp';

/** Splits pasted spreadsheet lines; the separator (tab, semicolon or comma) is detected from the first line. */
export function parseDelimited(content: string): string[][] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n').filter((line) => line.trim());
  if (!lines.length) return [];
  const first = lines[0];
  const separator = first.includes('\t') ? '\t' : first.includes(';') ? ';' : first.includes(',') ? ',' : ';';
  return lines.map((line) => {
    const cells: string[] = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (quoted) {
        if (char === '"' && line[i + 1] === '"') { cell += '"'; i++; } else if (char === '"') quoted = false;
        else cell += char;
      } else if (char === '"') quoted = true;
      else if (char === separator) { cells.push(cell.trim()); cell = ''; } else cell += char;
    }
    cells.push(cell.trim());
    return cells;
  });
}

const key = (value: string) => value.trim().toLocaleLowerCase('es-ES');

export interface TeamImportRow { name: string; institution: string; speakers: string[] }
export interface JudgeImportRow { name: string; institution: string; rating?: number; canChair?: boolean; phone?: string }
export interface ImportPreview<T> { rows: T[]; errors: string[] }

/** "Equipo;Institución;Orador 1;Orador 2…" — a first line starting with "Equipo" is treated as a header. */
export function parseTeamLines(content: string): ImportPreview<TeamImportRow> {
  const rows: TeamImportRow[] = [];
  const errors: string[] = [];
  parseDelimited(content).forEach((cells, index) => {
    if (index === 0 && /^equipo/i.test(cells[0] ?? '')) return;
    const [name = '', institution = '', ...speakers] = cells;
    if (!name) { errors.push('Línea ' + (index + 1) + ': falta el nombre del equipo.'); return; }
    rows.push({ name, institution, speakers: speakers.filter(Boolean) });
  });
  return { rows, errors };
}

function parseYesNo(value: string | undefined): boolean | undefined {
  if (!value?.trim()) return undefined;
  if (/^(s[ií]|s|x|1|true|yes|y)$/i.test(value.trim())) return true;
  if (/^(no|n|0|false)$/i.test(value.trim())) return false;
  return undefined;
}

/** "Juez;Institución;Nivel (1-5);Preside (sí/no);Móvil" — a first line starting with "Juez" is treated as a header. */
export function parseJudgeLines(content: string): ImportPreview<JudgeImportRow> {
  const rows: JudgeImportRow[] = [];
  const errors: string[] = [];
  parseDelimited(content).forEach((cells, index) => {
    if (index === 0 && /^jue[zc]/i.test(cells[0] ?? '')) return;
    const [name = '', institution = '', ratingText, chairText, phoneText] = cells;
    if (!name) { errors.push('Línea ' + (index + 1) + ': falta el nombre del juez.'); return; }
    const rating = ratingText ? Number(ratingText.replace(',', '.')) : undefined;
    if (rating !== undefined && (!Number.isInteger(rating) || rating < 1 || rating > 5)) errors.push('Línea ' + (index + 1) + ': el nivel debe ser un entero de 1 a 5.');
    const phone = whatsAppNumber(phoneText ?? '');
    rows.push({ name, institution, rating: rating !== undefined && rating >= 1 && rating <= 5 ? Math.round(rating) : undefined, canChair: parseYesNo(chairText), ...(phone ? { phone } : {}) });
  });
  return { rows, errors };
}

export function parseVenueLines(content: string): ImportPreview<string> {
  const rows = parseDelimited(content).map((cells) => cells[0]).filter((name): name is string => Boolean(name) && !/^sala$/i.test(name));
  return { rows, errors: [] };
}

export interface ImportSummary { tournament: TabTournament; added: number; updated: number }

/** Adds new teams or completes existing ones (matched by name); speakers are added when missing. */
export function applyTeamImport(tournament: TabTournament, rows: TeamImportRow[]): ImportSummary {
  let added = 0;
  let updated = 0;
  const teams = [...tournament.teams];
  const speakers = [...tournament.speakers];
  for (const row of rows) {
    let team = teams.find((item) => key(item.name) === key(row.name));
    if (!team) {
      team = { id: makeTabId('equipo'), name: row.name.trim(), institution: row.institution.trim(), active: true, swing: false, breakEligible: true, incompatibleJudgeIds: [] };
      teams.push(team);
      added++;
    } else if (row.institution.trim() && row.institution.trim() !== team.institution) {
      const changed = { ...team, institution: row.institution.trim() };
      teams[teams.indexOf(team)] = changed;
      team = changed;
      updated++;
    }
    const teamId = team.id;
    for (const name of row.speakers) {
      if (!speakers.some((speaker) => speaker.teamId === teamId && key(speaker.name) === key(name))) speakers.push({ id: makeTabId('orador'), teamId, name: name.trim() });
    }
  }
  return { tournament: { ...tournament, teams, speakers }, added, updated };
}

export function applyJudgeImport(tournament: TabTournament, rows: JudgeImportRow[]): ImportSummary {
  let added = 0;
  let updated = 0;
  const judges = [...tournament.judges];
  for (const row of rows) {
    const index = judges.findIndex((item) => key(item.name) === key(row.name));
    if (index < 0) {
      judges.push({
        id: makeTabId('juez'), name: row.name.trim(), institution: row.institution.trim(), active: true, rating: row.rating ?? 3,
        canChair: row.canChair ?? true, incompatibleJudgeIds: [], unavailableRoundIds: [], ...(row.phone ? { phone: row.phone } : {}),
      });
      added++;
      continue;
    }
    const current = judges[index];
    const next = {
      ...current,
      institution: row.institution.trim() || current.institution,
      rating: row.rating ?? current.rating,
      canChair: row.canChair ?? current.canChair,
      ...(row.phone ? { phone: row.phone } : {}),
    };
    if (JSON.stringify(next) !== JSON.stringify(current)) { judges[index] = next; updated++; }
  }
  return { tournament: { ...tournament, judges }, added, updated };
}

export function applyVenueImport(tournament: TabTournament, names: string[]): ImportSummary {
  const venues = [...tournament.venues];
  let added = 0;
  for (const name of names) {
    if (venues.some((venue) => key(venue.name) === key(name))) continue;
    venues.push({ id: makeTabId('sala'), name: name.trim(), active: true });
    added++;
  }
  return { tournament: { ...tournament, venues }, added, updated: 0 };
}

/** Names as people type them: case, accents and repeated spaces do not matter. */
const looseKey = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-ES').replace(/\s+/g, ' ').trim();

export interface ConflictImportRow { judgeId: string; teamId?: string; institution?: string; level: ConflictLevel; note: string }

/**
 * "Juez;Equipo o institución;objetiva|subjetiva;nota". The second column is matched first against team names and
 * then against the institutions of the teams; unknown names are reported line by line.
 */
export function parseConflictLines(content: string, tournament: Pick<TabTournament, 'judges' | 'teams'>): ImportPreview<ConflictImportRow> {
  const rows: ConflictImportRow[] = [];
  const errors: string[] = [];
  const judges = new Map(tournament.judges.map((judge) => [looseKey(judge.name), judge.id]));
  const teams = new Map(tournament.teams.map((team) => [looseKey(team.name), team.id]));
  const institutions = new Map<string, string>();
  for (const team of tournament.teams) if (team.institution.trim() && !institutions.has(looseKey(team.institution))) institutions.set(looseKey(team.institution), team.institution.trim());
  parseDelimited(content).forEach((cells, index) => {
    // A header row names the columns; a first row with a real judge is data.
    if (index === 0 && /^jue[zc]/i.test(cells[0] ?? '') && !judges.has(looseKey(cells[0] ?? ''))) return;
    const line = 'Línea ' + (index + 1) + ': ';
    const [judgeName = '', target = '', levelText = '', note = ''] = cells;
    const judgeId = judges.get(looseKey(judgeName));
    if (!judgeId) { errors.push(line + 'no se encuentra el juez «' + judgeName + '».'); return; }
    const teamId = teams.get(looseKey(target));
    const institution = teamId ? undefined : institutions.get(looseKey(target));
    if (!teamId && !institution) { errors.push(line + '«' + target + '» no es ningún equipo ni institución.'); return; }
    const level: ConflictLevel | null = /^o(bj|$)/i.test(levelText.trim()) ? 'objective' : /^s(ubj|$)/i.test(levelText.trim()) ? 'subjective' : null;
    if (!level) { errors.push(line + 'el tipo debe ser «objetiva» o «subjetiva».'); return; }
    rows.push({ judgeId, ...(teamId ? { teamId } : { institution }), level, note: note.trim() });
  });
  return { rows, errors };
}

/** Adds the new incompatibilities; the same judge and team (or institution) only updates its type and note. */
export function applyConflictImport(tournament: TabTournament, rows: ConflictImportRow[]): ImportSummary {
  let added = 0;
  let updated = 0;
  const conflicts: TabJudgeConflict[] = [...(tournament.judgeConflicts ?? [])];
  const sameTarget = (conflict: TabJudgeConflict, row: ConflictImportRow) => conflict.judgeId === row.judgeId
    && (row.teamId ? conflict.teamId === row.teamId : !conflict.teamId && looseKey(conflict.institution ?? '') === looseKey(row.institution ?? ''));
  for (const row of rows) {
    const index = conflicts.findIndex((conflict) => sameTarget(conflict, row));
    if (index < 0) {
      conflicts.push({ id: makeTabId('incompatibilidad'), ...row });
      added++;
    } else if (conflicts[index].level !== row.level || conflicts[index].note !== row.note) {
      conflicts[index] = { ...conflicts[index], level: row.level, note: row.note };
      updated++;
    }
  }
  return { tournament: { ...tournament, judgeConflicts: conflicts }, added, updated };
}

/** Semicolon CSV with a BOM so spreadsheet programs configured for Spanish open it correctly. */
export function toCsv(rows: Array<Array<string | number>>): string {
  const cell = (value: string | number) => {
    const raw = typeof value === 'number' ? String(Number(value.toFixed(2))).replace('.', ',') : value;
    return /[;"\n]/.test(raw) ? '"' + raw.replace(/"/g, '""') + '"' : raw;
  };
  return '\ufeff' + rows.map((row) => row.map(cell).join(';')).join('\r\n');
}

export function standingsCsv(sections: Array<{ title: string; rows: TeamStanding[] }>, speakerRankings: SpeakerRanking[]): string {
  const rows: Array<Array<string | number>> = [];
  for (const section of sections) {
    rows.push([section.title]);
    rows.push(['Pos.', 'Equipo', 'Institución', 'Victorias', 'Derrotas', 'Votos', 'Puntos', 'Media', 'Oradores', 'Graves', 'Leves', 'Avisos']);
    for (const row of section.rows) {
      rows.push([row.rank, row.name, row.institution, row.wins, row.losses, row.ballots, row.points, row.pointsAverage, row.speakerPoints, row.majors, row.minors, row.warnings]);
    }
    rows.push([]);
  }
  for (const ranking of speakerRankings) {
    rows.push([ranking.title]);
    rows.push(['Pos.', 'Orador', 'Equipo', 'Suma', 'Media', 'Intervenciones']);
    for (const row of ranking.rows) rows.push([row.rank, row.name, row.teamName, row.total, row.average, row.count]);
    rows.push([]);
  }
  return toCsv(rows);
}
