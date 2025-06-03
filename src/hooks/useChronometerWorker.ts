
import { useState, useEffect, useCallback, useRef } from 'react';
import { useChronometerStore } from '@/stores/chronometerStore';

interface UseChronometerWorkerProps {
  initialTime: number;
  timerId: string;
  disabled?: boolean;
  onTick?: (currentTime: number, drift: number) => void;
}

interface TimerControls {
  time: number;
  isRunning: boolean;
  drift: number;
  start: () => void;
  pause: () => void;
  resume: () => void;
  reset: () => void;
  setNewTime: (newTime: number) => void;
}

export const useChronometerWorker = ({ 
  initialTime, 
  timerId, 
  disabled = false,
  onTick
}: UseChronometerWorkerProps): TimerControls => {
  const [time, setTime] = useState(initialTime);
  const [isRunning, setIsRunning] = useState(false);
  const [drift, setDrift] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  const updateTimerState = useChronometerStore(state => state.updateTimerState);

  // Initialize Web Worker
  useEffect(() => {
    if (typeof Worker !== 'undefined') {
      try {
        workerRef.current = new Worker(
          new URL('../workers/chronometerWorker.ts', import.meta.url),
          { type: 'module' }
        );

        workerRef.current.onmessage = (event) => {
          const { type, timerId: responseTimerId, currentTime, isRunning: workerIsRunning, drift: workerDrift } = event.data;
          
          if (responseTimerId === timerId) {
            setTime(currentTime);
            setDrift(workerDrift);
            
            if (type === 'TICK') {
              setIsRunning(workerIsRunning);
              onTick?.(currentTime, workerDrift);
            } else if (type === 'STOPPED') {
              setIsRunning(false);
            } else if (type === 'RESET_COMPLETE') {
              setIsRunning(false);
            }

            // Update global store
            updateTimerState(timerId, {
              id: timerId,
              currentTime,
              isRunning: type === 'TICK' ? workerIsRunning : false
            });
          }
        };

        workerRef.current.onerror = (error) => {
          console.error('Worker error:', error);
          setTime(initialTime);
          setIsRunning(false);
        };

        // Initialize timer in worker
        workerRef.current.postMessage({
          type: 'SET_TIME',
          timerId,
          initialTime
        });
      } catch (error) {
        console.error('Failed to create worker:', error);
        setTime(initialTime);
      }
    }

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, [timerId, initialTime, onTick, updateTimerState]);

  // Update worker when initial time changes
  useEffect(() => {
    if (workerRef.current) {
      workerRef.current.postMessage({
        type: 'SET_TIME',
        timerId,
        initialTime
      });
      setTime(initialTime);
      setIsRunning(false);
    }
  }, [initialTime, timerId]);

  const start = useCallback(() => {
    if (disabled || !workerRef.current) return;
    
    try {
      workerRef.current.postMessage({
        type: 'START',
        timerId,
        initialTime: time
      });
      setIsRunning(true);
    } catch (error) {
      console.error('Failed to start timer:', error);
    }
  }, [disabled, timerId, time]);

  const pause = useCallback(() => {
    if (disabled || !workerRef.current) return;
    
    try {
      workerRef.current.postMessage({
        type: 'PAUSE',
        timerId
      });
    } catch (error) {
      console.error('Failed to pause timer:', error);
      setIsRunning(false);
    }
  }, [disabled, timerId]);

  const resume = useCallback(() => {
    if (disabled || !workerRef.current) return;
    
    try {
      workerRef.current.postMessage({
        type: 'RESUME',
        timerId
      });
      setIsRunning(true);
    } catch (error) {
      console.error('Failed to resume timer:', error);
    }
  }, [disabled, timerId]);

  const reset = useCallback(() => {
    if (disabled || !workerRef.current) return;
    
    try {
      workerRef.current.postMessage({
        type: 'RESET',
        timerId
      });
      setTime(initialTime);
      setIsRunning(false);
    } catch (error) {
      console.error('Failed to reset timer:', error);
      setTime(initialTime);
      setIsRunning(false);
    }
  }, [disabled, timerId, initialTime]);

  const setNewTime = useCallback((newTime: number) => {
    if (workerRef.current) {
      try {
        workerRef.current.postMessage({
          type: 'SET_TIME',
          timerId,
          initialTime: newTime
        });
        setTime(newTime);
        setIsRunning(false);
      } catch (error) {
        console.error('Failed to set new time:', error);
        setTime(newTime);
        setIsRunning(false);
      }
    } else {
      setTime(newTime);
      setIsRunning(false);
    }
  }, [timerId]);

  return {
    time,
    isRunning,
    drift,
    start,
    pause,
    resume,
    reset,
    setNewTime
  };
};
