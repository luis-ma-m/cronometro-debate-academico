
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TimerInstance } from '@/types/chronometer';
import { formatTime } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

interface SummaryCategoryData {
  categoryName: string;
  timers: TimerInstance[];
}

interface SummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  summaryData: SummaryCategoryData[];
}

const SummaryModal: React.FC<SummaryModalProps> = ({ isOpen, onClose, summaryData }) => {
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
          {summaryData.map((categoryData, index) => (
            <div key={index} className="mb-4 p-3 border rounded-md">
              <h3 className="font-semibold text-lg mb-2">{categoryData.categoryName}</h3>
              {categoryData.timers.map((timer) => {
                // Get position name based on timer position ID
                let positionName = "";
                if (timer.positionId === 'favor') positionName = "A favor";
                else if (timer.positionId === 'contra') positionName = "En contra";
                else if (timer.positionId === 'examen_favor') positionName = "Examen Cruzado (A favor)";
                else if (timer.positionId === 'examen_contra') positionName = "Examen Cruzado (En contra)";
                
                return (
                  <div key={timer.id} className="flex justify-between items-center text-sm mb-1">
                    <span>{positionName}:</span>
                    <span className={`font-medium ${timer.currentTime < 0 ? 'text-red-600' : ''}`}>
                      {formatTime(timer.currentTime)}
                    </span>
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
