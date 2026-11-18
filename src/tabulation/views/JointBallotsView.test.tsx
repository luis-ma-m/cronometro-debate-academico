import { describe, expect, it } from 'vitest';
import { applyJoint, draftFor } from './JointBallotsView';
import { debate, makeTournament, qualifyingRound } from '../test-fixtures';

describe('joint acta speaker assignments', () => {
  it('saves and reopens roles without a score, then edits the same entries without duplicates', () => {
    const tournament = makeTournament('aduma', ['a', 'b'], ['j1']);
    const round = qualifyingRound(1, []);
    const original = debate('debate-1', 'a', 'b', ['j1']);
    const initialDraft = draftFor(tournament, round, original);
    const draft = {
      ...initialDraft,
      speakers: {
        a: {
          'a-s1': { score: '', roles: ['introductor' as const] },
          'a-s2': { score: '8,5', roles: ['first_rebuttal' as const] },
        },
        b: {},
      },
    };

    const saved = applyJoint(original, draft, false);
    expect(saved.result?.joint?.speakers.a).toEqual([
      { speakerId: 'a-s1', roles: ['introductor'] },
      { speakerId: 'a-s2', score: 8.5, roles: ['first_rebuttal'] },
    ]);

    const reopened = draftFor(tournament, round, saved);
    expect(reopened.speakers.a).toEqual({
      'a-s1': { score: '', roles: ['introductor'] },
      'a-s2': { score: '8,5', roles: ['first_rebuttal'] },
    });

    const edited = {
      ...reopened,
      speakers: {
        ...reopened.speakers,
        a: {
          ...reopened.speakers.a,
          'a-s1': { score: '', roles: ['concluder' as const] },
        },
      },
    };
    const updated = applyJoint(saved, edited, false);
    expect(updated.id).toBe(original.id);
    expect(updated.result?.joint?.speakers.a).toEqual([
      { speakerId: 'a-s1', roles: ['concluder'] },
      { speakerId: 'a-s2', score: 8.5, roles: ['first_rebuttal'] },
    ]);
  });
});
