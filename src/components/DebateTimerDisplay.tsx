
import React from 'react';
import { Button } from '@/components/ui/button';
import { Play, Pause, RotateCcw } from 'lucide-react';
import { formatTime } from '@/lib/utils';
import { GlobalSettings } from '@/types/chronometer';

interface DebateTimerDisplayProps {
  time: number; // current time in seconds
  isRunning: boolean;
  onStartPause: () => void;
  onReset: () => void;
  settings: Pick<GlobalSettings, 'positiveWarningThreshold' | 'negativeWarningThreshold'>;
  baseBgColor: string; // e.g., 'bg-soft-green' or 'bg-soft-red'
  positionName: string; 
}

const DebateTimerDisplay: React.FC<DebateTimerDisplayProps> = ({
  time,
  isRunning,
  onStartPause,
  onReset,
  settings,
  baseBgColor,
  positionName,
}) => {
  let timerBgColor = baseBgColor; // This is for the whole card background
  let timeDigitsBgColor = 'bg-transparent'; // Default for time digits

  if (time < 0) {
    if (time < settings.negativeWarningThreshold) {
      timeDigitsBgColor = 'bg-strong-red text-white';
    } else {
      timeDigitsBgColor = 'bg-soft-red text-black'; // Or a darker text for contrast
    }
  } else if (time <= settings.positiveWarningThreshold) {
    timeDigitsBgColor = 'bg-pale-yellow text-black'; // Or a darker text
  }

  return (
    <div className={`p-4 rounded-lg shadow ${baseBgColor} flex flex-col items-center space-y-3`}>
      <h3 className="text-xl font-semibold">{positionName}</h3>
      <div className={`text-6xl font-bold p-2 rounded ${timeDigitsBgColor} transition-colors duration-300`}>
        {formatTime(time)}
      </div>
      <div className="flex space-x-2">
        <Button onClick={onStartPause} variant="outline" size="icon" aria-label={isRunning ? "Pausar" : "Iniciar"}>
          {isRunning ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
        </Button>
        <Button onClick={onReset} variant="outline" size="icon" aria-label="Reiniciar">
          <RotateCcw className="h-6 w-6" />
        </Button>
      </div>
    </div>
  );
};

export default DebateTimerDisplay;
