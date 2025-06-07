
import React from 'react';
import { cn } from '@/lib/utils';
import { formatTime } from '@/utils/formatTime';

interface TimerDisplayProps {
  time: number; // current time in seconds
  isRunning: boolean;
  initialTime: number;
  title?: string;
  size?: 'normal' | 'large';
  showProgress?: boolean;
  warningThreshold?: number;
}

const TimerDisplay: React.FC<TimerDisplayProps> = ({
  time,
  isRunning,
  initialTime,
  title,
  size = 'normal',
  showProgress = true,
  warningThreshold = 60
}) => {
  const percentage = Math.max(0, (time / initialTime) * 100);
  
  // Determine alert state
  const isWarning = time <= warningThreshold && time > 0;
  const isExpired = time <= 0;

  // Style classes based on size
  const containerClasses = cn(
    'rounded-lg flex flex-col items-center space-y-4 transition-all duration-300',
    size === 'large' ? 'p-8 w-full max-w-md mx-auto' : 'p-6',
    {
const containerClasses = cn(
  'rounded-lg flex flex-col items-center space-y-4 transition-all duration-300',
  size === 'large' ? 'p-8 w-full max-w-md mx-auto' : 'p-6',
  {
    'bg-card': !isWarning && !isExpired,
    'bg-yellow-50 border-2 border-yellow-400': isWarning,
    'bg-red-100 border-2 border-red-600': isExpired,
    'animate-pulse': isRunning && isExpired,
  }
);
 main
      'bg-yellow-50 border-2 border-yellow-400': isWarning,
      'bg-red-100 border-2 border-red-600': isExpired,
      'animate-pulse': isRunning && isExpired
    }
  );

  const titleClasses = cn(
    'font-semibold text-center',
    size === 'large' ? 'text-2xl mb-2' : 'text-lg mb-1'
  );

  const timeClasses = cn(
    'font-mono font-bold tabular-nums',
    size === 'large' ? 'text-6xl md:text-7xl' : 'text-4xl',
    {
      'text-foreground': !isWarning && !isExpired,
      'text-yellow-700': isWarning,
      'text-red-800': isExpired
    }
  );

  return (
    <div className={containerClasses}>
      {title && (
        <h2 className={titleClasses}>{title}</h2>
      )}
      
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
                  'bg-green-500': !isWarning && !isExpired,
                  'bg-yellow-500': isWarning,
                  'bg-red-500': isExpired
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
  );
};

export default TimerDisplay;
