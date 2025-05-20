
export interface CategoryConfig {
  id: string;
  name: string;
  timeFavor: number; // initial time in seconds
  timeContra: number; // initial time in seconds
}

export interface GlobalSettings {
  logoUrl: string;
  h1Text: string;
  positiveWarningThreshold: number; // seconds, e.g., 30. Time <= this and > 0 for pale yellow
  negativeWarningThreshold: number; // seconds, e.g., -30. Time < this for strong red, else pale red if < 0
}

export interface TimerInstance {
  id: string; // Unique ID, e.g., categoryId_favor
  categoryId: string;
  positionId: 'favor' | 'contra';
  currentTime: number;
  isRunning: boolean;
  initialTime: number;
}

export type TimerUpdatePayload = Omit<TimerInstance, 'categoryId' | 'positionId' | 'initialTime'>;

