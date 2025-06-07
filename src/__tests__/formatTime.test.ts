import { describe, it, expect } from 'vitest';
import { formatTime, formatTimeMs, parseTimeString, formatDuration } from '../utils/formatTime';

describe('formatTime utilities', () => {
  it('formats positive and negative times', () => {
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(-65)).toBe('-1:05');
  });

  it('formats hours when required', () => {
    expect(formatTime(3661, true)).toBe('1:01:01');
  });

  it('formats milliseconds with rounding', () => {
    expect(formatTimeMs(61000)).toBe('1:01');
  });

  it('parses valid time strings and rejects invalid ones', () => {
    expect(parseTimeString('1:05')).toBe(65);
    expect(parseTimeString('01:01:01')).toBe(3661);
    expect(parseTimeString('5:99')).toBeNull();
  });

  it('creates human readable durations', () => {
    expect(formatDuration(45)).toBe('45 segundos');
    expect(formatDuration(120)).toBe('2 minutos');
    expect(formatDuration(3600)).toBe('1 hora');
    expect(formatDuration(3660)).toBe('1 hora y 1 minuto');
  });
});
