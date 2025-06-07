import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChronometer } from '@/hooks/useChronometer';

const mockPerformanceNow = vi.fn();
Object.defineProperty(global, 'performance', {
  value: { now: mockPerformanceNow },
  writable: true
});

describe.skip('useChronometer regression - timer continues after first second', () => {
  let currentTime = 0;

  beforeEach(() => {
    currentTime = 0;
    mockPerformanceNow.mockImplementation(() => currentTime);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps running beyond the initial second', () => {
    const { result } = renderHook(() => useChronometer({ initialTime: 3 }));

    act(() => {
      result.current.startTimer();
    });

    // After 1 second it should still be running with about 2s remaining
    currentTime = 1000;
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current.isRunning).toBe(true);
    expect(result.current.time).toBe(2);

    // After 2 seconds it should continue running with ~1s left
    currentTime = 2000;
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current.isRunning).toBe(true);
    expect(result.current.time).toBe(1);

    // At 3 seconds it should stop
    currentTime = 3000;
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current.isRunning).toBe(false);
    expect(result.current.time).toBe(0);
  });
});
