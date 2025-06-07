
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
import { CategoryConfig, GlobalSettings, PositionType, Question, TimerUpdatePayload } from '@/types/chronometer';
import CategoryCard from './CategoryCard';
import TimerControl from './TimerControl';
import { v4 as uuidv4 } from 'uuid';
import QuestionTracker from './QuestionTracker';
import { useChronometerStore } from '@/stores/chronometerStore';

interface CategoryDetailProps {
  category: CategoryConfig;
  settings: GlobalSettings;
  activePositionType: PositionType | null;
  onQuestionUpdate: (categoryId: string, updatedQuestions: Question[]) => void;
}

const CategoryDetail: React.FC<CategoryDetailProps> = ({ 
  category, 
  settings, 
  activePositionType,
  onQuestionUpdate 
}) => {
  if (!category || !activePositionType) {
    return <div className="text-center p-8 text-muted-foreground">Selecciona un turno.</div>;
  }

  // Handle question toggle
  const handleQuestionToggle = (questionId: string) => {
    if (!category.questions) return;
    
    const updatedQuestions = category.questions.map(q => 
      q.id === questionId ? { ...q, answered: !q.answered } : q
    );
    
    onQuestionUpdate(category.id, updatedQuestions);
  };

  // Handle adding a new question
  const handleAddQuestion = () => {
    if (!category.questions) return;
    
    const newQuestion: Question = {
      id: uuidv4(),
      answered: false
    };
    
    onQuestionUpdate(category.id, [...category.questions, newQuestion]);
  };

  // Handle timer updates
  const updateTimerState = useChronometerStore(state => state.updateTimerState);

  const handleTimerUpdate = (payload: TimerUpdatePayload) => {
    updateTimerState(payload.id, {
      id: payload.id,
      currentTime: payload.currentTime,
      isRunning: payload.isRunning
    });
  };

  const renderQuestionTracker = () => {
    if (category.type !== 'refutacion' || !category.questions) return null;

    const isForContraPosition = activePositionType === 'contra';
    
    return (
      <div className="flex justify-center mb-4">
        <QuestionTracker 
          questions={category.questions} 
          onQuestionToggle={handleQuestionToggle} 
          onAddQuestion={handleAddQuestion}
          position={isForContraPosition ? 'contra' : 'favor'}
          minQuestions={category.minQuestions || 0}
        />
      </div>
    );
  };

  const renderSingleTimer = () => {
    let initialTime = 0;
    let positionName = '';
    let baseBgColor = '';

    switch (activePositionType) {
      case 'favor':
        initialTime = category.timeFavor;
        positionName = 'A favor';
        baseBgColor = 'bg-soft-green';
        break;
      case 'contra':
        initialTime = category.timeContra;
        positionName = 'En contra';
        baseBgColor = 'bg-soft-red';
        break;
      case 'examen_favor':
        if (category.type === 'introduccion' && category.hasExamenCruzado && category.timeExamenCruzadoFavor !== undefined) {
          initialTime = category.timeExamenCruzadoFavor;
          positionName = 'Examen Cruzado (A favor)';
          baseBgColor = 'bg-soft-green';
        } else {
          return (
            <div className="text-center p-8 text-muted-foreground">
              Examen Cruzado no disponible para esta categoría.
            </div>
          );
        }
        break;
      case 'examen_contra':
        if (category.type === 'introduccion' && category.hasExamenCruzado && category.timeExamenCruzadoContra !== undefined) {
          initialTime = category.timeExamenCruzadoContra;
          positionName = 'Examen Cruzado (En contra)';
          baseBgColor = 'bg-soft-red';
        } else {
          return (
            <div className="text-center p-8 text-muted-foreground">
              Examen Cruzado no disponible para esta categoría.
            </div>
          );
        }
        break;
      default:
        return (
          <div className="text-center p-8 text-muted-foreground">
            Turno no disponible.
          </div>
        );
    }

    return (
      <div className="w-full flex flex-col items-center py-4">
        <TimerControl
          initialTime={initialTime}
          categoryId={category.id}
          position={activePositionType}
          settings={settings}
          baseBgColor={baseBgColor}
          positionName={positionName}
          size="large"
        />
      </div>
    );
  };

  return (
    <div className="w-full max-w-4xl mx-auto">
      {renderSingleTimer()}
      {renderQuestionTracker()}
    </div>
  );
};

export default CategoryDetail;
