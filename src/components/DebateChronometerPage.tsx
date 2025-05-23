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

const DEFAULT_LOGO_URL = 'https://aduma.es/wp-content/uploads/2021/09/Logo-ADUMA-Completo.png';

// Initial Data with new types and fields
const initialCategoriesData: CategoryConfig[] = [
  { 
    id: 'intro', name: 'Introducción', 
    timeFavor: 4 * 60, timeContra: 4 * 60, 
    type: 'introduccion', 
    hasExamenCruzado: true,
    timeExamenCruzadoFavor: 1.5 * 60, 
    timeExamenCruzadoContra: 1.5 * 60,
    examenCruzadoIntroduccionUsed: false,
  },
  { 
    id: 'ref1', name: 'Refutación 1', 
    timeFavor: 5 * 60, timeContra: 5 * 60, 
    type: 'refutacion', 
    minQuestions: 2,
    questions: Array.from({ length: 2 }, () => ({ id: uuidv4(), answered: false }))
  },
  { 
    id: 'ref2', name: 'Refutación 2', 
    timeFavor: 5 * 60, timeContra: 5 * 60, 
    type: 'refutacion', 
    minQuestions: 1,
    questions: Array.from({ length: 1 }, () => ({ id: uuidv4(), answered: false }))
  },
  { 
    id: 'conclu', name: 'Conclusión', 
    timeFavor: 3 * 60, timeContra: 3 * 60, 
    type: 'conclusion' 
  },
];

const initialGlobalSettings: GlobalSettings = {
  logoUrl: DEFAULT_LOGO_URL,
  h1Text: 'Debate Académico',
  positiveWarningThreshold: 10, // Updated to 10
  negativeWarningThreshold: -10, // Updated to -10
};

const DebateChronometerPage: React.FC = () => {
  const [categories, setCategories] = useState<CategoryConfig[]>(() =>
    initialCategoriesData.map(cat => {
      const baseCat = { ...cat };
      if (!baseCat.type) baseCat.type = 'conclusion';

      if (baseCat.type === 'introduccion') {
        baseCat.hasExamenCruzado = typeof baseCat.hasExamenCruzado === 'boolean' ? baseCat.hasExamenCruzado : false;
        baseCat.examenCruzadoIntroduccionUsed = typeof baseCat.examenCruzadoIntroduccionUsed === 'boolean' ? baseCat.examenCruzadoIntroduccionUsed : false;
        if (!baseCat.hasExamenCruzado) {
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
          initialTime = (category.type === 'introduccion' && category.hasExamenCruzado) ? category.timeExamenCruzadoFavor ?? 0 : 0;
          break;
        case 'examen_contra':
          initialTime = (category.type === 'introduccion' && category.hasExamenCruzado) ? category.timeExamenCruzadoContra ?? 0 : 0;
          break;
        case 'examen_introduccion':
          initialTime = 0; 
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
    setActivePositionType(null); 
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
    
    if (activeCategoryId && !processedNewCategories.find(cat => cat.id === activeCategoryId)) {
      setActiveCategoryId(null);
      setActivePositionType(null);
    } else if (activeCategoryId && activePositionType) {
        const currentActiveCat = processedNewCategories.find(cat => cat.id === activeCategoryId);
        if (currentActiveCat) {
            let positionStillValid = true;
            if (activePositionType === 'examen_favor' || activePositionType === 'examen_contra') {
                if (currentActiveCat.type !== 'introduccion' || !currentActiveCat.hasExamenCruzado) {
                    positionStillValid = false;
                } else if (activePositionType === 'examen_favor' && currentActiveCat.timeExamenCruzadoFavor === undefined) {
                    positionStillValid = false;
                } else if (activePositionType === 'examen_contra' && currentActiveCat.timeExamenCruzadoContra === undefined) {
                    positionStillValid = false;
                }
            }
            
            if (!positionStillValid) {
                setActivePositionType(null);
            }
        } else { 
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
      
      if (cat.type === 'introduccion' && cat.hasExamenCruzado) {
        if (cat.timeExamenCruzadoFavor !== undefined && timerStates[`${cat.id}_examen_favor`]) {
          catTimers.push(timerStates[`${cat.id}_examen_favor`]);
        }
        if (cat.timeExamenCruzadoContra !== undefined && timerStates[`${cat.id}_examen_contra`]) {
          catTimers.push(timerStates[`${cat.id}_examen_contra`]);
        }
      }
      
      return {
        categoryId: cat.id, // Added categoryId
        categoryName: cat.name,
        categoryType: cat.type,
        questions: cat.type === 'refutacion' ? cat.questions : undefined,
        minQuestions: cat.type === 'refutacion' ? cat.minQuestions : undefined,
        hasExamenCruzado: cat.type === 'introduccion' ? cat.hasExamenCruzado : undefined,
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
            {activeCategoryData.type === 'introduccion' && activeCategoryData.hasExamenCruzado &&
             (activeCategoryData.timeExamenCruzadoFavor !== undefined || activeCategoryData.timeExamenCruzadoContra !== undefined) && (
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
        allCategories={categories} // Pass allCategories
      />
    </div>
  );
};

export default DebateChronometerPage;
