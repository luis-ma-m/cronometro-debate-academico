import { useState, useEffect, useCallback, useRef } from 'react';
import { TimerUpdatePayload } from '@/types/chronometer';

interface UseDebateTimerProps {
  initialTime: number; // in seconds
  timerId: string;
  onUpdate?: (payload: TimerUpdatePayload) => void;
  disabled?: boolean;
}

export const useDebateTimer = ({ 
  initialTime, 
  timerId, 
  onUpdate,
  disabled = false
}: UseDebateTimerProps) => {
  // [1] UNIFY TO MILLISECONDS AT LOAD - convert once and store in ms
  const speechDurationMs = initialTime * 1000;
  
  // State for remaining time in milliseconds
  const [remainingMs, setRemainingMs] = useState(speechDurationMs);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  
  // [2] SINGLE INTERVAL REF AND TIMING REFS
  const intervalRef = useRef<number | null>(null);
  const startTimestampRef = useRef<number | null>(null);
  const elapsedMs = useRef<number>(0);

  // Report timer state to parent via callback
  const reportUpdate = useCallback(() => {
    if (onUpdate) {
      onUpdate({
        id: timerId,
        currentTime: remainingMs / 1000, // Convert to seconds for external API
        isRunning
      });
    }
  }, [onUpdate, timerId, remainingMs, isRunning]);

  // [2] REWRITE tick() TO WORK PURELY IN MS
  const tick = useCallback(() => {
    if (startTimestampRef.current === null) return;

    // Compute how many ms have passed
    const now = performance.now();
    const delta = now - startTimestampRef.current; // in ms
    elapsedMs.current = delta;

    // Compute remaining ms
    const remaining = speechDurationMs - delta; // both in ms

    if (remaining <= 0) {
      // Force it to exactly zero so display doesn't flicker negative
      setRemainingMs(0);
      stopTimer(); // exactly once
      return;
    }

    // Otherwise update the displayed time
    setRemainingMs(remaining);
  }, [speechDurationMs]);

  // [4] GUARD AGAINST MULTIPLE INTERVALS - startTimer()
  const startTimer = useCallback(() => {
    if (disabled || intervalRef.current !== null) return; // prevents stacking intervals
    
    // Compute a fresh startTimestampRef
    if (!isPaused) {
      // Fresh start
      startTimestampRef.current = performance.now();
      elapsedMs.current = 0;
    } else {
      // Resuming from pause - we want to resume from the existing elapsedMs
      startTimestampRef.current = performance.now() - elapsedMs.current;
    }
    
    // Create exactly one interval and store its ID
    intervalRef.current = window.setInterval(tick, 50); // 50ms for smooth updates
    
    // [5] FIX THE UI-STATE MISMATCH
    setIsRunning(true);
    setIsPaused(false); // ensure "paused" flag is off
  }, [disabled, isPaused, tick]);

  // pauseTimer()
  const pauseTimer = useCallback(() => {
    if (!isRunning) return;
    
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    // [5] FIX THE UI-STATE MISMATCH
    setIsRunning(false);
    setIsPaused(true);
    // elapsedMs.current already holds how many ms have passed so far
  }, [isRunning]);

  // resumeTimer()
  const resumeTimer = useCallback(() => {
    if (isRunning || !isPaused) return;
    startTimer(); // Will handle resume logic via isPaused check
  }, [isRunning, isPaused, startTimer]);

  // [5] FIX THE UI-STATE MISMATCH - stopTimer()
  const stopTimer = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsRunning(false);
    setIsPaused(false); // reset so the Play button shows
    elapsedMs.current = 0;
    startTimestampRef.current = null;
  }, []);

  // Combined start/pause toggle
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

  // [5] FIX THE UI-STATE MISMATCH - reset()
  const reset = useCallback(() => {
    if (disabled) return;
    
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    elapsedMs.current = 0;
    startTimestampRef.current = null;
    setIsRunning(false);
    setIsPaused(false);
    setRemainingMs(speechDurationMs); // show the full time again
  }, [disabled, speechDurationMs]);

  // Set new time (useful when config changes)
  const setNewTime = useCallback((newTimeSeconds: number) => {
    const newDurationMs = newTimeSeconds * 1000;
    
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    elapsedMs.current = 0;
    startTimestampRef.current = null;
    setIsRunning(false);
    setIsPaused(false);
    setRemainingMs(newDurationMs);
  }, []);

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
    elapsedMs.current = 0;
    startTimestampRef.current = null;
    setIsRunning(false);
    setIsPaused(false);
    setRemainingMs(newDurationMs);
  }, [initialTime]);

  // [4] GUARD AGAINST MULTIPLE INTERVALS - cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // Report initial state and changes
  useEffect(() => {
    reportUpdate();
  }, [reportUpdate]);

  return {
    time: remainingMs / 1000, // Convert to seconds for external API
    isRunning,
    startPause,
    reset,
    setNewTime
  };
};
