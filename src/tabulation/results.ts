import { validateJointActa } from './acta.js';
import { effectivePenalties, type EffectivePenalties } from './penalties.js';
import {
  isFallenAt,
  SPEAKER_ROLES,
  type SpeakerRole,
  type TabDebate,
  type TabJudge,
  type TabRound,
  type TabSettings,
  type TabSpeaker,
  type TabTeam,
  type TabTournament,
} from './types.js';

export { effectivePenalties, minorsFromWarnings, penaltyConversionWarning, type EffectivePenalties } from './penalties.js';

export interface OutcomeContext {
  settings: TabSettings;
  teams: Map<string, TabTeam>;
  judges: Map<string, TabJudge>;
  speakers: Map<string, TabSpeaker>;
}

export function outcomeContext(tournament: Pick<TabTournament, 'settings' | 'teams' | 'judges' | 'speakers'>): OutcomeContext {
  return {
    settings: tournament.settings,
    teams: new Map(tournament.teams.map((team) => [team.id, team])),
    judges: new Map(tournament.judges.map((judge) => [judge.id, judge])),
    speakers: new Map(tournament.speakers.map((speaker) => [speaker.id, speaker])),
  };
}

export type OutcomeStatus = 'empty' | 'pending' | 'complete' | 'invalid';

export interface TeamLine {
  teamId: string;
  opponentId: string;
  side: 'favor' | 'contra' | null;
  won: boolean;
  votes: number;
  votesAgainst: number;
  /** Debate score; null when it must be substituted (see `deferred`) or does not exist (eliminations). */
  points: number | null;
  /** How standings substitute null points: the team's average in the stage, or the round's average. */
  deferred: 'stage' | 'round' | null;
  forfeitWin: boolean;
  forfeitLoss: boolean;
  /** "Equipo caído": won because the rival fell / lost because this team fell. */
  fallenWin: boolean;
  fallenLoss: boolean;
  penalties: EffectivePenalties;
  speakerPoints: number;
}

export interface JudgeVote { judgeId: string; teamId: string | null; nets: Record<string, number>; tie: boolean }
export interface SpeechScore { teamId: string; role: SpeakerRole; speakerId: string | null; score: number }
/** One value per speaker and debate, used by the overall speaker ranking. */
export interface SpeakerTotal { speakerId: string; teamId: string; score: number }

export interface DebateOutcome {
  status: OutcomeStatus;
  issues: string[];
  /** What is still missing while the acta is incomplete. */
  missing: string[];
  warnings: string[];
  winnerTeamId: string | null;
  /** Both teams fell: the debate counts as a loss for both and nobody receives items. */
  noWinner: boolean;
  lines: TeamLine[];
  judgeVotes: JudgeVote[];
  speeches: SpeechScore[];
  speakerTotals: SpeakerTotal[];
}

const isScore = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Mean of the judges' scores; LEDU drops the highest and lowest when there are more than three. */
export function aggregatePanel(values: number[], trimExtremes: boolean): number | null {
  if (!values.length) return null;
  let sorted = [...values].sort((a, b) => a - b);
  if (trimExtremes && sorted.length > 3) sorted = sorted.slice(1, -1);
  return sorted.reduce((total, value) => total + value, 0) / sorted.length;
}

function onStep(value: number, min: number, step: number): boolean {
  if (step <= 0) return true;
  const ratio = (value - min) / step;
  return Math.abs(ratio - Math.round(ratio)) < 1e-9;
}

type RoundInfo = Pick<TabRound, 'kind' | 'sideMode' | 'number'>;

/** What the acta itself says, before override, falls, forfeits or swing teams are considered. */
interface ActaEvaluation {
  /** Every value needed to decide from the acta is present. */
  ready: boolean;
  winner: string | null;
  /** Issue raised only when the acta has to decide (e.g. tied votes without the chair). */
  winnerIssue: string | null;
  points: Record<string, number | null>;
  votes: Record<string, number>;
  judgeVotes: JudgeVote[];
  issues: string[];
  /** Blocking only when the acta decides the debate; warnings otherwise (tied ballots, no panel). */
  decisiveIssues: string[];
  missing: string[];
  warnings: string[];
  speeches: SpeechScore[];
  speakerTotals: SpeakerTotal[];
  speakerPoints: Record<string, number>;
}

function evaluateJudgeBallots(round: RoundInfo, debate: TabDebate, context: OutcomeContext, penalties: Record<string, EffectivePenalties>): ActaEvaluation {
  const { settings } = context;
  const [a, b] = debate.teamIds;
  const result = debate.result!;
  const elimination = round.kind === 'elimination';
  const judgeName = (id: string) => context.judges.get(id)?.name ?? 'un juez';
  const teamName = (id: string) => context.teams.get(id)?.name ?? 'un equipo';
  const issues: string[] = [];
  const decisiveIssues: string[] = [];
  const warnings: string[] = [];
  const panel = debate.judgeIds;
  const ballots = new Map(result.ballots.map((ballot) => [ballot.judgeId, ballot]));
  if (result.ballots.some((ballot) => !panel.includes(ballot.judgeId))) issues.push('Hay un acta de un juez que no forma parte del panel.');
  if (!panel.length) decisiveIssues.push('El debate no tiene jueces asignados.');

  const judgeVotes: JudgeVote[] = [];
  const nets: Record<string, number[]> = { [a]: [], [b]: [] };
  let missing = 0;
  for (const judgeId of panel) {
    const ballot = ballots.get(judgeId);
    if (elimination) {
      const vote = ballot?.winnerTeamId;
      if (!vote) { missing++; continue; }
      if (vote !== a && vote !== b) { issues.push('El voto de ' + judgeName(judgeId) + ' es para un equipo que no está en el debate.'); continue; }
      judgeVotes.push({ judgeId, teamId: vote, nets: {}, tie: false });
      continue;
    }
    const totalA = ballot?.totals[a];
    const totalB = ballot?.totals[b];
    if (!isScore(totalA) || !isScore(totalB)) { missing++; continue; }
    for (const value of [totalA, totalB]) {
      if (value < settings.scoreMin || value > settings.scoreMax) {
        issues.push('El acta de ' + judgeName(judgeId) + ' tiene una puntuación fuera del rango ' + settings.scoreMin + '–' + settings.scoreMax + '.');
        break;
      }
    }
    const netA = totalA - penalties[a].deduction;
    const netB = totalB - penalties[b].deduction;
    nets[a].push(netA);
    nets[b].push(netB);
    const tie = netA === netB;
    if (tie) decisiveIssues.push('El acta de ' + judgeName(judgeId) + ' da la misma puntuación a ambos equipos: el ganador debe tener más puntos.');
    judgeVotes.push({ judgeId, teamId: tie ? null : netA > netB ? a : b, nets: { [a]: netA, [b]: netB }, tie });
  }
  const ready = panel.length > 0 && missing === 0;
  const votes = { [a]: judgeVotes.filter((vote) => vote.teamId === a).length, [b]: judgeVotes.filter((vote) => vote.teamId === b).length };
  let winner: string | null = null;
  let winnerIssue: string | null = null;
  if (ready) {
    if (votes[a] !== votes[b]) winner = votes[a] > votes[b] ? a : b;
    else {
      winner = judgeVotes.find((vote) => vote.judgeId === debate.chairId)?.teamId ?? null;
      if (winner) warnings.push('Empate a votos resuelto por el voto del juez principal.');
      else winnerIssue = 'Empate a votos y sin voto del juez principal que lo resuelva.';
    }
  }
  const points = {
    [a]: !elimination && ready ? aggregatePanel(nets[a], settings.trimExtremes) : null,
    [b]: !elimination && ready ? aggregatePanel(nets[b], settings.trimExtremes) : null,
  };

  const speeches: SpeechScore[] = [];
  const speakerTotals: SpeakerTotal[] = [];
  const speakerPoints: Record<string, number> = { [a]: 0, [b]: 0 };
  if (settings.speakerScores && !elimination) {
    const rolesBySpeaker = new Map<string, number>();
    for (const teamId of [a, b]) {
      for (const role of SPEAKER_ROLES) {
        const speakerId = result.lineup[teamId]?.[role] ?? null;
        if (speakerId) {
          const speaker = context.speakers.get(speakerId);
          if (!speaker || speaker.teamId !== teamId) issues.push('La alineación de ' + teamName(teamId) + ' incluye un orador de otro equipo.');
          rolesBySpeaker.set(speakerId, (rolesBySpeaker.get(speakerId) ?? 0) + 1);
        }
        const values = panel.map((judgeId) => ballots.get(judgeId)?.speeches[teamId]?.[role]).filter(isScore);
        for (const value of values) {
          if (value < settings.speakerScoreMin || value > settings.speakerScoreMax || !onStep(value, settings.speakerScoreMin, settings.speakerScoreStep)) {
            issues.push('Hay notas de orador fuera de la escala ' + settings.speakerScoreMin + '–' + settings.speakerScoreMax + ' (paso ' + settings.speakerScoreStep + ').');
            break;
          }
        }
        const score = aggregatePanel(values, settings.trimExtremes);
        if (score === null) continue;
        if (!speakerId) warnings.push('Falta indicar qué orador de ' + teamName(teamId) + ' hizo una de las intervenciones puntuadas.');
        speeches.push({ teamId, role, speakerId, score });
        speakerPoints[teamId] += score;
      }
    }
    if ([...rolesBySpeaker.values()].some((roles) => roles > 2)) warnings.push('Un orador interviene en más de dos turnos.');
    // "Mejor orador" counts one value per debate: the mean of that speaker's turns (as src/rankings.ts does).
    const perSpeaker = new Map<string, { teamId: string; scores: number[] }>();
    for (const speech of speeches) {
      if (!speech.speakerId) continue;
      const entry = perSpeaker.get(speech.speakerId) ?? { teamId: speech.teamId, scores: [] };
      entry.scores.push(speech.score);
      perSpeaker.set(speech.speakerId, entry);
    }
    for (const [speakerId, entry] of perSpeaker) speakerTotals.push({ speakerId, teamId: entry.teamId, score: entry.scores.reduce((sum, value) => sum + value, 0) / entry.scores.length });
  }

  return {
    ready, winner, winnerIssue, points, votes, judgeVotes, issues, decisiveIssues,
    missing: ready ? [] : ['Faltan actas de ' + missing + ' juez(es) del panel.'],
    warnings, speeches, speakerTotals, speakerPoints,
  };
}

function evaluateJointActa(round: RoundInfo, debate: TabDebate, context: OutcomeContext): ActaEvaluation {
  const { settings } = context;
  const [a, b] = debate.teamIds;
  const result = debate.result!;
  const elimination = round.kind === 'elimination';
  const check = validateJointActa(result.joint, result.penalties, {
    settings, teamIds: [a, b], speakers: context.speakers, elimination, teamName: (id) => context.teams.get(id)?.name ?? 'un equipo',
  });
  const declared = result.joint?.winnerTeamId;
  const ready = !check.missing.length && (declared === a || declared === b);
  const speeches: SpeechScore[] = [];
  const speakerTotals: SpeakerTotal[] = [];
  const speakerPoints: Record<string, number> = { [a]: 0, [b]: 0 };
  if (settings.speakerScores && !elimination) {
    for (const teamId of [a, b]) {
      for (const row of result.joint?.speakers[teamId] ?? []) {
        if (!isScore(row.score)) continue;
        speakerTotals.push({ speakerId: row.speakerId, teamId, score: row.score });
        speakerPoints[teamId] += row.score;
        for (const role of row.roles) speeches.push({ teamId, role, speakerId: row.speakerId, score: row.score });
      }
    }
  }
  return {
    ready,
    winner: ready ? (declared ?? null) : null,
    winnerIssue: null,
    points: { [a]: elimination ? null : check.totals[a].net, [b]: elimination ? null : check.totals[b].net },
    votes: { [a]: declared === a ? 1 : 0, [b]: declared === b ? 1 : 0 },
    judgeVotes: [],
    issues: check.issues,
    decisiveIssues: [],
    missing: check.missing,
    warnings: check.warnings,
    speeches,
    speakerTotals,
    speakerPoints,
  };
}

export function computeDebateOutcome(round: RoundInfo, debate: TabDebate, context: OutcomeContext): DebateOutcome {
  const { settings } = context;
  const [a, b] = debate.teamIds;
  const base: DebateOutcome = {
    status: 'empty', issues: [], missing: [], warnings: [], winnerTeamId: null, noWinner: false, lines: [], judgeVotes: [], speeches: [], speakerTotals: [],
  };
  if (!a || !b || a === b) return { ...base, status: 'invalid', issues: ['El debate necesita dos equipos distintos.'] };
  const elimination = round.kind === 'elimination';
  const result = debate.result;
  const joint = settings.ballotMode === 'joint';
  const penalties = { [a]: effectivePenalties(result?.penalties[a], settings), [b]: effectivePenalties(result?.penalties[b], settings) };
  const side = (teamId: string) => (debate.favorTeamId ? (debate.favorTeamId === teamId ? 'favor' : 'contra') : null);
  const line = (teamId: string, patch: Partial<TeamLine>): TeamLine => ({
    teamId, opponentId: teamId === a ? b : a, side: side(teamId), won: false, votes: 0, votesAgainst: 0, points: null, deferred: null,
    forfeitWin: false, forfeitLoss: false, fallenWin: false, fallenLoss: false, penalties: penalties[teamId], speakerPoints: 0, ...patch,
  });
  const override = result?.override && (result.override.winnerTeamId === a || result.override.winnerTeamId === b) ? result.override : null;
  const fallenA = isFallenAt(context.teams.get(a), round.number);
  const fallenB = isFallenAt(context.teams.get(b), round.number);

  // "Equipo caído": no acta is needed unless the organisers decide otherwise.
  if ((fallenA || fallenB) && !override) {
    const warnings: string[] = [];
    if (result && (result.ballots.length || result.joint)) warnings.push('Se ignora el acta registrada: el debate incluye un equipo caído.');
    if (fallenA && fallenB) {
      if (elimination) return { ...base, status: 'invalid', warnings, issues: ['Ambos equipos están caídos: la organización debe decidir quién pasa con una decisión manual.'] };
      return {
        ...base, status: 'complete', warnings, noWinner: true,
        lines: [line(a, { points: 0, fallenLoss: true }), line(b, { points: 0, fallenLoss: true })],
      };
    }
    // The rival wins and receives the round's average items (computed by the standings).
    const winner = fallenA ? b : a;
    return {
      ...base, status: 'complete', warnings, winnerTeamId: winner,
      lines: [a, b].map((teamId) => (teamId === winner
        ? line(teamId, { won: true, votes: 1, deferred: elimination ? null : 'round', fallenWin: true })
        : line(teamId, { votesAgainst: 1, points: elimination ? null : 0, fallenLoss: true }))),
    };
  }
  if (!result) return base;

  const acta = joint ? evaluateJointActa(round, debate, context) : evaluateJudgeBallots(round, debate, context, penalties);
  const issues = [...acta.issues];
  const warnings = [...acta.warnings];
  let winner: string | null = null;
  let decidedBy: 'override' | 'forfeit' | 'swing' | 'acta' | null = null;
  const swingA = Boolean(context.teams.get(a)?.swing);
  const swingB = Boolean(context.teams.get(b)?.swing);
  if (override) {
    winner = override.winnerTeamId;
    decidedBy = 'override';
    if (!override.reason.trim()) warnings.push('La decisión manual no indica el motivo.');
  } else if (penalties[a].forfeit && penalties[b].forfeit) {
    issues.push('Ambos equipos pierden por falta grave o descalificación: indica el ganador con una decisión manual.');
  } else if (penalties[a].forfeit !== penalties[b].forfeit) {
    winner = penalties[a].forfeit ? b : a;
    decidedBy = 'forfeit';
  } else if (swingA !== swingB && acta.ready) {
    // UC3M art. 36: the swing team can never win, but the real team still needs its scores.
    winner = swingA ? b : a;
    decidedBy = 'swing';
  }
  if (!decidedBy || decidedBy === 'swing') issues.push(...acta.decisiveIssues);
  else warnings.push(...acta.decisiveIssues);
  if (!decidedBy && !issues.length && acta.ready) {
    winner = acta.winner;
    if (!winner && acta.winnerIssue) issues.push(acta.winnerIssue);
    decidedBy = winner ? 'acta' : null;
  }

  let votesA = acta.votes[a];
  let votesB = acta.votes[b];
  if (decidedBy === 'forfeit' || decidedBy === 'swing' || (decidedBy === 'override' && !acta.ready)) {
    const allVotes = joint ? 1 : Math.max(debate.judgeIds.length, 1);
    votesA = winner === a ? allVotes : 0;
    votesB = winner === b ? allVotes : 0;
  }
  if (decidedBy === 'override' && acta.ready && winner && ((winner === a && votesA < votesB) || (winner === b && votesB < votesA))) {
    warnings.push('La decisión manual contradice los votos registrados.');
  }
  if (round.sideMode === 'draw' && !debate.favorTeamId && winner) warnings.push('Falta registrar la postura sorteada.');

  const uniqueIssues = [...new Set(issues)];
  const status: OutcomeStatus = uniqueIssues.length ? 'invalid' : winner ? 'complete' : 'pending';
  const shared = { warnings: [...new Set(warnings)], judgeVotes: acta.judgeVotes, speeches: acta.speeches, speakerTotals: acta.speakerTotals };
  if (status !== 'complete' || !winner) return { ...base, ...shared, status, issues: uniqueIssues, missing: acta.missing };

  const loser = winner === a ? b : a;
  const pointsFor = (teamId: string): Pick<TeamLine, 'points' | 'deferred'> => {
    const points = acta.points[teamId];
    if (decidedBy !== 'forfeit' || elimination) return { points, deferred: null };
    if (teamId === loser) return { points: settings.forfeitLoserPoints, deferred: null };
    if (settings.forfeitWinnerPoints === 'roundAverage') return { points: null, deferred: 'round' };
    if (settings.forfeitWinnerPoints === 'average' || points === null) return { points: null, deferred: 'stage' };
    return { points, deferred: null };
  };
  const teamLine = (teamId: string) => line(teamId, {
    won: teamId === winner,
    votes: teamId === a ? votesA : votesB,
    votesAgainst: teamId === a ? votesB : votesA,
    ...pointsFor(teamId),
    forfeitWin: decidedBy === 'forfeit' && teamId === winner,
    forfeitLoss: decidedBy === 'forfeit' && teamId !== winner,
    speakerPoints: acta.speakerPoints[teamId],
  });
  return { ...base, ...shared, status, winnerTeamId: winner, lines: [teamLine(a), teamLine(b)] };
}

/** Outcome of every debate keyed by debate id. */
export function computeTournamentOutcomes(tournament: TabTournament): Map<string, DebateOutcome> {
  const context = outcomeContext(tournament);
  const outcomes = new Map<string, DebateOutcome>();
  for (const round of tournament.rounds) {
    for (const debate of round.debates) outcomes.set(debate.id, computeDebateOutcome(round, debate, context));
  }
  return outcomes;
}

export function roundIsComplete(round: TabRound, outcomes: Map<string, DebateOutcome>): boolean {
  return round.debates.length > 0 && round.debates.every((debate) => outcomes.get(debate.id)?.status === 'complete');
}
