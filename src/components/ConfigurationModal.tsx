import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CategoryConfig, GlobalSettings } from '@/types/chronometer';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PlusCircle, Trash2, GripVertical } from 'lucide-react';
import { DragDropContext, Droppable, Draggable, DropResult } from 'react-beautiful-dnd';

interface ConfigurationModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentCategories: CategoryConfig[];
  currentSettings: GlobalSettings;
  onSave: (newCategories: CategoryConfig[], newSettings: GlobalSettings) => void;
}

const ConfigurationModal: React.FC<ConfigurationModalProps> = ({
  isOpen,
  onClose,
  currentCategories,
  currentSettings,
  onSave,
}) => {
  const [categories, setCategories] = useState<CategoryConfig[]>([]);
  const [settings, setSettings] = useState<GlobalSettings>(currentSettings);

  useEffect(() => {
    setCategories(JSON.parse(JSON.stringify(currentCategories.map((cat, index) => ({ ...cat, originalIndex: index })))));
    setSettings(JSON.parse(JSON.stringify(currentSettings)));
  }, [isOpen, currentCategories, currentSettings]);

  const handleCategoryChange = (index: number, field: keyof CategoryConfig | 'timePerSpeaker', value: string | number) => {
    const newCategories = [...categories];
    const categoryToUpdate = newCategories[index];

    if (field === 'name') {
      categoryToUpdate[field] = value as string;
    } else if (field === 'timePerSpeaker') { // Unified time input for Favor/Contra
      const numValue = Number(value);
      if (!isNaN(numValue)) {
        const timeInSeconds = Math.max(0, numValue) * 60;
        categoryToUpdate.timeFavor = timeInSeconds;
        categoryToUpdate.timeContra = timeInSeconds;
      }
    } else if (field === 'timeExamenCruzadoFavor' || field === 'timeExamenCruzadoContra') {
      const numValue = Number(value);
      if (!isNaN(numValue)) {
        categoryToUpdate[field] = Math.max(0, numValue) * 60;
      }
    }
    setCategories(newCategories);
  };
  
  const handleSettingChange = (field: keyof GlobalSettings, value: string | number) => {
    setSettings(prev => {
      if (typeof prev[field] === 'number') {
        const numValue = Number(value);
        return { ...prev, [field]: isNaN(numValue) ? prev[field] : numValue };
      }
      return { ...prev, [field]: value };
    });
  };

  const handleAddCategory = () => {
    setCategories(prev => [
      ...prev,
      {
        id: `new_cat_${Date.now()}`,
        name: 'Nueva Categoría',
        timeFavor: 3 * 60, // Default to 3 minutes
        timeContra: 3 * 60, // Default to 3 minutes (synced with timeFavor)
        // Examen Cruzado times can be undefined by default or set to 0
        // timeExamenCruzadoFavor: 0,
        // timeExamenCruzadoContra: 0,
      }
    ]);
  };

  const handleDeleteCategory = (index: number) => {
    setCategories(prev => prev.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    const processedCategories = categories.map(cat => ({
      ...cat,
      timeExamenCruzadoFavor: cat.timeExamenCruzadoFavor !== undefined ? Number(cat.timeExamenCruzadoFavor) : undefined,
      timeExamenCruzadoContra: cat.timeExamenCruzadoContra !== undefined ? Number(cat.timeExamenCruzadoContra) : undefined,
    }));
    onSave(processedCategories, settings);
    onClose();
  };

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) {
      return;
    }
    const items = Array.from(categories);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    setCategories(items);
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Configuración del Cronómetro</DialogTitle>
          <DialogDescription>
            Ajusta los tiempos, nombres de categorías y configuraciones globales del cronómetro. Puedes reordenar las categorías arrastrándolas.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh] p-1">
        <div className="grid gap-4 py-4 pr-2">
          <h3 className="font-semibold text-lg mb-2">Ajustes Globales</h3>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="h1Text" className="text-right col-span-1">Título H1</Label>
            <Input id="h1Text" value={settings.h1Text} onChange={(e) => handleSettingChange('h1Text', e.target.value)} className="col-span-3" />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="logoUrl" className="text-right col-span-1">URL del Logo</Label>
            <Input id="logoUrl" value={settings.logoUrl} onChange={(e) => handleSettingChange('logoUrl', e.target.value)} className="col-span-3" />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="positiveWarning" className="text-right col-span-1">Aviso Positivo (seg)</Label>
            <Input id="positiveWarning" type="number" value={settings.positiveWarningThreshold} onChange={(e) => handleSettingChange('positiveWarningThreshold', e.target.value)} className="col-span-3" />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="negativeWarning" className="text-right col-span-1">Aviso Negativo (seg)</Label>
            <Input id="negativeWarning" type="number" value={settings.negativeWarningThreshold} onChange={(e) => handleSettingChange('negativeWarningThreshold', e.target.value)} className="col-span-3" />
          </div>

          <div className="flex justify-between items-center mt-6 mb-2">
            <h3 className="font-semibold text-lg">Categorías</h3>
            <Button variant="outline" size="sm" onClick={handleAddCategory}>
              <PlusCircle className="mr-2 h-4 w-4" /> Añadir Categoría
            </Button>
          </div>
          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="categories">
              {(provided) => (
                <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-3">
                  {categories.map((cat, index) => (
                    <Draggable key={cat.id || `cat-${index}`} draggableId={String(cat.id || `cat-draggable-${index}`)} index={index}>
                      {(providedDraggable, snapshot) => (
                        <div
                          ref={providedDraggable.innerRef}
                          {...providedDraggable.draggableProps}
                          className={`border p-3 pr-12 rounded-md space-y-3 relative bg-card ${snapshot.isDragging ? 'shadow-lg ring-2 ring-primary' : ''}`}
                        >
                          <div 
                            {...providedDraggable.dragHandleProps} 
                            className="absolute top-1/2 -translate-y-1/2 left-1.5 p-1 cursor-grab"
                            aria-label="Arrastrar para reordenar"
                          >
                            <GripVertical className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="absolute top-2 right-2 text-destructive hover:text-destructive/80"
                            onClick={() => handleDeleteCategory(index)}
                            aria-label="Eliminar categoría"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          <div className="pl-6"> {/* Add padding to make space for drag handle */}
                            <div className="grid grid-cols-4 items-center gap-4">
                              <Label htmlFor={`catName-${index}`} className="text-right col-span-1">Nombre</Label>
                              <Input id={`catName-${index}`} value={cat.name} onChange={(e) => handleCategoryChange(index, 'name', e.target.value)} className="col-span-3" />
                            </div>
                            
                            <div className="grid grid-cols-4 items-center gap-4">
                              <Label htmlFor={`timePerSpeaker-${index}`} className="text-right col-span-1">Tiempo por Orador (min)</Label>
                              <Input 
                                id={`timePerSpeaker-${index}`} 
                                type="number" 
                                value={cat.timeFavor / 60} 
                                onChange={(e) => handleCategoryChange(index, 'timePerSpeaker', e.target.value)} 
                                className="col-span-3" 
                              />
                            </div>
                            
                            {(cat.id.startsWith('intro') || cat.timeExamenCruzadoFavor !== undefined || cat.timeExamenCruzadoContra !== undefined) && (
                              <>
                                <div className="grid grid-cols-4 items-center gap-4">
                                  <Label htmlFor={`timeExamenFavor-${index}`} className="text-right col-span-1">Examen Favor (min)</Label>
                                  <Input 
                                    id={`timeExamenFavor-${index}`} 
                                    type="number" 
                                    value={(cat.timeExamenCruzadoFavor ?? 0) / 60} 
                                    onChange={(e) => handleCategoryChange(index, 'timeExamenCruzadoFavor', e.target.value)} 
                                    className="col-span-3" 
                                    placeholder="0"
                                  />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                  <Label htmlFor={`timeExamenContra-${index}`} className="text-right col-span-1">Examen Contra (min)</Label>
                                  <Input 
                                    id={`timeExamenContra-${index}`} 
                                    type="number" 
                                    value={(cat.timeExamenCruzadoContra ?? 0) / 60} 
                                    onChange={(e) => handleCategoryChange(index, 'timeExamenCruzadoContra', e.target.value)} 
                                    className="col-span-3"
                                    placeholder="0"
                                  />
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </div>
        </ScrollArea>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">Cancelar</Button>
          </DialogClose>
          <Button type="button" onClick={handleSave}>Guardar Cambios</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ConfigurationModal;
