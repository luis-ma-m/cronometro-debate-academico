import { unzipSync } from 'fflate';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { teamConflicts } from './adjudication';
import { applyDraftEdit, confirmDraft, createRoundDraft, type DraftEdit } from './draft';
import { verifyLog } from './log';
import { parseTournamentExport, serializeTournamentExport } from './normalize';
import { hashSeed } from './random';
import { buildRoundZip } from './roundZip';
import { createTabStore, memoryStorage } from './store';
import { makeTournament, playRound } from './test-fixtures';
import { isFallenAt, type TabRound, type TabTournament } from './types';

/** Fixed seed so CI is reproducible; PROPERTY_SEED and PROPERTY_RUNS allow longer searches locally. */
const RUNS = { seed: Number(process.env.PROPERTY_SEED ?? 20261120), numRuns: Number(process.env.PROPERTY_RUNS ?? 60) };

const shape = fc.record({
  teams: fc.integer({ min: 1, max: 12 }).map((n) => n * 2),
  judges: fc.integer({ min: 0, max: 40 }),
  venues: fc.integer({ min: 0, max: 14 }),
  institutions: fc.integer({ min: 1, max: 6 }),
  judgesFromTeams: fc.boolean(),
  fallen: fc.array(fc.record({ team: fc.nat(), round: fc.integer({ min: 1, max: 4 }) }), { maxLength: 3 }),
  conflicts: fc.array(fc.record({ judge: fc.nat(), team: fc.nat(), objective: fc.boolean() }), { maxLength: 10 }),
  seed: fc.integer({ min: 1, max: 2 ** 31 - 1 }),
});
type Shape = typeof shape extends fc.Arbitrary<infer T> ? T : never;

function build(input: Shape): TabTournament {
  const teamIds = Array.from({ length: input.teams }, (_, i) => 't' + i);
  const judgeIds = Array.from({ length: input.judges }, (_, i) => 'j' + i);
  const tournament = makeTournament('aduma', teamIds, judgeIds, input.venues);
  tournament.teams.forEach((team, i) => { team.institution = 'Inst ' + (i % input.institutions); });
  tournament.judges.forEach((judge, i) => { judge.institution = input.judgesFromTeams && i % 3 === 0 ? 'Inst ' + (i % input.institutions) : 'Jueces'; });
  for (const item of input.fallen) tournament.teams[item.team % input.teams].fallenFromRound = item.round;
  if (input.judges) {
    tournament.judgeConflicts = input.conflicts.map((item, i) => ({
      id: 'c' + i, judgeId: 'j' + (item.judge % input.judges), teamId: 't' + (item.team % input.teams), level: item.objective ? 'objective' as const : 'subjective' as const, note: '',
    }));
  }
  return tournament;
}

/** Every team once, every judge in one panel, chairs inside their panel, no room or jury for debates not held. */
function checkRound(tournament: TabTournament, round: TabRound) {
  const teams = round.debates.flatMap((debate) => debate.teamIds);
  if (round.kind === 'qualifying') expect([...teams].sort()).toEqual(tournament.teams.filter((team) => team.active).map((team) => team.id).sort());
  expect(new Set(teams).size).toBe(teams.length);
  const judges = round.debates.flatMap((debate) => debate.judgeIds);
  expect(new Set(judges).size).toBe(judges.length);
  const byId = new Map(tournament.teams.map((team) => [team.id, team]));
  for (const debate of round.debates) {
    expect(debate.judgeIds.length ? debate.judgeIds.includes(debate.chairId) : debate.chairId === '').toBe(true);
    if (debate.teamIds.some((id) => isFallenAt(byId.get(id), round.number))) expect([debate.venueId, debate.judgeIds]).toEqual(['', []]);
    // An objective conflict is only seated as the single judge of a debate that would otherwise have none.
    for (const judgeId of debate.judgeIds) {
      const judge = tournament.judges.find((item) => item.id === judgeId)!;
      const objective = debate.teamIds.some((teamId) => teamConflicts(judge, byId.get(teamId)!, tournament.judgeConflicts).some((conflict) => conflict.level === 'objective'));
      if (objective) expect(debate.judgeIds).toEqual([judgeId]);
    }
  }
}

const points = (teamId: string) => 20 + (hashSeed(teamId) % 30);

describe('properties (fixed seed)', () => {
  it('generates, confirms and plays every round of any tournament without breaking an invariant', () => {
    fc.assert(fc.property(shape, (input) => {
      let tournament = build(input);
      for (let number = 1; number <= 7; number++) {
        const created = createRoundDraft(tournament, input.seed + number, 1);
        if (!created.draft) {
          expect(created.champion !== null || created.issues.length > 0).toBe(true);
          break;
        }
        checkRound(tournament, created.draft.round);
        const confirmed = confirmDraft({ ...tournament, draftRound: created.draft }, created.draft.round.id);
        expect(confirmed.errors).toEqual([]);
        tournament = playRound(confirmed.tournament, created.draft.round.id, points);
      }
      const parsed = parseTournamentExport(serializeTournamentExport(tournament, 1));
      expect(parsed.tournament).toEqual(tournament);
      for (const round of tournament.rounds) {
        const files = unzipSync(buildRoundZip(tournament, round, [], 1).bytes);
        expect(Object.keys(files).filter((name) => name.startsWith('publico/'))).toHaveLength(3);
      }
    }), RUNS);
  });

  it('keeps every draft consistent under any sequence of manual edits, valid or not', () => {
    const edit = fc.oneof(
      fc.record({ kind: fc.constant('team' as const), debate: fc.nat(), slot: fc.constantFrom(0 as const, 1 as const), team: fc.nat() }),
      fc.record({ kind: fc.constant('venue' as const), debate: fc.nat(), venue: fc.nat() }),
      fc.record({ kind: fc.constant('judge' as const), debate: fc.nat(), seat: fc.integer({ min: -1, max: 5 }), judge: fc.nat(), remove: fc.boolean() }),
      fc.record({ kind: fc.constant('chair' as const), debate: fc.nat(), judge: fc.nat() }),
      fc.record({ kind: fc.constant('side' as const), debate: fc.nat(), team: fc.nat() }),
      fc.record({ kind: fc.constant('allocate' as const), seed: fc.nat() }),
    );
    fc.assert(fc.property(shape, fc.array(edit, { maxLength: 25 }), (input, edits) => {
      const tournament = build(input);
      const created = createRoundDraft(tournament, input.seed, 1);
      if (!created.draft) return;
      let draft = created.draft;
      const pick = <T,>(list: T[], index: number) => list[index % Math.max(1, list.length)];
      for (const item of edits) {
        const debate = pick(draft.round.debates, 'debate' in item ? item.debate : 0);
        const id = debate?.id ?? 'missing';
        const change: DraftEdit = item.kind === 'team' ? { kind: 'team', debateId: id, slot: item.slot, teamId: pick(tournament.teams, item.team)?.id ?? 'x' }
          : item.kind === 'venue' ? { kind: 'venue', debateId: id, venueId: item.venue % 3 === 0 ? '' : pick(tournament.venues, item.venue)?.id ?? 'x' }
            : item.kind === 'judge' ? { kind: 'judge', debateId: id, seat: item.seat, judgeId: item.remove ? '' : pick(tournament.judges, item.judge)?.id ?? 'x' }
              : item.kind === 'chair' ? { kind: 'chair', debateId: id, judgeId: pick(tournament.judges, item.judge)?.id ?? 'x' }
                : item.kind === 'side' ? { kind: 'side', debateId: id, favorTeamId: item.team % 3 === 0 ? '' : pick(debate?.teamIds ?? [], item.team) ?? '' }
                  : { kind: 'allocate', seed: item.seed };
        draft = applyDraftEdit(tournament, draft, change).draft;
        const teams = draft.round.debates.flatMap((entry) => entry.teamIds);
        expect(new Set(teams).size).toBe(teams.length);
        const judges = draft.round.debates.flatMap((entry) => entry.judgeIds);
        expect(new Set(judges).size).toBe(judges.length);
        for (const entry of draft.round.debates) expect(entry.judgeIds.length ? entry.judgeIds.includes(entry.chairId) : entry.chairId === '').toBe(true);
      }
    }), RUNS);
  });

  it('keeps a verifiable, gap-free log through any sequence of edits, saves, reloads and restores', () => {
    const operation = fc.oneof(
      fc.record({ op: fc.constant('named' as const), name: fc.string({ maxLength: 8 }) }),
      fc.record({ op: fc.constant('unnamed' as const), name: fc.string({ maxLength: 8 }) }),
      fc.record({ op: fc.constant('wait' as const), ms: fc.integer({ min: 0, max: 15_000 }) }),
      fc.constant({ op: 'flush' as const }),
      fc.constant({ op: 'reload' as const }),
      fc.constant({ op: 'backup' as const }),
      fc.constant({ op: 'restore' as const }),
    );
    fc.assert(fc.property(fc.array(operation, { minLength: 1, maxLength: 30 }), (operations) => {
      const storage = memoryStorage();
      let time = 1_000_000;
      const timers: Array<{ at: number; callback: () => void }> = [];
      const open = () => createTabStore({
        storage, events: null, now: () => time,
        schedule: (callback, delay) => {
          const timer = { at: time + delay, callback };
          timers.push(timer);
          return () => { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1); };
        },
      });
      let store = open();
      store.create(makeTournament('aduma', ['a', 'b']));
      for (const item of operations) {
        if (item.op === 'named') store.update((t) => ({ ...t, name: 'N' + item.name }), { type: 'named', message: item.name });
        else if (item.op === 'unnamed') store.update((t) => ({ ...t, name: 'U' + item.name }));
        else if (item.op === 'wait') {
          time += item.ms;
          for (const timer of timers.filter((entry) => entry.at <= time)) {
            const index = timers.indexOf(timer);
            if (index < 0) continue;
            timers.splice(index, 1);
            timer.callback();
          }
        } else if (item.op === 'flush') expect(store.flush()).toBe(true);
        else if (item.op === 'reload') {
          store.flush();
          timers.length = 0;
          store = open();
        } else if (item.op === 'backup') store.backup('copia');
        else if (store.listBackups().length) store.restoreBackup(store.listBackups()[0].slot);
      }
      expect(store.flush()).toBe(true);
      const { entries, issues } = store.readLog();
      expect(issues).toEqual([]);
      expect(verifyLog(entries).ok).toBe(true);
      const seqs = entries.map((entry) => entry.seq);
      expect(seqs).toEqual([...new Set(seqs)].sort((x, y) => x - y));
      expect(Math.max(...seqs)).toBe(store.getState().tournament!.logSeq);
      // Reopening shows exactly the same history.
      expect(open().readLog().entries.map((entry) => entry.seq)).toEqual(seqs);
    }), RUNS);
  });
});
