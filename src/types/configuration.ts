
import { CategoryConfig, GlobalSettings, CategoryType, Question } from '@/types/chronometer';

// Helper type for local state with string inputs for editable numeric fields
export interface EditableCategoryConfig extends Omit<CategoryConfig, 'timeFavor' | 'timeContra' | 'timeExamenCruzadoFavor' | 'timeExamenCruzadoContra' | 'minQuestions'> {
  id: string; // Ensure id is always present
  name: string;
  type: CategoryType;
  hasExamenCruzado?: boolean;
  
  timePerSpeaker: string; // In minutes, as string
  timeExamenCruzadoFavor?: string; // In minutes, as string
  timeExamenCruzadoContra?: string; // In minutes, as string
  minQuestions?: string; // As string
  questions?: Question[]; // Keep as is

  originalIndex?: number;
  examenCruzadoIntroduccionUsed?: boolean;
}

export interface EditableGlobalSettings extends Omit<GlobalSettings, 'positiveWarningThreshold' | 'negativeWarningThreshold'> {
  h1Text: string;
  logoUrl: string;
  positiveWarningThreshold: string; // In seconds, as string
  negativeWarningThreshold: string; // In seconds, as string
}

export interface ValidationErrors {
  [key: string]: string | undefined; // e.g., 'categories[0].timePerSpeaker': 'Error message'
  settingsPositiveWarning?: string;
  settingsNegativeWarning?: string;
}
