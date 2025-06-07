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
  showProgress?: boolean
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
  showProgress = true,
  warningThreshold = 60,
  negativeWarningThreshold = -10,
}) => {
  // Derived states
  const isWarning = time > 0 && time <= warningThreshold
  const isExpired = time === 0
  const isNegative = time < 0
  const isNegativeWarning = time <= negativeWarningThreshold

  // Percentage for progress bar (clamped 0–100)
  const percentage = Math.max(0, Math.min(100, (time / initialTime) * 100))

  // Container background / border / animation
  const containerClasses = cn(
    'rounded-lg flex flex-col items-center space-y-4 transition-all duration-300',
    size === 'large' ? 'p-8 w-full max-w-md mx-auto' : 'p-6',
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
    'font-mono font-bold tabular-nums',
    size === 'large' ? 'text-6xl md:text-7xl' : 'text-4xl',
    {
      'text-foreground': !isWarning && !isExpired && !isNegative,
      'text-yellow-700': isWarning,
      'text-red-800': isExpired || isNegative,
    }
  )

  return (
    <div className={containerClasses}>
      {title && <h2 className={titleClasses}>{title}</h2>}

      <div className={timeClasses}>
        {formatTime(time)}
      </div>

      {showProgress && (
        <div className="w-full">
          <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
            <div
              className={cn(
                'h-full transition-all duration-1000 ease-linear',
                {
                  'bg-green-500': !isWarning && !isExpired && !isNegative,
                  'bg-yellow-500': isWarning,
                  'bg-red-500': isExpired || isNegative,
                }
              )}
              style={{ width: `${percentage}%` }}
            />
          </div>
        </div>
      )}

      {isRunning && (
        <div className="text-sm text-muted-foreground">
          En ejecución...
        </div>
      )}
    </div>
  )
}

export default TimerDisplay
