import { describe, expect, it } from 'vitest';
import { createTimer, formatTime, LEDU_PHASES, secondsLeft, transitionTimer } from './timer';

describe('LEDU timer state machine', () => {
  it('formats elapsed and remaining time as mm:ss', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(61)).toBe('01:01');
    expect(formatTime(-4)).toBe('00:00');
  });

  it('derives remaining time from timestamps rather than interval ticks', () => {
    const running = { ...createTimer(), status: 'running' as const, remainingSeconds: 240, lastResumedAt: 1000 };
    expect(secondsLeft(running, 3500)).toBe(238);
    expect(secondsLeft(running, 300000)).toBe(0);
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

  it('moves to the next phase and finishes at the end', () => {
    const next = transitionTimer(createTimer(), LEDU_PHASES, 'next', 5000);
    expect(next.phaseIndex).toBe(1);
    expect(next.remainingSeconds).toBe(LEDU_PHASES[1].durationSeconds);
    const last = { ...createTimer(), phaseIndex: LEDU_PHASES.length - 1 };
    expect(transitionTimer(last, LEDU_PHASES, 'next', 6000).status).toBe('finished');
  });
});
