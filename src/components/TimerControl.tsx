
/**
 * MIT License
 * Copyright (c) 2025 Luis Martín Maíllo
 */

import React, { useEffect, useCallback, useState } from 'react';
import { useChronometerWorker } from '@/hooks/useChronometerWorker';
import { useAccessibility } from '@/components/AccessibilityProvider';
import TimerDisplay from './TimerDisplay';
import TimerControls from './TimerControls';
import { GlobalSettings, PositionType } from '@/types/chronometer';

interface TimerControlProps {
  initialTime: number;
  categoryId: string;
  position: PositionType;
  settings: GlobalSettings;
  baseBgColor: string;
  positionName: string;
  size?: 'normal' | 'large';
  disabled?: boolean;
}

const TimerControl: React.FC<TimerControlProps> = ({
  initialTime,
  categoryId,
  position,
  settings,
  baseBgColor,
  positionName,
  size = 'normal',
  disabled = false
}) => {
  const timerId = `${categoryId}_${position}`;
  const { announceTime } = useAccessibility();

  // 60fps onTick callback with accessibility announcements
  const handleTick = useCallback((currentTime: number, drift: number) => {
    // Announce time warnings
    if (currentTime === settings.positiveWarningThreshold) {
      announceTime(`${settings.positiveWarningThreshold} segundos restantes`);
    } else if (currentTime === 30) {
      announceTime('30 segundos restantes');
    } else if (currentTime === 10) {
      announceTime('10 segundos restantes');
    } else if (currentTime === 0) {
      announceTime('Tiempo agotado');
    }
  }, [settings.positiveWarningThreshold, announceTime]);

  const { time, isRunning, start, pause, resume, reset } = useChronometerWorker({
    initialTime,
    timerId,
    disabled,
    onTick: handleTick
  });

  const [hasStarted, setHasStarted] = useState(false);

  // Handle keyboard shortcuts via custom events
  useEffect(() => {
    const handleToggle = (event: CustomEvent) => {
      if (event.detail.categoryId === categoryId && event.detail.position === position) {
        if (isRunning) {
          pause();
        } else {
          if (time < initialTime) {
            resume();
            setHasStarted(true);
          } else {
            start();
            setHasStarted(true);
          }
        }
      }
    };

    const handleReset = (event: CustomEvent) => {
      if (event.detail.categoryId === categoryId && event.detail.position === position) {
        reset();
        setHasStarted(false);
      }
    };

    window.addEventListener('chronometer-toggle', handleToggle as EventListener);
    window.addEventListener('chronometer-reset', handleReset as EventListener);

    return () => {
      window.removeEventListener('chronometer-toggle', handleToggle as EventListener);
      window.removeEventListener('chronometer-reset', handleReset as EventListener);
    };
  }, [categoryId, position, isRunning, time, initialTime, start, pause, resume, reset]);

  const handleStartPause = () => {
    if (isRunning) {
      pause();
    } else {
      if (time <= 0) {
        reset();
        resume();
        setHasStarted(true);
      } else if (time < initialTime) {
        resume();
        setHasStarted(true);
      } else {
        start();
        setHasStarted(true);
      }
    }
  };

  const handleResetClick = () => {
    reset();
    setHasStarted(false);
  };

  return (
    <div
      className={`rounded-lg ${size === 'large' ? 'p-6 md:p-8 w-fit mx-auto inline-block' : 'p-4 w-fit inline-block'}`}
    >
      <TimerDisplay
        time={time}
        isRunning={isRunning}
        initialTime={initialTime}
        title={positionName}
        size={size}
        warningThreshold={settings.positiveWarningThreshold}
        negativeWarningThreshold={settings.negativeWarningThreshold}
      />
      
      <div className="mt-4">
        <TimerControls
          isRunning={isRunning}
          isPaused={!isRunning && hasStarted}
          onToggle={handleStartPause}
          onReset={handleResetClick}
          size={size}
        />
      </div>
    </div>
  );
};

export default TimerControl;
