
import React from 'react';
import { CategoryConfig, GlobalSettings, TimerUpdatePayload, PositionType } from '@/types/chronometer';
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
  const timerExamenFavorId = `${category.id}_examen_favor`;
  const timerExamenContraId = `${category.id}_examen_contra`;

  const {
    time: timeFavor,
    isRunning: isRunningFavor,
    startPause: startPauseFavor,
    reset: resetFavor,
    setNewTime: setNewTimeFavor,
  } = useDebateTimer({ initialTime: category.timeFavor, timerId: timerFavorId, onUpdate: onTimerUpdate });

  const {
    time: timeContra,
    isRunning: isRunningContra,
    startPause: startPauseContra,
    reset: resetContra,
    setNewTime: setNewTimeContra,
  } = useDebateTimer({ initialTime: category.timeContra, timerId: timerContraId, onUpdate: onTimerUpdate });
  
  // Initialize examen cruzado timers if they exist for this category
  const hasExamenCruzado = category.timeExamenCruzadoFavor !== undefined && category.timeExamenCruzadoContra !== undefined;
  
  const {
    time: timeExamenFavor,
    isRunning: isRunningExamenFavor,
    startPause: startPauseExamenFavor,
    reset: resetExamenFavor,
    setNewTime: setNewTimeExamenFavor,
  } = useDebateTimer({ 
    initialTime: category.timeExamenCruzadoFavor || 0,
    timerId: timerExamenFavorId,
    onUpdate: onTimerUpdate,
    disabled: !hasExamenCruzado
  });

  const {
    time: timeExamenContra,
    isRunning: isRunningExamenContra,
    startPause: startPauseExamenContra,
    reset: resetExamenContra,
    setNewTime: setNewTimeExamenContra,
  } = useDebateTimer({ 
    initialTime: category.timeExamenCruzadoContra || 0,
    timerId: timerExamenContraId,
    onUpdate: onTimerUpdate,
    disabled: !hasExamenCruzado
  });
  
  // Effects to update internal timer if category times change via config
  React.useEffect(() => {
    setNewTimeFavor(category.timeFavor);
  }, [category.timeFavor, setNewTimeFavor]);

  React.useEffect(() => {
    setNewTimeContra(category.timeContra);
  }, [category.timeContra, setNewTimeContra]);

  React.useEffect(() => {
    if (hasExamenCruzado && category.timeExamenCruzadoFavor) {
      setNewTimeExamenFavor(category.timeExamenCruzadoFavor);
    }
  }, [category.timeExamenCruzadoFavor, setNewTimeExamenFavor, hasExamenCruzado]);

  React.useEffect(() => {
    if (hasExamenCruzado && category.timeExamenCruzadoContra) {
      setNewTimeExamenContra(category.timeExamenCruzadoContra);
    }
  }, [category.timeExamenCruzadoContra, setNewTimeExamenContra, hasExamenCruzado]);

  return (
    <div className="bg-card p-6 rounded-lg shadow-md w-full">
      <h2 className="text-2xl font-bold mb-4 text-center text-card-foreground">{category.name}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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

        {/* Examen Cruzado timers - only show if this category has them */}
        {hasExamenCruzado && (
          <>
            <DebateTimerDisplay
              time={timeExamenFavor}
              isRunning={isRunningExamenFavor}
              onStartPause={startPauseExamenFavor}
              onReset={resetExamenFavor}
              settings={settings}
              baseBgColor="bg-soft-green"
              positionName="Examen Cruzado (A favor)"
            />
            <DebateTimerDisplay
              time={timeExamenContra}
              isRunning={isRunningExamenContra}
              onStartPause={startPauseExamenContra}
              onReset={resetExamenContra}
              settings={settings}
              baseBgColor="bg-soft-red"
              positionName="Examen Cruzado (En contra)"
            />
          </>
        )}
      </div>
    </div>
  );
};

export default CategoryCard;
