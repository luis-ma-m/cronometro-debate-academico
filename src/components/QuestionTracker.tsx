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
import { Question } from '@/types/chronometer';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react'; // AlertCircle and Circle are now in StyledQuestionIcon
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import StyledQuestionIcon from './StyledQuestionIcon'; // Import the new component

interface QuestionTrackerProps {
  questions: Question[];
  onQuestionToggle: (questionId: string) => void;
  onAddQuestion: () => void;
  maxQuestions?: number;
  position: 'favor' | 'contra';
  minQuestions?: number;
}

const MAX_QUESTIONS_DEFAULT = 15;

const QuestionTracker: React.FC<QuestionTrackerProps> = ({
  questions,
  onQuestionToggle,
  onAddQuestion,
  maxQuestions = MAX_QUESTIONS_DEFAULT,
  position,
  minQuestions = 0,
}) => {
  const canAddQuestion = questions.length < maxQuestions;

  return (
    <div className="flex flex-col items-center space-y-2 p-2 rounded-lg"> {/* Ensured no specific background for transparency */}
      <p className="text-sm font-medium text-card-foreground">
        Preguntas: {questions.filter(q => q.answered).length} / {questions.length}
      </p>
      <div className={cn(
        "flex items-center space-x-1.5 flex-wrap justify-center",
        position === 'contra' ? 'flex-row-reverse space-x-reverse' : ''
      )}>
        <AnimatePresence>
          {questions.map((question, index) => {
            const isFilled = question.answered;
            const isMinQuestionContext = index < minQuestions; // Is this question part of the initial minimum set?
            const isAlertUnfilled = isMinQuestionContext && !isFilled; // Is it an unfilled minimum question (triggers alert style)?

            return (
              <motion.div
                key={question.id}
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.5 }}
                transition={{ duration: 0.2 }}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onQuestionToggle(question.id)}
                  aria-pressed={isFilled}
                  aria-label={
                    isAlertUnfilled 
                      ? "Pregunta mínima" 
                      : `Pregunta ${index + 1} ${isFilled ? 'respondida' : 'no respondida'}`
                  }
                  className={cn(
                    "rounded-full h-6 w-6 p-0.5 transition-opacity duration-300",
                    isFilled ? "opacity-25" : "opacity-100",
                    "hover:bg-muted/50"
                  )}
                >
                  <StyledQuestionIcon 
                    isFilled={isFilled} 
                    isAlertUnfilled={isAlertUnfilled} 
                  />
                </Button>
              </motion.div>
            );
          })}
        </AnimatePresence>
        {canAddQuestion && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onAddQuestion}
            aria-label="Añadir pregunta"
            className="rounded-full h-6 w-6 p-0.5 hover:bg-muted/50"
            disabled={!canAddQuestion}
          >
            <Plus className="h-4 w-4 text-primary" />
          </Button>
        )}
      </div>
      {questions.length === 0 && !canAddQuestion && (
         <p className="text-xs text-muted-foreground">Máximo de preguntas alcanzado.</p>
      )}
       {questions.length === 0 && canAddQuestion && (
         <p className="text-xs text-muted-foreground">Añade preguntas.</p>
      )}
    </div>
  );
};

export default QuestionTracker;
