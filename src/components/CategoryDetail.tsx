import React from 'react';
import { CategoryConfig, GlobalSettings, TimerUpdatePayload, PositionType, Question } from '@/types/chronometer';
import CategoryCard from './CategoryCard';
import { v4 as uuidv4 } from 'uuid';
import QuestionTracker from './QuestionTracker';

interface CategoryDetailProps {
  category: CategoryConfig;
  settings: GlobalSettings;
  onTimerUpdate: (payload: TimerUpdatePayload) => void;
  activePositionType: PositionType | null;
  onQuestionUpdate: (categoryId: string, updatedQuestions: Question[]) => void; // New prop
}

const CategoryDetail: React.FC<CategoryDetailProps> = ({ 
  category, 
  settings, 
  onTimerUpdate, 
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
        onTimerUpdate={onTimerUpdate}
        displayOnlyPosition={activePositionType}
        onQuestionUpdate={onQuestionUpdate} // Pass down
      />
      {renderQuestionTracker()}
    </div>
  );
};

export default CategoryDetail;
