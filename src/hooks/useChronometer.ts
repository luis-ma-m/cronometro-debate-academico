
import { useState, useRef, useCallback, useEffect } from 'react';

interface UseChronometerProps {
  initialTime: number; // in seconds
  onComplete?: () => void;
  onTick?: (currentTime: number) => void;
  disabled?: boolean;
}

export const useChronometer = ({
  initialTime,
  onComplete,
  onTick,
  disabled = false
}: UseChronometerProps) => {
  // Convert to milliseconds once at load
  const speechDurationMs = initialTime * 1000;
  
  // State
  const [remainingMs, setRemainingMs] = useState(speechDurationMs);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  // Refs for timing
  const startTimestampRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const elapsedMsRef = useRef<number>(0);

  // Tick function
  const tick = useCallback(() => {
    if (startTimestampRef.current === null) return;

    const now = performance.now();
    const delta = now - startTimestampRef.current;
    elapsedMsRef.current = delta;

    const remainingMs = speechDurationMs - delta;

    if (remainingMs <= 0) {
      setRemainingMs(0);
      stopTimer();
      onComplete?.();
      return;
    }

    setRemainingMs(remainingMs);
    onTick?.(Math.ceil(remainingMs / 1000));
  }, [speechDurationMs, onComplete, onTick]);

  // Timer controls
  const startTimer = useCallback(() => {
    if (disabled || intervalRef.current !== null) return;

    if (!isPaused) {
      startTimestampRef.current = performance.now();
      elapsedMsRef.current = 0;
    } else {
      startTimestampRef.current = performance.now() - elapsedMsRef.current;
    }

    intervalRef.current = window.setInterval(tick, 50);
    setIsRunning(true);
    setIsPaused(false);
  }, [disabled, isPaused, tick]);

  const pauseTimer = useCallback(() => {
    if (!isRunning) return;

    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    setIsRunning(false);
    setIsPaused(true);
  }, [isRunning]);

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
  }, []);

  const resetTimer = useCallback(() => {
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
  }, [disabled, speechDurationMs]);

  const toggleTimer = useCallback(() => {
    if (disabled) return;

    if (isRunning) {
      pauseTimer();
    } else if (isPaused) {
      resumeTimer();
    } else {
      startTimer();
    }
  }, [disabled, isRunning, isPaused, startTimer, pauseTimer, resumeTimer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

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
  }, [initialTime]);

  return {
    time: Math.ceil(remainingMs / 1000),
    remainingMs,
    isRunning,
    isPaused,
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    resetTimer,
    toggleTimer
  };
};
