
import React from 'react';
import { Question } from '@/types/chronometer';
import { Button } from '@/components/ui/button';
import { AlertCircle, Circle, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

interface QuestionTrackerProps {
  questions: Question[];
  onQuestionToggle: (questionId: string) => void;
  onAddQuestion: () => void;
  maxQuestions?: number;
  position: 'favor' | 'contra';
  minQuestions?: number; // Add minQuestions prop
}

const MAX_QUESTIONS_DEFAULT = 15;

const QuestionTracker: React.FC<QuestionTrackerProps> = ({
  questions,
  onQuestionToggle,
  onAddQuestion,
  maxQuestions = MAX_QUESTIONS_DEFAULT,
  position,
  minQuestions = 0, // Default to 0 if not provided
}) => {
  const canAddQuestion = questions.length < maxQuestions;

  return (
    <div className="flex flex-col items-center space-y-2 p-2 rounded-lg">
      <p className="text-sm font-medium text-card-foreground">
        Preguntas: {questions.filter(q => q.answered).length} / {questions.length}
      </p>
      <div className={cn(
        "flex items-center space-x-1.5 flex-wrap justify-center",
        position === 'contra' ? 'flex-row-reverse space-x-reverse' : ''
      )}>
        <AnimatePresence>
          {questions.map((question, index) => (
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
                aria-pressed={question.answered}
                aria-label={index < minQuestions ? "Pregunta mínima" : `Pregunta ${index + 1} ${question.answered ? 'respondida' : 'no respondida'}`}
                className={cn(
                  "rounded-full h-6 w-6 p-0.5 transition-opacity duration-300",
                  question.answered ? "opacity-25" : "opacity-100",
                  "hover:bg-muted/50"
                )}
              >
                {index < minQuestions ? (
                  <AlertCircle className={cn(
                    "h-4 w-4",
                    question.answered ? "text-muted-foreground" : "fill-yellow-400 text-background"
                  )} />
                ) : (
                  <Circle className={cn(
                    "h-4 w-4",
                    question.answered ? "fill-current text-muted-foreground" : "text-primary"
                  )} />
                )}
              </Button>
            </motion.div>
          ))}
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
