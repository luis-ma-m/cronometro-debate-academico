
import React from 'react';
import { CategoryConfig, GlobalSettings, TimerUpdatePayload, PositionType } from '@/types/chronometer';
import CategoryCard from './CategoryCard';

interface CategoryDetailProps {
  category: CategoryConfig;
  settings: GlobalSettings;
  onTimerUpdate: (payload: TimerUpdatePayload) => void;
  activePositionType: PositionType | null; // New prop
}

const CategoryDetail: React.FC<CategoryDetailProps> = ({ 
  category, 
  settings, 
  onTimerUpdate, 
  activePositionType 
}) => {
  // CategoryDetail now expects activePositionType to be set if it's rendered for main display
  if (!category || !activePositionType) {
    // This case should ideally be handled by DebateChronometerPage's logic
    // (i.e., not rendering CategoryDetail if activePositionType is null)
    return <div className="text-center p-8 text-muted-foreground">Selecciona un turno.</div>;
  }

  return (
    <div className="w-full max-w-4xl mx-auto">
      <CategoryCard 
        category={category} 
        settings={settings} 
        onTimerUpdate={onTimerUpdate}
        displayOnlyPosition={activePositionType} // Pass the active position
      />
    </div>
  );
};

export default CategoryDetail;
