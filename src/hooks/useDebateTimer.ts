
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
  // Store time internally in milliseconds to avoid unit conversion bugs
  const initialTimeMs = initialTime * 1000;
  const [remainingMs, setRemainingMs] = useState(initialTimeMs);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  
  const intervalRef = useRef<number | null>(null);
  const startTimestampRef = useRef<number | null>(null);
  const pausedDurationRef = useRef<number>(0);

  // Report timer state to parent via callback
  const reportUpdate = useCallback(() => {
    if (onUpdate) {
      onUpdate({
        id: timerId,
        currentTime: remainingMs / 1000, // Convert back to seconds for external API
        isRunning
      });
    }
  }, [onUpdate, timerId, remainingMs, isRunning]);

  // Clear any existing interval
  const clearCurrentInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Set a new time value (useful when config changes)
  const setNewTime = useCallback((newTimeSeconds: number) => {
    const newTimeMs = newTimeSeconds * 1000;
    setRemainingMs(newTimeMs);
    setIsRunning(false);
    setIsPaused(false);
    clearCurrentInterval();
    startTimestampRef.current = null;
    pausedDurationRef.current = 0;
  }, [clearCurrentInterval]);

  // Start the timer
  const startTimer = useCallback(() => {
    if (disabled || intervalRef.current) return; // Prevent multiple intervals
    
    setIsRunning(true);
    setIsPaused(false);
    startTimestampRef.current = Date.now();
    
    intervalRef.current = window.setInterval(() => {
      const now = Date.now();
      const elapsedMs = now - startTimestampRef.current! - pausedDurationRef.current;
      const newRemainingMs = Math.max(0, initialTimeMs - elapsedMs);
      
      setRemainingMs(newRemainingMs);
      
      // Stop when time expires
      if (newRemainingMs <= 0) {
        setIsRunning(false);
        setIsPaused(false);
        clearInterval(intervalRef.current!);
        intervalRef.current = null;
      }
    }, 50);
  }, [disabled, initialTimeMs]);

  // Pause the timer
  const pauseTimer = useCallback(() => {
    if (!isRunning || !startTimestampRef.current) return;
    
    const now = Date.now();
    const sessionDuration = now - startTimestampRef.current - pausedDurationRef.current;
    pausedDurationRef.current += sessionDuration;
    
    setIsRunning(false);
    setIsPaused(true);
    clearCurrentInterval();
    startTimestampRef.current = now; // Reset for next session
  }, [isRunning, clearCurrentInterval]);

  // Resume the timer
  const resumeTimer = useCallback(() => {
    if (isRunning || !isPaused) return;
    
    setIsRunning(true);
    setIsPaused(false);
    startTimestampRef.current = Date.now();
    
    intervalRef.current = window.setInterval(() => {
      const now = Date.now();
      const elapsedMs = now - startTimestampRef.current! - pausedDurationRef.current;
      const newRemainingMs = Math.max(0, initialTimeMs - elapsedMs);
      
      setRemainingMs(newRemainingMs);
      
      // Stop when time expires
      if (newRemainingMs <= 0) {
        setIsRunning(false);
        setIsPaused(false);
        clearInterval(intervalRef.current!);
        intervalRef.current = null;
      }
    }, 50);
  }, [isRunning, isPaused, initialTimeMs]);

  // Toggle start/pause
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

  // Reset the timer to its initial value
  const reset = useCallback(() => {
    if (disabled) return;
    
    setRemainingMs(initialTimeMs);
    setIsRunning(false);
    setIsPaused(false);
    clearCurrentInterval();
    startTimestampRef.current = null;
    pausedDurationRef.current = 0;
  }, [initialTimeMs, disabled, clearCurrentInterval]);

  // Handle disabled state
  useEffect(() => {
    if (disabled && isRunning) {
      setIsRunning(false);
      setIsPaused(false);
      clearCurrentInterval();
    }
  }, [disabled, isRunning, clearCurrentInterval]);

  // Update when initial time changes
  useEffect(() => {
    const newTimeMs = initialTime * 1000;
    setRemainingMs(newTimeMs);
    setIsRunning(false);
    setIsPaused(false);
    clearCurrentInterval();
    startTimestampRef.current = null;
    pausedDurationRef.current = 0;
  }, [initialTime, clearCurrentInterval]);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      clearCurrentInterval();
    };
  }, [clearCurrentInterval]);

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
