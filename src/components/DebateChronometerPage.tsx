import React, { useState, useCallback, useMemo } from 'react';
import ChronometerHeader from './ChronometerHeader';
import CategoryNavigation from './CategoryNavigation';
import CategoryDetail from './CategoryDetail';
import PositionNavigation from './PositionNavigation';
import ExamenCruzadoNavigation from './ExamenCruzadoNavigation';
import { CategoryConfig, GlobalSettings, TimerInstance, TimerUpdatePayload, PositionType } from '@/types/chronometer';
import { Button } from '@/components/ui/button';
import { Settings, ListChecks } from 'lucide-react';
import ConfigurationModal from './ConfigurationModal';
import SummaryModal from './SummaryModal';

// Initial Data
const initialCategoriesData: CategoryConfig[] = [
  { id: 'intro', name: 'Introducción', timeFavor: 4 * 60, timeContra: 4 * 60, timeExamenCruzadoFavor: 1.5 * 60, timeExamenCruzadoContra: 1.5 * 60 },
  { id: 'ref1', name: 'Refutación 1', timeFavor: 5 * 60, timeContra: 5 * 60 },
  { id: 'ref2', name: 'Refutación 2', timeFavor: 5 * 60, timeContra: 5 * 60 },
  { id: 'conclu', name: 'Conclusión', timeFavor: 3 * 60, timeContra: 3 * 60 },
];

const initialGlobalSettings: GlobalSettings = {
  logoUrl: '/lovable-uploads/a017ffca-3321-45a7-8261-0d6e2de79a5b.png', // Using uploaded image as default logo
  h1Text: 'Debate Académico',
  positiveWarningThreshold: 30, // seconds
  negativeWarningThreshold: -30, // seconds
};

const DebateChronometerPage: React.FC = () => {
  const [categories, setCategories] = useState<CategoryConfig[]>(initialCategoriesData);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings>(initialGlobalSettings);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [activePositionType, setActivePositionType] = useState<PositionType | null>(null);

  // State to hold all timer snapshots
  const [timerStates, setTimerStates] = useState<Record<string, TimerInstance>>({});

  const handleTimerUpdate = useCallback((payload: TimerUpdatePayload) => {
    setTimerStates(prev => {
      const parts = payload.id.split('_');
      const categoryId = parts[0];
      // Handles 'favor', 'contra', 'examen_favor', 'examen_contra'
      const positionSuffix = parts.slice(1).join('_') as PositionType; 
      
      const category = categories.find(c => c.id === categoryId);
      if (!category) {
        console.warn(`Category not found for timer update: ${payload.id}`);
        return prev;
      }
      
      let initialTime: number;
      switch (positionSuffix) {
        case 'favor':
          initialTime = category.timeFavor;
          break;
        case 'contra':
          initialTime = category.timeContra;
          break;
        case 'examen_favor':
          initialTime = category.timeExamenCruzadoFavor ?? 0;
          break;
        case 'examen_contra':
          initialTime = category.timeExamenCruzadoContra ?? 0;
          break;
        default:
          console.warn(`Could not determine initial time for ${payload.id}`);
          initialTime = 0;
      }

      return {
        ...prev,
        [payload.id]: { 
          ...payload, 
          categoryId, 
          positionId: positionSuffix, 
          initialTime 
        }
      };
    });
  }, [categories]);
  
  const handleSelectCategory = (categoryId: string) => {
    setActiveCategoryId(categoryId);
    setActivePositionType(null);
  };

  const handleSettingsSave = (newCategories: CategoryConfig[], newGlobalSettings: GlobalSettings) => {
    setCategories(newCategories);
    setGlobalSettings(newGlobalSettings);
    
    if (activeCategoryId && !newCategories.find(cat => cat.id === activeCategoryId)) {
      setActiveCategoryId(null);
      setActivePositionType(null);
    }
    const currentActiveCat = newCategories.find(cat => cat.id === activeCategoryId);
    if (currentActiveCat && currentActiveCat.timeExamenCruzadoFavor === undefined && 
        (activePositionType === 'examen_favor' || activePositionType === 'examen_contra')) {
        setActivePositionType(null);
    }
  };

  const summaryData = useMemo(() => {
    return categories.map(cat => {
      const catTimers: TimerInstance[] = [];
      
      // Favor and Contra are always present conceptually
      if (timerStates[`${cat.id}_favor`]) catTimers.push(timerStates[`${cat.id}_favor`]);
      if (timerStates[`${cat.id}_contra`]) catTimers.push(timerStates[`${cat.id}_contra`]);
      
      // Examen Cruzado timers (only if they exist in timerStates, implying they were initialized)
      if (cat.timeExamenCruzadoFavor !== undefined && timerStates[`${cat.id}_examen_favor`]) {
        catTimers.push(timerStates[`${cat.id}_examen_favor`]);
      }
      if (cat.timeExamenCruzadoContra !== undefined && timerStates[`${cat.id}_examen_contra`]) {
        catTimers.push(timerStates[`${cat.id}_examen_contra`]);
      }
      
      return {
        categoryName: cat.name,
        timers: catTimers.filter(Boolean)
      };
    });
  }, [categories, timerStates]);

  const activeCategoryData = useMemo(() => {
    return categories.find(cat => cat.id === activeCategoryId) || null;
  }, [categories, activeCategoryId]);

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
      <div className="container mx-auto">
        <ChronometerHeader logoUrl={globalSettings.logoUrl} h1Text={globalSettings.h1Text} />

        <CategoryNavigation 
          categories={categories}
          activeCategory={activeCategoryId}
          onSelectCategory={handleSelectCategory}
        />

        {activeCategoryData && (
          <div className="mt-2 mb-4">
            <PositionNavigation
              activeCategory={activeCategoryData}
              activePositionType={activePositionType}
              onSelectPosition={setActivePositionType}
            />
            {activeCategoryData.timeExamenCruzadoFavor !== undefined && activeCategoryData.timeExamenCruzadoContra !== undefined && (
              <ExamenCruzadoNavigation
                activeCategory={activeCategoryData}
                activePositionType={activePositionType}
                onSelectPosition={setActivePositionType}
              />
            )}
          </div>
        )}

        <main className="mt-6">
          {activeCategoryData && activePositionType ? (
            <CategoryDetail 
              category={activeCategoryData}
              settings={globalSettings}
              onTimerUpdate={handleTimerUpdate}
              activePositionType={activePositionType}
            />
          ) : activeCategoryData && !activePositionType ? (
            <div className="text-center p-12 bg-card/80 rounded-lg shadow">
              <p className="text-lg text-card-foreground">Selecciona un turno para visualizar el cronómetro.</p>
            </div>
          ) : (
            <div className="text-center p-12 bg-card/80 rounded-lg shadow">
              <p className="text-lg text-card-foreground">Selecciona una categoría para comenzar.</p>
            </div>
          )}
        </main>

        <footer className="mt-12 flex justify-center md:justify-end space-x-4 py-4">
          <Button variant="outline" onClick={() => setIsSummaryModalOpen(true)}>
            <ListChecks className="mr-2 h-5 w-5" />
            Resumen
          </Button>
          <Button variant="outline" onClick={() => setIsConfigModalOpen(true)}>
            <Settings className="mr-2 h-5 w-5" />
            Configuración
          </Button>
        </footer>
      </div>

      <ConfigurationModal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
        currentCategories={categories}
        currentSettings={globalSettings}
        onSave={handleSettingsSave}
      />

      <SummaryModal
        isOpen={isSummaryModalOpen}
        onClose={() => setIsSummaryModalOpen(false)}
        summaryData={summaryData}
      />
    </div>
  );
};

export default DebateChronometerPage;
