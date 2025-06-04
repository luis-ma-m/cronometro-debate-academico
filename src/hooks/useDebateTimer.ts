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
  // [1] SINGLE "ms" CANONICAL FORMAT - convert once at load
  const speechDurationMs = initialTime * 1000;
  
  // State for remaining time in milliseconds
  const [remainingMs, setRemainingMs] = useState(speechDurationMs);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  
  // [2] THREE useRef VARIABLES IN HOOK'S TOP SCOPE
  const startTimestampRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const elapsedMsRef = useRef<number>(0); // preserves elapsed when pausing

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

  // [3] FORMAT remainingMs → "mm:ss" ONLY FOR DISPLAY
  const formatTime = useCallback((ms: number): number => {
    // Return in seconds for external display, but keep internal calculations in ms
    return Math.ceil(ms / 1000);
  }, []);

  // [2] REWRITE tick() TO WORK PURELY IN ms
  const tick = useCallback(() => {
    if (startTimestampRef.current === null) return;

    const now = performance.now();
    const delta = now - startTimestampRef.current; // milliseconds
    elapsedMsRef.current = delta;

    // Both in ms - NO DIVISION BY 1000 IN COMPARISONS
    const remainingMs = speechDurationMs - delta;

    if (remainingMs <= 0) {
      // Clamp to zero so display never flickers negative
      setRemainingMs(0);
      stopTimer(); // This will clear the interval & reset UI flags → exactly once
      return;
    }

    // Otherwise, update the displayed time
    setRemainingMs(remainingMs);
  }, [speechDurationMs]);

  // [2] startTimer() with GUARD and proper state management
  const startTimer = useCallback(() => {
    // [4] GUARD at the top
    if (disabled || intervalRef.current !== null) {
      return; // already running or disabled
    }
    
    // Calculate fresh startTimestampRef.current
    if (!isPaused) {
      // Brand-new start (never paused yet)
      startTimestampRef.current = performance.now();
      elapsedMsRef.current = 0;
    } else {
      // Resuming from pause
      startTimestampRef.current = performance.now() - elapsedMsRef.current;
    }
    
    // [4] CREATE EXACTLY ONE INTERVAL and update UI flags
    intervalRef.current = window.setInterval(tick, 50); // 50ms for smooth updates
    
    // [5] CORRECT UI STATE FLAGS
    setIsRunning(true);
    setIsPaused(false); // ensure it's no longer "paused"
  }, [disabled, isPaused, tick]);

  // [2] pauseTimer()
  const pauseTimer = useCallback(() => {
    if (!isRunning) return;
    
    // [4] CLEAR INTERVAL and set intervalRef to null
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    // [5] CORRECT UI STATE FLAGS
    setIsRunning(false);
    setIsPaused(true);
    // elapsedMsRef.current already holds the ms elapsed so far
  }, [isRunning]);

  // resumeTimer()
  const resumeTimer = useCallback(() => {
    if (isRunning || !isPaused) return;
    startTimer(); // Will handle resume logic via isPaused check
  }, [isRunning, isPaused, startTimer]);

  // [2] stopTimer() with complete cleanup
  const stopTimer = useCallback(() => {
    // [4] CLEAR INTERVAL and set intervalRef to null
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    // [5] CORRECT UI STATE FLAGS - Reset "paused" flag so Play button shows
    setIsRunning(false);
    setIsPaused(false);
    elapsedMsRef.current = 0;
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

  // [2] reset() with complete cleanup
  const reset = useCallback(() => {
    if (disabled) return;
    
    // [4] CLEAR ANY STRAY INTERVALS
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    elapsedMsRef.current = 0;
    startTimestampRef.current = null;
    
    // [5] CORRECT UI STATE FLAGS
    setIsRunning(false);
    setIsPaused(false);
    setRemainingMs(speechDurationMs); // show full time again
  }, [disabled, speechDurationMs]);

  // Set new time (useful when config changes)
  const setNewTime = useCallback((newTimeSeconds: number) => {
    const newDurationMs = newTimeSeconds * 1000;
    
    // [4] CLEAR ANY EXISTING INTERVALS
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    elapsedMsRef.current = 0;
    startTimestampRef.current = null;
    
    // [5] RESET ALL FLAGS
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
    
    // [4] CLEAR ANY EXISTING INTERVALS
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    elapsedMsRef.current = 0;
    startTimestampRef.current = null;
    
    // [5] RESET ALL FLAGS
    setIsRunning(false);
    setIsPaused(false);
    setRemainingMs(newDurationMs);
  }, [initialTime]);

  // [4] CLEANUP ON UNMOUNT - catch any stray interval
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
    time: formatTime(remainingMs), // Convert to seconds for external API
    isRunning,
    startPause,
    reset,
    setNewTime
  };
};
