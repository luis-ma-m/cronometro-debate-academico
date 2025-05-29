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
    // Unanswered-alert: Yellow fill, dark yellow icon lines for contrast
    return <AlertCircle className={cn("h-4 w-4 fill-yellow-400 text-yellow-700", className)} />;
  }

  // Unanswered-neutral: Grey border, no fill
  return <Circle className={cn("h-4 w-4 text-muted-foreground fill-transparent stroke-current", className)} />;
};

export default StyledQuestionIcon;
