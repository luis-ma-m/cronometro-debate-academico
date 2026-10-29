import type { TabTournament } from './types';

export interface IntegrityReport { errors: string[]; warnings: string[] }

/** Institution text as people may mistype it: case, accents and spacing removed. */
function looseInstitution(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-ES').replace(/\s+/g, ' ').trim();
}

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const id of ids) (seen.has(id) ? repeated : seen).add(id);
  return [...repeated];
}

/**
 * Consistency checks for the «Diagnóstico» screen: everything that could make a result, a pairing or an export
 * wrong. Errors need fixing before the next round; warnings are worth a look.
 */
export function checkIntegrity(tournament: TabTournament): IntegrityReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const teams = new Map(tournament.teams.map((team) => [team.id, team]));
  const judges = new Map(tournament.judges.map((judge) => [judge.id, judge]));
  const venues = new Map(tournament.venues.map((venue) => [venue.id, venue]));
  const teamName = (id: string) => teams.get(id)?.name ?? id;
  const judgeName = (id: string) => judges.get(id)?.name ?? id;

  const allDebates = tournament.rounds.flatMap((round) => round.debates);
  for (const [label, ids] of [
    ['equipos', tournament.teams.map((team) => team.id)], ['oradores', tournament.speakers.map((speaker) => speaker.id)],
    ['jueces', tournament.judges.map((judge) => judge.id)], ['salas', tournament.venues.map((venue) => venue.id)],
    ['rondas', tournament.rounds.map((round) => round.id)], ['debates', allDebates.map((debate) => debate.id)],
  ] as const) {
    const repeated = duplicates([...ids]);
    if (repeated.length) errors.push('Hay ' + label + ' con el mismo identificador: ' + repeated.join(', ') + '.');
  }

  for (const number of duplicates(tournament.rounds.map((round) => String(round.number)))) errors.push('Dos rondas tienen el número ' + number + '.');
  const firstElimination = Math.min(...tournament.rounds.filter((round) => round.kind === 'elimination').map((round) => round.number));
  if (tournament.rounds.some((round) => round.kind === 'qualifying' && round.number > firstElimination)) errors.push('Hay una ronda clasificatoria después de las eliminatorias.');

  for (const round of tournament.rounds) {
    const teamUse = new Map<string, number>();
    const judgeUse = new Map<string, number>();
    const venueUse = new Map<string, number>();
    for (const debate of round.debates) {
      debate.teamIds.forEach((id) => id && teamUse.set(id, (teamUse.get(id) ?? 0) + 1));
      debate.judgeIds.forEach((id) => judgeUse.set(id, (judgeUse.get(id) ?? 0) + 1));
      if (debate.venueId) venueUse.set(debate.venueId, (venueUse.get(debate.venueId) ?? 0) + 1);
      if (debate.teamIds.some((id) => !teams.has(id))) errors.push(round.name + ': un debate incluye un equipo que no existe.');
      if (debate.judgeIds.some((id) => !judges.has(id))) errors.push(round.name + ': un panel incluye un juez que no existe.');
      if (debate.venueId && !venues.has(debate.venueId)) warnings.push(round.name + ': un debate usa una sala que no existe.');
      if (debate.chairId && !debate.judgeIds.includes(debate.chairId)) warnings.push(round.name + ': el juez principal de un debate no está en su panel.');
      const winner = debate.result?.joint?.winnerTeamId || debate.result?.override?.winnerTeamId;
      if (winner && !debate.teamIds.includes(winner)) errors.push(round.name + ': un acta da como ganador a un equipo que no está en el debate.');
    }
    for (const [id, count] of teamUse) if (count > 1 && teams.has(id)) errors.push(round.name + ': ' + teamName(id) + ' aparece en dos debates.');
    for (const [id, count] of judgeUse) if (count > 1 && judges.has(id)) errors.push(round.name + ': ' + judgeName(id) + ' está en dos paneles.');
    for (const [id, count] of venueUse) if (count > 1) errors.push(round.name + ': la sala ' + (venues.get(id)?.name ?? id) + ' se usa dos veces.');
    if (round.kind === 'elimination') {
      const slots = round.debates.map((debate) => String(debate.bracketSlot ?? ''));
      if (slots.includes('') || duplicates(slots).length) errors.push(round.name + ': las posiciones del cuadro están incompletas o repetidas.');
    }
  }

  const unknownSeeds = tournament.breakSeeds.filter((id) => !teams.has(id));
  if (unknownSeeds.length) warnings.push('La lista de clasificados para eliminatorias incluye equipos que no existen.');
  if (tournament.breakSeeds.length && !tournament.rounds.some((round) => round.kind === 'elimination') && !tournament.draftRound) {
    warnings.push('Hay clasificados guardados sin ninguna eliminatoria: se recalcularán al generar los cuartos.');
  }

  for (const conflict of tournament.judgeConflicts ?? []) {
    if (!judges.has(conflict.judgeId)) warnings.push('Hay una incompatibilidad de un juez que no existe.');
    else if (conflict.teamId && !teams.has(conflict.teamId)) warnings.push('Hay una incompatibilidad de ' + judgeName(conflict.judgeId) + ' con un equipo que no existe.');
  }

  const draft = tournament.draftRound;
  if (draft && tournament.rounds.some((round) => round.number === draft.round.number || round.id === draft.round.id)) {
    errors.push('El borrador de ronda pendiente coincide con una ronda ya confirmada: descártalo y genera otro.');
  }

  // Conflicts by institution compare the text exactly (ignoring case): spelling variants would hide them.
  const spellings = new Map<string, Set<string>>();
  for (const value of [...tournament.teams.map((team) => team.institution), ...tournament.judges.map((judge) => judge.institution)]) {
    if (!value.trim()) continue;
    const key = looseInstitution(value);
    spellings.set(key, (spellings.get(key) ?? new Set()).add(value));
  }
  for (const variants of spellings.values()) {
    const distinct = [...new Set([...variants].map((value) => value.trim().toLocaleLowerCase('es-ES')))];
    if (distinct.length > 1) warnings.push('La misma institución está escrita de varias formas: ' + [...variants].map((value) => '«' + value + '»').join(', ') + '. Unifícalas para que las incompatibilidades funcionen.');
  }

  const active = tournament.teams.filter((team) => team.active && !team.swing).length;
  const expected = tournament.settings.expectedTeams;
  if (expected && active !== expected) warnings.push('Hay ' + active + ' equipos activos de ' + expected + ' previstos.');
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}
