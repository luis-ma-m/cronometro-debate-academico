
import React from 'react';
import { CategoryConfig, GlobalSettings, TimerUpdatePayload } from '@/types/chronometer';
import { useDebateTimer } from '@/hooks/useDebateTimer';
import DebateTimerDisplay from './DebateTimerDisplay';

interface CategoryCardProps {
  category: CategoryConfig;
  settings: Pick<GlobalSettings, 'positiveWarningThreshold' | 'negativeWarningThreshold'>;
  onTimerUpdate: (payload: TimerUpdatePayload) => void;
}

const CategoryCard: React.FC<CategoryCardProps> = ({ category, settings, onTimerUpdate }) => {
  const timerFavorId = `${category.id}_favor`;
  const timerContraId = `${category.id}_contra`;

  const {
    time: timeFavor,
    isRunning: isRunningFavor,
    startPause: startPauseFavor,
    reset: resetFavor,
    setNewTime: setNewTimeFavor, // Will be used by config modal
  } = useDebateTimer({ initialTime: category.timeFavor, timerId: timerFavorId, onUpdate: onTimerUpdate });

  const {
    time: timeContra,
    isRunning: isRunningContra,
    startPause: startPauseContra,
    reset: resetContra,
    setNewTime: setNewTimeContra, // Will be used by config modal
  } = useDebateTimer({ initialTime: category.timeContra, timerId: timerContraId, onUpdate: onTimerUpdate });
  
  // Effect to update internal timer if category.timeFavor/Contra changes via config
  React.useEffect(() => {
    setNewTimeFavor(category.timeFavor);
  }, [category.timeFavor, setNewTimeFavor]);

  React.useEffect(() => {
    setNewTimeContra(category.timeContra);
  }, [category.timeContra, setNewTimeContra]);


  return (
    <div className="bg-card p-6 rounded-lg shadow-md w-full">
      <h2 className="text-2xl font-bold mb-4 text-center text-card-foreground">{category.name}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DebateTimerDisplay
          time={timeFavor}
          isRunning={isRunningFavor}
          onStartPause={startPauseFavor}
          onReset={resetFavor}
          settings={settings}
          baseBgColor="bg-soft-green"
          positionName="A favor"
        />
        <DebateTimerDisplay
          time={timeContra}
          isRunning={isRunningContra}
          onStartPause={startPauseContra}
          onReset={resetContra}
          settings={settings}
          baseBgColor="bg-soft-red"
          positionName="En contra"
        />
      </div>
    </div>
  );
};

export default CategoryCard;
