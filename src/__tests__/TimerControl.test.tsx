import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import TimerControl from '@/components/TimerControl';
import { AccessibilityProvider } from '@/components/AccessibilityProvider';
import { GlobalSettings } from '@/types/chronometer';

class MockWorker {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  timerId = '';
  initialTime = 0;
  currentTime = 0;
  constructor(public url: string | URL, public options?: WorkerOptions) {
    (globalThis as { latestWorker?: MockWorker }).latestWorker = this;
  }
  postMessage(data: {
    type: 'SET_TIME' | 'START' | 'RESUME' | 'PAUSE' | 'RESET';
    timerId?: string;
    initialTime?: number;
  }) {
    this.timerId = data.timerId || this.timerId;
    switch (data.type) {
      case 'SET_TIME':
        this.initialTime = data.initialTime;
        this.currentTime = data.initialTime;
        break;
      case 'START':
        this.currentTime = data.initialTime;
        if (this.onmessage) {
          this.onmessage(
            new MessageEvent('message', {
              data: { type: 'TICK', timerId: this.timerId, currentTime: this.currentTime, isRunning: true, drift: 0 }
            })
          );
        }
        break;
      case 'RESUME':
        if (this.onmessage) {
          this.onmessage(
            new MessageEvent('message', {
              data: { type: 'TICK', timerId: this.timerId, currentTime: this.currentTime, isRunning: true, drift: 0 }
            })
          );
        }
        break;
      case 'PAUSE':
        if (this.onmessage) {
          this.onmessage(
            new MessageEvent('message', {
              data: { type: 'STOPPED', timerId: this.timerId, currentTime: this.currentTime, isRunning: false, drift: 0 }
            })
          );
        }
        break;
      case 'RESET':
        this.currentTime = this.initialTime;
        if (this.onmessage) {
          this.onmessage(
            new MessageEvent('message', {
              data: { type: 'RESET_COMPLETE', timerId: this.timerId, currentTime: this.currentTime, isRunning: false, drift: 0 }
            })
          );
        }
        break;
    }
  }
  terminate() {}
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }
}

const settings: GlobalSettings = {
  logoUrl: '',
  h1Text: '',
  positiveWarningThreshold: 10,
  negativeWarningThreshold: -10
};

let originalWorker: typeof Worker;
beforeEach(() => {
  originalWorker = global.Worker;
  global.Worker = MockWorker as unknown as typeof Worker;
});

afterEach(() => {
  global.Worker = originalWorker;
});

describe('TimerControl handleStartPause edge case', () => {
  it('resets and starts a new timer when time is 0', () => {
    render(
      <AccessibilityProvider>
        <TimerControl
          initialTime={5}
          categoryId="cat"
          position="favor"
          settings={settings}
          baseBgColor="bg-white"
          positionName="Favor"
        />
      </AccessibilityProvider>
    );

    const toggle = screen.getByRole('button', { name: /^Iniciar$/i });

    act(() => {
      fireEvent.click(toggle); // start
    });

    const worker = (globalThis as { latestWorker: MockWorker }).latestWorker;

    act(() => {
      worker.onmessage(
        new MessageEvent('message', {
          data: { type: 'STOPPED', timerId: 'cat_favor', currentTime: 0, isRunning: false, drift: 0 }
        })
      );
    });

    expect(toggle).toHaveAttribute('aria-label', 'Reanudar');

    act(() => {
      fireEvent.click(toggle); // should reset and start
    });

    expect(toggle).toHaveAttribute('aria-label', 'Pausar');
    expect(screen.getByText('0:05')).toBeInTheDocument();
  });
});
