
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { formatTime as formatTimeUtil } from "@/utils/formatTime"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Re-export formatTime from utils for backward compatibility
export const formatTime = formatTimeUtil
