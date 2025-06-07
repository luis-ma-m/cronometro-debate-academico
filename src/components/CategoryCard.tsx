/**
 * MIT License
 * Copyright (c) 2025 Luis Martín Maíllo
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 */

import React from 'react';
import { CategoryConfig, GlobalSettings, TimerUpdatePayload, PositionType, Question } from '@/types/chronometer';
import { useDebateTimer } from '@/hooks/useDebateTimer';
import DebateTimerDisplay from './DebateTimerDisplay';
import QuestionTracker from './QuestionTracker'; 
import { v4 as uuidv4 } from 'uuid'; // For generating question IDs

interface CategoryCardProps {
  category: CategoryConfig;
  settings: Pick<GlobalSettings, 'positiveWarningThreshold' | 'negativeWarningThreshold'>;
  onTimerUpdate: (payload: TimerUpdatePayload) => void;
  displayOnlyPosition?: PositionType;
  onQuestionUpdate: (categoryId: string, updatedQuestions: Question[]) => void;
}

const CategoryCard: React.FC<CategoryCardProps> = ({ 
  category, 
  settings, 
  onTimerUpdate,
  displayOnlyPosition,
  onQuestionUpdate
}) => {
  const timerFavorId = `${category.id}_favor`;
  const timerContraId = `${category.id}_contra`;
  const timerExamenFavorId = `${category.id}_examen_favor`;
  const timerExamenContraId = `${category.id}_examen_contra`;
  // const timerExamenIntroduccionId = `${category.id}_examen_introduccion`; // For 'introduccion' examen

  const timerFavorHook = useDebateTimer({ initialTime: category.timeFavor, timerId: timerFavorId, onUpdate: onTimerUpdate });
  const timerContraHook = useDebateTimer({ initialTime: category.timeContra, timerId: timerContraId, onUpdate: onTimerUpdate });
  
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

  React.useEffect(() => {
    timerFavorHook.setNewTime(category.timeFavor);
  }, [category.timeFavor]);

  React.useEffect(() => {
    timerContraHook.setNewTime(category.timeContra);
  }, [category.timeContra]);

  React.useEffect(() => {
    if (category.timeExamenCruzadoFavor !== undefined) {
      timerExamenFavorHook.setNewTime(category.timeExamenCruzadoFavor);
    }
  }, [category.timeExamenCruzadoFavor]);

  React.useEffect(() => {
    if (category.timeExamenCruzadoContra !== undefined) {
      timerExamenContraHook.setNewTime(category.timeExamenCruzadoContra);
    }
  }, [category.timeExamenCruzadoContra]);
  
  const handleQuestionToggle = (position: 'favor' | 'contra', questionId: string) => {
    // Note: Question state is per category, not per position (favor/contra) for refutations.
    // If questions were per-position, this logic would need adjustment.
    // For now, assuming `category.questions` is the single source of truth for this category's refutation.
    const currentQuestions = category.questions || [];
    const updatedQs = currentQuestions.map(q => 
      q.id === questionId ? {...q, answered: !q.answered } : q
    );
    onQuestionUpdate(category.id, updatedQs);
  };

  const handleAddQuestion = (position: 'favor' | 'contra') => {
    // Same note as above: questions are per-category.
    const currentQuestions = category.questions || [];
    if (currentQuestions.length < 15) { // Max 15 questions
      const newQuestion: Question = { id: uuidv4(), answered: false };
      onQuestionUpdate(category.id, [...currentQuestions, newQuestion]);
    }
  };

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
        if (category.type === 'introduccion' && category.hasExamenCruzado && category.timeExamenCruzadoFavor !== undefined) {
          timerData = timerExamenFavorHook;
          positionName = 'Examen Cruzado (A favor)';
          baseBg = 'bg-soft-green'; 
        }
        break;
      case 'examen_contra':
         if (category.type === 'introduccion' && category.hasExamenCruzado && category.timeExamenCruzadoContra !== undefined) {
          timerData = timerExamenContraHook;
          positionName = 'Examen Cruzado (En contra)';
          baseBg = 'bg-soft-red'; 
        }
        break;
    }

    if (timerData) {
      return (
        <div className="w-full flex flex-col items-center py-4">
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
        </div>
      );
    }
    return (
      <div className="text-center p-8 text-muted-foreground">
        Turno no disponible o no configurado para esta categoría.
      </div>
    );
  }

  // Fallback grid display
  return (
    <div className="bg-card p-4 md:p-6 rounded-lg shadow-md w-full">
      <h2 className="text-xl md:text-2xl font-bold mb-4 text-center text-card-foreground">
        {category.name} 
        <span className="text-sm font-normal ml-2 text-muted-foreground">
          ({category.type === 'introduccion' ? 'Introducción' : category.type === 'refutacion' ? 'Refutación' : 'Conclusión'})
        </span>
      </h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        <div className="flex flex-col space-y-2">
          <DebateTimerDisplay
            time={timerFavorHook.time}
            isRunning={timerFavorHook.isRunning}
            onStartPause={timerFavorHook.startPause}
            onReset={timerFavorHook.reset}
            settings={settings}
            baseBgColor="bg-soft-green"
            positionName="A favor"
          />
          {category.type === 'refutacion' && category.questions && (
            <QuestionTracker
              questions={category.questions}
              onQuestionToggle={(questionId) => handleQuestionToggle('favor', questionId)}
              onAddQuestion={() => handleAddQuestion('favor')}
              position="favor"
              // minQuestions is not passed here, so it defaults to 0.
              // This is for the grid view, which wasn't mentioned as problematic.
            />
          )}
        </div>
        <div className="flex flex-col space-y-2">
          <DebateTimerDisplay
            time={timerContraHook.time}
            isRunning={timerContraHook.isRunning}
            onStartPause={timerContraHook.startPause}
            onReset={timerContraHook.reset}
            settings={settings}
            baseBgColor="bg-soft-red"
            positionName="En contra"
          />
          {category.type === 'refutacion' && category.questions && (
            <QuestionTracker
              questions={category.questions}
              onQuestionToggle={(questionId) => handleQuestionToggle('contra', questionId)}
              onAddQuestion={() => handleAddQuestion('contra')}
              position="contra"
              // minQuestions is not passed here, so it defaults to 0.
              // This is for the grid view, which wasn't mentioned as problematic.
            />
          )}
        </div>

        {/* Examen Cruzado sections, only if type is 'introduccion' and hasExamenCruzado is true */}
        {category.type === 'introduccion' && category.hasExamenCruzado && category.timeExamenCruzadoFavor !== undefined && (
          <DebateTimerDisplay
            time={timerExamenFavorHook.time}
            isRunning={timerExamenFavorHook.isRunning}
            onStartPause={timerExamenFavorHook.startPause}
            onReset={timerExamenFavorHook.reset}
            settings={settings}
            baseBgColor="bg-blue-100" 
            positionName="Examen Cruzado (A favor)"
          />
        )}
        {category.type === 'introduccion' && category.hasExamenCruzado && category.timeExamenCruzadoContra !== undefined && (
          <DebateTimerDisplay
            time={timerExamenContraHook.time}
            isRunning={timerExamenContraHook.isRunning}
            onStartPause={timerExamenContraHook.startPause}
            onReset={timerExamenContraHook.reset}
            settings={settings}
            baseBgColor="bg-orange-100"
            positionName="Examen Cruzado (En contra)"
          />
        )}
      </div>
    </div>
  );
};

export default CategoryCard;
