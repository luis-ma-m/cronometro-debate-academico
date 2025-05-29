
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

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Trash2 } from 'lucide-react';
import { EditableCategoryConfig, ValidationErrors, CategoryChangeField, CategoryChangeValue } from '@/types/configuration';
import { CategoryType } from '@/types/chronometer';

interface CategoryFormProps {
  category: EditableCategoryConfig;
  index: number;
  validationErrors: ValidationErrors;
  onCategoryChange: (index: number, field: CategoryChangeField, value: CategoryChangeValue) => void;
  onDeleteCategory: (index: number) => void;
}

const CategoryForm: React.FC<CategoryFormProps> = ({
  category,
  index,
  validationErrors,
  onCategoryChange,
  onDeleteCategory,
}) => {
  return (
    <div className="border p-3 pr-12 rounded-md space-y-3 relative bg-card">
      <Button 
        variant="ghost" 
        size="icon" 
        className="absolute top-2 right-2 text-destructive hover:text-destructive/80"
        onClick={() => onDeleteCategory(index)}
        aria-label="Eliminar categoría"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      
      <div className="grid grid-cols-4 items-start gap-4">
        <Label htmlFor={`catName-${index}`} className="text-right col-span-1 pt-2">Nombre</Label>
        <div className="col-span-3">
          <Input 
            id={`catName-${index}`} 
            value={category.name} 
            onChange={(e) => onCategoryChange(index, 'name', e.target.value)} 
            className="w-full" 
          />
          {validationErrors[`categories[${index}].name`] && (
            <p className="text-sm text-destructive mt-1">{validationErrors[`categories[${index}].name`]}</p>
          )}
        </div>
      </div>
      
      <div className="grid grid-cols-4 items-start gap-4">
        <Label htmlFor={`timePerSpeaker-${index}`} className="text-right col-span-1 pt-2">Tiempo Orador (min)</Label>
        <div className="col-span-3">
          <Input 
            id={`timePerSpeaker-${index}`} 
            type="number"
            step="0.01"
            value={category.timePerSpeaker} 
            onChange={(e) => onCategoryChange(index, 'timePerSpeaker', e.target.value)} 
            className="w-full" 
            placeholder="Ej: 5 o 2.5"
          />
          {validationErrors[`categories[${index}].timePerSpeaker`] && (
            <p className="text-sm text-destructive mt-1">{validationErrors[`categories[${index}].timePerSpeaker`]}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 items-center gap-4">
        <Label className="text-right col-span-1">Tipo Intervención</Label>
        <RadioGroup
          value={category.type}
          onValueChange={(value) => onCategoryChange(index, 'categoryType', value as CategoryType)}
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

      {category.type === 'introduccion' && (
        <div className="grid grid-cols-4 items-center gap-4 my-4">
          <Label htmlFor={`hasExamenCruzado-${index}`} className="text-right col-span-1">Permitir Ex. Cruzado</Label>
          <div className="col-span-3 flex items-center">
            <Switch
              id={`hasExamenCruzado-${index}`}
              checked={category.hasExamenCruzado || false}
              onCheckedChange={(checked) => onCategoryChange(index, 'hasExamenCruzado', checked)}
            />
          </div>
        </div>
      )}

      {category.type === 'introduccion' && category.hasExamenCruzado && (
        <>
          <div className="grid grid-cols-4 items-start gap-4">
            <Label htmlFor={`timeExamenFavor-${index}`} className="text-right col-span-1 pt-2">Examen Favor (min)</Label>
            <div className="col-span-3">
              <Input 
                id={`timeExamenFavor-${index}`} 
                type="number" 
                step="0.01"
                value={category.timeExamenCruzadoFavor ?? ''} 
                onChange={(e) => onCategoryChange(index, 'timeExamenCruzadoFavor', e.target.value)} 
                className="w-full" 
                placeholder="Opcional (ej: 1.5)"
              />
              {validationErrors[`categories[${index}].timeExamenCruzadoFavor`] && (
                <p className="text-sm text-destructive mt-1">{validationErrors[`categories[${index}].timeExamenCruzadoFavor`]}</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-4 items-start gap-4">
            <Label htmlFor={`timeExamenContra-${index}`} className="text-right col-span-1 pt-2">Examen Contra (min)</Label>
            <div className="col-span-3">
              <Input 
                id={`timeExamenContra-${index}`} 
                type="number"
                step="0.01"
                value={category.timeExamenCruzadoContra ?? ''} 
                onChange={(e) => onCategoryChange(index, 'timeExamenCruzadoContra', e.target.value)} 
                className="w-full"
                placeholder="Opcional (ej: 1.5)"
              />
              {validationErrors[`categories[${index}].timeExamenCruzadoContra`] && (
                <p className="text-sm text-destructive mt-1">{validationErrors[`categories[${index}].timeExamenCruzadoContra`]}</p>
              )}
            </div>
          </div>
        </>
      )}

      {category.type === 'refutacion' && (
        <div className="grid grid-cols-4 items-start gap-4">
          <Label htmlFor={`minQuestions-${index}`} className="text-right col-span-1 pt-2">Preguntas Mínimas</Label>
          <div className="col-span-3">
            <Input 
              id={`minQuestions-${index}`} 
              type="number" 
              value={category.minQuestions ?? ''} 
              onChange={(e) => onCategoryChange(index, 'minQuestions', e.target.value)} 
              className="w-full" 
              min="0"
              placeholder="Ej: 2 (0 si es opcional)"
            />
            {validationErrors[`categories[${index}].minQuestions`] && (
              <p className="text-sm text-destructive mt-1">{validationErrors[`categories[${index}].minQuestions`]}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CategoryForm;
