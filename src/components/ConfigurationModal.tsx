import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CategoryConfig, GlobalSettings } from '@/types/chronometer';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PlusCircle, Trash2 } from 'lucide-react';

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
    // Deep copy to avoid mutating parent state directly
    setCategories(JSON.parse(JSON.stringify(currentCategories))); 
    setSettings(JSON.parse(JSON.stringify(currentSettings)));
  }, [isOpen, currentCategories, currentSettings]);

  const handleCategoryChange = (index: number, field: keyof CategoryConfig, value: string | number) => {
    const newCategories = [...categories];
    const categoryToUpdate = newCategories[index];

    if (field === 'name') {
      categoryToUpdate[field] = value as string;
    } else if (field === 'timeFavor' || field === 'timeContra' || field === 'timeExamenCruzadoFavor' || field === 'timeExamenCruzadoContra') {
      const numValue = Number(value);
      if (!isNaN(numValue)) {
        // Store as seconds (value from input is minutes)
        categoryToUpdate[field] = Math.max(0, numValue) * 60;
      }
    } else {
      // For other fields like 'id', or future string fields.
      // For now, we only edit name and times.
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
        timeContra: 3 * 60, // Default to 3 minutes
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
    // Ensure Examen Cruzado fields are numbers or undefined
    const processedCategories = categories.map(cat => ({
      ...cat,
      timeExamenCruzadoFavor: cat.timeExamenCruzadoFavor !== undefined ? Number(cat.timeExamenCruzadoFavor) : undefined,
      timeExamenCruzadoContra: cat.timeExamenCruzadoContra !== undefined ? Number(cat.timeExamenCruzadoContra) : undefined,
    }));
    onSave(processedCategories, settings);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Configuración del Cronómetro</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh] p-1">
        <div className="grid gap-4 py-4 pr-4">
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
          {categories.map((cat, index) => (
            <div key={cat.id || index} className="border p-3 pr-12 rounded-md space-y-3 relative">
              <Button 
                variant="ghost" 
                size="icon" 
                className="absolute top-2 right-2 text-destructive hover:text-destructive/80"
                onClick={() => handleDeleteCategory(index)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor={`catName-${index}`} className="text-right col-span-1">Nombre</Label>
                <Input id={`catName-${index}`} value={cat.name} onChange={(e) => handleCategoryChange(index, 'name', e.target.value)} className="col-span-3" />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor={`timeFavor-${index}`} className="text-right col-span-1">Tiempo Favor (min)</Label>
                <Input id={`timeFavor-${index}`} type="number" value={cat.timeFavor / 60} onChange={(e) => handleCategoryChange(index, 'timeFavor', e.target.value)} className="col-span-3" />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor={`timeContra-${index}`} className="text-right col-span-1">Tiempo Contra (min)</Label>
                <Input id={`timeContra-${index}`} type="number" value={cat.timeContra / 60} onChange={(e) => handleCategoryChange(index, 'timeContra', e.target.value)} className="col-span-3" />
              </div>
              
              {/* Examen Cruzado fields - shown if category is 'Introducción' or they are already defined */}
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
          ))}
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
