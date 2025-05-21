
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatTime(totalSeconds: number): string {
  const absSeconds = Math.floor(Math.abs(totalSeconds)); // Changed to use Math.floor
  const minutes = Math.floor(absSeconds / 60);
  const seconds = absSeconds % 60;
  const sign = totalSeconds < 0 ? "-" : "";
  return `${sign}${String(minutes).padStart(1, '0')}:${String(seconds).padStart(2, '0')}`;
}

