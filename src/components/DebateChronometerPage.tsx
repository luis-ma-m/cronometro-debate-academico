import React, { useState, useCallback, useMemo } from 'react';
import ChronometerHeader from './ChronometerHeader';
import CategoryNavigation from './CategoryNavigation';
import CategoryDetail from './CategoryDetail';
import PositionNavigation from './PositionNavigation';
import ExamenCruzadoNavigation from './ExamenCruzadoNavigation';
import { CategoryConfig, GlobalSettings, TimerInstance, TimerUpdatePayload, PositionType, Question } from '@/types/chronometer';
import { Button } from '@/components/ui/button';
import { Settings, ListChecks } from 'lucide-react';
import ConfigurationModal from './ConfigurationModal';
import SummaryModal from './SummaryModal';
import { v4 as uuidv4 } from 'uuid';

// Initial Data with new types and fields
const initialCategoriesData: CategoryConfig[] = [
  { 
    id: 'intro', name: 'Introducción', 
    timeFavor: 4 * 60, timeContra: 4 * 60, 
    type: 'introduccion', 
    hasExamenCruzado: true, // Example: Introductions can have their special Examen Cruzado
    // These are the old examen cruzado times, keep them if relevant to the debate format
    timeExamenCruzadoFavor: 1.5 * 60, 
    timeExamenCruzadoContra: 1.5 * 60,
    examenCruzadoIntroduccionUsed: false, // Initialize this
  },
  { 
    id: 'ref1', name: 'Refutación 1', 
    timeFavor: 5 * 60, timeContra: 5 * 60, 
    type: 'refutacion', 
    minQuestions: 2, // Example
    questions: Array.from({ length: 2 }, () => ({ id: uuidv4(), answered: false })) // Initialize with actual questions
  },
  { 
    id: 'ref2', name: 'Refutación 2', 
    timeFavor: 5 * 60, timeContra: 5 * 60, 
    type: 'refutacion', 
    minQuestions: 1, // Example
    questions: Array.from({ length: 1 }, () => ({ id: uuidv4(), answered: false })) // Initialize
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
  const [categories, setCategories] = useState<CategoryConfig[]>(() =>
    initialCategoriesData.map(cat => {
      const baseCat = { ...cat };
      if (!baseCat.type) baseCat.type = 'conclusion';

      if (baseCat.type === 'introduccion') {
        baseCat.hasExamenCruzado = typeof baseCat.hasExamenCruzado === 'boolean' ? baseCat.hasExamenCruzado : false;
        baseCat.examenCruzadoIntroduccionUsed = typeof baseCat.examenCruzadoIntroduccionUsed === 'boolean' ? baseCat.examenCruzadoIntroduccionUsed : false;
        if (!baseCat.hasExamenCruzado) { // If not allowed, times should not exist
            delete baseCat.timeExamenCruzadoFavor;
            delete baseCat.timeExamenCruzadoContra;
        }
      } else {
        delete baseCat.hasExamenCruzado;
        delete baseCat.timeExamenCruzadoFavor;
        delete baseCat.timeExamenCruzadoContra;
        delete baseCat.examenCruzadoIntroduccionUsed;
      }

      if (baseCat.type === 'refutacion') {
        baseCat.minQuestions = typeof baseCat.minQuestions === 'number' ? baseCat.minQuestions : 0;
        baseCat.questions = Array.isArray(baseCat.questions) 
          ? baseCat.questions 
          : Array.from({ length: baseCat.minQuestions || 0 }, () => ({ id: uuidv4(), answered: false }));
      } else {
        delete baseCat.minQuestions;
        delete baseCat.questions;
      }
      return baseCat;
    })
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
      // Reconstruct positionSuffix more robustly for multi-word suffixes like 'examen_favor'
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
        case 'examen_favor': // This is the Examen Cruzado for Introduccion (Favor side)
          initialTime = (category.type === 'introduccion' && category.hasExamenCruzado) ? category.timeExamenCruzadoFavor ?? 0 : 0;
          break;
        case 'examen_contra': // This is the Examen Cruzado for Introduccion (Contra side)
          initialTime = (category.type === 'introduccion' && category.hasExamenCruzado) ? category.timeExamenCruzadoContra ?? 0 : 0;
          break;
        case 'examen_introduccion': // This is the SPECIAL Examen Cruzado for 'introduccion' type
                                    // Its time is derived from main speech time (timeFavor/timeContra)
                                    // This timer needs to be explicitly created and managed if it's separate.
                                    // For now, assuming it might use timeFavor or timeContra if not separately defined.
                                    // The prompt says "same duration", so it would be category.timeFavor or category.timeContra
                                    // This part requires further clarification on how 'examen_introduccion' timer is distinct from 'examen_favor'/'examen_contra' for introduction.
                                    // For now, let's assume it's covered by the above or needs a dedicated timer in CategoryCard.
                                    // If 'examen_introduccion' refers to the favor/contra speech itself when examen is active, no new timer.
                                    // If it's a THIRD timer for 'introduccion', it needs definition.
                                    // Let's assume it's not a separate timer instance for now beyond the togglable ones.
          initialTime = 0; // Placeholder - this type needs full implementation if it's a distinct timer.
          console.warn(`'examen_introduccion' timer type initial time determination needs review.`);
          break;
        default:
          console.warn(`Could not determine initial time for ${payload.id} with position ${positionSuffix}`);
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
    setActivePositionType(null); // Reset position when category changes
  };

  const handleSettingsSave = (newCategories: CategoryConfig[], newGlobalSettings: GlobalSettings) => {
    const processedNewCategories = newCategories.map(cat => {
      const CATTEMP: CategoryConfig = { ...cat };
      if (!CATTEMP.type) CATTEMP.type = 'conclusion';

      if (CATTEMP.type === 'introduccion') {
        CATTEMP.hasExamenCruzado = typeof CATTEMP.hasExamenCruzado === 'boolean' ? CATTEMP.hasExamenCruzado : false;
        CATTEMP.examenCruzadoIntroduccionUsed = typeof CATTEMP.examenCruzadoIntroduccionUsed === 'boolean' ? CATTEMP.examenCruzadoIntroduccionUsed : false;
        if (!CATTEMP.hasExamenCruzado) {
          delete CATTEMP.timeExamenCruzadoFavor;
          delete CATTEMP.timeExamenCruzadoContra;
        }
      } else {
        delete CATTEMP.hasExamenCruzado;
        delete CATTEMP.timeExamenCruzadoFavor;
        delete CATTEMP.timeExamenCruzadoContra;
        delete CATTEMP.examenCruzadoIntroduccionUsed;
      }

      if (CATTEMP.type === 'refutacion') {
        CATTEMP.minQuestions = typeof CATTEMP.minQuestions === 'number' ? CATTEMP.minQuestions : 0;
        CATTEMP.questions = Array.isArray(CATTEMP.questions) 
        ? CATTEMP.questions 
        : Array.from({ length: CATTEMP.minQuestions || 0 }, () => ({ id: uuidv4(), answered: false }));

      } else {
        delete CATTEMP.minQuestions;
        delete CATTEMP.questions;
      }
      return CATTEMP;
    });
    
    setCategories(processedNewCategories);
    setGlobalSettings(newGlobalSettings);
    
    // Logic to reset active selections if they become invalid after save
    if (activeCategoryId && !processedNewCategories.find(cat => cat.id === activeCategoryId)) {
      setActiveCategoryId(null);
      setActivePositionType(null);
    } else if (activeCategoryId && activePositionType) {
        const currentActiveCat = processedNewCategories.find(cat => cat.id === activeCategoryId);
        if (currentActiveCat) {
            let positionStillValid = true;
            // Check if the current activePositionType is still valid for the category
            if (activePositionType === 'examen_favor' || activePositionType === 'examen_contra') {
                if (currentActiveCat.type !== 'introduccion' || !currentActiveCat.hasExamenCruzado) {
                    positionStillValid = false;
                } else if (activePositionType === 'examen_favor' && currentActiveCat.timeExamenCruzadoFavor === undefined) {
                    positionStillValid = false;
                } else if (activePositionType === 'examen_contra' && currentActiveCat.timeExamenCruzadoContra === undefined) {
                    positionStillValid = false;
                }
            }
            // Add checks for 'examen_introduccion' if it becomes a distinct selectable position
            // e.g., if (activePositionType === 'examen_introduccion' && (currentActiveCat.type !== 'introduccion' || !currentActiveCat.hasExamenCruzado)) { ... }
            
            if (!positionStillValid) {
                setActivePositionType(null);
            }
        } else { // Active category somehow disappeared
             setActiveCategoryId(null);
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
  }, []);

  const summaryData = useMemo(() => {
    return categories.map(cat => {
      const catTimers: TimerInstance[] = [];
      
      if (timerStates[`${cat.id}_favor`]) catTimers.push(timerStates[`${cat.id}_favor`]);
      if (timerStates[`${cat.id}_contra`]) catTimers.push(timerStates[`${cat.id}_contra`]);
      
      // For 'introduccion' with Examen Cruzado enabled
      if (cat.type === 'introduccion' && cat.hasExamenCruzado) {
        if (cat.timeExamenCruzadoFavor !== undefined && timerStates[`${cat.id}_examen_favor`]) {
          catTimers.push(timerStates[`${cat.id}_examen_favor`]);
        }
        if (cat.timeExamenCruzadoContra !== undefined && timerStates[`${cat.id}_examen_contra`]) {
          catTimers.push(timerStates[`${cat.id}_examen_contra`]);
        }
      }
      // Add logic for a dedicated 'examen_introduccion' timer if it's tracked and distinct
      // if (cat.type === 'introduccion' && cat.hasExamenCruzado && timerStates[`${cat.id}_examen_introduccion`]) {
      //   catTimers.push(timerStates[`${cat.id}_examen_introduccion`]);
      // }
      
      return {
        categoryName: cat.name,
        categoryType: cat.type,
        questions: cat.type === 'refutacion' ? cat.questions : undefined,
        minQuestions: cat.type === 'refutacion' ? cat.minQuestions : undefined,
        hasExamenCruzado: cat.type === 'introduccion' ? cat.hasExamenCruzado : undefined,
        examenCruzadoIntroduccionUsed: cat.type === 'introduccion' ? cat.examenCruzadoIntroduccionUsed : undefined, // For summary display
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
            {/* This ExamenCruzadoNavigation is for the specific cross-examination timers 
                that are part of an 'introduccion' category if `hasExamenCruzado` is true
                AND if times are defined for them.
            */}
            {activeCategoryData.type === 'introduccion' && activeCategoryData.hasExamenCruzado &&
             (activeCategoryData.timeExamenCruzadoFavor !== undefined || activeCategoryData.timeExamenCruzadoContra !== undefined) && (
              <ExamenCruzadoNavigation // This component might need renaming or repurposing
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
              onQuestionUpdate={handleQuestionUpdate}
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
