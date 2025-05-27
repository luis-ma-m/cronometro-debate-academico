import * as React from 'react';
const { useState, useEffect } = React;
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CategoryConfig, GlobalSettings, CategoryType, Question } from '@/types/chronometer';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PlusCircle, Trash2 } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { v4 as uuidv4 } from 'uuid';

// Helper type for local state with string inputs for editable numeric fields
interface EditableCategoryConfig extends Omit<CategoryConfig, 'timeFavor' | 'timeContra' | 'timeExamenCruzadoFavor' | 'timeExamenCruzadoContra' | 'minQuestions'> {
  id: string; // Ensure id is always present
  name: string;
  type: CategoryType;
  hasExamenCruzado?: boolean;
  
  timePerSpeaker: string; // In minutes, as string
  timeExamenCruzadoFavor?: string; // In minutes, as string
  timeExamenCruzadoContra?: string; // In minutes, as string
  minQuestions?: string; // As string
  questions?: Question[]; // Keep as is

  originalIndex?: number;
  examenCruzadoIntroduccionUsed?: boolean;
}

interface EditableGlobalSettings extends Omit<GlobalSettings, 'positiveWarningThreshold' | 'negativeWarningThreshold'> {
  h1Text: string;
  logoUrl: string;
  positiveWarningThreshold: string; // In seconds, as string
  negativeWarningThreshold: string; // In seconds, as string
}

interface ValidationErrors {
  [key: string]: string | undefined; // e.g., 'categories[0].timePerSpeaker': 'Error message'
  settingsPositiveWarning?: string;
  settingsNegativeWarning?: string;
}

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
  const [categories, setCategories] = useState<EditableCategoryConfig[]>([]);
  const [settings, setSettings] = useState<EditableGlobalSettings>({
    h1Text: '',
    logoUrl: '',
    positiveWarningThreshold: '',
    negativeWarningThreshold: '',
  });
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});

  useEffect(() => {
    if (isOpen) {
      const processedCategories: EditableCategoryConfig[] = currentCategories.map((cat, index) => {
        const editableCat: EditableCategoryConfig = {
          id: cat.id,
          name: cat.name,
          type: cat.type || 'conclusion',
          timePerSpeaker: cat.timeFavor === 0 ? '' : String(cat.timeFavor / 60),
          questions: cat.questions ? [...cat.questions] : [], // Deep copy questions
          originalIndex: index,
          examenCruzadoIntroduccionUsed: cat.examenCruzadoIntroduccionUsed,
        };

        if (editableCat.type === 'introduccion') {
          editableCat.hasExamenCruzado = typeof cat.hasExamenCruzado === 'boolean' ? cat.hasExamenCruzado : false;
          if (editableCat.hasExamenCruzado) {
            editableCat.timeExamenCruzadoFavor = cat.timeExamenCruzadoFavor === undefined || cat.timeExamenCruzadoFavor === 0 ? '' : String(cat.timeExamenCruzadoFavor / 60);
            editableCat.timeExamenCruzadoContra = cat.timeExamenCruzadoContra === undefined || cat.timeExamenCruzadoContra === 0 ? '' : String(cat.timeExamenCruzadoContra / 60);
          }
        } else if (editableCat.type === 'refutacion') {
          editableCat.minQuestions = cat.minQuestions === undefined || cat.minQuestions === 0 ? '' : String(cat.minQuestions);
        }
        return editableCat;
      });
      setCategories(processedCategories);

      setSettings({
        h1Text: currentSettings.h1Text,
        logoUrl: currentSettings.logoUrl,
        positiveWarningThreshold: currentSettings.positiveWarningThreshold === 0 ? '' : String(currentSettings.positiveWarningThreshold),
        negativeWarningThreshold: currentSettings.negativeWarningThreshold === 0 ? '' : String(currentSettings.negativeWarningThreshold),
      });
      setValidationErrors({}); // Reset errors when modal opens
    }
  }, [isOpen, currentCategories, currentSettings]);
  
  const handleCategoryChange = (index: number, field: keyof EditableCategoryConfig | 'categoryType', value: string | boolean | CategoryType) => {
    const newCategories = [...categories];
    const categoryToUpdate = { ...newCategories[index] };

    let errorKey = `categories[${index}].${field}`;

    if (field === 'name') {
      categoryToUpdate.name = value as string;
    } else if (field === 'timePerSpeaker' || field === 'timeExamenCruzadoFavor' || field === 'timeExamenCruzadoContra' || field === 'minQuestions') {
      (categoryToUpdate as any)[field] = value as string;
    } else if (field === 'categoryType') {
      categoryToUpdate.type = value as CategoryType;
      // Reset fields based on new type, ensure string fields are reset properly for editable state
      if (value === 'introduccion') {
        categoryToUpdate.hasExamenCruzado = false;
        categoryToUpdate.timeExamenCruzadoFavor = '';
        categoryToUpdate.timeExamenCruzadoContra = '';
        delete categoryToUpdate.minQuestions; // no string version needed if not applicable
        categoryToUpdate.questions = []; // Clear questions as well for consistency
      } else if (value === 'refutacion') {
        categoryToUpdate.minQuestions = ''; // Default for new 'refutacion'
        categoryToUpdate.questions = [];
        delete categoryToUpdate.hasExamenCruzado;
        delete categoryToUpdate.timeExamenCruzadoFavor;
        delete categoryToUpdate.timeExamenCruzadoContra;
      } else { // conclusion
        delete categoryToUpdate.hasExamenCruzado;
        delete categoryToUpdate.timeExamenCruzadoFavor;
        delete categoryToUpdate.timeExamenCruzadoContra;
        delete categoryToUpdate.minQuestions;
        categoryToUpdate.questions = [];
      }
      // Clear potential errors from fields of previous type
      setValidationErrors(prev => ({
        ...prev,
        [`categories[${index}].timeExamenCruzadoFavor`]: undefined,
        [`categories[${index}].timeExamenCruzadoContra`]: undefined,
        [`categories[${index}].minQuestions`]: undefined,
      }));
      errorKey = ''; // Handled above
    } else if (field === 'hasExamenCruzado') {
      if (categoryToUpdate.type === 'introduccion') {
        categoryToUpdate.hasExamenCruzado = value as boolean;
        if (!value) {
          categoryToUpdate.timeExamenCruzadoFavor = '';
          categoryToUpdate.timeExamenCruzadoContra = '';
          setValidationErrors(prev => ({
            ...prev,
            [`categories[${index}].timeExamenCruzadoFavor`]: undefined,
            [`categories[${index}].timeExamenCruzadoContra`]: undefined,
          }));
        } else {
          // Fields are already strings, user will input or leave them ''
        }
      }
       errorKey = ''; // Not directly validated on change
    } else {
      // For other fields like 'id', 'questions', 'originalIndex' that are not directly bound to an input causing this handler
      (categoryToUpdate as any)[field] = value;
      errorKey = ''; // No specific error key for these
    }
    
    newCategories[index] = categoryToUpdate;
    setCategories(newCategories);

    if (errorKey) {
      setValidationErrors(prev => ({ ...prev, [errorKey]: undefined }));
    }
  };
  
  const handleSettingChange = (field: keyof EditableGlobalSettings, value: string) => {
    setSettings(prev => ({ ...prev, [field]: value }));
    if (field === 'positiveWarningThreshold' || field === 'negativeWarningThreshold') {
      setValidationErrors(prev => ({ ...prev, [`settings${field.charAt(0).toUpperCase() + field.slice(1)}`]: undefined }));
    }
  };

  const handleAddCategory = () => {
    setCategories(prev => [
      ...prev,
      {
        id: `new_cat_${Date.now()}`,
        name: 'Nueva Categoría',
        timePerSpeaker: '3', // Default to 3 minutes as string
        type: 'conclusion',
        questions: [],
      }
    ]);
  };

  const handleDeleteCategory = (index: number) => {
    setCategories(prev => prev.filter((_, i) => i !== index));
    // Also clear any validation errors associated with the deleted category
    const newErrors = {...validationErrors};
    Object.keys(newErrors).forEach(key => {
      if (key.startsWith(`categories[${index}].`)) {
        delete newErrors[key];
      } else if (key.startsWith('categories[')) {
        // Adjust indices for subsequent categories if needed, though less critical if just deleting
      }
    });
    setValidationErrors(newErrors);
  };

  const validateAndSave = () => {
    const newErrors: ValidationErrors = {};
    let isValid = true;

    const finalCategories: CategoryConfig[] = [];

    categories.forEach((cat, index) => {
      const currentCatFinal: Partial<CategoryConfig> & { id: string; name: string; type: CategoryType } = {
        id: cat.id,
        name: cat.name,
        type: cat.type,
        questions: [...(cat.questions || [])],
        examenCruzadoIntroduccionUsed: cat.examenCruzadoIntroduccionUsed,
      };

      // Validate Name (though not explicitly requested for error, good practice)
      if (!cat.name.trim()) {
        newErrors[`categories[${index}].name`] = 'El nombre es requerido.';
        isValid = false;
      }

      // Validate timePerSpeaker
      const timePerSpeakerVal = cat.timePerSpeaker.trim();
      if (timePerSpeakerVal === '') {
        newErrors[`categories[${index}].timePerSpeaker`] = 'Requerido (min).';
        isValid = false;
      } else {
        const num = parseFloat(timePerSpeakerVal);
        if (isNaN(num) || num < 0) {
          newErrors[`categories[${index}].timePerSpeaker`] = 'Número inválido (min).';
          isValid = false;
        } else if (timePerSpeakerVal.includes('.') && timePerSpeakerVal.split('.')[1].length > 2) {
          newErrors[`categories[${index}].timePerSpeaker`] = 'Máximo 2 decimales (min).';
          isValid = false;
        } else {
          currentCatFinal.timeFavor = Math.round(num * 60);
          currentCatFinal.timeContra = Math.round(num * 60);
        }
      }

      if (cat.type === 'introduccion') {
        currentCatFinal.hasExamenCruzado = cat.hasExamenCruzado;
        if (cat.hasExamenCruzado) {
          // Examen Favor
          const timeExamenFavorVal = cat.timeExamenCruzadoFavor?.trim();
          if (timeExamenFavorVal && timeExamenFavorVal !== '') {
            const num = parseFloat(timeExamenFavorVal);
            if (isNaN(num) || num < 0) {
              newErrors[`categories[${index}].timeExamenCruzadoFavor`] = 'Inválido (min).';
              isValid = false;
            } else if (timeExamenFavorVal.includes('.') && timeExamenFavorVal.split('.')[1].length > 2) {
              newErrors[`categories[${index}].timeExamenCruzadoFavor`] = 'Máximo 2 decimales (min).';
              isValid = false;
            } else {
              currentCatFinal.timeExamenCruzadoFavor = Math.round(num * 60);
            }
          } else {
            currentCatFinal.timeExamenCruzadoFavor = 0;
          }
          // Examen Contra
          const timeExamenContraVal = cat.timeExamenCruzadoContra?.trim();
          if (timeExamenContraVal && timeExamenContraVal !== '') {
            const num = parseFloat(timeExamenContraVal);
            if (isNaN(num) || num < 0) {
              newErrors[`categories[${index}].timeExamenCruzadoContra`] = 'Inválido (min).';
              isValid = false;
            } else if (timeExamenContraVal.includes('.') && timeExamenContraVal.split('.')[1].length > 2) {
              newErrors[`categories[${index}].timeExamenCruzadoContra`] = 'Máximo 2 decimales (min).';
              isValid = false;
            } else {
              currentCatFinal.timeExamenCruzadoContra = Math.round(num * 60);
            }
          } else {
            currentCatFinal.timeExamenCruzadoContra = 0;
          }
        }
      } else if (cat.type === 'refutacion') {
        const minQuestionsVal = cat.minQuestions?.trim();
        let minQParsed = 0;
        if (minQuestionsVal && minQuestionsVal !== '') {
          const num = parseInt(minQuestionsVal, 10);
          if (isNaN(num) || num < 0) {
            newErrors[`categories[${index}].minQuestions`] = 'Número inválido.';
            isValid = false;
          } else {
            minQParsed = num;
          }
        }
        currentCatFinal.minQuestions = minQParsed;
        
        // Sync questions logic (adapted from old syncMinQuestions)
        let currentQuestions = currentCatFinal.questions || [];
        if (currentQuestions.length < minQParsed) {
          const questionsToAdd = minQParsed - currentQuestions.length;
          for (let i = 0; i < questionsToAdd; i++) {
            currentQuestions.push({ id: uuidv4(), answered: false });
          }
        } else if (currentQuestions.length > minQParsed) {
          const answeredCount = currentQuestions.filter(q => q.answered).length;
          if (answeredCount >= minQParsed) {
            currentQuestions = currentQuestions.filter(q => q.answered);
          } else {
            const answeredQuestions = currentQuestions.filter(q => q.answered);
            const unansweredQuestions = currentQuestions.filter(q => !q.answered);
            const unansweredToKeep = minQParsed - answeredQuestions.length;
            currentQuestions = [
              ...answeredQuestions,
              ...unansweredQuestions.slice(0, Math.max(0, unansweredToKeep))
            ];
          }
        }
        currentCatFinal.questions = currentQuestions;
      }
      finalCategories.push(currentCatFinal as CategoryConfig);
    });

    const finalSettings: Partial<GlobalSettings> = {
      h1Text: settings.h1Text,
      logoUrl: settings.logoUrl,
    };

    // Validate positiveWarningThreshold
    const positiveWarningVal = settings.positiveWarningThreshold.trim();
    if (positiveWarningVal === '') {
      newErrors.settingsPositiveWarning = 'Requerido (seg).';
      isValid = false;
    } else {
      const num = parseInt(positiveWarningVal, 10);
      if (isNaN(num) || num < 0) {
        newErrors.settingsPositiveWarning = 'Número inválido (seg).';
        isValid = false;
      } else {
        finalSettings.positiveWarningThreshold = num;
      }
    }

    // Validate negativeWarningThreshold
    const negativeWarningVal = settings.negativeWarningThreshold.trim();
    if (negativeWarningVal === '') {
      newErrors.settingsNegativeWarning = 'Requerido (seg).';
      isValid = false;
    } else {
      const num = parseInt(negativeWarningVal, 10);
      if (isNaN(num)) {
        newErrors.settingsNegativeWarning = 'Número inválido (seg).';
        isValid = false;
      } else if (num >= 0) {
        newErrors.settingsNegativeWarning = 'Valor negativo requerido (seg).';
        isValid = false;
      } else {
        finalSettings.negativeWarningThreshold = num;
      }
    }
    
    setValidationErrors(newErrors);

    if (isValid) {
      // Clean up categories based on type one last time before saving
      const cleanedFinalCategories = finalCategories.map(cat => {
        const cleanCat = { ...cat };
        if (cleanCat.type !== 'introduccion') {
          delete cleanCat.hasExamenCruzado;
          delete cleanCat.timeExamenCruzadoFavor;
          delete cleanCat.timeExamenCruzadoContra;
          delete cleanCat.examenCruzadoIntroduccionUsed;
        } else {
          if (!cleanCat.hasExamenCruzado) {
            delete cleanCat.timeExamenCruzadoFavor;
            delete cleanCat.timeExamenCruzadoContra;
          }
        }
        if (cleanCat.type !== 'refutacion') {
          delete cleanCat.minQuestions;
          delete cleanCat.questions;
        }
        return cleanCat;
      });
      onSave(cleanedFinalCategories, finalSettings as GlobalSettings);
      onClose();
    }
  };


  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Configuración del Cronómetro</DialogTitle>
          <DialogDescription>
            Ajusta los tiempos, nombres de los turnos y configuraciones globales del cronómetro.
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
          <div className="grid grid-cols-4 items-start gap-4">
            <Label htmlFor="positiveWarning" className="text-right col-span-1 pt-2">Aviso Positivo (seg)</Label>
            <div className="col-span-3">
              <Input 
                id="positiveWarning" 
                type="number" 
                value={settings.positiveWarningThreshold} 
                onChange={(e) => handleSettingChange('positiveWarningThreshold', e.target.value)} 
                className="w-full"
                placeholder="Ej: 30"
              />
              {validationErrors.settingsPositiveWarning && <p className="text-sm text-destructive mt-1">{validationErrors.settingsPositiveWarning}</p>}
            </div>
          </div>
          <div className="grid grid-cols-4 items-start gap-4">
            <Label htmlFor="negativeWarning" className="text-right col-span-1 pt-2">Aviso Negativo (seg)</Label>
            <div className="col-span-3">
              <Input 
                id="negativeWarning" 
                type="number" 
                value={settings.negativeWarningThreshold} 
                onChange={(e) => handleSettingChange('negativeWarningThreshold', e.target.value)} 
                className="w-full"
                placeholder="Ej: -30"
              />
              {validationErrors.settingsNegativeWarning && <p className="text-sm text-destructive mt-1">{validationErrors.settingsNegativeWarning}</p>}
            </div>
          </div>

          <div className="flex justify-between items-center mt-6 mb-2">
            <h3 className="font-semibold text-lg">Turnos</h3>
            <Button variant="outline" size="sm" onClick={handleAddCategory}>
              <PlusCircle className="mr-2 h-4 w-4" /> Añadir turno
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
                  <div className="grid grid-cols-4 items-start gap-4">
                    <Label htmlFor={`catName-${index}`} className="text-right col-span-1 pt-2">Nombre</Label>
                    <div className="col-span-3">
                      <Input 
                        id={`catName-${index}`} 
                        value={cat.name} 
                        onChange={(e) => handleCategoryChange(index, 'name', e.target.value)} 
                        className="w-full" 
                      />
                      {validationErrors[`categories[${index}].name`] && <p className="text-sm text-destructive mt-1">{validationErrors[`categories[${index}].name`]}</p>}
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-4 items-start gap-4">
                    <Label htmlFor={`timePerSpeaker-${index}`} className="text-right col-span-1 pt-2">Tiempo Orador (min)</Label>
                    <div className="col-span-3">
                      <Input 
                        id={`timePerSpeaker-${index}`} 
                        type="number"
                        step="0.01"
                        value={cat.timePerSpeaker} 
                        onChange={(e) => handleCategoryChange(index, 'timePerSpeaker', e.target.value)} 
                        className="w-full" 
                        placeholder="Ej: 5 o 2.5"
                      />
                      {validationErrors[`categories[${index}].timePerSpeaker`] && <p className="text-sm text-destructive mt-1">{validationErrors[`categories[${index}].timePerSpeaker`]}</p>}
                    </div>
                  </div>

                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label className="text-right col-span-1">Tipo Intervención</Label>
                    <RadioGroup
                      value={cat.type}
                      onValueChange={(value) => handleCategoryChange(index, 'categoryType', value as CategoryType)}
                      className="col-span-3 flex space-x-2 items-center pt-1"
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
                    <div className="grid grid-cols-4 items-center gap-4 my-2"> {/* Added my-2 here */}
                      <Label htmlFor={`hasExamenCruzado-${index}`} className="text-right col-span-1">Permitir Ex. Cruzado</Label>
                      <div className="col-span-3 flex items-center">
                        <Switch
                          id={`hasExamenCruzado-${index}`}
                          checked={cat.hasExamenCruzado || false}
                          onCheckedChange={(checked) => handleCategoryChange(index, 'hasExamenCruzado', checked)}
                        />
                      </div>
                    </div>
                  )}

                  {cat.type === 'introduccion' && cat.hasExamenCruzado && (
                    <>
                      <div className="grid grid-cols-4 items-start gap-4">
                        <Label htmlFor={`timeExamenFavor-${index}`} className="text-right col-span-1 pt-2">Examen Favor (min)</Label>
                        <div className="col-span-3">
                          <Input 
                            id={`timeExamenFavor-${index}`} 
                            type="number" 
                            step="0.01"
                            value={cat.timeExamenCruzadoFavor ?? ''} 
                            onChange={(e) => handleCategoryChange(index, 'timeExamenCruzadoFavor', e.target.value)} 
                            className="w-full" 
                            placeholder="Opcional (ej: 1.5)"
                          />
                          {validationErrors[`categories[${index}].timeExamenCruzadoFavor`] && <p className="text-sm text-destructive mt-1">{validationErrors[`categories[${index}].timeExamenCruzadoFavor`]}</p>}
                        </div>
                      </div>
                      <div className="grid grid-cols-4 items-start gap-4">
                        <Label htmlFor={`timeExamenContra-${index}`} className="text-right col-span-1 pt-2">Examen Contra (min)</Label>
                        <div className="col-span-3">
                          <Input 
                            id={`timeExamenContra-${index}`} 
                            type="number"
                            step="0.01"
                            value={cat.timeExamenCruzadoContra ?? ''} 
                            onChange={(e) => handleCategoryChange(index, 'timeExamenCruzadoContra', e.target.value)} 
                            className="w-full"
                            placeholder="Opcional (ej: 1.5)"
                          />
                          {validationErrors[`categories[${index}].timeExamenCruzadoContra`] && <p className="text-sm text-destructive mt-1">{validationErrors[`categories[${index}].timeExamenCruzadoContra`]}</p>}
                        </div>
                      </div>
                    </>
                  )}

                  {cat.type === 'refutacion' && (
                    <div className="grid grid-cols-4 items-start gap-4">
                      <Label htmlFor={`minQuestions-${index}`} className="text-right col-span-1 pt-2">Preguntas Mínimas</Label>
                      <div className="col-span-3">
                        <Input 
                          id={`minQuestions-${index}`} 
                          type="number" 
                          value={cat.minQuestions ?? ''} 
                          onChange={(e) => handleCategoryChange(index, 'minQuestions', e.target.value)} 
                          className="w-full" 
                          min="0"
                          placeholder="Ej: 2 (0 si es opcional)"
                        />
                        {validationErrors[`categories[${index}].minQuestions`] && <p className="text-sm text-destructive mt-1">{validationErrors[`categories[${index}].minQuestions`]}</p>}
                      </div>
                    </div>
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
          <Button type="button" onClick={validateAndSave}>Guardar Cambios</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ConfigurationModal;
