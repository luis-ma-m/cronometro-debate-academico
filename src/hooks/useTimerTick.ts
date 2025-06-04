
import { useCallback } from 'react';
import { TimerRefs } from './useTimerState';

interface UseTimerTickProps {
  speechDurationMs: number;
  refs: TimerRefs;
  setRemainingMs: (ms: number) => void;
  stopTimer: () => void;
}

export const useTimerTick = ({
  speechDurationMs,
  refs,
  setRemainingMs,
  stopTimer
}: UseTimerTickProps) => {
  const { startTimestampRef, elapsedMsRef } = refs;

  const tick = useCallback(() => {
    if (startTimestampRef.current === null) return;

    const now = performance.now();
    const delta = now - startTimestampRef.current;
    elapsedMsRef.current = delta;

    const remainingMs = speechDurationMs - delta;

    if (remainingMs <= 0) {
      setRemainingMs(0);
      stopTimer();
      return;
    }

    setRemainingMs(remainingMs);
  }, [speechDurationMs, startTimestampRef, elapsedMsRef, setRemainingMs, stopTimer]);

  return { tick };
};
