
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TimerInstance, CategoryConfig, PositionType } from '@/types/chronometer'; // Added CategoryConfig
import { formatTime } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import QuestionSummary from './QuestionSummary'; // Import QuestionSummary

interface SummaryCategoryData {
  categoryId: string; // Ensured this is passed from DebateChronometerPage
  categoryName: string;
  categoryType: CategoryConfig['type']; // More specific type
  questions?: CategoryConfig['questions'];
  timers: TimerInstance[];
}

interface SummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  summaryData: SummaryCategoryData[];
  allCategories: CategoryConfig[]; // Added allCategories prop
}

const SummaryModal: React.FC<SummaryModalProps> = ({ isOpen, onClose, summaryData, allCategories }) => {
  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Resumen de Tiempos</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh] p-1">
        <div className="py-4 pr-4">
          {summaryData.length === 0 && <p>No hay datos de temporizadores aún.</p>}
          {summaryData.map((categoryData) => (
            <div key={categoryData.categoryId} className="mb-4 p-3 border rounded-md">
              <h3 className="font-semibold text-lg mb-2">{categoryData.categoryName}</h3>
              {categoryData.timers.map((timer) => {
                let positionName = "";
                if (timer.positionId === 'favor') positionName = "A favor";
                else if (timer.positionId === 'contra') positionName = "En contra";
                else if (timer.positionId === 'examen_favor') positionName = "Examen Cruzado (A favor)";
                else if (timer.positionId === 'examen_contra') positionName = "Examen Cruzado (En contra)";
                
                const isRefutacionSpeech = categoryData.categoryType === 'refutacion' && 
                                           (timer.positionId === 'favor' || timer.positionId === 'contra');

                return (
                  <div key={timer.id} className="flex justify-between items-start text-sm mb-1 py-1">
                    <span>{positionName}:</span>
                    <div className="flex flex-col items-end text-right">
                      <span className={`font-medium ${timer.currentTime < 0 ? 'text-red-600' : ''}`}>
                        {formatTime(timer.currentTime)}
                      </span>
                      {isRefutacionSpeech && (
                        <QuestionSummary 
                          categoryId={categoryData.categoryId} 
                          side={timer.positionId as 'favor' | 'contra'} 
                          allCategories={allCategories} 
                        />
                      )}
                    </div>
                  </div>
                );
              })}
              {categoryData.timers.length === 0 && 
                <p className="text-xs text-muted-foreground">
                  Temporizadores no iniciados para esta categoría.
                </p>
              }
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

