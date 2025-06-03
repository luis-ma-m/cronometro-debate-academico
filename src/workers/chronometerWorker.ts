
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
  initialTime: number;
  currentTime: number;
  isRunning: boolean;
  startTime: number;
  pausedTime: number;
  lastTickTime: number;
  intervalId?: number;
}

class ChronometerWorker {
  private timers: Map<string, TimerState> = new Map();
  private tickInterval: number | null = null;

  constructor() {
    this.tick = this.tick.bind(this);
    this.startTickLoop();
  }

  private startTickLoop() {
    // Use setInterval for more reliable timing
    this.tickInterval = setInterval(() => {
      this.tick();
    }, 100) as unknown as number; // 10 FPS for better performance
  }

  private tick() {
    const now = performance.now();
    const activeTimers = Array.from(this.timers.values()).filter(timer => timer.isRunning);
    
    for (const timer of activeTimers) {
      const elapsed = (now - timer.startTime) / 1000; // Convert to seconds
      const newTime = Math.max(timer.initialTime - elapsed, -999); // Allow negative time up to -999
      
      // Calculate drift (difference between expected and actual time)
      const expectedTime = timer.currentTime - 0.1; // Expected change per 100ms
      const drift = Math.abs(newTime - expectedTime);
      
      timer.currentTime = newTime;
      timer.lastTickTime = now;
      
      // Send tick update to main thread
      const response: TimerResponse = {
        type: 'TICK',
        timerId: timer.id,
        currentTime: newTime,
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
          const timer: TimerState = {
            id: timerId,
            initialTime,
            currentTime: initialTime,
            isRunning: true,
            startTime: performance.now(),
            pausedTime: 0,
            lastTickTime: performance.now()
          };
          this.timers.set(timerId, timer);
        }
        break;

      case 'PAUSE':
        const pauseTimer = this.timers.get(timerId);
        if (pauseTimer && pauseTimer.isRunning) {
          pauseTimer.isRunning = false;
          pauseTimer.pausedTime = performance.now();
          
          postMessage({
            type: 'STOPPED',
            timerId,
            currentTime: pauseTimer.currentTime,
            isRunning: false,
            drift: 0
          } as TimerResponse);
        }
        break;

      case 'RESUME':
        const resumeTimer = this.timers.get(timerId);
        if (resumeTimer && !resumeTimer.isRunning) {
          const pauseDuration = performance.now() - resumeTimer.pausedTime;
          resumeTimer.startTime += pauseDuration; // Adjust start time to account for pause
          resumeTimer.isRunning = true;
        }
        break;

      case 'RESET':
        const resetTimer = this.timers.get(timerId);
        if (resetTimer) {
          resetTimer.currentTime = resetTimer.initialTime;
          resetTimer.isRunning = false;
          resetTimer.startTime = performance.now();
          resetTimer.pausedTime = 0;
          
          postMessage({
            type: 'RESET_COMPLETE',
            timerId,
            currentTime: resetTimer.initialTime,
            isRunning: false,
            drift: 0
          } as TimerResponse);
        }
        break;

      case 'SET_TIME':
        if (initialTime !== undefined) {
          const existingTimer = this.timers.get(timerId);
          if (existingTimer) {
            existingTimer.initialTime = initialTime;
            existingTimer.currentTime = initialTime;
            existingTimer.startTime = performance.now();
            existingTimer.isRunning = false;
          } else {
            const timer: TimerState = {
              id: timerId,
              initialTime,
              currentTime: initialTime,
              isRunning: false,
              startTime: performance.now(),
              pausedTime: 0,
              lastTickTime: performance.now()
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
