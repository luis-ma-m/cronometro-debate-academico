
import React from 'react';
import { Button } from '@/components/ui/button';
import { Play, Pause, RotateCcw } from 'lucide-react';
import { formatTime } from '@/lib/utils';
import { GlobalSettings } from '@/types/chronometer';
import { cn } from '@/lib/utils';

interface DebateTimerDisplayProps {
  time: number; // current time in seconds
  isRunning: boolean;
  onStartPause: () => void;
  onReset: () => void;
  settings: Pick<GlobalSettings, 'positiveWarningThreshold' | 'negativeWarningThreshold'>;
  baseBgColor: string; // e.g., 'bg-soft-green' or 'bg-soft-red' - for the overall card
  positionName: string;
  size?: 'normal' | 'large';
}

const DebateTimerDisplay: React.FC<DebateTimerDisplayProps> = ({
  time,
  isRunning,
  onStartPause,
  onReset,
  settings,
  baseBgColor,
  positionName,
  size = 'normal',
}) => {
  let timeTextClasses = ""; // For text color, defaults to inherit or card foreground
  let positionNameClasses = "font-semibold";
  let timeValueClasses = "font-bold";
  let iconSizeClass = "h-6 w-6";
  let buttonSize: "icon" | "lg" = "icon";
  
  let timeDigitsContainerClasses = "p-2 rounded bg-transparent";
  let mainContainerAlertBgClass = ""; 

  if (size === 'large') {
    positionNameClasses += " text-3xl md:text-4xl mb-4";
    timeValueClasses += " text-8xl md:text-9xl";
    iconSizeClass = "h-8 w-8 md:h-10 md:h-10";
    buttonSize = "lg";
    timeDigitsContainerClasses = "p-4 md:p-6 rounded bg-transparent";
  } else {
    positionNameClasses += " text-xl";
    timeValueClasses += " text-6xl";
  }

  // Determine alert states and corresponding classes
  if (time < settings.negativeWarningThreshold) { // More negative than the threshold
    mainContainerAlertBgClass = "bg-soft-red"; 
    timeTextClasses = "text-strong-red"; 
  } else if (time < 0) { // Negative, but not past the negativeWarningThreshold
    mainContainerAlertBgClass = "bg-soft-red";
    // timeTextClasses remains default (not strong red)
  } else if (time <= settings.positiveWarningThreshold && time > 0) { // Positive warning
    mainContainerAlertBgClass = "animate-yellow-blink"; 
    timeTextClasses = "text-black"; 
  }
  // If none of the above, mainContainerAlertBgClass and timeTextClasses remain empty.

  return (
    <div className={cn(
      `rounded-lg shadow flex flex-col items-center space-y-3`,
      // Apply base background if no alert background is set
      mainContainerAlertBgClass 
        ? mainContainerAlertBgClass 
        : (size === 'large' ? 'bg-card' : baseBgColor),
      // Paddings are applied regardless of alert state
      size === 'large' ? 'p-6 md:p-8 w-full max-w-md mx-auto' : 'p-4'
    )}>
      <h3 className={positionNameClasses}>{positionName}</h3>
      <div className={cn(timeValueClasses, timeDigitsContainerClasses, timeTextClasses)}>
        {formatTime(time)}
      </div>
      <div className="flex space-x-2 md:space-x-4">
        <Button onClick={onStartPause} variant="outline" size={buttonSize} aria-label={isRunning ? "Pausar" : "Iniciar"}>
          {isRunning ? <Pause className={iconSizeClass} /> : <Play className={iconSizeClass} />}
        </Button>
        <Button onClick={onReset} variant="outline" size={buttonSize} aria-label="Reiniciar">
          <RotateCcw className={iconSizeClass} />
        </Button>
      </div>
    </div>
  );
};

export default DebateTimerDisplay;
