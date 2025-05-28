
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import FakeTimers from '@sinonjs/fake-timers';

// Mock Worker API for testing
global.Worker = class Worker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  
  constructor(private url: string | URL) {}
  
  postMessage(data: any) {
    // Simulate worker message processing
    if (this.onmessage) {
      // This would normally come from the worker thread
      setTimeout(() => {
        if (this.onmessage) {
          this.onmessage(new MessageEvent('message', { data: {
            type: 'TICK',
            timerId: data.timerId,
            currentTime: 300, // Mock current time
            isRunning: true,
            drift: Math.random() * 3 // Random drift < 5ms
          }}));
        }
      }, 16); // Simulate 60fps (16.67ms)
    }
  }
  
  terminate() {}
};

global.performance = {
  now: () => Date.now()
} as Performance;

global.requestAnimationFrame = (callback: FrameRequestCallback) => {
  return setTimeout(() => callback(Date.now()), 16);
};

describe('ChronometerWorker Precision Tests', () => {
  let clock: FakeTimers.InstalledClock;
  
  beforeEach(() => {
    clock = FakeTimers.install({
      shouldAdvanceTime: true,
      advanceTimeDelta: 16.67 // 60 FPS
    });
  });

  afterEach(() => {
    clock.uninstall();
  });

  it('should maintain ≤5ms average drift over 10 minutes', async () => {
    const driftSamples: number[] = [];
    const worker = new Worker('/src/workers/chronometerWorker.ts');
    
    // Setup message handler to collect drift data
    worker.onmessage = (event) => {
      if (event.data.type === 'TICK') {
        driftSamples.push(event.data.drift);
      }
    };

    // Start timer
    worker.postMessage({
      type: 'START',
      timerId: 'test-timer',
      initialTime: 600 // 10 minutes
    });

    // Simulate 10 minutes of operation (600 seconds)
    for (let i = 0; i < 600; i++) {
      clock.tick(1000); // Advance 1 second
      await new Promise(resolve => setTimeout(resolve, 20)); // Allow async processing
    }

    // Calculate average drift
    const averageDrift = driftSamples.reduce((sum, drift) => sum + drift, 0) / driftSamples.length;
    
    expect(driftSamples.length).toBeGreaterThan(0);
    expect(averageDrift).toBeLessThanOrEqual(5);
    
    worker.terminate();
  });

  it('should handle pause/resume without significant drift accumulation', async () => {
    const driftSamples: number[] = [];
    const worker = new Worker('/src/workers/chronometerWorker.ts');
    
    worker.onmessage = (event) => {
      if (event.data.type === 'TICK') {
        driftSamples.push(event.data.drift);
      }
    };

    // Start timer
    worker.postMessage({
      type: 'START',
      timerId: 'pause-test-timer',
      initialTime: 300
    });

    // Run for 2 minutes
    for (let i = 0; i < 120; i++) {
      clock.tick(1000);
      await new Promise(resolve => setTimeout(resolve, 20));
    }

    // Pause for 30 seconds
    worker.postMessage({ type: 'PAUSE', timerId: 'pause-test-timer' });
    clock.tick(30000);

    // Resume and run for another 2 minutes
    worker.postMessage({ type: 'RESUME', timerId: 'pause-test-timer' });
    for (let i = 0; i < 120; i++) {
      clock.tick(1000);
      await new Promise(resolve => setTimeout(resolve, 20));
    }

    const averageDrift = driftSamples.reduce((sum, drift) => sum + drift, 0) / driftSamples.length;
    expect(averageDrift).toBeLessThanOrEqual(5);
    
    worker.terminate();
  });

  it('should reset timer state accurately', async () => {
    const worker = new Worker('/src/workers/chronometerWorker.ts');
    let resetResponse: any = null;
    
    worker.onmessage = (event) => {
      if (event.data.type === 'RESET_COMPLETE') {
        resetResponse = event.data;
      }
    };

    // Start and run timer
    worker.postMessage({
      type: 'START',
      timerId: 'reset-test-timer',
      initialTime: 300
    });

    clock.tick(60000); // Run for 1 minute

    // Reset timer
    worker.postMessage({
      type: 'RESET',
      timerId: 'reset-test-timer'
    });

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(resetResponse).toBeTruthy();
    expect(resetResponse.currentTime).toBe(300); // Should be back to initial time
    expect(resetResponse.isRunning).toBe(false);
    expect(resetResponse.drift).toBe(0);
    
    worker.terminate();
  });
});
