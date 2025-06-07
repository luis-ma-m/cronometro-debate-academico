
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebateTimer } from '@/hooks/useDebateTimer';

// Mock performance.now for consistent testing
const mockPerformanceNow = vi.fn();
Object.defineProperty(global, 'performance', {
  value: { now: mockPerformanceNow },
  writable: true
});

describe.skip('useDebateTimer - Fixed Version (No 1s Freeze)', () => {
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

  it('is still running after 1s and stops exactly at speechDurationMs', () => {
    const { result } = renderHook(() => 
      useDebateTimer({ 
        initialTime: 5, // 5 seconds = 5000ms internally
        timerId: 'test-timer'
      })
    );

    // Start the timer
    act(() => {
      result.current.startPause();
    });

    expect(result.current.isRunning).toBe(true);
    expect(result.current.time).toBe(5);

    // After 1000ms, should STILL be running (this was the bug)
    currentTime = 1000;
    act(() => {
      vi.advanceTimersByTime(50); // Trigger one tick
    });

    // Timer should still be running and show ~4 seconds remaining
    expect(result.current.isRunning).toBe(true);
    expect(result.current.time).toBe(4);

    // Advance time by another 2 seconds (total 3000ms)
    currentTime = 3000;
    act(() => {
      vi.advanceTimersByTime(50);
    });

    // Timer should still be running with ~2 seconds remaining
    expect(result.current.isRunning).toBe(true);
    expect(result.current.time).toBe(2);

    // Advance to exactly 5000ms (timer should stop)
    currentTime = 5000;
    act(() => {
      vi.advanceTimersByTime(50);
    });

    // Timer should have stopped exactly at 0
    expect(result.current.isRunning).toBe(false);
    expect(result.current.time).toBe(0);
  });

  it('handles pause and resume correctly without interval leaks', () => {
    const { result } = renderHook(() => 
      useDebateTimer({ 
        initialTime: 10, // 10 seconds
        timerId: 'test-timer'
      })
    );

    // Start the timer
    act(() => {
      result.current.startPause();
    });

    expect(result.current.isRunning).toBe(true);

    // Run for 2 seconds
    currentTime = 2000;
    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(result.current.time).toBe(8);

    // Pause the timer
    act(() => {
      result.current.startPause();
    });

    expect(result.current.isRunning).toBe(false);

    // Time passes while paused - timer should not advance
    currentTime = 4000;
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.time).toBe(8); // Should remain at 8

    // Resume the timer
    act(() => {
      result.current.startPause();
    });

    expect(result.current.isRunning).toBe(true);

    // Advance another 3 seconds from pause point
    currentTime = 7000; // 4000 (pause time) + 3000 (additional)
    act(() => {
      vi.advanceTimersByTime(50);
    });

    // Should show 5 seconds remaining (10 - 2 - 3 = 5)
    expect(result.current.time).toBe(5);
  });

  it('resets timer correctly and clears all state flags', () => {
    const { result } = renderHook(() => 
      useDebateTimer({ 
        initialTime: 3,
        timerId: 'test-timer'
      })
    );

    // Start and run for 1 second
    act(() => {
      result.current.startPause();
    });

    currentTime = 1000;
    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(result.current.time).toBe(2);
    expect(result.current.isRunning).toBe(true);

    // Reset the timer
    act(() => {
      result.current.reset();
    });

    // Should be back to initial state with proper flags
    expect(result.current.time).toBe(3);
    expect(result.current.isRunning).toBe(false);
  });

  it('prevents multiple intervals from being created', () => {
    const { result } = renderHook(() => 
      useDebateTimer({ 
        initialTime: 5,
        timerId: 'test-timer'
      })
    );

    // Start the timer
    act(() => {
      result.current.startPause();
    });

    expect(result.current.isRunning).toBe(true);

    // Try to start again (should be ignored due to guard)
    act(() => {
      result.current.startPause(); // This should pause instead
    });

    expect(result.current.isRunning).toBe(false); // Should be paused now

    // Resume
    act(() => {
      result.current.startPause();
    });

    expect(result.current.isRunning).toBe(true);
  });

  it('continues past multiple seconds without stopping prematurely', () => {
    const { result } = renderHook(() => 
      useDebateTimer({ 
        initialTime: 10, // 10 seconds
        timerId: 'test-timer'
      })
    );

    act(() => {
      result.current.startPause();
    });

    // Test that it continues past 1s, 2s, 3s, etc.
    for (let seconds = 1; seconds <= 9; seconds++) {
      currentTime = seconds * 1000;
      act(() => {
        vi.advanceTimersByTime(50);
      });
      
      expect(result.current.isRunning).toBe(true);
      expect(result.current.time).toBe(10 - seconds);
    }

    // Finally at 10 seconds, it should stop
    currentTime = 10000;
    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(result.current.isRunning).toBe(false);
    expect(result.current.time).toBe(0);
  });
});
