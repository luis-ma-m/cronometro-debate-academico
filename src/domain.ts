export type TimerStatus = 'idle' | 'running' | 'paused' | 'finished';
export type RoomStatus = 'unassigned' | 'ready' | 'running' | 'paused' | 'finished' | 'issue';
export type PhaseType = 'opening' | 'cross-examination' | 'rebuttal' | 'cross-rebuttal' | 'conclusion' | 'other';

export interface Phase {
  id: string;
  name: string;
  side: 'favor' | 'contra';
  speaker: string;
  durationSeconds: number;
  type?: PhaseType;
  warningThresholdsSeconds?: number[];
  allowOvertimeDisplay?: boolean;
}

export interface TimerState {
  status: TimerStatus;
  phaseIndex: number;
  remainingSeconds: number;
  startedAt: number | null;
  lastResumedAt: number | null;
  revision: number;
  updatedAt: number;
}

export interface Team { id: string; name: string; institution: string; active: boolean }
export interface Judge { id: string; name: string; institution: string; active: boolean }
export interface Round {
  id: string;
  number: number;
  name: string;
  active: boolean;
  defaultFormatId: string;
}

export interface FormatPreset {
  id: string;
  name: string;
  phases: Phase[];
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface PhysicalRoom {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Room {
  id: string;
  name: string;
  roundId: string;
  physicalRoomId: string;
  formatId: string;
  teamFavorId: string;
  teamContraId: string;
  judgeIds: string[];
  status: RoomStatus;
  phases: Phase[];
  timer: TimerState;
  notes: string;
  updatedAt: number;
}

export interface Tournament {
  tournamentName: string;
  rounds: Round[];
  teams: Team[];
  judges: Judge[];
  rooms: Room[];
  physicalRooms: PhysicalRoom[];
  formats: FormatPreset[];
  activeRoundId: string;
  activationRevision: number;
  activatedAt: number;
  institutions?: string[];
  formatPhases?: Phase[];
  minimumJudgesPerRoom?: number;
  revision: number;
  updatedAt: number;
  serverTime?: number;
}

export interface PublicRoom {
  tournamentName: string;
  roundName: string;
  room: Room;
  hasAssignment: boolean;
  physicalRoomId: string;
  roomSlug: string;
  physicalRoomName: string;
  activationRevision: number;
  activatedAt: number;
  teamFavor: string;
  teamContra: string;
  judges: string[];
  minimumJudgesPerRoom?: number;
  serverTime: number;
}
