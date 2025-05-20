export interface CategoryConfig {
  id: string;
  name: string;
  timeFavor: number; // initial time in seconds
  timeContra: number; // initial time in seconds
  timeExamenCruzadoFavor?: number; // optional, in seconds
  timeExamenCruzadoContra?: number; // optional, in seconds
}

export interface GlobalSettings {
  logoUrl: string;
  h1Text: string;
  positiveWarningThreshold: number; // seconds, e.g., 30. Time <= this and > 0 for pale yellow
  negativeWarningThreshold: number; // seconds, e.g., -30. Time < this for strong red, else pale red if < 0
}

export type PositionType = 'favor' | 'contra' | 'examen_favor' | 'examen_contra';

export interface TimerInstance {
  id: string; // Unique ID, e.g., categoryId_favor, categoryId_examen_favor
  categoryId: string;
  positionId: PositionType;
  currentTime: number;
  isRunning: boolean;
  initialTime: number;
}

export type TimerUpdatePayload = Omit<TimerInstance, 'categoryId' | 'positionId' | 'initialTime'>;
