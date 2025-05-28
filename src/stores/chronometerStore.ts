
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CategoryConfig, GlobalSettings, TimerInstance, PositionType, Question } from '@/types/chronometer';
import { v4 as uuidv4 } from 'uuid';

const DEFAULT_LOGO_URL = 'https://aduma.es/wp-content/uploads/2021/09/Logo-ADUMA-Completo.png';

// Initial categories data
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
  positiveWarningThreshold: 10,
  negativeWarningThreshold: -10,
};

interface ChronometerState {
  // Data
  categories: CategoryConfig[];
  globalSettings: GlobalSettings;
  activeCategoryId: string | null;
  activePositionType: PositionType | null;
  timerStates: Record<string, TimerInstance>;
  
  // UI State
  isConfigModalOpen: boolean;
  isSummaryModalOpen: boolean;
  accessibilityMode: 'default' | 'high-contrast' | 'dyslexic-friendly';
  
  // Actions
  setCategories: (categories: CategoryConfig[]) => void;
  setGlobalSettings: (settings: GlobalSettings) => void;
  setActiveCategoryId: (id: string | null) => void;
  setActivePositionType: (type: PositionType | null) => void;
  updateTimerState: (timerId: string, state: Partial<TimerInstance>) => void;
  updateQuestions: (categoryId: string, questions: Question[]) => void;
  setConfigModalOpen: (open: boolean) => void;
  setSummaryModalOpen: (open: boolean) => void;
  setAccessibilityMode: (mode: 'default' | 'high-contrast' | 'dyslexic-friendly') => void;
  
  // Complex actions
  saveConfiguration: (categories: CategoryConfig[], settings: GlobalSettings) => void;
  selectCategory: (categoryId: string) => void;
  reset: () => void;
}

export const useChronometerStore = create<ChronometerState>()(
  persist(
    (set, get) => ({
      // Initial state
      categories: initialCategoriesData.map(cat => {
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
      }),
      globalSettings: initialGlobalSettings,
      activeCategoryId: null,
      activePositionType: null,
      timerStates: {},
      isConfigModalOpen: false,
      isSummaryModalOpen: false,
      accessibilityMode: 'default',

      // Basic setters
      setCategories: (categories) => set({ categories }),
      setGlobalSettings: (globalSettings) => set({ globalSettings }),
      setActiveCategoryId: (activeCategoryId) => set({ activeCategoryId }),
      setActivePositionType: (activePositionType) => set({ activePositionType }),
      setConfigModalOpen: (isConfigModalOpen) => set({ isConfigModalOpen }),
      setSummaryModalOpen: (isSummaryModalOpen) => set({ isSummaryModalOpen }),
      setAccessibilityMode: (accessibilityMode) => set({ accessibilityMode }),

      updateTimerState: (timerId, newState) => set((state) => ({
        timerStates: {
          ...state.timerStates,
          [timerId]: {
            ...state.timerStates[timerId],
            ...newState,
          }
        }
      })),

      updateQuestions: (categoryId, questions) => set((state) => ({
        categories: state.categories.map(cat => 
          cat.id === categoryId ? { ...cat, questions } : cat
        )
      })),

      selectCategory: (categoryId) => set({
        activeCategoryId: categoryId,
        activePositionType: null
      }),

      saveConfiguration: (newCategories, newGlobalSettings) => {
        const processedCategories = newCategories.map(cat => {
          const processedCat: CategoryConfig = { ...cat };
          if (!processedCat.type) processedCat.type = 'conclusion';

          if (processedCat.type === 'introduccion') {
            processedCat.hasExamenCruzado = typeof processedCat.hasExamenCruzado === 'boolean' ? processedCat.hasExamenCruzado : false;
            processedCat.examenCruzadoIntroduccionUsed = typeof processedCat.examenCruzadoIntroduccionUsed === 'boolean' ? processedCat.examenCruzadoIntroduccionUsed : false;
            if (!processedCat.hasExamenCruzado) {
              delete processedCat.timeExamenCruzadoFavor;
              delete processedCat.timeExamenCruzadoContra;
            }
          } else {
            delete processedCat.hasExamenCruzado;
            delete processedCat.timeExamenCruzadoFavor;
            delete processedCat.timeExamenCruzadoContra;
            delete processedCat.examenCruzadoIntroduccionUsed;
          }

          if (processedCat.type === 'refutacion') {
            processedCat.minQuestions = typeof processedCat.minQuestions === 'number' ? processedCat.minQuestions : 0;
            processedCat.questions = Array.isArray(processedCat.questions) 
              ? processedCat.questions 
              : Array.from({ length: processedCat.minQuestions || 0 }, () => ({ id: uuidv4(), answered: false }));
          } else {
            delete processedCat.minQuestions;
            delete processedCat.questions;
          }
          return processedCat;
        });

        const state = get();
        
        set({
          categories: processedCategories,
          globalSettings: newGlobalSettings
        });

        // Validate current selections
        if (state.activeCategoryId && !processedCategories.find(cat => cat.id === state.activeCategoryId)) {
          set({ activeCategoryId: null, activePositionType: null });
        } else if (state.activeCategoryId && state.activePositionType) {
          const currentActiveCat = processedCategories.find(cat => cat.id === state.activeCategoryId);
          if (currentActiveCat) {
            let positionStillValid = true;
            if (state.activePositionType === 'examen_favor' || state.activePositionType === 'examen_contra') {
              if (currentActiveCat.type !== 'introduccion' || !currentActiveCat.hasExamenCruzado) {
                positionStillValid = false;
              } else if (state.activePositionType === 'examen_favor' && currentActiveCat.timeExamenCruzadoFavor === undefined) {
                positionStillValid = false;
              } else if (state.activePositionType === 'examen_contra' && currentActiveCat.timeExamenCruzadoContra === undefined) {
                positionStillValid = false;
              }
            }
            
            if (!positionStillValid) {
              set({ activePositionType: null });
            }
          } else { 
            set({ activeCategoryId: null, activePositionType: null });
          }
        }
      },

      reset: () => set({
        categories: initialCategoriesData,
        globalSettings: initialGlobalSettings,
        activeCategoryId: null,
        activePositionType: null,
        timerStates: {},
        isConfigModalOpen: false,
        isSummaryModalOpen: false,
      }),
    }),
    {
      name: 'chronometer-storage',
      partialize: (state) => ({
        categories: state.categories,
        globalSettings: state.globalSettings,
        activeCategoryId: state.activeCategoryId,
        activePositionType: state.activePositionType,
        timerStates: state.timerStates,
        accessibilityMode: state.accessibilityMode,
      }),
    }
  )
);
