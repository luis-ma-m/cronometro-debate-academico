/**
 * MIT License
 * Copyright (c) 2025 Luis Martín Maíllo
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 */

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
  let timeTextClasses = ""; 
  let positionNameClasses = "font-semibold";
  let timeValueClasses = "font-bold whitespace-nowrap";
  let iconSizeClass = "h-6 w-6";
  let buttonSize: "icon" | "lg" = "icon";
  
  let timeDigitsContainerClasses = "p-2 rounded bg-transparent";
  let mainContainerAlertBgClass = ""; 

  if (size === 'large') {
    positionNameClasses += " text-3xl md:text-4xl mb-4";
    timeValueClasses += " text-[12rem] md:text-[16rem]";
    iconSizeClass = "h-8 w-8 md:h-10 md:h-10";
    buttonSize = "lg";
    timeDigitsContainerClasses = "p-4 md:p-6 rounded bg-transparent";
  } else {
    positionNameClasses += " text-xl";
    timeValueClasses += " text-[7.5rem]";
  }

  // Determine alert states and corresponding classes
  if (time <= settings.positiveWarningThreshold && time > 0) { // Positive warning
    mainContainerAlertBgClass = "animate-yellow-blink"; 
    timeTextClasses = "text-black"; // Ensure contrast on yellow background
  } else if (time < 0) { // Any negative time
    timeTextClasses = "text-red-600"; // Text turns red for any negative time
    if (time < settings.negativeWarningThreshold) { // Negative time AND past the threshold
      mainContainerAlertBgClass = "bg-soft-red"; // Box turns pale red
    }
    // If time is negative but not past negativeWarningThreshold, 
    // mainContainerAlertBgClass remains empty, so box stays default color (white/card).
    // timeTextClasses is already set to text-red-600.
  }
  // If none of the above (e.g. time is positive and above positiveWarningThreshold), 
  // mainContainerAlertBgClass and timeTextClasses remain empty (default appearance).

  return (
    <div
      className={cn(
        'rounded-lg flex flex-col items-center space-y-3',
        // Background only applies when an alert class is present
        mainContainerAlertBgClass,
        // Padding and layout classes
        size === 'large' ? 'p-6 md:p-8 w-fit mx-auto inline-block' : 'p-4 w-fit inline-block'
      )}
    >
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

