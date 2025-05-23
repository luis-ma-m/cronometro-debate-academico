import React, { useState, useCallback, useMemo } from 'react';
import ChronometerHeader from './ChronometerHeader';
import CategoryNavigation from './CategoryNavigation';
import CategoryDetail from './CategoryDetail';
import PositionNavigation from './PositionNavigation';
import ExamenCruzadoNavigation from './ExamenCruzadoNavigation';
import { CategoryConfig, GlobalSettings, TimerInstance, TimerUpdatePayload, PositionType, CategoryType, Question } from '@/types/chronometer';
import { Button } from '@/components/ui/button';
import { Settings, ListChecks } from 'lucide-react';
import ConfigurationModal from './ConfigurationModal';
import SummaryModal from './SummaryModal';

// Initial Data with new types and fields
const initialCategoriesData: CategoryConfig[] = [
  { 
    id: 'intro', name: 'Introducción', 
    timeFavor: 4 * 60, timeContra: 4 * 60, 
    type: 'introduccion', 
    hasExamenCruzado: true, // Example: Introductions can have their special Examen Cruzado
    // These are the old examen cruzado times, keep them if relevant to the debate format
    timeExamenCruzadoFavor: 1.5 * 60, 
    timeExamenCruzadoContra: 1.5 * 60 
  },
  { 
    id: 'ref1', name: 'Refutación 1', 
    timeFavor: 5 * 60, timeContra: 5 * 60, 
    type: 'refutacion', 
    minQuestions: 2, // Example
    questions: [] 
  },
  { 
    id: 'ref2', name: 'Refutación 2', 
    timeFavor: 5 * 60, timeContra: 5 * 60, 
    type: 'refutacion', 
    minQuestions: 1, // Example
    questions: [] 
  },
  { 
    id: 'conclu', name: 'Conclusión', 
    timeFavor: 3 * 60, timeContra: 3 * 60, 
    type: 'conclusion' 
  },
];

const initialGlobalSettings: GlobalSettings = {
  logoUrl: '/lovable-uploads/a017ffca-3321-45a7-8261-0d6e2de79a5b.png',
  h1Text: 'Debate Académico',
  positiveWarningThreshold: 30,
  negativeWarningThreshold: -30,
};

const DebateChronometerPage: React.FC = () => {
  const [categories, setCategories] = useState<CategoryConfig[]>(
    // Process initial data to ensure all fields are present
    initialCategoriesData.map(cat => ({
      ...cat,
      type: cat.type || 'conclusion', // Default type
      questions: cat.type === 'refutacion' ? cat.questions || [] : undefined,
      minQuestions: cat.type === 'refutacion' ? cat.minQuestions || 0 : undefined,
      hasExamenCruzado: cat.type === 'introduccion' ? cat.hasExamenCruzado || false : undefined,
      examenCruzadoIntroduccionUsed: cat.type === 'introduccion' ? cat.examenCruzadoIntroduccionUsed || false : undefined,
    }))
  );
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings>(initialGlobalSettings);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [activePositionType, setActivePositionType] = useState<PositionType | null>(null);
  const [timerStates, setTimerStates] = useState<Record<string, TimerInstance>>({});

  const handleTimerUpdate = useCallback((payload: TimerUpdatePayload) => {
    setTimerStates(prev => {
      const parts = payload.id.split('_');
      const categoryId = parts[0];
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
        // Case for 'examen_introduccion' will be handled when that timer is implemented
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
    // Ensure new categories have all necessary fields properly initialized
    const processedNewCategories = newCategories.map(cat => {
      const CATTEMP = { ...cat }; // Create a mutable copy
      if (!CATTEMP.type) CATTEMP.type = 'conclusion';
      if (CATTEMP.type === 'introduccion') {
        if (CATTEMP.hasExamenCruzado === undefined) CATTEMP.hasExamenCruzado = false;
        if (CATTEMP.examenCruzadoIntroduccionUsed === undefined) CATTEMP.examenCruzadoIntroduccionUsed = false;
      } else {
        delete CATTEMP.hasExamenCruzado;
        delete CATTEMP.examenCruzadoIntroduccionUsed;
      }
      if (CATTEMP.type === 'refutacion') {
        if (CATTEMP.minQuestions === undefined) CATTEMP.minQuestions = 0;
        if (!CATTEMP.questions) CATTEMP.questions = [];
      } else {
        delete CATTEMP.minQuestions;
        delete CATTEMP.questions;
      }
      return CATTEMP;
    });
    
    setCategories(processedNewCategories);
    setGlobalSettings(newGlobalSettings);
    
    if (activeCategoryId && !processedNewCategories.find(cat => cat.id === activeCategoryId)) {
      setActiveCategoryId(null);
      setActivePositionType(null);
    }
    const currentActiveCat = processedNewCategories.find(cat => cat.id === activeCategoryId);
    // This condition for resetting activePositionType needs review with new category types
    if (currentActiveCat) {
        // If the active category is 'introduccion' but no longer hasExamenCruzado,
        // and current activePosition is for its special examen, reset.
        if (currentActiveCat.type === 'introduccion' && !currentActiveCat.hasExamenCruzado && activePositionType === 'examen_introduccion') {
             setActivePositionType(null);
        }
        // If the category no longer has the old examen_favor/contra times defined
        if (currentActiveCat.timeExamenCruzadoFavor === undefined && activePositionType === 'examen_favor') {
            setActivePositionType(null);
        }
        if (currentActiveCat.timeExamenCruzadoContra === undefined && activePositionType === 'examen_contra') {
            setActivePositionType(null);
        }
    }
  };
  
  const handleQuestionUpdate = useCallback((categoryId: string, updatedQuestions: Question[]) => {
    setCategories(prevCategories => 
      prevCategories.map(cat => 
        cat.id === categoryId ? { ...cat, questions: updatedQuestions } : cat
      )
    );
    // Here you might want to also update timerStates or trigger a save to localStorage if implemented
  }, []);

  const summaryData = useMemo(() => {
    return categories.map(cat => {
      const catTimers: TimerInstance[] = [];
      
      if (timerStates[`${cat.id}_favor`]) catTimers.push(timerStates[`${cat.id}_favor`]);
      if (timerStates[`${cat.id}_contra`]) catTimers.push(timerStates[`${cat.id}_contra`]);
      
      if (cat.timeExamenCruzadoFavor !== undefined && timerStates[`${cat.id}_examen_favor`]) {
        catTimers.push(timerStates[`${cat.id}_examen_favor`]);
      }
      if (cat.timeExamenCruzadoContra !== undefined && timerStates[`${cat.id}_examen_contra`]) {
        catTimers.push(timerStates[`${cat.id}_examen_contra`]);
      }
      // Add logic for examen_introduccion timer if it's tracked in timerStates
      if (cat.type === 'introduccion' && cat.hasExamenCruzado && timerStates[`${cat.id}_examen_introduccion`]) {
        catTimers.push(timerStates[`${cat.id}_examen_introduccion`]);
      }
      
      return {
        categoryName: cat.name,
        categoryType: cat.type, // For summary modal logic
        questions: cat.type === 'refutacion' ? cat.questions : undefined,
        minQuestions: cat.type === 'refutacion' ? cat.minQuestions : undefined,
        examenCruzadoIntroduccionUsed: cat.type === 'introduccion' ? cat.examenCruzadoIntroduccionUsed : undefined,
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
            {/* The existing ExamenCruzadoNavigation is for the optional Favor/Contra cross-examination times */}
            {/* This should only show if these times are defined, regardless of category type */}
            {(activeCategoryData.timeExamenCruzadoFavor !== undefined || activeCategoryData.timeExamenCruzadoContra !== undefined) && (
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
              onQuestionUpdate={handleQuestionUpdate} // Pass down question update handler
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
