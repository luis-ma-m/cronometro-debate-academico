import * as React from 'react';
const { useState, useEffect } = React;
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CategoryConfig, GlobalSettings, CategoryType } from '@/types/chronometer';
import { ScrollArea } from '@/components/ui/scroll-area';
import { v4 as uuidv4 } from 'uuid';
import GlobalSettingsForm from './GlobalSettingsForm';
import CategoryList from './CategoryList';
import { EditableCategoryConfig, EditableGlobalSettings, ValidationErrors } from '@/types/configuration';

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
            <GlobalSettingsForm
              settings={settings}
              validationErrors={validationErrors}
              onSettingChange={handleSettingChange}
            />
            <CategoryList
              categories={categories}
              validationErrors={validationErrors}
              onCategoryChange={handleCategoryChange}
              onAddCategory={handleAddCategory}
              onDeleteCategory={handleDeleteCategory}
            />
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
