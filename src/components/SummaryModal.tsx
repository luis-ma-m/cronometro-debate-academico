
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TimerInstance, CategoryConfig, PositionType } from '@/types/chronometer';
import { formatTime } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import QuestionSummary from './QuestionSummary';

interface SummaryCategoryData {
  categoryId: string;
  categoryName: string;
  categoryType: CategoryConfig['type'];
  questions?: CategoryConfig['questions'];
  timers: TimerInstance[];
}

interface SummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  summaryData: SummaryCategoryData[];
  allCategories: CategoryConfig[];
}

const SummaryModal: React.FC<SummaryModalProps> = ({ isOpen, onClose, summaryData, allCategories }) => {
  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]" aria-describedby="summary-description">
        <DialogHeader>
          <DialogTitle>Resumen de Tiempos</DialogTitle>
        </DialogHeader>
        <div id="summary-description" className="sr-only">
          Resumen de todos los tiempos de debate y estado de preguntas
        </div>
        <ScrollArea className="max-h-[70vh] p-1">
          <div className="py-4 pr-4">
            {summaryData.length === 0 && <p>No hay datos de temporizadores aún.</p>}
            {summaryData.map((categoryData) => (
              <div key={categoryData.categoryId} className="mb-6 p-4 border rounded-md bg-card">
                <h3 className="font-semibold text-lg mb-3">{categoryData.categoryName}</h3>
                <div className="space-y-2">
                  {categoryData.timers.map((timer) => {
                    let positionName = "";
                    if (timer.positionId === 'favor') positionName = "A favor";
                    else if (timer.positionId === 'contra') positionName = "En contra";
                    else if (timer.positionId === 'examen_favor') positionName = "Examen Cruzado (A favor)";
                    else if (timer.positionId === 'examen_contra') positionName = "Examen Cruzado (En contra)";
                    
                    const isRefutacionSpeech = categoryData.categoryType === 'refutacion' && 
                                               (timer.positionId === 'favor' || timer.positionId === 'contra');

                    // Get the current category data to ensure we have the latest question state
                    const currentCategory = allCategories.find(cat => cat.id === categoryData.categoryId);

                    return (
                      <div key={timer.id} className="flex justify-between items-start py-2 px-3 rounded bg-muted/30">
                        <div className="flex-1">
                          <span className="font-medium">{positionName}:</span>
                          {isRefutacionSpeech && currentCategory && (
                            <div className="mt-1">
                              <QuestionSummary 
                                categoryId={categoryData.categoryId} 
                                side={timer.positionId as 'favor' | 'contra'} 
                                allCategories={allCategories} 
                              />
                            </div>
                          )}
                        </div>
                        <div className="text-right ml-4">
                          <span className={`font-mono text-lg font-bold ${timer.currentTime < 0 ? 'text-red-600' : 'text-foreground'}`}>
                            {formatTime(timer.currentTime)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  {categoryData.timers.length === 0 && 
                    <p className="text-sm text-muted-foreground italic p-2">
                      Temporizadores no iniciados para esta categoría.
                    </p>
                  }
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">Cerrar</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SummaryModal;
