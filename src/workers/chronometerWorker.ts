
// Web Worker for high-precision timer functionality
interface TimerMessage {
  type: 'START' | 'PAUSE' | 'RESUME' | 'RESET' | 'SET_TIME';
  timerId?: string;
  initialTime?: number;
  currentTime?: number;
}

interface TimerResponse {
  type: 'TICK' | 'STOPPED' | 'RESET_COMPLETE';
  timerId: string;
  currentTime: number;
  isRunning: boolean;
  drift: number;
}

interface TimerState {
  id: string;
  initialTimeMs: number;
  currentTimeMs: number;
  isRunning: boolean;
  startTimestamp: number;
  pausedTimeMs: number; // Total accumulated paused time
  lastPauseTimestamp: number; // When last paused
}

class ChronometerWorker {
  private timers: Map<string, TimerState> = new Map();
  private tickInterval: number | null = null;

  constructor() {
    this.tick = this.tick.bind(this);
    this.startTickLoop();
  }

  private startTickLoop() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
    }
    this.tickInterval = setInterval(() => {
      this.tick();
    }, 100) as unknown as number;
  }

  private tick() {
    const now = performance.now();
    const activeTimers = Array.from(this.timers.values()).filter(timer => timer.isRunning);
    
    for (const timer of activeTimers) {
      // Calculate total elapsed time since start, excluding paused periods
      const rawElapsedMs = now - timer.startTimestamp;
      const elapsedMs = rawElapsedMs - timer.pausedTimeMs;
      
      // Calculate remaining time in milliseconds (allow negatives)
      const remainingMs = timer.initialTimeMs - elapsedMs;

      // Update timer state
      timer.currentTimeMs = remainingMs;

      // Convert to seconds for display
      const currentTimeSeconds = remainingMs / 1000;
      
      // Calculate drift (minimal for this implementation)
      const drift = 0;
      
      // Always post TICK updates, even past zero
      postMessage({
        type: 'TICK',
        timerId: timer.id,
        currentTime: currentTimeSeconds,
        isRunning: true,
        drift
      } as TimerResponse);
    }
  }

  handleMessage(message: TimerMessage) {
    const { type, timerId, initialTime } = message;
    
    if (!timerId) return;

    switch (type) {
      case 'START':
        if (initialTime !== undefined) {
          const now = performance.now();
          const timer: TimerState = {
            id: timerId,
            initialTimeMs: initialTime * 1000, // Convert seconds to milliseconds
            currentTimeMs: initialTime * 1000,
            isRunning: true,
            startTimestamp: now,
            pausedTimeMs: 0,
            lastPauseTimestamp: 0
          };
          this.timers.set(timerId, timer);
        }
        break;

      case 'PAUSE': {
        const pauseTimer = this.timers.get(timerId);
        if (pauseTimer && pauseTimer.isRunning) {
          const now = performance.now();
          pauseTimer.isRunning = false;
          pauseTimer.lastPauseTimestamp = now;

          postMessage({
            type: 'STOPPED',
            timerId,
            currentTime: pauseTimer.currentTimeMs / 1000,
            isRunning: false,
            drift: 0
          } as TimerResponse);
        }
        break;
      }

      case 'RESUME': {
        const resumeTimer = this.timers.get(timerId);
        if (resumeTimer && !resumeTimer.isRunning) {
          const now = performance.now();

          // Add the paused duration to total paused time
          if (resumeTimer.lastPauseTimestamp > 0) {
            const pauseDuration = now - resumeTimer.lastPauseTimestamp;
            resumeTimer.pausedTimeMs += pauseDuration;
          }

          resumeTimer.isRunning = true;
          resumeTimer.lastPauseTimestamp = 0;
        }
        break;
      }

      case 'RESET': {
        const resetTimer = this.timers.get(timerId);
        if (resetTimer) {
          const now = performance.now();
          resetTimer.currentTimeMs = resetTimer.initialTimeMs;
          resetTimer.isRunning = false;
          resetTimer.startTimestamp = now;
          resetTimer.pausedTimeMs = 0;
          resetTimer.lastPauseTimestamp = 0;

          postMessage({
            type: 'RESET_COMPLETE',
            timerId,
            currentTime: resetTimer.initialTimeMs / 1000,
            isRunning: false,
            drift: 0
          } as TimerResponse);
        }
        break;
      }

      case 'SET_TIME':
        if (initialTime !== undefined) {
          const now = performance.now();
          const existingTimer = this.timers.get(timerId);
          if (existingTimer) {
            existingTimer.initialTimeMs = initialTime * 1000;
            existingTimer.currentTimeMs = initialTime * 1000;
            existingTimer.startTimestamp = now;
            existingTimer.pausedTimeMs = 0;
            existingTimer.lastPauseTimestamp = 0;
            existingTimer.isRunning = false;
          } else {
            const timer: TimerState = {
              id: timerId,
              initialTimeMs: initialTime * 1000,
              currentTimeMs: initialTime * 1000,
              isRunning: false,
              startTimestamp: now,
              pausedTimeMs: 0,
              lastPauseTimestamp: 0
            };
            this.timers.set(timerId, timer);
          }
        }
        break;
    }
  }
}

// Initialize worker
const worker = new ChronometerWorker();

// Listen for messages from main thread
self.addEventListener('message', (event: MessageEvent<TimerMessage>) => {
  worker.handleMessage(event.data);
});
