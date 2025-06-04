
import { useEffect } from 'react';
import { TimerUpdatePayload } from '@/types/chronometer';
import { TimerState, TimerRefs } from './useTimerState';

interface UseTimerEffectsProps {
  initialTime: number;
  timerId: string;
  disabled: boolean;
  state: TimerState;
  refs: TimerRefs;
  setters: {
    setRemainingMs: (ms: number) => void;
    setIsRunning: (running: boolean) => void;
    setIsPaused: (paused: boolean) => void;
  };
  stopTimer: () => void;
  onUpdate?: (payload: TimerUpdatePayload) => void;
}

export const useTimerEffects = ({
  initialTime,
  timerId,
  disabled,
  state,
  refs,
  setters,
  stopTimer,
  onUpdate
}: UseTimerEffectsProps) => {
  const { remainingMs, isRunning } = state;
  const { intervalRef, elapsedMsRef, startTimestampRef } = refs;
  const { setRemainingMs, setIsRunning, setIsPaused } = setters;

  // Report timer state to parent via callback
  useEffect(() => {
    if (onUpdate) {
      onUpdate({
        id: timerId,
        currentTime: remainingMs / 1000,
        isRunning
      });
    }
  }, [onUpdate, timerId, remainingMs, isRunning]);

  // Handle disabled state
  useEffect(() => {
    if (disabled && isRunning) {
      stopTimer();
    }
  }, [disabled, isRunning, stopTimer]);

  // Update when initial time changes
  useEffect(() => {
    const newDurationMs = initialTime * 1000;
    
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    elapsedMsRef.current = 0;
    startTimestampRef.current = null;
    
    setIsRunning(false);
    setIsPaused(false);
    setRemainingMs(newDurationMs);
  }, [initialTime, intervalRef, elapsedMsRef, startTimestampRef, setIsRunning, setIsPaused, setRemainingMs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
      }
    };
  }, [intervalRef]);
};
