
import { TimerUpdatePayload } from '@/types/chronometer';
import { useTimerState } from './useTimerState';
import { useTimerTick } from './useTimerTick';
import { useTimerControls } from './useTimerControls';
import { useTimerEffects } from './useTimerEffects';

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
  // Convert once at load to milliseconds
  const speechDurationMs = initialTime * 1000;
  
  // State management
  const { state, refs, setters } = useTimerState(speechDurationMs);
  
  // Timer tick logic
  const { tick } = useTimerTick({
    speechDurationMs,
    refs,
    setRemainingMs: setters.setRemainingMs,
    stopTimer: () => {} // Will be set by controls
  });
  
  // Timer controls
  const controls = useTimerControls({
    speechDurationMs,
    state,
    refs,
    setters,
    tick,
    disabled
  });
  
  // Update tick with actual stopTimer function
  const { tick: finalTick } = useTimerTick({
    speechDurationMs,
    refs,
    setRemainingMs: setters.setRemainingMs,
    stopTimer: controls.stopTimer
  });
  
  // Side effects
  useTimerEffects({
    initialTime,
    timerId,
    disabled,
    state,
    refs,
    setters,
    stopTimer: controls.stopTimer,
    onUpdate
  });

  // Format time for external API
  const formatTime = (ms: number): number => {
    return Math.ceil(ms / 1000);
  };

  return {
    time: formatTime(state.remainingMs),
    isRunning: state.isRunning,
    startPause: controls.startPause,
    reset: controls.reset,
    setNewTime: controls.setNewTime
  };
};
