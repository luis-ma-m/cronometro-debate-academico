import { describe, expect, it } from 'vitest';
import { createTimer, formatTime, LEDU_PHASES, secondsLeft, transitionTimer, validateAssignments, withRoomStatus } from './timer';

describe('preset LEDU general', () => {
  it('matches the reference turn sequence and duration from the project specification', () => {
    expect(LEDU_PHASES.map((phase) => phase.durationSeconds)).toEqual([240, 120, 240, 120, 300, 300, 300, 300, 90, 90, 180, 180]);
    expect(LEDU_PHASES.reduce((sum, phase) => sum + phase.durationSeconds, 0)).toBe(41 * 60);
    expect(LEDU_PHASES[1].speaker).toContain('En contra pregunta');
    expect(LEDU_PHASES[10].side).toBe('contra');
    expect(LEDU_PHASES[11].side).toBe('favor');
  });
});

describe('Room readiness', () => {
  it('uses the configured judge minimum rather than assuming one judge is enough', () => {
    const room = {
      status: 'unassigned',
      timer: createTimer(LEDU_PHASES),
      teamFavorId: 'team-a',
      teamContraId: 'team-b',
      judgeIds: ['judge-1'],
    };
    expect(withRoomStatus(room, 2).status).toBe('unassigned');
    expect(withRoomStatus({ ...room, judgeIds: ['judge-1', 'judge-2'] }, 2).status).toBe('ready');
  });
});

describe('LEDU timer state machine', () => {
  it('formats regular and overtime values', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(61)).toBe('01:01');
    expect(formatTime(-4)).toBe('+00:04');
    expect(formatTime(-61)).toBe('+01:01');
  });

  it('derives remaining time from timestamps rather than interval ticks, including overtime', () => {
    const running = { ...createTimer(), status: 'running' as const, remainingSeconds: 240, lastResumedAt: 1000 };
    expect(secondsLeft(running, 3500)).toBe(238);
    expect(secondsLeft(running, 300000)).toBe(-59);
  });

  it('starts, pauses and resumes without resetting the remainder', () => {
    const started = transitionTimer(createTimer(), LEDU_PHASES, 'start', 1000);
    expect(secondsLeft(started, 11000)).toBe(230);
    const paused = transitionTimer(started, LEDU_PHASES, 'pause', 11000);
    expect(paused.status).toBe('paused');
    expect(paused.remainingSeconds).toBe(230);
    const resumed = transitionTimer(paused, LEDU_PHASES, 'start', 20000);
    expect(secondsLeft(resumed, 21000)).toBe(229);
  });

  it('resets the current intervention rather than the entire debate', () => {
    const active = { ...createTimer(LEDU_PHASES), phaseIndex: 4, status: 'paused' as const, remainingSeconds: 17 };
    const reset = transitionTimer(active, LEDU_PHASES, 'reset', 5000);
    expect(reset.status).toBe('idle');
    expect(reset.phaseIndex).toBe(4);
    expect(reset.remainingSeconds).toBe(300);
  });

  it('moves forward, backward and finishes safely at sequence boundaries', () => {
    const next = transitionTimer(createTimer(), LEDU_PHASES, 'next', 5000);
    expect(next.phaseIndex).toBe(1);
    expect(next.remainingSeconds).toBe(LEDU_PHASES[1].durationSeconds);
    const initial = createTimer(LEDU_PHASES);
    expect(transitionTimer(initial, LEDU_PHASES, 'previous', 6000)).toEqual(initial);
    const last = { ...createTimer(LEDU_PHASES), phaseIndex: LEDU_PHASES.length - 1 };
    expect(transitionTimer(last, LEDU_PHASES, 'next', 6000).status).toBe('finished');
  });

  it('validates duplicate assignments and room completeness', () => {
    const room = (id: string, favor: string, judges: string[]) => ({ id, name: id.toUpperCase(), roundId: 'r1', teamFavorId: favor, teamContraId: 't2', judgeIds: judges, phases: LEDU_PHASES });
    const errors = validateAssignments({
      rounds: [{ id: 'r1', name: 'Ronda 1' }], teams: [{ id: 't1', name: 'Equipo 1' }, { id: 't2', name: 'Equipo 2' }],
      judges: [{ id: 'j1', name: 'Juez 1' }], rooms: [room('a1', 't1', ['j1']), room('a2', 't1', ['j1'])],
    });
    expect(errors.some((error) => error.includes('misma ronda'))).toBe(true);
  });
});
