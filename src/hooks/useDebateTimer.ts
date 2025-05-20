
import { useState, useEffect, useCallback, useRef } from 'react';
import { TimerUpdatePayload } from '@/types/chronometer';

interface UseDebateTimerProps {
  initialTime: number;
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
  const [time, setTime] = useState(initialTime);
  const [isRunning, setIsRunning] = useState(false);
  const timerRef = useRef<number | null>(null);
  const lastUpdateTimeRef = useRef<number>(Date.now());

  // Report timer state to parent via callback
  const reportUpdate = useCallback(() => {
    if (onUpdate) {
      onUpdate({
        id: timerId,
        currentTime: time,
        isRunning
      });
    }
  }, [onUpdate, timerId, time, isRunning]);

  // Set a new time value (useful when config changes)
  const setNewTime = useCallback((newTime: number) => {
    setTime(newTime);
    setIsRunning(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    lastUpdateTimeRef.current = Date.now();
  }, []);

  // Start or pause the timer
  const startPause = useCallback(() => {
    if (disabled) return;
    
    setIsRunning(prev => !prev);
    lastUpdateTimeRef.current = Date.now(); // Reset time reference when toggling
  }, [disabled]);

  // Reset the timer to its initial value
  const reset = useCallback(() => {
    if (disabled) return;
    
    setTime(initialTime);
    setIsRunning(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    lastUpdateTimeRef.current = Date.now();
  }, [initialTime, disabled]);

  // Main timer logic
  useEffect(() => {
    // Don't run the timer if disabled
    if (disabled) {
      if (isRunning) {
        setIsRunning(false);
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      }
      return;
    }

    if (isRunning) {
      // Create an interval that updates more frequently
      timerRef.current = window.setInterval(() => {
        const now = Date.now();
        const elapsed = (now - lastUpdateTimeRef.current) / 1000; // seconds
        lastUpdateTimeRef.current = now;
        
        setTime(prevTime => {
          const newTime = prevTime - elapsed;
          return newTime;
        });
      }, 50); // Update more frequently for smoother display
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isRunning, disabled]);

  // Report initial state and changes
  useEffect(() => {
    reportUpdate();
  }, [time, isRunning, reportUpdate]);

  return {
    time,
    isRunning,
    startPause,
    reset,
    setNewTime
  };
};
