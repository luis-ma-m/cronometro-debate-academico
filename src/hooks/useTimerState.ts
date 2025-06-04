
import { useState, useRef } from 'react';

export interface TimerState {
  remainingMs: number;
  isRunning: boolean;
  isPaused: boolean;
}

export interface TimerRefs {
  startTimestampRef: React.MutableRefObject<number | null>;
  intervalRef: React.MutableRefObject<number | null>;
  elapsedMsRef: React.MutableRefObject<number>;
}

export const useTimerState = (speechDurationMs: number) => {
  const [remainingMs, setRemainingMs] = useState(speechDurationMs);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const startTimestampRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const elapsedMsRef = useRef<number>(0);

  const state: TimerState = { remainingMs, isRunning, isPaused };
  const refs: TimerRefs = { startTimestampRef, intervalRef, elapsedMsRef };
  
  const setters = {
    setRemainingMs,
    setIsRunning,
    setIsPaused
  };

  return { state, refs, setters };
};
