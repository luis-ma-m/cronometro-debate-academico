import { createTabTournament } from './presets.js';
import { isFallenAt, type PresetId, type TabBallot, type TabDebate, type TabDebateResult, type TabJointActa, type TabJudge, type TabRound, type TabTeam, type TabTournament } from './types.js;

/** Deterministic fixtures shared by the tabulation tests. */
export function team(id: string, institution = 'Inst ' + id, extra: Partial<TabTeam> = {}): TabTeam {
  return { id, name: 'Equipo ' + id, institution, active: true, swing: false, breakEligible: true, incompatibleJudgeIds: [], ...extra };
}

export function judge(id: string, extra: Partial<TabJudge> = {}): TabJudge {
  return { id, name: 'Juez ' + id, institution: 'Jueces', active: true, rating: 3, canChair: true, incompatibleJudgeIds: [], unavailableRoundIds: [], ...extra };
}

export function makeTournament(presetId: PresetId, teamIds: string[], judgeIds: string[] = [], venueCount = 0): TabTournament {
  const tournament = createTabTournament('Prueba', presetId, 1_800_000_000_000, 42);
  tournament.teams = teamIds.map((id) => team(id));
  tournament.speakers = teamIds.flatMap((id) => [1, 2, 3, 4].map((n) => ({ id: id + '-s' + n, teamId: id, name: 'Orador ' + n + ' de ' + id })));
  tournament.judges = judgeIds.map((id) => judge(id));
  tournament.venues = Array.from({ length: venueCount }, (_, i) => ({ id: 'v' + (i + 1), name: 'Aula ' + (i + 1), active: true }));
  return tournament;
}

/** A qualifying ballot set: one [teamA, teamB] total per judge. */
export function ballots(a: string, b: string, totals: Array<[number, number]>, judgeIds = totals.map((_, i) => 'j' + (i + 1))): TabBallot[] {
  return totals.map(([ta, tb], i) => ({ judgeId: judgeIds[i], totals: { [a]: ta, [b]: tb }, speeches: {} }));
}

export function result(ballotList: TabBallot[], extra: Partial<TabDebateResult> = {}): TabDebateResult {
  return { lineup: {}, ballots: ballotList, penalties: {}, notes: '', updatedAt: 1, ...extra };
}

export function debate(id: string, a: string, b: string, judgeIds: string[], debateResult?: TabDebateResult, extra: Partial<TabDebate> = {}): TabDebate {
  return { id, venueId: '', teamIds: [a, b], judgeIds, chairId: judgeIds[0] ?? '', result: debateResult, ...extra };
}

export function qualifyingRound(number: number, debates: TabDebate[], extra: Partial<TabRound> = {}): TabRound {
  return { id: 'r' + number, number, name: 'Ronda ' + number, kind: 'qualifying', sideMode: 'draw', panelSize: 3, seed: number, silent: false, debates, createdAt: 1, ...extra };
}

/** Debate won by `winner` on a single judge's ballot (winner 70, loser 60 unless given). */
export function decided(id: string, winner: string, loser: string, winnerPoints = 70, loserPoints = 60): TabDebate {
  return debate(id, winner, loser, ['j1'], result(ballots(winner, loser, [[winnerPoints, loserPoints]])));
}

/** ADUMA joint acta with quick totals (item detail pending), declared winner first. */
export function jointDecided(id: string, winner: string, loser: string, winnerTotal = 40, loserTotal = 30, extra: Partial<TabJointActa> = {}): TabDebate {
  return debate(id, winner, loser, ['j1'], result([], {
    joint: { winnerTeamId: winner, items: {}, quickTotals: { [winner]: winnerTotal, [loser]: loserTotal }, speakers: {}, ...extra },
  }));
}

/** Fills a joint acta in every played debate of a round that has none: the team with more points wins. */
export function playRound(tournament: TabTournament, roundId: string, points: (teamId: string) => number): TabTournament {
  const teams = new Map(tournament.teams.map((item) => [item.id, item]));
  return {
    ...tournament,
    rounds: tournament.rounds.map((round) => (round.id !== roundId ? round : {
      ...round,
      debates: round.debates.map((item) => {
        const [a, b] = item.teamIds;
        if (item.result || isFallenAt(teams.get(a), round.number) || isFallenAt(teams.get(b), round.number)) return item;
        return { ...item, result: result([], { joint: { winnerTeamId: points(a) > points(b) ? a : b, items: {}, quickTotals: { [a]: points(a), [b]: points(b) }, speakers: {} } }) };
      }),
    })),
  };
}
