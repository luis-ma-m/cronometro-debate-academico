import { describe, expect, it } from 'vitest';
import {
  applyDraftEdit, auditRound, confirmDraft, createRoundDraft, diffRounds, draftFingerprint, draftIsStale, draftProblems, editRound, reopenRound, undoDraftEdit,
} from './draft';
import { makeTournament, playRound, team } from './test-fixtures';
import type { TabRound, TabRoundDraft, TabTournament } from './types';

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => prefix + String(i + 1).padStart(2, '0'));
/** t01 is the strongest team: it always wins and every team has its own fixed total. */
const strength = (teamId: string) => 55 - Number(teamId.slice(1));

function aduma(teams = 20, judges = 30, venues = 10): TabTournament {
  return makeTournament('aduma', ids('t', teams), ids('j', judges), venues);
}

function draftOf(tournament: TabTournament, seed = 3): TabRoundDraft {
  const { draft, issues } = createRoundDraft(tournament, seed, 1);
  expect(issues).toEqual([]);
  return draft!;
}

/** Creates, confirms and plays the next round. */
function advance(tournament: TabTournament, seed: number): TabTournament {
  const draft = draftOf(tournament, seed);
  const confirmed = confirmDraft({ ...tournament, draftRound: draft }, draft.round.id);
  expect(confirmed.errors).toEqual([]);
  return playRound(confirmed.tournament, draft.round.id, strength);
}

const teamsOf = (round: TabRound) => round.debates.flatMap((debate) => debate.teamIds);
const shape = (round: TabRound) => round.debates.map((debate) => [debate.teamIds, debate.venueId, debate.judgeIds, debate.chairId]);

describe('creating a round draft', () => {
  it('generates the next Swiss round with rooms and judges without touching the tournament', () => {
    const tournament = aduma();
    const before = JSON.stringify(tournament);
    const { draft, issues } = createRoundDraft(tournament, 7, 100);
    expect(issues).toEqual([]);
    expect(JSON.stringify(tournament)).toBe(before);
    expect(draft).toMatchObject({ seed: 7, kind: 'swiss', createdAt: 100, editHistory: [] });
    expect(draft!.generated).toEqual(draft!.round);
    expect(teamsOf(draft!.round).sort()).toEqual(ids('t', 20));
    expect(new Set(draft!.round.debates.map((debate) => debate.venueId)).size).toBe(10);
    expect(draft!.round.debates.every((debate) => debate.judgeIds.length === 3 && debate.judgeIds.includes(debate.chairId))).toBe(true);
    expect(draft!.fingerprint).toBe(draftFingerprint(tournament));
  });

  it('is reproducible from its seed', () => {
    const tournament = aduma();
    expect(shape(draftOf(tournament, 11).round)).toEqual(shape(draftOf(tournament, 11).round));
  });

  it('refuses while a previous round has missing actas', () => {
    const tournament = aduma();
    const draft = draftOf(tournament);
    const confirmed = confirmDraft({ ...tournament, draftRound: draft }, draft.round.id).tournament;
    expect(createRoundDraft(confirmed, 4, 1).issues.join(' ')).toContain('actas');
  });

  it('leaves debates against a fallen team without room or judges', () => {
    const tournament = aduma();
    tournament.teams.find((item) => item.id === 't20')!.fallenFromRound = 1;
    const fallen = draftOf(tournament).round.debates.find((debate) => debate.teamIds.includes('t20'))!;
    expect([fallen.venueId, fallen.judgeIds]).toEqual(['', []]);
  });

  it('moves on to the break after the fourth round and reports the champion after the final', () => {
    let tournament = aduma();
    for (let round = 1; round <= 4; round++) tournament = advance(tournament, round);
    const quarters = draftOf(tournament, 5);
    expect(quarters).toMatchObject({ kind: 'elimination' });
    expect(quarters.breakSeeds).toHaveLength(8);
    expect(quarters.round.debates).toHaveLength(4);
    for (let round = 5; round <= 7; round++) tournament = advance(tournament, round);
    expect(createRoundDraft(tournament, 8, 1)).toMatchObject({ draft: null, champion: 't01', issues: [] });
  });
});

describe('editing a draft', () => {
  it('swaps two teams between debates and describes both', () => {
    const tournament = aduma();
    const draft = draftOf(tournament);
    const [first, second] = draft.round.debates;
    const moving = second.teamIds[1];
    const replaced = first.teamIds[0];
    const { draft: edited, change } = applyDraftEdit(tournament, draft, { kind: 'team', debateId: first.id, slot: 0, teamId: moving });
    expect(edited.round.debates[0].teamIds[0]).toBe(moving);
    expect(edited.round.debates[1].teamIds[1]).toBe(replaced);
    expect(teamsOf(edited.round).sort()).toEqual(ids('t', 20));
    expect(change).toContain('Equipo ' + moving);
    expect(change).toContain('Equipo ' + replaced);
    expect(edited.editHistory).toEqual([draft.round]);
    expect(edited.generated).toBe(draft.generated);
  });

  it('accepts a team from outside the round and warns that the replaced team has no debate', () => {
    const tournament = aduma();
    tournament.teams.push(team('x', 'Inst x', { active: false }));
    const draft = draftOf(tournament);
    const replaced = draft.round.debates[0].teamIds[0];
    const { draft: edited, change } = applyDraftEdit(tournament, draft, { kind: 'team', debateId: draft.round.debates[0].id, slot: 0, teamId: 'x' });
    expect(change).toContain('sin debate');
    const problems = draftProblems(tournament, edited);
    expect(problems.errors).toEqual([]);
    expect(problems.warnings.join(' ')).toContain('Equipo ' + replaced + ' no tiene debate');
    expect(problems.warnings.join(' ')).toContain('Equipo x no está activo');
  });

  it('swaps rooms when the chosen room is already in use', () => {
    const tournament = aduma();
    const draft = draftOf(tournament);
    const [first, second] = draft.round.debates;
    const { draft: edited } = applyDraftEdit(tournament, draft, { kind: 'venue', debateId: first.id, venueId: second.venueId });
    expect(edited.round.debates.slice(0, 2).map((debate) => debate.venueId)).toEqual([second.venueId, first.venueId]);
  });

  it('moves a judge between panels by swapping seats; the newcomer takes over the chair it replaces', () => {
    const tournament = aduma();
    const draft = draftOf(tournament);
    const [a, b] = draft.round.debates;
    const incoming = b.judgeIds.find((id) => id !== b.chairId)!;
    const seat = a.judgeIds.indexOf(a.chairId);
    const { draft: edited, change } = applyDraftEdit(tournament, draft, { kind: 'judge', debateId: a.id, seat, judgeId: incoming });
    const [ea, eb] = edited.round.debates;
    expect(ea.judgeIds[seat]).toBe(incoming);
    expect(ea.chairId).toBe(incoming);
    expect(eb.judgeIds).toContain(a.chairId);
    expect(eb.chairId).toBe(b.chairId);
    expect(change).toContain('Juez ' + incoming);
    expect(draftProblems(tournament, edited).errors).toEqual([]);
  });

  it('adds and removes judges, choosing a new chair when the chair leaves', () => {
    const tournament = aduma(20, 31);
    const draft = draftOf(tournament);
    const spare = ids('j', 31).find((id) => !draft.round.debates.some((debate) => debate.judgeIds.includes(id)))!;
    const debate = draft.round.debates[0];
    let edited = applyDraftEdit(tournament, draft, { kind: 'judge', debateId: debate.id, seat: 3, judgeId: spare }).draft;
    expect(edited.round.debates[0].judgeIds).toEqual([...debate.judgeIds, spare]);
    const result = applyDraftEdit(tournament, edited, { kind: 'judge', debateId: debate.id, seat: debate.judgeIds.indexOf(debate.chairId), judgeId: '' });
    edited = result.draft;
    expect(edited.round.debates[0].judgeIds).not.toContain(debate.chairId);
    expect(edited.round.debates[0].judgeIds).toHaveLength(3);
    expect(edited.round.debates[0].judgeIds).toContain(edited.round.debates[0].chairId);
    expect(result.change).toContain('Juez ' + debate.chairId);
  });

  it('only accepts a chair from the panel', () => {
    const tournament = aduma();
    const draft = draftOf(tournament);
    const [a, b] = draft.round.debates;
    expect(applyDraftEdit(tournament, draft, { kind: 'chair', debateId: a.id, judgeId: b.chairId }).change).toBeNull();
    const wing = a.judgeIds.find((id) => id !== a.chairId)!;
    expect(applyDraftEdit(tournament, draft, { kind: 'chair', debateId: a.id, judgeId: wing }).draft.round.debates[0].chairId).toBe(wing);
  });

  it('ignores edits that change nothing or point to unknown debates, and never throws', () => {
    const tournament = aduma();
    const draft = draftOf(tournament);
    const debate = draft.round.debates[0];
    for (const edit of [
      { kind: 'team', debateId: debate.id, slot: 0, teamId: debate.teamIds[0] },
      { kind: 'team', debateId: 'missing', slot: 1, teamId: 't01' },
      { kind: 'venue', debateId: debate.id, venueId: debate.venueId },
      { kind: 'judge', debateId: debate.id, seat: 9, judgeId: 'j01' },
      { kind: 'judge', debateId: debate.id, seat: 0, judgeId: 'nobody' },
      { kind: 'side', debateId: debate.id, favorTeamId: 'not-in-debate' },
    ] as const) {
      const result = applyDraftEdit(tournament, draft, edit);
      expect(result.change).toBeNull();
      expect(result.draft).toBe(draft);
    }
  });

  it('undoes edits one by one', () => {
    const tournament = aduma();
    const draft = draftOf(tournament);
    const [a, b] = draft.round.debates;
    const once = applyDraftEdit(tournament, draft, { kind: 'venue', debateId: a.id, venueId: b.venueId }).draft;
    const twice = applyDraftEdit(tournament, once, { kind: 'side', debateId: a.id, favorTeamId: a.teamIds[1] }).draft;
    const undone = undoDraftEdit(tournament, twice);
    expect(undone.draft.round).toEqual(once.round);
    expect(undone.change).toContain('Deshacer');
    const back = undoDraftEdit(tournament, undone.draft);
    expect(back.draft.round).toEqual(draft.round);
    expect(undoDraftEdit(tournament, back.draft).change).toBeNull();
  });

  it('lists every manual change with respect to the generated round', () => {
    const tournament = aduma();
    const draft = draftOf(tournament);
    const [a, b] = draft.round.debates;
    let edited = applyDraftEdit(tournament, draft, { kind: 'team', debateId: a.id, slot: 1, teamId: b.teamIds[0] }).draft;
    edited = applyDraftEdit(tournament, edited, { kind: 'venue', debateId: a.id, venueId: b.venueId }).draft;
    edited = applyDraftEdit(tournament, edited, { kind: 'chair', debateId: a.id, judgeId: a.judgeIds.find((id) => id !== a.chairId)! }).draft;
    edited = applyDraftEdit(tournament, edited, { kind: 'side', debateId: a.id, favorTeamId: a.teamIds[0] }).draft;
    const changes = diffRounds(tournament, draft.generated, edited.round).join('\n');
    expect(changes).toContain('Equipo ' + b.teamIds[0]);
    expect(changes).toContain('sala');
    expect(changes).toContain('principal');
    expect(changes).toContain('a favor');
    expect(diffRounds(tournament, draft.generated, draft.round)).toEqual([]);
  });

  it('reallocates every panel on request', () => {
    const tournament = aduma();
    const draft = draftOf(tournament);
    const emptied = draft.round.debates.reduce(
      (current, debate) => applyDraftEdit(tournament, current, { kind: 'judge', debateId: debate.id, seat: 0, judgeId: '' }).draft, draft);
    const { draft: refilled, change } = applyDraftEdit(tournament, emptied, { kind: 'allocate', seed: 5 });
    expect(refilled.round.debates.every((debate) => debate.judgeIds.length === 3)).toBe(true);
    expect(change).toContain('automática');
  });

  it('edits a confirmed round too (replacing a judge on the day)', () => {
    const tournament = aduma(20, 31);
    const draft = draftOf(tournament);
    const round = draft.round;
    const spare = ids('j', 31).find((id) => !round.debates.some((debate) => debate.judgeIds.includes(id)))!;
    const { round: edited, change } = editRound(tournament, round, { kind: 'judge', debateId: round.debates[0].id, seat: 0, judgeId: spare });
    expect(edited.debates[0].judgeIds[0]).toBe(spare);
    expect(change).toContain('Juez ' + spare);
  });
});

describe('confirming a draft', () => {
  it('adds the round and clears the draft exactly once', () => {
    const tournament = aduma();
    const draft = draftOf(tournament);
    const first = confirmDraft({ ...tournament, draftRound: draft }, draft.round.id);
    expect(first.errors).toEqual([]);
    expect(first.tournament.rounds.map((round) => round.id)).toEqual([draft.round.id]);
    expect(first.tournament.draftRound).toBeUndefined();
    const again = confirmDraft(first.tournament, draft.round.id);
    expect(again.alreadyConfirmed).toBe(true);
    expect(again.errors).toEqual([]);
    expect(again.tournament.rounds).toHaveLength(1);
  });

  it('blocks a draft with errors and leaves the tournament untouched', () => {
    const tournament = aduma();
    const draft = draftOf(tournament);
    const [a, b] = draft.round.debates;
    const broken: TabRoundDraft = { ...draft, round: { ...draft.round, debates: [{ ...a, teamIds: [a.teamIds[0], b.teamIds[0]] }, ...draft.round.debates.slice(1)] } };
    const withDraft = { ...tournament, draftRound: broken };
    const result = confirmDraft(withDraft, broken.round.id);
    expect(result.errors.join(' ')).toContain('aparece en dos debates');
    expect(result.tournament).toBe(withDraft);
  });

  it('rejects a draft that is no longer the pending one', () => {
    const tournament = aduma();
    const draft = draftOf(tournament);
    expect(confirmDraft({ ...tournament, draftRound: draft }, 'otro-borrador').errors.join(' ')).toContain('borrador');
    expect(confirmDraft(tournament, draft.round.id).errors.join(' ')).toContain('borrador');
  });

  it('warns without blocking when the inputs changed after generating', () => {
    const tournament = aduma();
    const draft = draftOf(tournament);
    const renamed = { ...tournament, teams: tournament.teams.map((item) => (item.id === 't01' ? { ...item, name: 'Nuevo nombre' } : item)) };
    expect(draftIsStale(renamed, draft)).toBe(false);
    const fallen = { ...tournament, teams: tournament.teams.map((item) => (item.id === 't01' ? { ...item, fallenFromRound: 1 } : item)) };
    expect(draftIsStale(fallen, draft)).toBe(true);
    expect(draftProblems(fallen, draft).warnings.join(' ')).toContain('cambiado');
    expect(confirmDraft({ ...fallen, draftRound: draft }, draft.round.id).errors).toEqual([]);
  });

  it('stores the break with the first elimination round', () => {
    let tournament = aduma();
    for (let round = 1; round <= 4; round++) tournament = advance(tournament, round);
    const draft = draftOf(tournament, 5);
    const confirmed = confirmDraft({ ...tournament, draftRound: draft }, draft.round.id).tournament;
    expect(confirmed.breakSeeds).toEqual(draft.breakSeeds);
  });
});

describe('reopening a round', () => {
  it('turns the last round without actas back into a draft', () => {
    const tournament = aduma();
    const draft = draftOf(tournament);
    const confirmed = confirmDraft({ ...tournament, draftRound: draft }, draft.round.id).tournament;
    const reopened = reopenRound(confirmed, draft.round.id, 50);
    expect(reopened.errors).toEqual([]);
    expect(reopened.tournament.rounds).toEqual([]);
    expect(reopened.tournament.draftRound).toMatchObject({ kind: 'swiss', createdAt: 50, editHistory: [] });
    expect(reopened.tournament.draftRound!.round).toEqual(draft.round);
  });

  it('refuses rounds with actas, rounds that are not the last one and when another draft is pending', () => {
    let tournament = advance(aduma(), 1);
    const first = tournament.rounds[0];
    expect(reopenRound(tournament, first.id, 1).errors.join(' ')).toContain('actas');
    const draft = draftOf(tournament, 2);
    tournament = confirmDraft({ ...tournament, draftRound: draft }, draft.round.id).tournament;
    expect(reopenRound(tournament, first.id, 1).errors.join(' ')).toContain('última');
    expect(reopenRound({ ...tournament, draftRound: draftOf(aduma()) }, draft.round.id, 1).errors.join(' ')).toContain('borrador');
    expect(reopenRound(tournament, 'missing', 1).errors).not.toEqual([]);
  });

  it('keeps the break with a reopened first elimination round', () => {
    let tournament = aduma();
    for (let round = 1; round <= 4; round++) tournament = advance(tournament, round);
    const draft = draftOf(tournament, 5);
    const confirmed = confirmDraft({ ...tournament, draftRound: draft }, draft.round.id).tournament;
    const reopened = reopenRound(confirmed, draft.round.id, 1).tournament;
    expect(reopened.breakSeeds).toEqual([]);
    expect(reopened.draftRound!.breakSeeds).toEqual(draft.breakSeeds);
    expect(confirmDraft(reopened, draft.round.id).tournament.breakSeeds).toEqual(draft.breakSeeds);
  });
});

describe('auditing a confirmed round', () => {
  it('reproduces the pairing from the seed and lists the manual changes', () => {
    let tournament = advance(aduma(), 1);
    const draft = draftOf(tournament, 2);
    expect(auditRound(confirmDraft({ ...tournament, draftRound: draft }, draft.round.id).tournament, draft.round.id)).toEqual({ reproducible: true, differences: [] });
    const [a, b] = draft.round.debates;
    const edited = applyDraftEdit(tournament, draft, { kind: 'team', debateId: a.id, slot: 0, teamId: b.teamIds[0] }).draft;
    tournament = confirmDraft({ ...tournament, draftRound: edited }, edited.round.id).tournament;
    const audit = auditRound(tournament, edited.round.id);
    expect(audit.reproducible).toBe(false);
    expect(audit.differences).toHaveLength(4);
    expect(audit.differences.join(' ')).toContain('Equipo ' + b.teamIds[0]);
    expect(auditRound(tournament, 'missing').differences.join(' ')).toContain('no existe');
  });
});
