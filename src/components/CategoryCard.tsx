import React from 'react';
import { CategoryConfig, GlobalSettings, TimerUpdatePayload, PositionType } from '@/types/chronometer';
import { useDebateTimer } from '@/hooks/useDebateTimer';
import DebateTimerDisplay from './DebateTimerDisplay';

interface CategoryCardProps {
  category: CategoryConfig;
  settings: Pick<GlobalSettings, 'positiveWarningThreshold' | 'negativeWarningThreshold'>;
  onTimerUpdate: (payload: TimerUpdatePayload) => void;
  displayOnlyPosition?: PositionType; // New prop
}

const CategoryCard: React.FC<CategoryCardProps> = ({ 
  category, 
  settings, 
  onTimerUpdate,
  displayOnlyPosition 
}) => {
  const timerFavorId = `${category.id}_favor`;
  const timerContraId = `${category.id}_contra`;
  const timerExamenFavorId = `${category.id}_examen_favor`;
  const timerExamenContraId = `${category.id}_examen_contra`;

  const timerFavorHook = useDebateTimer({ initialTime: category.timeFavor, timerId: timerFavorId, onUpdate: onTimerUpdate });
  const timerContraHook = useDebateTimer({ initialTime: category.timeContra, timerId: timerContraId, onUpdate: onTimerUpdate });
  
  const hasExamenCruzado = category.timeExamenCruzadoFavor !== undefined && category.timeExamenCruzadoContra !== undefined;
  
  const timerExamenFavorHook = useDebateTimer({ 
    initialTime: category.timeExamenCruzadoFavor || 0,
    timerId: timerExamenFavorId,
    onUpdate: onTimerUpdate,
    disabled: !hasExamenCruzado
  });

  const timerExamenContraHook = useDebateTimer({ 
    initialTime: category.timeExamenCruzadoContra || 0,
    timerId: timerExamenContraId,
    onUpdate: onTimerUpdate,
    disabled: !hasExamenCruzado
  });
  
  React.useEffect(() => {
    timerFavorHook.setNewTime(category.timeFavor);
  }, [category.timeFavor, timerFavorHook.setNewTime]);

  React.useEffect(() => {
    timerContraHook.setNewTime(category.timeContra);
  }, [category.timeContra, timerContraHook.setNewTime]);

  React.useEffect(() => {
    if (hasExamenCruzado && category.timeExamenCruzadoFavor !== undefined) {
      timerExamenFavorHook.setNewTime(category.timeExamenCruzadoFavor);
    }
  }, [category.timeExamenCruzadoFavor, timerExamenFavorHook.setNewTime, hasExamenCruzado]);

  React.useEffect(() => {
    if (hasExamenCruzado && category.timeExamenCruzadoContra !== undefined) {
      timerExamenContraHook.setNewTime(category.timeExamenCruzadoContra);
    }
  }, [category.timeExamenCruzadoContra, timerExamenContraHook.setNewTime, hasExamenCruzado]);

  if (displayOnlyPosition) {
    let timerData;
    let positionName = '';
    let baseBg = ''; // Less relevant for large single display focused on digits

    switch (displayOnlyPosition) {
      case 'favor':
        timerData = timerFavorHook;
        positionName = 'A favor';
        baseBg = 'bg-soft-green';
        break;
      case 'contra':
        timerData = timerContraHook;
        positionName = 'En contra';
        baseBg = 'bg-soft-red';
        break;
      case 'examen_favor':
        if (hasExamenCruzado) {
          timerData = timerExamenFavorHook;
          positionName = 'Examen Cruzado (A favor)';
          baseBg = 'bg-soft-green';
        }
        break;
      case 'examen_contra':
        if (hasExamenCruzado) {
          timerData = timerExamenContraHook;
          positionName = 'Examen Cruzado (En contra)';
          baseBg = 'bg-soft-red';
        }
        break;
    }

    if (timerData) {
      return (
        <div className="w-full flex justify-center py-4">
          <DebateTimerDisplay
            time={timerData.time}
            isRunning={timerData.isRunning}
            onStartPause={timerData.startPause}
            onReset={timerData.reset}
            settings={settings}
            baseBgColor={baseBg} // Card background if not overridden by size='large'
            positionName={positionName}
            size="large"
          />
        </div>
      );
    }
    return (
      <div className="text-center p-8 text-muted-foreground">
        Turno no disponible o no configurado para esta categoría.
      </div>
    );
  }

  // Fallback to original grid display if displayOnlyPosition is not provided
  // This part is mostly unchanged for now but might be removed if not used.
  return (
    <div className="bg-card p-6 rounded-lg shadow-md w-full">
      <h2 className="text-2xl font-bold mb-4 text-center text-card-foreground">{category.name}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <DebateTimerDisplay
          time={timerFavorHook.time}
          isRunning={timerFavorHook.isRunning}
          onStartPause={timerFavorHook.startPause}
          onReset={timerFavorHook.reset}
          settings={settings}
          baseBgColor="bg-soft-green"
          positionName="A favor"
        />
        <DebateTimerDisplay
          time={timerContraHook.time}
          isRunning={timerContraHook.isRunning}
          onStartPause={timerContraHook.startPause}
          onReset={timerContraHook.reset}
          settings={settings}
          baseBgColor="bg-soft-red"
          positionName="En contra"
        />
        {hasExamenCruzado && (
          <>
            <DebateTimerDisplay
              time={timerExamenFavorHook.time}
              isRunning={timerExamenFavorHook.isRunning}
              onStartPause={timerExamenFavorHook.startPause}
              onReset={timerExamenFavorHook.reset}
              settings={settings}
              baseBgColor="bg-soft-green"
              positionName="Examen Cruzado (A favor)"
            />
            <DebateTimerDisplay
              time={timerExamenContraHook.time}
              isRunning={timerExamenContraHook.isRunning}
              onStartPause={timerExamenContraHook.startPause}
              onReset={timerExamenContraHook.reset}
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
