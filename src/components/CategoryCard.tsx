import React from 'react';
import { CategoryConfig, GlobalSettings, TimerUpdatePayload, PositionType, Question } from '@/types/chronometer';
import { useDebateTimer } from '@/hooks/useDebateTimer';
import DebateTimerDisplay from './DebateTimerDisplay';
// Placeholder for QuestionTracker, will be created later
// import QuestionTracker from './QuestionTracker'; 

interface CategoryCardProps {
  category: CategoryConfig;
  settings: Pick<GlobalSettings, 'positiveWarningThreshold' | 'negativeWarningThreshold'>;
  onTimerUpdate: (payload: TimerUpdatePayload) => void;
  displayOnlyPosition?: PositionType;
  onQuestionUpdate: (categoryId: string, updatedQuestions: Question[]) => void; // New prop
}

const CategoryCard: React.FC<CategoryCardProps> = ({ 
  category, 
  settings, 
  onTimerUpdate,
  displayOnlyPosition,
  onQuestionUpdate // Received prop
}) => {
  const timerFavorId = `${category.id}_favor`;
  const timerContraId = `${category.id}_contra`;
  const timerExamenFavorId = `${category.id}_examen_favor`; // Existing examen type
  const timerExamenContraId = `${category.id}_examen_contra`; // Existing examen type
  // const timerExamenIntroduccionId = `${category.id}_examen_introduccion`; // For new 'introduccion' examen

  const timerFavorHook = useDebateTimer({ initialTime: category.timeFavor, timerId: timerFavorId, onUpdate: onTimerUpdate });
  const timerContraHook = useDebateTimer({ initialTime: category.timeContra, timerId: timerContraId, onUpdate: onTimerUpdate });
  
  const hasExistingExamenCruzado = category.timeExamenCruzadoFavor !== undefined || category.timeExamenCruzadoContra !== undefined;
  
  const timerExamenFavorHook = useDebateTimer({ 
    initialTime: category.timeExamenCruzadoFavor || 0,
    timerId: timerExamenFavorId,
    onUpdate: onTimerUpdate,
    disabled: category.timeExamenCruzadoFavor === undefined
  });

  const timerExamenContraHook = useDebateTimer({ 
    initialTime: category.timeExamenCruzadoContra || 0,
    timerId: timerExamenContraId,
    onUpdate: onTimerUpdate,
    disabled: category.timeExamenCruzadoContra === undefined
  });

  // Placeholder for the new 'introduccion' type Examen Cruzado timer hook
  // This will be set up when implementing that specific UI and logic
  // const timerExamenIntroduccionHook = useDebateTimer({ ... });

  React.useEffect(() => {
    timerFavorHook.setNewTime(category.timeFavor);
  }, [category.timeFavor, timerFavorHook.setNewTime]);

  React.useEffect(() => {
    timerContraHook.setNewTime(category.timeContra);
  }, [category.timeContra, timerContraHook.setNewTime]);

  React.useEffect(() => {
    if (category.timeExamenCruzadoFavor !== undefined) {
      timerExamenFavorHook.setNewTime(category.timeExamenCruzadoFavor);
    }
  }, [category.timeExamenCruzadoFavor, timerExamenFavorHook.setNewTime]);

  React.useEffect(() => {
    if (category.timeExamenCruzadoContra !== undefined) {
      timerExamenContraHook.setNewTime(category.timeExamenCruzadoContra);
    }
  }, [category.timeExamenCruzadoContra, timerExamenContraHook.setNewTime]);
  
  // TODO: Add useEffects for timerExamenIntroduccionHook when implemented

  if (displayOnlyPosition) {
    let timerData;
    let positionName = '';
    let baseBg = '';

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
        if (category.timeExamenCruzadoFavor !== undefined) {
          timerData = timerExamenFavorHook;
          positionName = 'Examen Cruzado (A favor)';
          baseBg = 'bg-soft-green';
        }
        break;
      case 'examen_contra':
        if (category.timeExamenCruzadoContra !== undefined) {
          timerData = timerExamenContraHook;
          positionName = 'Examen Cruzado (En contra)';
          baseBg = 'bg-soft-red';
        }
        break;
      // case 'examen_introduccion': // For new 'introduccion' examen
      //   if (category.type === 'introduccion' && category.hasExamenCruzado) {
      //     timerData = timerExamenIntroduccionHook; // This hook needs to be defined
      //     positionName = 'Examen Cruzado (Introducción)';
      //     baseBg = 'bg-blue-100'; // Example contrasting color
      //   }
      //   break;
    }

    // Placeholder for Question Tracker for 'refutacion' type when displayed as single timer
    const showQuestionTracker = category.type === 'refutacion' && displayOnlyPosition && (displayOnlyPosition === 'favor' || displayOnlyPosition === 'contra');


    if (timerData) {
      return (
        <div className="w-full flex flex-col items-center py-4">
           {/* TODO: Add "Examen Cruzado" button for 'introduccion' type here if 'displayOnlyPosition' is 'favor' or 'contra' */}
          <DebateTimerDisplay
            time={timerData.time}
            isRunning={timerData.isRunning}
            onStartPause={timerData.startPause}
            onReset={timerData.reset}
            settings={settings}
            baseBgColor={baseBg}
            positionName={positionName}
            size="large"
          />
          {/* 
          {showQuestionTracker && category.questions && (
            <div className="mt-4 w-full max-w-md">
              <QuestionTracker 
                questions={category.questions}
                minQuestions={category.minQuestions || 0}
                onQuestionToggle={(questionId) => {
                  const updatedQs = category.questions?.map(q => q.id === questionId ? {...q, answered: !q.answered} : q) || [];
                  onQuestionUpdate(category.id, updatedQs);
                }}
                onAddQuestion={() => {
                  if ((category.questions?.length || 0) < 15) {
                    const newQuestion: Question = { id: `q_${Date.now()}`, answered: false };
                    onQuestionUpdate(category.id, [...(category.questions || []), newQuestion]);
                  }
                }}
                position={displayOnlyPosition as 'favor' | 'contra'} // This needs careful handling
              />
            </div>
          )}
           */}
        </div>
      );
    }
    return (
      <div className="text-center p-8 text-muted-foreground">
        Turno no disponible o no configurado para esta categoría.
      </div>
    );
  }

  // Fallback grid display (This section will also need updates for new features)
  // ... keep existing code for grid display. It will also need:
  //    - Examen Cruzado button for 'introduccion' type
  //    - QuestionTracker for 'refutacion' type for each side (favor/contra)
  return (
    <div className="bg-card p-6 rounded-lg shadow-md w-full">
      <h2 className="text-2xl font-bold mb-4 text-center text-card-foreground">{category.name} ({category.type})</h2>
      {/* TODO: Add "Examen Cruzado" button for 'introduccion' type if category.type === 'introduccion' && category.hasExamenCruzado */}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <DebateTimerDisplay
            time={timerFavorHook.time}
            isRunning={timerFavorHook.isRunning}
            onStartPause={timerFavorHook.startPause}
            onReset={timerFavorHook.reset}
            settings={settings}
            baseBgColor="bg-soft-green"
            positionName="A favor"
          />
          {/* TODO: If category.type === 'refutacion', render QuestionTracker for 'favor' side */}
        </div>
        <div>
          <DebateTimerDisplay
            time={timerContraHook.time}
            isRunning={timerContraHook.isRunning}
            onStartPause={timerContraHook.startPause}
            onReset={timerContraHook.reset}
            settings={settings}
            baseBgColor="bg-soft-red"
            positionName="En contra"
          />
          {/* TODO: If category.type === 'refutacion', render QuestionTracker for 'contra' side */}
        </div>

        {/* Existing Examen Cruzado sections */}
        {category.timeExamenCruzadoFavor !== undefined && (
          <DebateTimerDisplay
            time={timerExamenFavorHook.time}
            isRunning={timerExamenFavorHook.isRunning}
            onStartPause={timerExamenFavorHook.startPause}
            onReset={timerExamenFavorHook.reset}
            settings={settings}
            baseBgColor="bg-soft-green" // Or a different color for examen
            positionName="Examen Cruzado (A favor)"
          />
        )}
        {category.timeExamenCruzadoContra !== undefined && (
          <DebateTimerDisplay
            time={timerExamenContraHook.time}
            isRunning={timerExamenContraHook.isRunning}
            onStartPause={timerExamenContraHook.startPause}
            onReset={timerExamenContraHook.reset}
            settings={settings}
            baseBgColor="bg-soft-red" // Or a different color for examen
            positionName="Examen Cruzado (En contra)"
          />
        )}
      </div>
    </div>
  );
};

export default CategoryCard;
