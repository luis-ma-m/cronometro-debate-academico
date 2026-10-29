import { createTabTournament, PRESET_OPTIONS } from './presets';
import { createRng, hashSeed, randomSeed } from './random';
import { isFallenAt, SPEAKER_ROLES, type PresetId, type TabBallot, type TabDebate, type TabDebateResult, type TabJointActa, type TabRound, type TabTournament } from './types';

const UNIVERSITIES: Array<[string, string]> = [
  ['Universidad de Málaga', 'Málaga'],
  ['Universidad de Sevilla', 'Sevilla'],
  ['Universidad de Granada', 'Granada'],
  ['Universidad de Córdoba', 'Córdoba'],
  ['Universidad Complutense de Madrid', 'Complutense'],
  ['Universidad Carlos III de Madrid', 'Carlos III'],
  ['Universitat de València', 'València'],
  ['Universidad de Navarra', 'Navarra'],
];
const GIVEN_NAMES = ['Lucía', 'Hugo', 'Martina', 'Daniel', 'Sofía', 'Pablo', 'Julia', 'Álvaro', 'Paula', 'Adrián', 'Carmen', 'Mario', 'Elena', 'Diego', 'Irene', 'Javier'];
const SURNAMES = ['García', 'Martínez', 'López', 'Sánchez', 'Pérez', 'Gómez', 'Fernández', 'Ruiz', 'Díaz', 'Moreno', 'Muñoz', 'Álvarez', 'Romero', 'Navarro', 'Torres', 'Domínguez'];
const JUDGE_RATINGS = [5, 5, 4, 4, 4, 3, 3, 3, 3, 2, 2, 2];

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * Teams from eight universities, judges and rooms to try the tabulation: 16 teams, 12 judges and 8 rooms, or the
 * ADUMA size (20 teams, 30 judges, 10 rooms). IDs never clash with the panel.
 */
export function createSampleTournament(presetId: Exclude<PresetId, 'custom'>, now = Date.now(), seed = randomSeed()): TabTournament {
  const label = PRESET_OPTIONS.find((option) => option.id === presetId)?.label ?? 'ejemplo';
  const tournament = createTabTournament('Torneo de ejemplo · ' + label, presetId, now, seed);
  const aduma = presetId === 'aduma';
  tournament.sample = true;
  tournament.teams = Array.from({ length: aduma ? 20 : 16 }, (_, index) => {
    const [institution, short] = UNIVERSITIES[index % UNIVERSITIES.length];
    return {
      id: 'sample-team-' + pad(index + 1), name: short + ' ' + 'ABC'[Math.floor(index / UNIVERSITIES.length)], institution,
      active: true, swing: false, breakEligible: true, incompatibleJudgeIds: [],
    };
  });
  tournament.speakers = tournament.teams.flatMap((team, teamIndex) => [0, 1, 2, 3].map((n) => ({
    id: team.id + '-speaker-' + (n + 1),
    teamId: team.id,
    name: GIVEN_NAMES[(teamIndex + n * 5) % GIVEN_NAMES.length] + ' ' + SURNAMES[(teamIndex * 3 + n) % SURNAMES.length],
  })));
  tournament.judges = Array.from({ length: aduma ? 30 : JUDGE_RATINGS.length }, (_, index) => {
    const rating = JUDGE_RATINGS[index % JUDGE_RATINGS.length];
    // Names repeat every 16 judges: a second surname keeps them unique.
    const second = index >= GIVEN_NAMES.length ? ' ' + SURNAMES[(index + 7) % SURNAMES.length] : '';
    return {
      id: 'sample-judge-' + pad(index + 1),
      name: GIVEN_NAMES[(index * 7 + 3) % GIVEN_NAMES.length] + ' ' + SURNAMES[(index * 5 + 2) % SURNAMES.length] + second + ' (juez)',
      institution: index < 4 ? UNIVERSITIES[index][0] : 'Jueces independientes',
      active: true, rating, canChair: rating >= 4, incompatibleJudgeIds: [], unavailableRoundIds: [],
    };
  });
  tournament.venues = Array.from({ length: aduma ? 10 : 8 }, (_, index) => ({ id: 'sample-venue-' + (index + 1), name: 'Aula ' + (index + 1), active: true }));
  return tournament;
}

/** Plausible joint acta (ADUMA): declared winner, the items of each team and one score per member. */
function simulatedJointActa(tournament: TabTournament, round: TabRound, debate: TabDebate, rng: () => number, strength: (teamId: string) => number): TabJointActa {
  const { settings } = tournament;
  const [a, b] = debate.teamIds;
  const winner = rng() < 0.5 + (strength(a) - strength(b)) * 0.6 ? a : b;
  if (round.kind === 'elimination') return { winnerTeamId: winner, items: {}, speakers: {} };
  const items: TabJointActa['items'] = {};
  const speakers: TabJointActa['speakers'] = {};
  const scoreSteps = Math.max(0, Math.round((settings.speakerScoreMax - settings.speakerScoreMin) / (settings.speakerScoreStep || 1)));
  for (const teamId of [a, b]) {
    const level = 0.35 + 0.35 * strength(teamId) + (teamId === winner ? 0.1 : 0);
    items[teamId] = Object.fromEntries(settings.rubric.map((item) => {
      const value = settings.itemMin + (settings.itemMax - settings.itemMin) * Math.min(1, Math.max(0, level + (rng() - 0.5) * 0.4));
      return [item.id, Math.round(value)];
    }));
    const roster = tournament.speakers.filter((speaker) => speaker.teamId === teamId).slice(0, SPEAKER_ROLES.length);
    speakers[teamId] = roster.map((speaker, index) => ({
      speakerId: speaker.id,
      score: settings.speakerScoreMin + Math.round(scoreSteps * Math.min(1, Math.max(0, level + (rng() - 0.5) * 0.4))) * settings.speakerScoreStep,
      roles: [SPEAKER_ROLES[index]],
    }));
  }
  return { winnerTeamId: winner, items, speakers };
}

/** Fills plausible ballots for the debates of a round that have judges but no result. Only meant for trying the tool. */
export function simulateRoundResults(tournament: TabTournament, roundId: string, seed = randomSeed()): { tournament: TabTournament; skipped: number } {
  const rng = createRng(seed);
  const { settings } = tournament;
  const strength = (teamId: string) => (hashSeed(tournament.seed, teamId) % 1000) / 1000;
  const scale = settings.scoreMax - settings.scoreMin;
  const speechSteps = Math.max(0, Math.round((settings.speakerScoreMax - settings.speakerScoreMin) / (settings.speakerScoreStep || 1)));
  let skipped = 0;
  const teams = new Map(tournament.teams.map((team) => [team.id, team]));
  const rounds = tournament.rounds.map((round) => {
    if (round.id !== roundId) return round;
    return {
      ...round,
      debates: round.debates.map((debate) => {
        if (debate.result) return debate;
        // Debates against a fallen team need no acta.
        if (debate.teamIds.some((id) => isFallenAt(teams.get(id), round.number))) return debate;
        if (!debate.judgeIds.length) { skipped++; return debate; }
        if (settings.ballotMode === 'joint') {
          const joint = simulatedJointActa(tournament, round, debate, rng, strength);
          const result: TabDebateResult = { lineup: {}, ballots: [], penalties: {}, notes: 'Resultado simulado', updatedAt: Date.now(), joint };
          return { ...debate, favorTeamId: debate.favorTeamId ?? debate.teamIds[rng() < 0.5 ? 0 : 1], result };
        }
        const [a, b] = debate.teamIds;
        const ballots: TabBallot[] = debate.judgeIds.map((judgeId) => {
          if (round.kind === 'elimination') {
            const chanceA = 0.5 + (strength(a) - strength(b)) * 0.6;
            return { judgeId, totals: {}, speeches: {}, winnerTeamId: rng() < chanceA ? a : b };
          }
          const score = (teamId: string) => Math.round(settings.scoreMin + scale * Math.min(0.95, Math.max(0.2, 0.45 + 0.3 * strength(teamId) + (rng() - 0.5) * 0.25)));
          let totalA = score(a);
          let totalB = score(b);
          if (totalA === totalB) totalA < settings.scoreMax ? totalA++ : totalB--;
          const speeches: TabBallot['speeches'] = {};
          if (settings.speakerScores) {
            for (const teamId of [a, b]) {
              speeches[teamId] = Object.fromEntries(SPEAKER_ROLES.map((role) => {
                const steps = Math.round(speechSteps * Math.min(1, Math.max(0, 0.35 + 0.4 * strength(teamId) + (rng() - 0.5) * 0.4)));
                return [role, settings.speakerScoreMin + steps * settings.speakerScoreStep];
              }));
            }
          }
          return { judgeId, totals: { [a]: totalA, [b]: totalB }, speeches };
        });
        const lineup: TabDebateResult['lineup'] = {};
        for (const teamId of [a, b]) {
          const roster = tournament.speakers.filter((speaker) => speaker.teamId === teamId);
          if (roster.length) lineup[teamId] = Object.fromEntries(SPEAKER_ROLES.map((role, index) => [role, roster[index % roster.length].id]));
        }
        const result: TabDebateResult = { lineup, ballots, penalties: {}, notes: 'Resultado simulado', updatedAt: Date.now() };
        return { ...debate, favorTeamId: debate.favorTeamId ?? debate.teamIds[rng() < 0.5 ? 0 : 1], result };
      }),
    };
  });
  return { tournament: { ...tournament, rounds }, skipped };
}
