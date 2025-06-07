import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import TimerControl from '@/components/TimerControl';
import { AccessibilityProvider } from '@/components/AccessibilityProvider';
import { useChronometerStore } from '@/stores/chronometerStore';
import type { GlobalSettings } from '@/types/chronometer';

class MockWorker {
  static count = 0;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  timerId = '';
  initialTime = 0;
  currentTime = 0;

  constructor(public url: string | URL, public options?: WorkerOptions) {
    MockWorker.count++;
    (global as any).latestWorker = this;
  }

  postMessage(data: any) {
    this.timerId = data.timerId || this.timerId;
    switch (data.type) {
      case 'SET_TIME':
        this.initialTime = data.initialTime;
        this.currentTime = data.initialTime;
        break;
      case 'START':
        this.currentTime = data.initialTime;
        break;
      case 'RESET':
        this.currentTime = this.initialTime;
        break;
    }
  }

  simulateTick() {
    this.currentTime = this.currentTime - 1;
    if (this.onmessage) {
      this.onmessage(
        new MessageEvent('message', {
          data: {
            type: 'TICK',
            timerId: this.timerId,
            currentTime: this.currentTime,
            isRunning: true,
            drift: 0
          }
        })
      );
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

let originalWorker: any;

beforeEach(() => {
  originalWorker = (global as any).Worker;
  (global as any).Worker = MockWorker as any;
  MockWorker.count = 0;
});

afterEach(() => {
  (global as any).Worker = originalWorker;
});

describe('useChronometerWorker stability', () => {
  it('uses a single worker across re-renders and keeps counting', () => {
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
      fireEvent.click(toggle);
    });

    const worker: any = (global as any).latestWorker;

    act(() => {
      worker.simulateTick();
    });

    expect(screen.getByText('0:04')).toBeInTheDocument();

    act(() => {
      useChronometerStore.getState().setAccessibilityMode('high-contrast');
    });

    act(() => {
      worker.simulateTick();
    });

    expect(screen.getByText('0:03')).toBeInTheDocument();
    expect(MockWorker.count).toBe(1);
  });
});
