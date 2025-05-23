
import React from 'react';
import { Circle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StyledQuestionIconProps {
  isFilled: boolean;
  isAlertUnfilled: boolean;
  className?: string;
}

const StyledQuestionIcon: React.FC<StyledQuestionIconProps> = ({ isFilled, isAlertUnfilled, className }) => {
  if (isFilled) {
    // Answered: Solid primary fill, primary border
    return <Circle className={cn("h-4 w-4 fill-primary text-primary", className)} />;
  }

  if (isAlertUnfilled) {
    // Unanswered-alert: Yellow fill (using fill-yellow-400), icon lines take background color
    return <AlertCircle className={cn("h-4 w-4 fill-yellow-400 text-background", className)} />;
  }

  // Unanswered-neutral: Grey border, no fill
  return <Circle className={cn("h-4 w-4 text-muted-foreground fill-transparent stroke-current", className)} />;
};

export default StyledQuestionIcon;
