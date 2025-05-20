
import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CategoryConfig, GlobalSettings } from '@/types/chronometer';
import { ScrollArea } from '@/components/ui/scroll-area';

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
    setCategories(JSON.parse(JSON.stringify(currentCategories))); // Deep copy
    setSettings(JSON.parse(JSON.stringify(currentSettings))); // Deep copy
  }, [isOpen, currentCategories, currentSettings]);

  const handleCategoryChange = (index: number, field: keyof CategoryConfig, value: string | number) => {
    const newCategories = [...categories];
    if (field === 'name') {
      newCategories[index][field] = value as string;
    } else {
      // Ensure times are numbers and non-negative, convert minutes to seconds
      const numValue = Number(value);
      if (!isNaN(numValue)) {
        newCategories[index][field as 'timeFavor' | 'timeContra'] = Math.max(0, numValue) * 60;
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

  const handleSave = () => {
    onSave(categories, settings);
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

          <h3 className="font-semibold text-lg mt-4 mb-2">Categorías</h3>
          {categories.map((cat, index) => (
            <div key={cat.id} className="border p-3 rounded-md space-y-2">
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
