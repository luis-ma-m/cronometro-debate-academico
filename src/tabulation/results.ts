import {
  SPEAKER_ROLES,
  type SpeakerRole,
  type TabDebate,
  type TabJudge,
  type TabPenalties,
  type TabRound,
  type TabSettings,
  type TabSpeaker,
  type TabTeam,
  type TabTournament,
  type WarningConversion,
} from './types';

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

export interface EffectivePenalties {
  warnings: number;
  minors: number;
  majors: number;
  /** Points deducted from every judge's gross score. */
  deduction: number;
  forfeit: boolean;
}

export type OutcomeStatus = 'empty' | 'pending' | 'complete' | 'invalid';

export interface TeamLine {
  teamId: string;
  opponentId: string;
  side: 'favor' | 'contra' | null;
  won: boolean;
  votes: number;
  votesAgainst: number;
  /** Debate score; null when it must be substituted (forfeit win) or does not exist (eliminations). */
  points: number | null;
  forfeitWin: boolean;
  forfeitLoss: boolean;
  penalties: EffectivePenalties;
  speakerPoints: number;
}

export interface JudgeVote { judgeId: string; teamId: string | null; nets: Record<string, number>; tie: boolean }
export interface SpeechScore { teamId: string; role: SpeakerRole; speakerId: string | null; score: number }

export interface DebateOutcome {
  status: OutcomeStatus;
  issues: string[];
  warnings: string[];
  winnerTeamId: string | null;
  lines: TeamLine[];
  judgeVotes: JudgeVote[];
  speeches: SpeechScore[];
}

const count = (value: unknown) => (Number.isFinite(value) ? Math.max(0, Math.floor(Number(value))) : 0);
const isScore = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** LEDU art. 35.a: two warnings make a minor fault, the next two another one, and from the fifth every warning is one. */
export function minorsFromWarnings(warnings: number, mode: WarningConversion): number {
  const total = count(warnings);
  if (mode === 'ledu') return total < 5 ? Math.floor(total / 2) : total - 2;
  if (mode === 'pairs') return Math.floor(total / 2);
  return 0;
}

/** Converted faults replace the ones they come from: every `minorsPerMajor` minors become one major. */
export function effectivePenalties(penalties: TabPenalties | undefined, settings: TabSettings): EffectivePenalties {
  const warnings = count(penalties?.warnings);
  let minors = count(penalties?.minors) + minorsFromWarnings(warnings, settings.warningConversion);
  let majors = count(penalties?.majors);
  if (settings.minorsPerMajor > 0) {
    const converted = Math.floor(minors / settings.minorsPerMajor);
    majors += converted;
    minors -= converted * settings.minorsPerMajor;
  }
  const forfeit = Boolean(penalties?.disqualified) || (settings.majorMode === 'forfeit' && majors > 0);
  const deduction = settings.scoresIncludePenalties
    ? 0
    : minors * settings.minorPoints + (settings.majorMode === 'points' ? majors * settings.majorPoints : 0);
  return { warnings, minors, majors, deduction, forfeit };
}

/** Warns when converting minors into a major would lower the total deduction. */
export function penaltyConversionWarning(settings: TabSettings): string | null {
  if (settings.majorMode !== 'points' || settings.minorsPerMajor <= 0) return null;
  if (settings.majorPoints >= settings.minorsPerMajor * settings.minorPoints) return null;
  return 'Con esta configuración, acumular ' + settings.minorsPerMajor + ' faltas leves en una grave reduce la penalización.';
}

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

export function computeDebateOutcome(round: Pick<TabRound, 'kind' | 'sideMode'>, debate: TabDebate, context: OutcomeContext): DebateOutcome {
  const { settings } = context;
  const [a, b] = debate.teamIds;
  const base: DebateOutcome = { status: 'empty', issues: [], warnings: [], winnerTeamId: null, lines: [], judgeVotes: [], speeches: [] };
  if (!a || !b || a === b) return { ...base, status: 'invalid', issues: ['El debate necesita dos equipos distintos.'] };
  const result = debate.result;
  if (!result) return base;

  const issues: string[] = [];
  const warnings: string[] = [];
  const elimination = round.kind === 'elimination';
  const judgeName = (id: string) => context.judges.get(id)?.name ?? 'un juez';
  const teamName = (id: string) => context.teams.get(id)?.name ?? 'un equipo';
  const penalties = { [a]: effectivePenalties(result.penalties[a], settings), [b]: effectivePenalties(result.penalties[b], settings) };
  const panel = debate.judgeIds;
  const ballots = new Map(result.ballots.map((ballot) => [ballot.judgeId, ballot]));
  if (result.ballots.some((ballot) => !panel.includes(ballot.judgeId))) issues.push('Hay un acta de un juez que no forma parte del panel.');

  const judgeVotes: JudgeVote[] = [];
  const nets: Record<string, number[]> = { [a]: [], [b]: [] };
  const tieIssues: string[] = [];
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
    if (tie) tieIssues.push('El acta de ' + judgeName(judgeId) + ' da la misma puntuación a ambos equipos: el ganador debe tener más puntos.');
    judgeVotes.push({ judgeId, teamId: tie ? null : netA > netB ? a : b, nets: { [a]: netA, [b]: netB }, tie });
  }
  const ballotsComplete = panel.length > 0 && missing === 0;
  const panelPoints = (teamId: string) => (!elimination && ballotsComplete ? aggregatePanel(nets[teamId], settings.trimExtremes) : null);

  let winner: string | null = null;
  let decidedBy: 'override' | 'forfeit' | 'swing' | 'votes' | null = null;
  const forfeitA = penalties[a].forfeit;
  const forfeitB = penalties[b].forfeit;
  const swingA = Boolean(context.teams.get(a)?.swing);
  const swingB = Boolean(context.teams.get(b)?.swing);
  if (result.override && (result.override.winnerTeamId === a || result.override.winnerTeamId === b)) {
    winner = result.override.winnerTeamId;
    decidedBy = 'override';
    if (!result.override.reason.trim()) warnings.push('La decisión manual no indica el motivo.');
  } else if (forfeitA && forfeitB) {
    issues.push('Ambos equipos pierden por falta grave o descalificación: indica el ganador con una decisión manual.');
  } else if (forfeitA !== forfeitB) {
    winner = forfeitA ? b : a;
    decidedBy = 'forfeit';
  } else if (swingA !== swingB && ballotsComplete) {
    // UC3M art. 36: the swing team can never win, but the real team still needs its scores.
    winner = swingA ? b : a;
    decidedBy = 'swing';
  }

  if (!decidedBy || decidedBy === 'swing') {
    if (!panel.length) issues.push('El debate no tiene jueces asignados.');
    issues.push(...tieIssues);
  } else if (tieIssues.length) warnings.push(...tieIssues);

  let votesA = judgeVotes.filter((vote) => vote.teamId === a).length;
  let votesB = judgeVotes.filter((vote) => vote.teamId === b).length;
  if (!decidedBy && !issues.length && ballotsComplete) {
    if (votesA !== votesB) winner = votesA > votesB ? a : b;
    else {
      const chairVote = judgeVotes.find((vote) => vote.judgeId === debate.chairId)?.teamId ?? null;
      if (chairVote) {
        winner = chairVote;
        warnings.push('Empate a votos resuelto por el voto del juez principal.');
      } else issues.push('Empate a votos y sin voto del juez principal que lo resuelva.');
    }
    decidedBy = winner ? 'votes' : null;
  }
  if (decidedBy === 'forfeit' || decidedBy === 'swing' || (decidedBy === 'override' && !ballotsComplete)) {
    const allVotes = Math.max(panel.length, 1);
    votesA = winner === a ? allVotes : 0;
    votesB = winner === b ? allVotes : 0;
  }
  if (decidedBy === 'override' && ballotsComplete && winner) {
    // Keep the judges' votes but never show the overridden loser with more votes than the winner.
    if ((winner === a && votesA < votesB) || (winner === b && votesB < votesA)) warnings.push('La decisión manual contradice los votos registrados.');
  }

  const speeches: SpeechScore[] = [];
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
  }

  if (round.sideMode === 'draw' && !debate.favorTeamId && winner) warnings.push('Falta registrar la postura sorteada.');

  const uniqueIssues = [...new Set(issues)];
  const status: OutcomeStatus = uniqueIssues.length ? 'invalid' : winner ? 'complete' : 'pending';
  if (status !== 'complete') {
    return { ...base, status, issues: uniqueIssues, warnings: [...new Set(warnings)], judgeVotes, speeches };
  }

  const loser = winner === a ? b : a;
  const line = (teamId: string): TeamLine => {
    const opponentId = teamId === a ? b : a;
    const won = teamId === winner;
    let points = panelPoints(teamId);
    if (decidedBy === 'forfeit' && !elimination) {
      if (teamId === loser) points = settings.forfeitLoserPoints;
      else if (settings.forfeitWinnerPoints === 'average') points = null;
    }
    return {
      teamId,
      opponentId,
      side: debate.favorTeamId ? (debate.favorTeamId === teamId ? 'favor' : 'contra') : null,
      won,
      votes: teamId === a ? votesA : votesB,
      votesAgainst: teamId === a ? votesB : votesA,
      points,
      forfeitWin: decidedBy === 'forfeit' && won,
      forfeitLoss: decidedBy === 'forfeit' && !won,
      penalties: penalties[teamId],
      speakerPoints: speakerPoints[teamId],
    };
  };
  return {
    status,
    issues: [],
    warnings: [...new Set(warnings)],
    winnerTeamId: winner,
    lines: [line(a), line(b)],
    judgeVotes,
    speeches,
  };
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
