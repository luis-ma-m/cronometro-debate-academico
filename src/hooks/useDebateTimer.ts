
import { useChronometer } from './useChronometer';
import { TimerUpdatePayload } from '@/types/chronometer';
import { useEffect } from 'react';

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
  const chronometer = useChronometer({
    initialTime,
    disabled
  });

  // Report timer state to parent via callback
  useEffect(() => {
    if (onUpdate) {
      onUpdate({
        id: timerId,
        currentTime: chronometer.time,
        isRunning: chronometer.isRunning
      });
    }
  }, [onUpdate, timerId, chronometer.time, chronometer.isRunning]);

  return {
    time: chronometer.time,
    isRunning: chronometer.isRunning,
    startPause: chronometer.toggleTimer,
    reset: chronometer.resetTimer,
    setNewTime: chronometer.setNewTime
  };
};
