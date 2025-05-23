import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CategoryConfig, GlobalSettings, CategoryType, Question } from '@/types/chronometer';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PlusCircle, Trash2 } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";

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
    // Deep clone and add default type if missing (legacy handling)
    const processed = currentCategories.map((cat, index) => {
      const newCat = JSON.parse(JSON.stringify(cat));
      if (!newCat.type) {
        newCat.type = 'conclusion'; // Default legacy categories
      }
      if (newCat.type === 'refutacion' && newCat.minQuestions === undefined) {
        newCat.minQuestions = 0;
      }
      if (newCat.type === 'refutacion' && !newCat.questions) {
        newCat.questions = []; // Initialize if missing
      }
      if (newCat.type === 'introduccion' && newCat.hasExamenCruzado === undefined) {
        newCat.hasExamenCruzado = false;
      }
      return { ...newCat, originalIndex: index };
    });
    setCategories(processed);
    setSettings(JSON.parse(JSON.stringify(currentSettings)));
  }, [isOpen, currentCategories, currentSettings]);

  const handleCategoryChange = (index: number, field: keyof CategoryConfig | 'timePerSpeaker' | 'categoryType', value: string | number | boolean | CategoryType) => {
    const newCategories = [...categories];
    const categoryToUpdate = newCategories[index];

    if (field === 'name') {
      categoryToUpdate[field] = value as string;
    } else if (field === 'timePerSpeaker') {
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
    } else if (field === 'categoryType') {
      categoryToUpdate.type = value as CategoryType;
      // Reset/default specific fields when type changes
      if (value !== 'introduccion') {
        delete categoryToUpdate.hasExamenCruzado;
      } else if (categoryToUpdate.hasExamenCruzado === undefined) {
         categoryToUpdate.hasExamenCruzado = false;
      }
      if (value !== 'refutacion') {
        delete categoryToUpdate.minQuestions;
        delete categoryToUpdate.questions;
      } else {
        if (categoryToUpdate.minQuestions === undefined) categoryToUpdate.minQuestions = 0;
        if (!categoryToUpdate.questions) categoryToUpdate.questions = [];
      }
    } else if (field === 'hasExamenCruzado') {
       if (categoryToUpdate.type === 'introduccion') {
         categoryToUpdate.hasExamenCruzado = value as boolean;
       }
    } else if (field === 'minQuestions') {
      if (categoryToUpdate.type === 'refutacion') {
        const numValue = Number(value);
        categoryToUpdate.minQuestions = isNaN(numValue) ? 0 : Math.max(0, numValue);
        // Optionally adjust questions array if minQuestions changes
        // For simplicity, we'll let the question tracker handle actual question instances
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
        timeFavor: 3 * 60,
        timeContra: 3 * 60,
        type: 'conclusion', // Default new categories to 'conclusion'
        // Initialize type-specific fields as undefined or default
        hasExamenCruzado: false, // default for 'introduccion', relevant if type changes
        minQuestions: 0,       // default for 'refutacion'
        questions: [],         // default for 'refutacion'
      }
    ]);
  };

  const handleDeleteCategory = (index: number) => {
    setCategories(prev => prev.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    const processedCategories = categories.map(cat => {
      const { originalIndex, ...restOfCat } = cat; // Remove originalIndex before saving
      const finalCat: CategoryConfig = { ...restOfCat };

      if (finalCat.type !== 'introduccion') {
        delete finalCat.hasExamenCruzado;
        delete finalCat.examenCruzadoIntroduccionUsed;
      }
      if (finalCat.type !== 'refutacion') {
        delete finalCat.minQuestions;
        delete finalCat.questions;
      }
      // Ensure numeric conversion for optional times
      finalCat.timeExamenCruzadoFavor = finalCat.timeExamenCruzadoFavor !== undefined ? Number(finalCat.timeExamenCruzadoFavor) : undefined;
      finalCat.timeExamenCruzadoContra = finalCat.timeExamenCruzadoContra !== undefined ? Number(finalCat.timeExamenCruzadoContra) : undefined;
      
      return finalCat;
    });
    onSave(processedCategories, settings);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Configuración del Cronómetro</DialogTitle>
          <DialogDescription>
            Ajusta los tiempos, nombres de categorías y configuraciones globales del cronómetro.
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
          <div className="space-y-3">
            {categories.map((cat, index) => (
              <div
                key={cat.id || `cat-${index}`}
                className="border p-3 pr-12 rounded-md space-y-3 relative bg-card"
              >
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="absolute top-2 right-2 text-destructive hover:text-destructive/80"
                  onClick={() => handleDeleteCategory(index)}
                  aria-label="Eliminar categoría"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
                <div> 
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

                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label className="text-right col-span-1">Tipo de Intervención</Label>
                    <RadioGroup
                      value={cat.type}
                      onValueChange={(value) => handleCategoryChange(index, 'categoryType', value as CategoryType)}
                      className="col-span-3 flex space-x-2 items-center"
                    >
                      {(['introduccion', 'refutacion', 'conclusion'] as CategoryType[]).map(typeValue => (
                        <div key={typeValue} className="flex items-center space-x-1">
                          <RadioGroupItem value={typeValue} id={`type-${index}-${typeValue}`} />
                          <Label htmlFor={`type-${index}-${typeValue}`} className="capitalize text-sm font-normal">
                            {typeValue === 'introduccion' ? 'Introducción' : typeValue === 'refutacion' ? 'Refutación' : 'Conclusión'}
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>

                  {cat.type === 'introduccion' && (
                    <div className="grid grid-cols-4 items-center gap-4">
                      <Label htmlFor={`hasExamenCruzado-${index}`} className="text-right col-span-1">Permitir Examen Cruzado</Label>
                      <div className="col-span-3 flex items-center">
                        <Switch
                          id={`hasExamenCruzado-${index}`}
                          checked={cat.hasExamenCruzado || false}
                          onCheckedChange={(checked) => handleCategoryChange(index, 'hasExamenCruzado', checked)}
                        />
                      </div>
                    </div>
                  )}

                  {cat.type === 'refutacion' && (
                    <div className="grid grid-cols-4 items-center gap-4">
                      <Label htmlFor={`minQuestions-${index}`} className="text-right col-span-1">Preguntas Mínimas</Label>
                      <Input 
                        id={`minQuestions-${index}`} 
                        type="number" 
                        value={cat.minQuestions ?? 0} 
                        onChange={(e) => handleCategoryChange(index, 'minQuestions', e.target.value)} 
                        className="col-span-3" 
                        min="0"
                        placeholder="0"
                      />
                    </div>
                  )}
                  
                  {(cat.timeExamenCruzadoFavor !== undefined || cat.timeExamenCruzadoContra !== undefined || cat.id.startsWith('new_cat_')) && (
                    <>
                      <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor={`timeExamenFavor-${index}`} className="text-right col-span-1">Examen Favor (min)</Label>
                        <Input 
                          id={`timeExamenFavor-${index}`} 
                          type="number" 
                          value={(cat.timeExamenCruzadoFavor ?? 0) / 60} 
                          onChange={(e) => handleCategoryChange(index, 'timeExamenCruzadoFavor', e.target.value)} 
                          className="col-span-3" 
                          placeholder="Opcional (min)"
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
                          placeholder="Opcional (min)"
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
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
