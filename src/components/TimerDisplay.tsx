// src/components/TimerDisplay.tsx
import React from 'react'
import { cn } from '@/lib/utils'
import { formatTime } from '@/utils/formatTime'

export interface TimerDisplayProps {
  /** Current time in seconds (can be negative) */
  time: number
  isRunning: boolean
  /** Initial configured time in seconds */
  initialTime: number
  title?: string
  size?: 'normal' | 'large'
  /** Seconds remaining at which to show a warning (time > 0) */
  warningThreshold?: number
  /** Negative seconds at which to start pulsing (e.g. -10) */
  negativeWarningThreshold?: number
}

const TimerDisplay: React.FC<TimerDisplayProps> = ({
  time,
  isRunning,
  initialTime,
  title,
  size = 'normal',
  warningThreshold = 60,
  negativeWarningThreshold = -10,
}) => {
  // Derived states
  const isWarning = time > 0 && time <= warningThreshold
  const isExpired = time === 0
  const isNegative = time < 0
  const isNegativeWarning = time <= negativeWarningThreshold


  // Container background / border / animation
  const containerClasses = cn(
    'rounded-lg flex flex-col items-center space-y-4 transition-all duration-300',
    size === 'large' ? 'p-8 w-fit mx-auto inline-block' : 'p-6 w-fit inline-block',
    {
      // Default appearance (also used for negative time above threshold)
      'bg-card': !isWarning && !isExpired && !isNegativeWarning,

      // Warning (approaching zero)
      'bg-yellow-50 border-2 border-yellow-400': isWarning,

      // Expired exactly at zero
      'bg-red-100 border-2 border-red-600': isExpired,

      // Negative time past the configured threshold
      'bg-soft-red border-2 border-red-600': isNegativeWarning,
    }
  )

  // Title styling
  const titleClasses = cn(
    'font-semibold text-center',
    size === 'large' ? 'text-2xl mb-2' : 'text-lg mb-1'
  )

  // Time text styling
  const timeClasses = cn(
    'font-mono font-bold tabular-nums whitespace-nowrap',
    size === 'large' ? 'text-[7.5rem] md:text-[9rem]' : 'text-7xl',
    {
      'text-foreground': !isWarning && !isExpired && !isNegative,
      'text-yellow-700': isWarning,
      'text-red-600': isExpired || isNegative,
    }
  )

  return (
    <div className={containerClasses}>
      {title && <h2 className={titleClasses}>{title}</h2>}

      <div className={timeClasses}>
        {formatTime(time)}
      </div>

    </div>
  )
}

export default TimerDisplay
