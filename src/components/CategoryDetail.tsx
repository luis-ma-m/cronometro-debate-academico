
import React from 'react';
import { CategoryConfig, GlobalSettings, TimerUpdatePayload } from '@/types/chronometer';
import CategoryCard from './CategoryCard';

interface CategoryDetailProps {
  category: CategoryConfig;
  settings: GlobalSettings;
  onTimerUpdate: (payload: TimerUpdatePayload) => void;
}

const CategoryDetail: React.FC<CategoryDetailProps> = ({ category, settings, onTimerUpdate }) => {
  if (!category) {
    return <div className="text-center p-8">Selecciona una categoría</div>;
  }

  return (
    <div className="w-full max-w-4xl mx-auto">
      <CategoryCard 
        category={category} 
        settings={settings} 
        onTimerUpdate={onTimerUpdate}
      />
    </div>
  );
};

export default CategoryDetail;
