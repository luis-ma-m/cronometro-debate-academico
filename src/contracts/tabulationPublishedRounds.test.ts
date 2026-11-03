import { describe, expect, it } from 'vitest';
import { createTabTournament } from '../tabulation/presets';
import { mergePublishedTabulationRounds } from './tabulationPublishedRounds';
import type { TabulationPublishedRoundRow } from '../api';

describe('canonical Tabulation round hydration', () => {
  it('restores manager assignments and official acta data using canonical identity maps', () => {
    const tournament = createTabTournament('Torneo de prueba', 'ledu-groups', 100, 12);
    const local = { ...tournament, panelLink: {
      tournamentName: 'Torneo de prueba', linkedAt: 100, remoteId: '11111111-1111-4111-8111-111111111111',
      idMap: {
        teams: { teamLocalA: 'teamRemoteA', teamLocalB: 'teamRemoteB' },
        speakers: { speakerLocalA: 'speakerRemoteA' },
        judges: { judgeLocal: 'judgeRemote' },
        venues: { venueLocal: 'venueRemote' },
      },
    }, teams: [
      { ...tournament.teams[0], id: 'teamLocalA', name: 'Equipo A' },
      { ...tournament.teams[0], id: 'teamLocalB', name: 'Equipo B' },
    ], speakers: [{ id: 'speakerLocalA', teamId: 'teamLocalA', name: 'Orador A' }],
      judges: [{ ...tournament.judges[0], id: 'judgeLocal', name: 'Jueza' }],
      venues: [{ id: 'venueLocal', name: 'Sala 1', active: true }],
    };
    const row: TabulationPublishedRoundRow = {
      tabTournamentId: local.id, tabulationRoundId: 'roundLocal', tabulationDebateId: 'debateLocal',
      managerRoundId: 'roundRemote', assignmentId: 'assignmentRemote', chairJudgeId: 'judgeRemote',
      sidesProvisional: false, roundNumber: 1, roundName: 'Ronda 1', roundKind: 'qualifying', sideMode: 'balanced',
      teamMetadata: [{ teamId: 'teamRemoteA', swing: false, breakEligible: true }],
      entityIdMap: { teams: { publisherTeamA: 'teamRemoteA', publisherTeamB: 'teamRemoteB' }, speakers: { publisherSpeaker: 'speakerRemoteA' }, judges: { publisherJudge: 'judgeRemote' }, venues: { publisherVenue: 'venueRemote' } }, physicalRoomId: 'venueRemote',
      teamFavorId: 'teamRemoteA', teamContraId: 'teamRemoteB', judgeIds: ['judgeRemote'],
      currentSourceId: 'source-1',
      currentSourcePayload: { sourceMode: 'judges', acta: { result: {
        lineup: { teamRemoteA: { introductor: 'speakerRemoteA' } },
        ballots: [{ judgeId: 'judgeRemote', totals: { teamRemoteA: 75, teamRemoteB: 70 }, speeches: {}, winnerTeamId: 'teamRemoteA' }],
        penalties: { teamRemoteA: { warnings: 0, minors: 0, majors: 0, disqualified: false } },
        notes: 'Acta oficial', updatedAt: 200,
      } } },
    };
    const result = mergePublishedTabulationRounds(local, [row], 300);
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0]).toMatchObject({
      id: 'roundLocal', managerRoundId: 'roundRemote', number: 1,
      debates: [{
        id: 'debateLocal', managerAssignmentId: 'assignmentRemote', venueId: 'venueLocal',
        teamIds: ['teamLocalA', 'teamLocalB'], judgeIds: ['judgeLocal'], chairId: 'judgeLocal',
        result: {
          lineup: { teamLocalA: { introductor: 'speakerLocalA' } },
          ballots: [{ judgeId: 'judgeLocal', totals: { teamLocalA: 75, teamLocalB: 70 }, winnerTeamId: 'teamLocalA' }],
          notes: 'Acta oficial',
        },
      }],
    });
  });

  it('hydrates a published round when the receiving browser has a different local tournament ID', () => {
    const tournament = createTabTournament('Torneo', 'ledu-groups', 100, 12);
    const result = mergePublishedTabulationRounds(tournament, [{
      tabTournamentId: 'other', tabulationRoundId: 'round', tabulationDebateId: 'debate',
      managerRoundId: 'manager-round', assignmentId: 'assignment', chairJudgeId: '',
      sidesProvisional: true, roundNumber: 1, roundName: 'Ronda', roundKind: 'qualifying',
      sideMode: 'draw', teamMetadata: [], entityIdMap: { teams: {}, speakers: {}, judges: {}, venues: {} }, physicalRoomId: '', teamFavorId: '',
      teamContraId: '', judgeIds: [], currentSourceId: null, currentSourcePayload: null,
    }]);
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0]).toMatchObject({ id: 'round', managerRoundId: 'manager-round' });
  });
});
