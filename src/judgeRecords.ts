import type { Room, Tournament } from './domain';

export type FaultSeverity = 'minor' | 'major';

export interface TeamScore {
  teamId: string;
  points: number | null;
}

export interface RecordedFault {
  id: string;
  judgeId: string;
  teamId: string;
  severity: FaultSeverity;
  note: string;
}

export interface DebateRecord {
  id: string;
  roundId: string;
  roomId: string;
  teamFavorId: string;
  teamContraId: string;
  judgeIds: string[];
  scores: TeamScore[];
  faults: RecordedFault[];
  notes: string;
  updatedAt: number;
}

/** Statistics use only manager-entered debate records, never timer event logs. */
export interface JudgeStatistics {
  debateCount: number;
  rounds: Array<{ id: string; name: string }>;
  teams: Array<{ id: string; name: string; count: number }>;
  institutions: Array<{ name: string; count: number }>;
  coJudges: Array<{ id: string; name: string; count: number }>;
  meanPointsByTeam: Array<{ teamId: string; teamName: string; mean: number; recordCount: number }>;
  minorFaults: number;
  majorFaults: number;
  records: DebateRecord[];
}

export const emptyDebateRecord = (room: Room, data: Tournament): DebateRecord => ({
  id: 'record-' + room.id,
  roundId: room.roundId,
  roomId: room.id,
  teamFavorId: room.teamFavorId,
  teamContraId: room.teamContraId,
  judgeIds: [...room.judgeIds],
  scores: [],
  faults: [],
  notes: '',
  updatedAt: Date.now(),
});

export function normalizeDebateRecord(record: DebateRecord): DebateRecord {
  return {
    ...record,
    judgeIds: [...new Set(record.judgeIds ?? [])],
    scores: (record.scores ?? []).map((score) => ({
      teamId: score.teamId,
      points: score.points === null || score.points === undefined || score.points === ('' as unknown as number)
        ? null
        : Number(score.points),
    })),
    faults: (record.faults ?? []).map((fault) => ({
      ...fault,
      note: (fault.note ?? '').slice(0, 500),
    })),
    notes: (record.notes ?? '').slice(0, 3000),
  };
}

export function validateDebateRecords(data: Tournament, records: DebateRecord[]): string[] {
  const errors: string[] = [];
  const teams = new Set(data.teams.map((team) => team.id));
  const judges = new Set(data.judges.map((judge) => judge.id));
  const rooms = new Map(data.rooms.map((room) => [room.id, room]));
  const rounds = new Set(data.rounds.map((round) => round.id));
  const ids = new Set<string>();

  for (const raw of records) {
    const record = normalizeDebateRecord(raw);
    if (!record.id || ids.has(record.id)) errors.push('Las actas deben tener IDs únicos.');
    ids.add(record.id);
    if (!rounds.has(record.roundId) || !rooms.has(record.roomId)) {
      errors.push('Cada acta debe referenciar una ronda y sala existentes.');
      continue;
    }
    const room = rooms.get(record.roomId)!;
    if (room.roundId !== record.roundId) errors.push('El acta no pertenece a la ronda de su sala.');
    if (!record.teamFavorId || !teams.has(record.teamFavorId) ||
        !record.teamContraId || !teams.has(record.teamContraId) ||
        record.teamFavorId === record.teamContraId) errors.push('Cada acta necesita dos equipos distintos y existentes.');
    if (!record.judgeIds.length || record.judgeIds.some((id) => !judges.has(id))) {
      errors.push('Cada acta debe identificar jueces existentes.');
    }
    if (record.judgeIds.some((id) => !room.judgeIds.includes(id))) {
      errors.push('Los jueces del acta deben coincidir con el panel asignado a la sala.');
    }
    const scoreTeams = new Set<string>();
    for (const score of record.scores) {
      if (!teams.has(score.teamId) || ![record.teamFavorId, record.teamContraId].includes(score.teamId) || scoreTeams.has(score.teamId)) {
        errors.push('Las puntuaciones deben corresponder a uno de los dos equipos, sin duplicados.');
      }
      scoreTeams.add(score.teamId);
      if (score.points !== null && (!Number.isFinite(score.points) || score.points < 0 || score.points > 10000)) {
        errors.push('Las puntuaciones deben ser números entre 0 y 10000.');
      }
    }
    const faultIds = new Set<string>();
    for (const fault of record.faults) {
      if (!fault.id || faultIds.has(fault.id) || !record.judgeIds.includes(fault.judgeId) ||
          !teams.has(fault.teamId) || ![record.teamFavorId, record.teamContraId].includes(fault.teamId) ||
          !['minor', 'major'].includes(fault.severity)) {
        errors.push('Cada falta debe tener ID único y corresponder a juez y equipo del debate.');
      }
      faultIds.add(fault.id);
      if (fault.note.length > 500) errors.push('La observación de una falta no puede superar 500 caracteres.');
    }
  }
  return [...new Set(errors)];
}

export function judgeStatistics(data: Tournament, allRecords: DebateRecord[], judgeId: string): JudgeStatistics {
  const records = allRecords.map(normalizeDebateRecord).filter((record) => record.judgeIds.includes(judgeId));
  const teamCounts = new Map<string, number>();
  const institutionCounts = new Map<string, number>();
  const coJudgeCounts = new Map<string, number>();
  const scoreValues = new Map<string, number[]>();

  for (const record of records) {
    for (const teamId of [record.teamFavorId, record.teamContraId]) {
      teamCounts.set(teamId, (teamCounts.get(teamId) ?? 0) + 1);
      const institution = data.teams.find((team) => team.id === teamId)?.institution.trim();
      if (institution) institutionCounts.set(institution, (institutionCounts.get(institution) ?? 0) + 1);
    }
    for (const coJudge of record.judgeIds) {
      if (coJudge !== judgeId) coJudgeCounts.set(coJudge, (coJudgeCounts.get(coJudge) ?? 0) + 1);
    }
    for (const score of record.scores) {
      if (score.points === null) continue;
      const values = scoreValues.get(score.teamId) ?? [];
      values.push(score.points);
      scoreValues.set(score.teamId, values);
    }
  }

  const rounds = new Map<string, string>();
  for (const record of records) {
    const round = data.rounds.find((item) => item.id === record.roundId);
    if (round) rounds.set(round.id, round.name);
  }
  const countSort = <T extends { count: number }>(items: T[]) => items.sort((a, b) => b.count - a.count);
  return {
    debateCount: records.length,
    rounds: [...rounds].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'es')),
    teams: countSort([...teamCounts].map(([id, count]) => ({ id, name: data.teams.find((team) => team.id === id)?.name ?? id, count }))),
    institutions: countSort([...institutionCounts].map(([name, count]) => ({ name, count }))),
    coJudges: countSort([...coJudgeCounts].map(([id, count]) => ({ id, name: data.judges.find((judge) => judge.id === id)?.name ?? id, count }))),
    meanPointsByTeam: [...scoreValues].map(([teamId, values]) => ({
      teamId,
      teamName: data.teams.find((team) => team.id === teamId)?.name ?? teamId,
      mean: values.reduce((total, value) => total + value, 0) / values.length,
      recordCount: values.length,
    })).sort((a, b) => a.teamName.localeCompare(b.teamName, 'es')),
    minorFaults: records.reduce((total, record) => total + record.faults.filter((fault) => fault.severity === 'minor').length, 0),
    majorFaults: records.reduce((total, record) => total + record.faults.filter((fault) => fault.severity === 'major').length, 0),
    records: records.sort((a, b) => b.updatedAt - a.updatedAt),
  };
}
