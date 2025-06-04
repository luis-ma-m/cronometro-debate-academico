
/**
 * Formats time from seconds to MM:SS or HH:MM:SS format
 * @param totalSeconds - Time in seconds (can be negative)
 * @param showHours - Whether to show hours when >= 1 hour
 * @returns Formatted time string
 */
export function formatTime(totalSeconds: number, showHours = false): string {
  const absSeconds = Math.floor(Math.abs(totalSeconds));
  const hours = Math.floor(absSeconds / 3600);
  const minutes = Math.floor((absSeconds % 3600) / 60);
  const seconds = absSeconds % 60;
  const sign = totalSeconds < 0 ? "-" : "";

  if (showHours || hours > 0) {
    return `${sign}${String(hours).padStart(1, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${sign}${String(minutes).padStart(1, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Formats time with millisecond precision for display
 * @param totalMs - Time in milliseconds
 * @returns Formatted time string in MM:SS format
 */
export function formatTimeMs(totalMs: number): string {
  const totalSeconds = Math.ceil(totalMs / 1000);
  return formatTime(totalSeconds);
}

/**
 * Parses a time string (MM:SS or HH:MM:SS) to seconds
 * @param timeString - Time string to parse
 * @returns Time in seconds, or null if invalid
 */
export function parseTimeString(timeString: string): number | null {
  const parts = timeString.split(':').map(part => parseInt(part, 10));
  
  if (parts.some(isNaN)) return null;
  
  if (parts.length === 2) {
    // MM:SS format
    const [minutes, seconds] = parts;
    if (minutes < 0 || seconds < 0 || seconds >= 60) return null;
    return minutes * 60 + seconds;
  } else if (parts.length === 3) {
    // HH:MM:SS format
    const [hours, minutes, seconds] = parts;
    if (hours < 0 || minutes < 0 || seconds < 0 || minutes >= 60 || seconds >= 60) return null;
    return hours * 3600 + minutes * 60 + seconds;
  }
  
  return null;
}

/**
 * Converts seconds to a human-readable duration string
 * @param seconds - Duration in seconds
 * @returns Human-readable string like "2 minutes", "1 hour", etc.
 */
export function formatDuration(seconds: number): string {
  const absSeconds = Math.abs(seconds);
  
  if (absSeconds < 60) {
    return `${absSeconds} segundo${absSeconds !== 1 ? 's' : ''}`;
  }
  
  const minutes = Math.floor(absSeconds / 60);
  if (minutes < 60) {
    return `${minutes} minuto${minutes !== 1 ? 's' : ''}`;
  }
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  
  if (remainingMinutes === 0) {
    return `${hours} hora${hours !== 1 ? 's' : ''}`;
  }
  
  return `${hours} hora${hours !== 1 ? 's' : ''} y ${remainingMinutes} minuto${remainingMinutes !== 1 ? 's' : ''}`;
}
