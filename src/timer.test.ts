import { describe, expect, it } from 'vitest';
import type { Phase } from './domain';
import { createTimer, formatTime, LEDU_PHASES, resolvePhases, secondsLeft, transitionTimer, validateAssignments, withRoomStatus } from './timer';

describe('incompatibility domain rules', () => {
  const room = { id:'r1', name:'Sala 1', roundId:'r1', physicalRoomId:'p1', formatId:'f1', teamFavorId:'t1', teamContraId:'t2', judgeIds:['j1'], status:'ready' as const, phases:LEDU_PHASES, timer:createTimer(), notes:'', updatedAt:1 };
  // Empty array literals otherwise infer as never[] in this mutable fixture.
  const base = (): {
    rounds: { id: string; name: string }[];
    teams: { id: string; name: string; institution: string; active: boolean; incompatibleJudgeIds: string[] }[];
    judges: { id: string; name: string; institution: string; active: boolean; incompatibleJudgeIds: string[] }[];
    rooms: typeof room[];
  } => ({
    rounds:[{id:'r1',number:1,name:'Ronda 1',active:true,defaultFormatId:'f1'}],
    teams:[{id:'t1',name:'Equipo A',institution:'Uni A',active:true,incompatibleJudgeIds:[]},{id:'t2',name:'Equipo B',institution:'Uni B',active:true,incompatibleJudgeIds:[]}],
    judges:[{id:'j1',name:'Juez 1',institution:'Otra',active:true,incompatibleJudgeIds:[]},{id:'j2',name:'Juez 2',institution:'Otra',active:true,incompatibleJudgeIds:[]}],
    rooms:[{...room,judgeIds:['j1','j2']}],
  });
  it('blocks institution, team-judge and judge-judge conflicts while preserving the empty-list behavior', () => {
    const value=base();
    expect(validateAssignments(value)).toEqual([]);
    value.judges[0].institution='Uni A';
    expect(validateAssignments(value).some((message)=>message.includes('comparten institución'))).toBe(true);
    value.judges[0].institution='Otra';
    value.teams[1].incompatibleJudgeIds=['j1'];
    expect(validateAssignments(value).some((message)=>message.includes('incompatible con el equipo Equipo B'))).toBe(true);
    value.teams[1].incompatibleJudgeIds=[];
    value.judges[0].incompatibleJudgeIds=['j2'];
    expect(validateAssignments(value).some((message)=>message.includes('Juez 1 y Juez 2 son incompatibles'))).toBe(true);
  });
});


describe('preset LEDU general', () => {
  it('matches the reference turn sequence and duration from the project specification', () => {
    expect(LEDU_PHASES.map((phase) => phase.durationSeconds)).toEqual([240, 120, 240, 120, 300, 300, 300, 300, 90, 90, 180, 180]);
    expect(LEDU_PHASES.reduce((sum, phase) => sum + phase.durationSeconds, 0)).toBe(41 * 60);
    expect(LEDU_PHASES[1].speaker).toContain('En contra pregunta');
    expect(LEDU_PHASES[10].side).toBe('contra');
    expect(LEDU_PHASES[11].side).toBe('favor');
  });
});

describe('resolve room interventions', () => {
  it('falls back to the LEDU preset when neither the global format nor rooms have phases', () => {
    const phases = resolvePhases(undefined, [{ phases: [] as Phase[] }, {}]);
    expect(phases).toHaveLength(12);
    expect(phases.map((phase) => phase.durationSeconds).reduce((sum, value) => sum + value, 0)).toBe(41 * 60);
  });

  it('uses the global format before any room-specific phase list', () => {
    const global = [{ ...LEDU_PHASES[0], id: 'custom-1', name: 'Intervención personalizada' }];
    const phases = resolvePhases(global, [{ phases: LEDU_PHASES }]);
    expect(phases).toHaveLength(1);
    expect(phases[0].id).toBe('custom-1');
  });

  it('clones mutable warning thresholds so new rooms can edit their phase settings independently', () => {
    const phases = resolvePhases([LEDU_PHASES[0]]);
    phases[0].warningThresholdsSeconds?.push(5);
    expect(LEDU_PHASES[0].warningThresholdsSeconds).toEqual([60, 30, 10]);
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

  it('allows the current phase to be reset after a debate was finished', () => {
    const finished = { ...createTimer(LEDU_PHASES), phaseIndex: 5, status: 'finished' as const, remainingSeconds: 0 };
    const reset = transitionTimer(finished, LEDU_PHASES, 'reset', 7000);
    expect(reset.status).toBe('idle');
    expect(reset.phaseIndex).toBe(5);
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
      rounds: [{ id: 'r1', name: 'Ronda 1' }],
      teams: [{ id: 't1', name: 'Equipo 1' }, { id: 't2', name: 'Equipo 2' }],
      judges: [{ id: 'j1', name: 'Juez 1' }],
      rooms: [room('a1', 't1', ['j1']), room('a2', 't1', ['j1'])],
    });
    expect(errors.some((error) => error.includes('misma ronda'))).toBe(true);
  });
});
