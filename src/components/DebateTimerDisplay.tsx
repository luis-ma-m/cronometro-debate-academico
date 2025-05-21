
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
  baseBgColor, // This is for the card container if used, not directly for digits background anymore.
  positionName,
  size = 'normal',
}) => {
  let timeDigitsContainerClasses = "p-2 rounded transition-colors duration-300";
  let timeTextClasses = ""; // For text color, defaults to inherit or card foreground
  let positionNameClasses = "font-semibold";
  let timeValueClasses = "font-bold";
  let iconSizeClass = "h-6 w-6";
  let buttonSize: "icon" | "lg" = "icon";
  
  if (size === 'large') {
    positionNameClasses += " text-3xl md:text-4xl mb-4";
    timeValueClasses += " text-8xl md:text-9xl";
    iconSizeClass = "h-8 w-8 md:h-10 md:h-10";
    buttonSize = "lg";
    timeDigitsContainerClasses += " p-4 md:p-6"; // Larger padding for larger display
  } else {
    positionNameClasses += " text-xl";
    timeValueClasses += " text-6xl";
  }

  if (time < 0) {
    timeTextClasses = "text-strong-red"; 
    // For negative times, make digits background transparent or very subtle
    // The card's baseBgColor (e.g. soft-red) still applies to the surrounding card.
    timeDigitsContainerClasses += " bg-transparent"; 
  } else if (time <= settings.positiveWarningThreshold && time > 0) {
    timeDigitsContainerClasses += " bg-pale-yellow animate-yellow-blink";
    timeTextClasses = "text-black"; // Ensure contrast on yellow
  } else {
    // Default state, no specific alert coloring for digits background
    timeDigitsContainerClasses += " bg-transparent"; // Or a default subtle background from card
  }

  return (
    <div className={cn(
      `rounded-lg shadow flex flex-col items-center space-y-3`,
      size === 'large' ? 'p-6 md:p-8 w-full max-w-md mx-auto bg-card' : `p-4 ${baseBgColor}`
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
