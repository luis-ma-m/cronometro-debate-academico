import { SPEAKER_RANKINGS } from '../rankings';
import { hashSeed } from './random';
import { computeTournamentOutcomes, type DebateOutcome } from './results';
import { qualifyingRounds, type SpeakerRole, type TabTournament, type TiebreakKey } from './types';

export interface StandingsOptions {
  /** Restrict the table (and head-to-head mini-leagues) to these teams, e.g. one group. */
  teamIds?: string[];
  /** Only count qualifying rounds whose number is at most this value. */
  upToRoundNumber?: number;
  outcomes?: Map<string, DebateOutcome>;
}

export interface TeamStanding {
  teamId: string;
  name: string;
  institution: string;
  rank: number;
  /** Still tied with another team after every criterion. */
  tied: boolean;
  decidedByLots: boolean;
  debates: number;
  wins: number;
  losses: number;
  ballots: number;
  ballotsAgainst: number;
  points: number;
  pointsAverage: number;
  /** Debates whose score is not known yet (forfeit wins without other debates to average). */
  pendingPoints: number;
  speakerPoints: number;
  warnings: number;
  minors: number;
  majors: number;
  favor: number;
  contra: number;
  opponents: string[];
}

interface Match { a: string; b: string; winner: string; votes: Record<string, number>; points: Record<string, number | null> }

type Criterion = (teamId: string, block: string[]) => number;

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;
const pairKey = (x: string, y: string) => (x < y ? x + '|' + y : y + '|' + x);

function emptyStanding(teamId: string, name: string, institution: string): TeamStanding {
  return {
    teamId, name, institution, rank: 0, tied: false, decidedByLots: false, debates: 0, wins: 0, losses: 0, ballots: 0,
    ballotsAgainst: 0, points: 0, pointsAverage: 0, pendingPoints: 0, speakerPoints: 0, warnings: 0, minors: 0, majors: 0,
    favor: 0, contra: 0, opponents: [],
  };
}

export function buildTeamStandings(tournament: TabTournament, options: StandingsOptions = {}): TeamStanding[] {
  const outcomes = options.outcomes ?? computeTournamentOutcomes(tournament);
  const rounds = qualifyingRounds(tournament).filter((round) => options.upToRoundNumber === undefined || round.number <= options.upToRoundNumber);
  const played = new Set(rounds.flatMap((round) => round.debates.filter((debate) => outcomes.get(debate.id)?.status === 'complete').flatMap((debate) => debate.teamIds)));
  const scope = options.teamIds
    ? tournament.teams.filter((team) => options.teamIds!.includes(team.id) && !team.swing)
    : tournament.teams.filter((team) => !team.swing && (team.active || played.has(team.id)));
  const records = new Map(scope.map((team) => [team.id, emptyStanding(team.id, team.name, team.institution)]));
  const scoredValues = new Map<string, number[]>(scope.map((team) => [team.id, []]));
  const matches: Match[] = [];
  const deferred: Array<{ match: Match; teamId: string }> = [];

  for (const round of rounds) {
    for (const debate of round.debates) {
      const outcome = outcomes.get(debate.id);
      if (!outcome || outcome.status !== 'complete' || outcome.lines.length !== 2 || !outcome.winnerTeamId) continue;
      const [first, second] = outcome.lines;
      const match: Match = {
        a: first.teamId,
        b: second.teamId,
        winner: outcome.winnerTeamId,
        votes: { [first.teamId]: first.votes, [second.teamId]: second.votes },
        points: { [first.teamId]: first.points, [second.teamId]: second.points },
      };
      matches.push(match);
      for (const line of outcome.lines) {
        const record = records.get(line.teamId);
        if (!record) continue;
        record.debates++;
        if (line.won) record.wins++;
        else record.losses++;
        record.ballots += line.votes;
        record.ballotsAgainst += line.votesAgainst;
        record.speakerPoints += line.speakerPoints;
        record.warnings += line.penalties.warnings;
        record.minors += line.penalties.minors;
        record.majors += line.penalties.majors;
        if (line.side === 'favor') record.favor++;
        if (line.side === 'contra') record.contra++;
        record.opponents.push(line.opponentId);
        if (line.points !== null) {
          record.points += line.points;
          if (!line.forfeitWin && !line.forfeitLoss) scoredValues.get(line.teamId)?.push(line.points);
        } else if (line.forfeitWin) deferred.push({ match, teamId: line.teamId });
        else record.pendingPoints++;
      }
    }
  }
  // LEDU art. 36: a forfeit winner scores its average from the rest of the stage.
  for (const { match, teamId } of deferred) {
    const record = records.get(teamId)!;
    const values = scoredValues.get(teamId) ?? [];
    if (!values.length) { record.pendingPoints++; continue; }
    const average = values.reduce((total, value) => total + value, 0) / values.length;
    record.points += average;
    match.points[teamId] = average;
  }
  for (const record of records.values()) {
    const scored = record.debates - record.pendingPoints;
    record.pointsAverage = scored > 0 ? record.points / scored : 0;
  }

  const meetings = new Map<string, Match[]>();
  for (const match of matches) {
    const key = pairKey(match.a, match.b);
    meetings.set(key, [...(meetings.get(key) ?? []), match]);
  }
  const miniLeagueComplete = (block: string[]) => block.every((x, i) => block.slice(i + 1).every((y) => meetings.has(pairKey(x, y))));
  const headToHead = (field: 'wins' | 'votes' | 'points'): Criterion => (teamId, block) => {
    if (!miniLeagueComplete(block)) return 0;
    let value = 0;
    for (const other of block) {
      if (other === teamId) continue;
      for (const match of meetings.get(pairKey(teamId, other)) ?? []) {
        if (field === 'wins') value += match.winner === teamId ? 1 : 0;
        else if (field === 'votes') value += match.votes[teamId] ?? 0;
        else value += match.points[teamId] ?? 0;
      }
    }
    return value;
  };
  const stat = (read: (record: TeamStanding) => number): Criterion => (teamId) => read(records.get(teamId)!);
  const criteria: Record<TiebreakKey, Criterion> = {
    ballots: stat((record) => record.ballots),
    pointsTotal: stat((record) => record.points),
    pointsAverage: stat((record) => record.pointsAverage),
    headToHead: headToHead('wins'),
    headToHeadBallots: headToHead('votes'),
    headToHeadPoints: headToHead('points'),
    speakerPoints: stat((record) => record.speakerPoints),
    fewestPenalties: stat((record) => -(record.majors * 1e6 + record.minors * 1e3 + record.warnings)),
  };
  const chain: Criterion[] = [stat((record) => record.wins), ...tournament.settings.tiebreaks.map((key) => criteria[key])];

  // When a criterion splits a block, each sub-block restarts the chain so head-to-head is recomputed inside it.
  const rankBlock = (ids: string[], start: number): string[][] => {
    if (ids.length < 2) return [ids];
    for (let k = start; k < chain.length; k++) {
      const values = new Map(ids.map((id) => [id, round6(chain[k](id, ids))]));
      const distinct = [...new Set(values.values())].sort((x, y) => y - x);
      if (distinct.length < 2) continue;
      return distinct.flatMap((value) => {
        const block = ids.filter((id) => values.get(id) === value);
        return block.length > 1 ? rankBlock(block, 0) : [block];
      });
    }
    return [ids];
  };

  const lotsOrder = (id: string) => hashSeed(tournament.seed, id);
  const result: TeamStanding[] = [];
  for (const block of rankBlock([...records.keys()], 0)) {
    const manual = block.filter((id) => tournament.manualOrder.includes(id))
      .sort((x, y) => tournament.manualOrder.indexOf(x) - tournament.manualOrder.indexOf(y));
    const rest = block.filter((id) => !tournament.manualOrder.includes(id));
    const resolved: Array<{ ids: string[]; lots: boolean }> = manual.map((id) => ({ ids: [id], lots: false }));
    if (rest.length > 1 && tournament.settings.tiebreakFallback === 'lots') {
      resolved.push(...[...rest].sort((x, y) => lotsOrder(x) - lotsOrder(y)).map((id) => ({ ids: [id], lots: true })));
    } else if (rest.length) resolved.push({ ids: rest, lots: false });
    for (const entry of resolved) {
      const rank = result.length + 1;
      const rows = entry.ids.map((id) => records.get(id)!).sort((x, y) => x.name.localeCompare(y.name, 'es'));
      for (const row of rows) result.push({ ...row, rank, tied: entry.ids.length > 1, decidedByLots: entry.lots && block.length > 1 });
    }
  }
  return result;
}

export function buildGroupStandings(tournament: TabTournament, options: Omit<StandingsOptions, 'teamIds'> = {}) {
  const outcomes = options.outcomes ?? computeTournamentOutcomes(tournament);
  return tournament.groups.map((group) => ({
    group,
    rows: buildTeamStandings(tournament, { ...options, outcomes, teamIds: group.teamIds }),
  }));
}

export interface SpeakerStanding {
  speakerId: string;
  name: string;
  teamId: string;
  teamName: string;
  rank: number;
  tied: boolean;
  total: number;
  average: number;
  count: number;
  value: number;
}

export interface SpeakerRanking { key: SpeakerRole | 'all'; title: string; rows: SpeakerStanding[] }

/**
 * "Mejor orador" counts one value per debate (the mean of that speaker's turns, as in src/rankings.ts);
 * role rankings count each speech in that role. Ties go to the speaker from the better-ranked team (UC3M art. 41).
 */
export function buildSpeakerStandings(tournament: TabTournament, options: Omit<StandingsOptions, 'teamIds'> = {}): SpeakerRanking[] {
  const outcomes = options.outcomes ?? computeTournamentOutcomes(tournament);
  const teamRank = new Map(buildTeamStandings(tournament, { ...options, outcomes }).map((row) => [row.teamId, row.rank]));
  const teams = new Map(tournament.teams.map((team) => [team.id, team]));
  const speakers = new Map(tournament.speakers.map((speaker) => [speaker.id, speaker]));
  const rounds = qualifyingRounds(tournament).filter((round) => options.upToRoundNumber === undefined || round.number <= options.upToRoundNumber);
  const values = new Map<string, Map<string, number[]>>(SPEAKER_RANKINGS.map((ranking) => [ranking.key, new Map()]));
  const push = (key: string, speakerId: string, value: number) => {
    const bucket = values.get(key)!;
    bucket.set(speakerId, [...(bucket.get(speakerId) ?? []), value]);
  };
  for (const round of rounds) {
    for (const debate of round.debates) {
      const outcome = outcomes.get(debate.id);
      if (outcome?.status !== 'complete') continue;
      const perDebate = new Map<string, number[]>();
      for (const speech of outcome.speeches) {
        if (!speech.speakerId || !speakers.has(speech.speakerId) || teams.get(speech.teamId)?.swing) continue;
        push(speech.role, speech.speakerId, speech.score);
        perDebate.set(speech.speakerId, [...(perDebate.get(speech.speakerId) ?? []), speech.score]);
      }
      for (const [speakerId, scores] of perDebate) push('all', speakerId, scores.reduce((total, score) => total + score, 0) / scores.length);
    }
  }
  return SPEAKER_RANKINGS.map((ranking) => {
    const rows = [...values.get(ranking.key)!.entries()].map(([speakerId, list]) => {
      const speaker = speakers.get(speakerId)!;
      const total = list.reduce((sum, value) => sum + value, 0);
      const average = total / list.length;
      return {
        speakerId, name: speaker.name, teamId: speaker.teamId, teamName: teams.get(speaker.teamId)?.name ?? 'Equipo desconocido',
        rank: 0, tied: false, total, average, count: list.length,
        value: round6(tournament.settings.speakerMetric === 'sum' ? total : average),
      };
    });
    const teamOrder = (row: SpeakerStanding) => teamRank.get(row.teamId) ?? Number.MAX_SAFE_INTEGER;
    rows.sort((x, y) => y.value - x.value || teamOrder(x) - teamOrder(y) || x.name.localeCompare(y.name, 'es'));
    rows.forEach((row, index) => {
      const previous = rows[index - 1];
      const same = previous && previous.value === row.value && teamOrder(previous) === teamOrder(row);
      row.rank = same ? previous.rank : index + 1;
    });
    rows.forEach((row) => { row.tied = rows.some((other) => other !== row && other.rank === row.rank); });
    return { key: ranking.key, title: ranking.title, rows };
  });
}
