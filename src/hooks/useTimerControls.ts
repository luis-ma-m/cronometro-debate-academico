
import { useCallback } from 'react';
import { TimerState, TimerRefs } from './useTimerState';

interface UseTimerControlsProps {
  speechDurationMs: number;
  state: TimerState;
  refs: TimerRefs;
  setters: {
    setRemainingMs: (ms: number) => void;
    setIsRunning: (running: boolean) => void;
    setIsPaused: (paused: boolean) => void;
  };
  tick: () => void;
  disabled?: boolean;
}

export const useTimerControls = ({
  speechDurationMs,
  state,
  refs,
  setters,
  tick,
  disabled = false
}: UseTimerControlsProps) => {
  const { isRunning, isPaused } = state;
  const { startTimestampRef, intervalRef, elapsedMsRef } = refs;
  const { setRemainingMs, setIsRunning, setIsPaused } = setters;

  const startTimer = useCallback(() => {
    if (disabled || intervalRef.current !== null) {
      return;
    }
    
    if (!isPaused) {
      startTimestampRef.current = performance.now();
      elapsedMsRef.current = 0;
    } else {
      startTimestampRef.current = performance.now() - elapsedMsRef.current;
    }
    
    intervalRef.current = window.setInterval(tick, 50);
    setIsRunning(true);
    setIsPaused(false);
  }, [disabled, isPaused, tick, intervalRef, startTimestampRef, elapsedMsRef, setIsRunning, setIsPaused]);

  const pauseTimer = useCallback(() => {
    if (!isRunning) return;
    
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    setIsRunning(false);
    setIsPaused(true);
  }, [isRunning, intervalRef, setIsRunning, setIsPaused]);

  const resumeTimer = useCallback(() => {
    if (isRunning || !isPaused) return;
    startTimer();
  }, [isRunning, isPaused, startTimer]);

  const stopTimer = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    setIsRunning(false);
    setIsPaused(false);
    elapsedMsRef.current = 0;
    startTimestampRef.current = null;
  }, [intervalRef, elapsedMsRef, startTimestampRef, setIsRunning, setIsPaused]);

  const reset = useCallback(() => {
    if (disabled) return;
    
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    elapsedMsRef.current = 0;
    startTimestampRef.current = null;
    
    setIsRunning(false);
    setIsPaused(false);
    setRemainingMs(speechDurationMs);
  }, [disabled, speechDurationMs, intervalRef, elapsedMsRef, startTimestampRef, setIsRunning, setIsPaused, setRemainingMs]);

  const setNewTime = useCallback((newTimeSeconds: number) => {
    const newDurationMs = newTimeSeconds * 1000;
    
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    elapsedMsRef.current = 0;
    startTimestampRef.current = null;
    
    setIsRunning(false);
    setIsPaused(false);
    setRemainingMs(newDurationMs);
  }, [intervalRef, elapsedMsRef, startTimestampRef, setIsRunning, setIsPaused, setRemainingMs]);

  const startPause = useCallback(() => {
    if (disabled) return;
    
    if (isRunning) {
      pauseTimer();
    } else if (isPaused) {
      resumeTimer();
    } else {
      startTimer();
    }
  }, [disabled, isRunning, isPaused, startTimer, pauseTimer, resumeTimer]);

  return {
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    reset,
    setNewTime,
    startPause
  };
};
