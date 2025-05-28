
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
}

class ChronometerWorker {
  private timers: Map<string, TimerState> = new Map();
  private animationFrameId: number | null = null;
  private lastFrameTime = 0;

  constructor() {
    this.tick = this.tick.bind(this);
    this.startRenderLoop();
  }

  private startRenderLoop() {
    const renderLoop = (currentTime: number) => {
      this.tick(currentTime);
      this.animationFrameId = requestAnimationFrame(renderLoop);
    };
    this.animationFrameId = requestAnimationFrame(renderLoop);
  }

  private tick(currentTime: number) {
    const deltaTime = currentTime - this.lastFrameTime;
    
    // Target 60 FPS (16.67ms per frame)
    if (deltaTime >= 16.67) {
      this.lastFrameTime = currentTime;
      
      const activeTimers = Array.from(this.timers.values()).filter(timer => timer.isRunning);
      
      for (const timer of activeTimers) {
        const now = performance.now();
        const elapsed = (now - timer.startTime) / 1000; // Convert to seconds
        const newTime = timer.initialTime - elapsed;
        
        // Calculate drift (difference between expected and actual time)
        const expectedTime = timer.currentTime - (deltaTime / 1000);
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
  }

  handleMessage(message: TimerMessage) {
    const { type, timerId, initialTime, currentTime } = message;
    
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
        const setTimer = this.timers.get(timerId);
        if (setTimer && initialTime !== undefined) {
          setTimer.initialTime = initialTime;
          setTimer.currentTime = initialTime;
          setTimer.startTime = performance.now();
          setTimer.isRunning = false;
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
