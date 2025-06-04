
import React from 'react';
import { useChronometer } from '@/hooks/useChronometer';
import TimerDisplay from '@/components/TimerDisplay';
import TimerControls from '@/components/TimerControls';
import { useAccessibility } from '@/components/AccessibilityProvider';

interface TimerPageProps {
  initialTime?: number;
  title?: string;
}

const TimerPage: React.FC<TimerPageProps> = ({
  initialTime = 300, // 5 minutes default
  title = 'Timer'
}) => {
  const { announceTime } = useAccessibility();

  const handleTick = (currentTime: number) => {
    // Announce important time warnings
    if (currentTime === 60) {
      announceTime('1 minuto restante');
    } else if (currentTime === 30) {
      announceTime('30 segundos restantes');
    } else if (currentTime === 10) {
      announceTime('10 segundos restantes');
    }
  };

  const handleComplete = () => {
    announceTime('Tiempo agotado');
  };

  const {
    time,
    isRunning,
    isPaused,
    startTimer,
    pauseTimer,
    resumeTimer,
    resetTimer,
    toggleTimer
  } = useChronometer({
    initialTime,
    onTick: handleTick,
    onComplete: handleComplete
  });

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md mx-auto space-y-8">
        <h1 className="text-3xl font-bold text-center">{title}</h1>
        
        <TimerDisplay
          time={time}
          isRunning={isRunning}
          initialTime={initialTime}
          size="large"
        />
        
        <TimerControls
          isRunning={isRunning}
          isPaused={isPaused}
          onToggle={toggleTimer}
          onReset={resetTimer}
          size="large"
        />
      </div>
    </div>
  );
};

export default TimerPage;
