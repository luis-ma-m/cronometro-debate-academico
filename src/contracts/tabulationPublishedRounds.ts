import type { TabulationPublishedRoundRow } from '../api';
import type { PanelEntityIdMap, TabDebateResult, TabRound, TabTournament } from '../tabulation/types';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const rows = (value: unknown): RecordValue[] => Array.isArray(value) ? value.filter(record) : [];
const inverse = (mapping: Record<string, string>) => new Map(Object.entries(mapping).map(([local, remote]) => [remote, local]));
const parseRecord = (value: unknown): RecordValue | null => {
  if (record(value)) return value;
  if (typeof value !== 'string') return null;
  try { const parsed: unknown = JSON.parse(value); return record(parsed) ? parsed : null; } catch { return null; }
};
const mapObjectKeys = (value: unknown, mapId: (id: string) => string): Record<string, unknown> | null => {
  if (!record(value)) return null;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) result[mapId(key)] = item;
  return result;
};

function restoreActaResult(sourcePayload: unknown, ids: {
  teams: Map<string, string>; judges: Map<string, string>; speakers: Map<string, string>;
}): TabDebateResult | undefined {
  const source = parseRecord(sourcePayload);
  const acta = parseRecord(source?.acta);
  const result = parseRecord(acta?.result);
  if (!result || !record(result.lineup) || !Array.isArray(result.ballots) || !record(result.penalties)
    || typeof result.notes !== 'string' || typeof result.updatedAt !== 'number') return undefined;
  const team = (id: string) => ids.teams.get(id) ?? id;
  const judge = (id: string) => ids.judges.get(id) ?? id;
  const speaker = (id: string) => ids.speakers.get(id) ?? id;
  const lineup: Record<string, Record<string, string>> = {};
  for (const [teamId, roles] of Object.entries(result.lineup)) {
    if (!record(roles)) return undefined;
    const mappedRoles: Record<string, string> = {};
    for (const [role, speakerId] of Object.entries(roles)) {
      if (typeof speakerId !== 'string') return undefined;
      mappedRoles[role] = speaker(speakerId);
    }
    lineup[team(teamId)] = mappedRoles;
  }
  const ballots = result.ballots.map((raw) => {
    if (!record(raw) || typeof raw.judgeId !== 'string' || !record(raw.totals) || !record(raw.speeches)) return null;
    const totals = mapObjectKeys(raw.totals, team);
    const speeches: Record<string, unknown> = {};
    for (const [teamId, scores] of Object.entries(raw.speeches)) {
      if (!record(scores)) return null;
      speeches[team(teamId)] = scores;
    }
    return {
      ...raw, judgeId: judge(raw.judgeId), totals: totals ?? {},
      speeches, ...(typeof raw.winnerTeamId === 'string' ? { winnerTeamId: team(raw.winnerTeamId) } : {}),
    };
  });
  if (ballots.some((item) => !item)) return undefined;
  const penalties = mapObjectKeys(result.penalties, team);
  if (!penalties) return undefined;
  let override: RecordValue | undefined;
  if (record(result.override)) override = {
    ...result.override,
    ...(typeof result.override.winnerTeamId === 'string' ? { winnerTeamId: team(result.override.winnerTeamId) } : {}),
  };
  let joint: RecordValue | undefined;
  if (record(result.joint)) {
    const raw = result.joint;
    const items = mapObjectKeys(raw.items, team);
    const quickTotals = raw.quickTotals === undefined ? undefined : mapObjectKeys(raw.quickTotals, team);
    const writtenTotals = raw.writtenTotals === undefined ? undefined : mapObjectKeys(raw.writtenTotals, team);
    const speakerRows = parseRecord(raw.speakers);
    if (!items || !speakerRows || (raw.quickTotals !== undefined && !quickTotals)
      || (raw.writtenTotals !== undefined && !writtenTotals)) return undefined;
    const speakers: Record<string, unknown> = {};
    for (const [teamId, entries] of Object.entries(speakerRows)) {
      if (!Array.isArray(entries)) return undefined;
      speakers[team(teamId)] = entries.map((entry) => record(entry) && typeof entry.speakerId === 'string'
        ? { ...entry, speakerId: speaker(entry.speakerId) } : entry);
    }
    joint = {
      ...raw, winnerTeamId: typeof raw.winnerTeamId === 'string' ? team(raw.winnerTeamId) : raw.winnerTeamId,
      items, speakers,
      ...(quickTotals ? { quickTotals } : {}),
      ...(writtenTotals ? { writtenTotals } : {}),
    };
  }
  return {
    lineup: lineup as TabDebateResult['lineup'],
    ballots: ballots as TabDebateResult['ballots'],
    penalties: penalties as TabDebateResult['penalties'],
    ...(override ? { override: override as TabDebateResult['override'] } : {}),
    ...(joint ? { joint: joint as TabDebateResult['joint'] } : {}),
    notes: result.notes,
    updatedAt: result.updatedAt,
  };
}

/** Rebuilds the Tabulation projection from the canonical manager assignments and official acta heads. */
export function mergePublishedTabulationRounds(
  tournament: TabTournament,
  snapshotRows: TabulationPublishedRoundRow[],
  now = Date.now(),
): TabTournament {
  // The TabTournament id is browser-local in legacy installations. The manager tournament is the canonical scope,
  // so a second device must hydrate rows even when its local TabTournament id differs from the publishing device.
  const relevant = snapshotRows;
  if (!relevant.length) return tournament;
  const firstMap = parseRecord(relevant[0].entityIdMap) as unknown as PanelEntityIdMap | null;
  if (!firstMap || !record(firstMap.teams) || !record(firstMap.speakers) || !record(firstMap.judges) || !record(firstMap.venues)) {
    throw new Error('El snapshot remoto no contiene un mapa de identidades completo.');
  }
  const ids = {
    teams: inverse(firstMap.teams), speakers: inverse(firstMap.speakers),
    judges: inverse(firstMap.judges), venues: inverse(firstMap.venues),
  };
  const grouped = new Map<string, { first: TabulationPublishedRoundRow; debates: TabRound['debates'] }>();
  for (const row of relevant) {
    const group = grouped.get(row.tabulationRoundId) ?? { first: row, debates: [] };
    const judgeIds = Array.isArray(row.judgeIds) ? row.judgeIds.filter((id): id is string => typeof id === 'string') : [];
    const favor = ids.teams.get(row.teamFavorId) ?? row.teamFavorId;
    const contra = ids.teams.get(row.teamContraId) ?? row.teamContraId;
    const venueId = ids.venues.get(row.physicalRoomId) ?? row.physicalRoomId;
    const source = parseRecord(row.currentSourcePayload);
    group.debates.push({
      id: row.tabulationDebateId,
      venueId,
      teamIds: [favor, contra] as [string, string],
      favorTeamId: favor,
      judgeIds: judgeIds.map((id) => ids.judges.get(id) ?? id),
      chairId: ids.judges.get(row.chairJudgeId) ?? row.chairJudgeId,
      managerAssignmentId: row.assignmentId,
      ...(source && restoreActaResult(source, ids) ? { result: restoreActaResult(source, ids) } : {}),
    });
    grouped.set(row.tabulationRoundId, group);
  }
  const previous = new Map(tournament.rounds.map((round) => [round.id, round]));
  const rounds: TabRound[] = [...grouped.entries()].map(([id, group]) => {
    const row = group.first;
    const old = previous.get(id);
    const debates = group.debates.map((debate) => {
      const existing = old?.debates.find((item) => item.id === debate.id);
      return { ...existing, ...debate, result: debate.result ?? existing?.result };
    });
    return {
      id, number: row.roundNumber, name: row.roundName, kind: row.roundKind, sideMode: row.sideMode,
      panelSize: Math.max(1, ...debates.map((debate) => debate.judgeIds.length)),
      seed: old?.seed ?? 0, silent: old?.silent ?? false, debates,
      createdAt: old?.createdAt ?? now, managerRoundId: row.managerRoundId, pushedAt: old?.pushedAt ?? now,
    };
  }).sort((a, b) => a.number - b.number);
  const metadata = rows(relevant[0].teamMetadata);
  const metadataById = new Map(metadata.filter((item) => typeof item.teamId === 'string').map((item) => [String(item.teamId), item]));
  const teams = tournament.teams.map((item) => {
    const remoteId = firstMap.teams[item.id];
    const meta = remoteId ? metadataById.get(remoteId) : undefined;
    return meta ? {
      ...item,
      swing: typeof meta.swing === 'boolean' ? meta.swing : item.swing,
      breakEligible: typeof meta.breakEligible === 'boolean' ? meta.breakEligible : item.breakEligible,
      ...(typeof meta.fallenFromRound === 'number' ? { fallenFromRound: meta.fallenFromRound } : { fallenFromRound: undefined }),
    } : item;
  });
  return { ...tournament, teams, rounds };
}
