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
import { v4 as uuidv4 } from 'uuid';
import QuestionTracker from './QuestionTracker';

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

  // Handle timer updates (can be a no-op since we're using Zustand store)
  const handleTimerUpdate = (payload: TimerUpdatePayload) => {
    // Timer updates are now handled by the Zustand store
    console.log('Timer update:', payload);
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

  return (
    <div className="w-full max-w-4xl mx-auto">
      <CategoryCard 
        category={category} 
        settings={settings} 
        onTimerUpdate={handleTimerUpdate}
        displayOnlyPosition={activePositionType}
        onQuestionUpdate={onQuestionUpdate}
      />
      {renderQuestionTracker()}
    </div>
  );
};

export default CategoryDetail;
