export type CategoryType = 'introduccion' | 'refutacion' | 'conclusion';

export interface Question {
  id: string;          // uuid
  text?: string; // Optional: if questions have specific text, though not in original request
  answered: boolean;   // toggled by click
}

export interface CategoryConfig {
  id: string;
  name: string;
  timeFavor: number; // initial time in seconds
  timeContra: number; // initial time in seconds
  
  type: CategoryType; // Mandatory type

  // For 'introduccion' type
  hasExamenCruzado?: boolean; 
  // To track if the special Examen Cruzado for 'introduccion' was used (for summary)
  examenCruzadoIntroduccionUsed?: boolean; 
  // Duration for the special 'introduccion' Examen Cruzado, if different from main speech
  // If not provided, can default to timeFavor/timeContra.
  // For now, let's assume it uses timeFavor/timeContra as per "same duration".

  // For 'refutacion' type
  minQuestions?: number;
  questions?: Question[];

  // Existing optional cross-examination times, independent of the new 'introduccion' Examen Cruzado
  timeExamenCruzadoFavor?: number; // optional, in seconds
  timeExamenCruzadoContra?: number; // optional, in seconds
  originalIndex?: number; // Used internally by ConfigurationModal
}

export interface GlobalSettings {
  logoUrl: string;
  h1Text: string;
  positiveWarningThreshold: number; // seconds, e.g., 30. Time <= this and > 0 for pale yellow
  negativeWarningThreshold: number; // seconds, e.g., -30. Time < this for strong red, else pale red if < 0
}

export type PositionType = 'favor' | 'contra' | 'examen_favor' | 'examen_contra' | 'examen_introduccion'; // Added examen_introduccion

export interface TimerInstance {
  id: string; // Unique ID, e.g., categoryId_favor, categoryId_examen_favor
  categoryId: string;
  positionId: PositionType;
  currentTime: number;
  isRunning: boolean;
  initialTime: number;
}

export type TimerUpdatePayload = Omit<TimerInstance, 'categoryId' | 'positionId' | 'initialTime'>;
