
import React from 'react';
import { CategoryConfig, GlobalSettings, TimerUpdatePayload, PositionType, Question } from '@/types/chronometer';
import CategoryCard from './CategoryCard';

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

  return (
    <div className="w-full max-w-4xl mx-auto">
      <CategoryCard 
        category={category} 
        settings={settings} 
        onTimerUpdate={onTimerUpdate}
        displayOnlyPosition={activePositionType}
        onQuestionUpdate={onQuestionUpdate} // Pass down
      />
    </div>
  );
};

export default CategoryDetail;
