
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
  initialTimeMs: number; // Store in milliseconds for consistency
  currentTimeMs: number; // Store in milliseconds for consistency
  isRunning: boolean;
  startTimestamp: number; // When the timer was started/resumed
  pausedDuration: number; // Total time spent paused (in ms)
  lastTickTime: number;
}

class ChronometerWorker {
  private timers: Map<string, TimerState> = new Map();
  private tickInterval: number | null = null;

  constructor() {
    this.tick = this.tick.bind(this);
    this.startTickLoop();
  }

  private startTickLoop() {
    // Use setInterval for reliable timing at 10 FPS
    this.tickInterval = setInterval(() => {
      this.tick();
    }, 100) as unknown as number;
  }

  private tick() {
    const now = performance.now();
    const activeTimers = Array.from(this.timers.values()).filter(timer => timer.isRunning);
    
    for (const timer of activeTimers) {
      // Calculate elapsed time since start, minus any paused duration
      const elapsedMs = now - timer.startTimestamp - timer.pausedDuration;
      const remainingMs = timer.initialTimeMs - elapsedMs;
      
      // Convert to seconds for the response (display purposes)
      const currentTimeSeconds = remainingMs / 1000;
      
      // Calculate drift (difference between expected and actual time)
      const expectedMs = timer.currentTimeMs;
      const actualMs = remainingMs;
      const drift = Math.abs(actualMs - expectedMs) / 1000; // Convert to seconds for drift reporting
      
      // Update timer state
      timer.currentTimeMs = remainingMs;
      timer.lastTickTime = now;
      
      // Send tick update to main thread
      const response: TimerResponse = {
        type: 'TICK',
        timerId: timer.id,
        currentTime: currentTimeSeconds,
        isRunning: true,
        drift
      };
      
      postMessage(response);
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
            currentTimeMs: initialTime * 1000, // Convert seconds to milliseconds
            isRunning: true,
            startTimestamp: now,
            pausedDuration: 0,
            lastTickTime: now
          };
          this.timers.set(timerId, timer);
        }
        break;

      case 'PAUSE':
        const pauseTimer = this.timers.get(timerId);
        if (pauseTimer && pauseTimer.isRunning) {
          pauseTimer.isRunning = false;
          
          postMessage({
            type: 'STOPPED',
            timerId,
            currentTime: pauseTimer.currentTimeMs / 1000, // Convert back to seconds
            isRunning: false,
            drift: 0
          } as TimerResponse);
        }
        break;

      case 'RESUME':
        const resumeTimer = this.timers.get(timerId);
        if (resumeTimer && !resumeTimer.isRunning) {
          const now = performance.now();
          // Calculate how long we were paused and add it to total paused duration
          const pauseDuration = now - resumeTimer.lastTickTime;
          resumeTimer.pausedDuration += pauseDuration;
          resumeTimer.isRunning = true;
          resumeTimer.lastTickTime = now;
        }
        break;

      case 'RESET':
        const resetTimer = this.timers.get(timerId);
        if (resetTimer) {
          const now = performance.now();
          resetTimer.currentTimeMs = resetTimer.initialTimeMs;
          resetTimer.isRunning = false;
          resetTimer.startTimestamp = now;
          resetTimer.pausedDuration = 0;
          resetTimer.lastTickTime = now;
          
          postMessage({
            type: 'RESET_COMPLETE',
            timerId,
            currentTime: resetTimer.initialTimeMs / 1000, // Convert back to seconds
            isRunning: false,
            drift: 0
          } as TimerResponse);
        }
        break;

      case 'SET_TIME':
        if (initialTime !== undefined) {
          const now = performance.now();
          const existingTimer = this.timers.get(timerId);
          if (existingTimer) {
            existingTimer.initialTimeMs = initialTime * 1000; // Convert seconds to milliseconds
            existingTimer.currentTimeMs = initialTime * 1000; // Convert seconds to milliseconds
            existingTimer.startTimestamp = now;
            existingTimer.pausedDuration = 0;
            existingTimer.isRunning = false;
            existingTimer.lastTickTime = now;
          } else {
            const timer: TimerState = {
              id: timerId,
              initialTimeMs: initialTime * 1000, // Convert seconds to milliseconds
              currentTimeMs: initialTime * 1000, // Convert seconds to milliseconds
              isRunning: false,
              startTimestamp: now,
              pausedDuration: 0,
              lastTickTime: now
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
