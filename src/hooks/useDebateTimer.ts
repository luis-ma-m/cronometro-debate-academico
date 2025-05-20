
import { useState, useEffect, useCallback, useRef } from 'react';
import { TimerUpdatePayload } from '@/types/chronometer';

interface UseDebateTimerProps {
  initialTime: number; // in seconds
  timerId: string;
  onUpdate?: (payload: TimerUpdatePayload) => void;
}

export const useDebateTimer = ({ initialTime, timerId, onUpdate }: UseDebateTimerProps) => {
  const [time, setTime] = useState(initialTime);
  const [isRunning, setIsRunning] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const updateParent = useCallback(() => {
    if (onUpdate) {
      onUpdate({ id: timerId, currentTime: time, isRunning });
    }
  }, [time, isRunning, timerId, onUpdate]);

  useEffect(() => {
    // Initial update
    updateParent();
  }, [updateParent]);


  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(() => {
        setTime((prevTime) => {
          const newTime = prevTime - 1;
          if (onUpdate) {
            onUpdate({ id: timerId, currentTime: newTime, isRunning: true });
          }
          return newTime;
        });
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      // Update parent on pause
      if (onUpdate) {
        onUpdate({ id: timerId, currentTime: time, isRunning: false });
      }
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isRunning, timerId, onUpdate, time]); // Added time to dependencies of outer useEffect

  const startPause = useCallback(() => {
    setIsRunning((prev) => {
      const newIsRunning = !prev;
      if (onUpdate) {
        // Ensure 'time' in this callback is the current state value
        // by not relying on 'time' from closure if it's stale.
        // However, setTime has updated 'time' before this runs.
        onUpdate({ id: timerId, currentTime: time, isRunning: newIsRunning });
      }
      return newIsRunning;
    });
  }, [timerId, onUpdate, time]); // Added time to dependencies

  const reset = useCallback(() => {
    setIsRunning(false);
    setTime(initialTime);
    if (onUpdate) {
      onUpdate({ id: timerId, currentTime: initialTime, isRunning: false });
    }
  }, [initialTime, timerId, onUpdate]);

  const setNewTime = useCallback((newInitialTime: number) => {
    setTime(newInitialTime);
    setIsRunning(false); // Usually reset also stops the timer
    if (onUpdate) {
      onUpdate({ id: timerId, currentTime: newInitialTime, isRunning: false });
    }
  }, [timerId, onUpdate]);


  return {
    time,
    isRunning,
    startPause,
    reset,
    setNewTime, // For configuration changes
  };
};
