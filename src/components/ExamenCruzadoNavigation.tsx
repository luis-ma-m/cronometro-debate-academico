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
import { CategoryConfig, PositionType } from '@/types/chronometer';
import { cn } from '@/lib/utils';

interface ExamenCruzadoNavigationProps {
  activeCategory: CategoryConfig | null;
  activePositionType: PositionType | null;
  onSelectPosition: (position: PositionType) => void;
  className?: string;
}

const ExamenCruzadoNavigation: React.FC<ExamenCruzadoNavigationProps> = ({
  activeCategory,
  activePositionType,
  onSelectPosition,
  className,
}) => {
  if (!activeCategory || activeCategory.timeExamenCruzadoFavor === undefined || activeCategory.timeExamenCruzadoContra === undefined) {
    return null;
  }

  const examenPositions: { type: PositionType; label: string; colorClass: string }[] = [
    { type: 'examen_favor', label: 'Examen Cruzado (A favor)', colorClass: 'bg-green-500 hover:bg-green-600' },
    { type: 'examen_contra', label: 'Examen Cruzado (En contra)', colorClass: 'bg-red-500 hover:bg-red-600' },
  ];

  return (
    <div className={cn("flex justify-center space-x-2 my-3", className)}>
      {examenPositions.map((pos) => (
        <Button
          key={pos.type}
          variant={activePositionType === pos.type ? 'default' : 'outline'}
           className={cn(
            "text-white",
            activePositionType === pos.type ? (pos.type === 'examen_favor' ? 'bg-green-700' : 'bg-red-700') : pos.colorClass
          )}
          onClick={() => onSelectPosition(pos.type)}
        >
          {pos.label}
        </Button>
      ))}
    </div>
  );
};

export default ExamenCruzadoNavigation;
