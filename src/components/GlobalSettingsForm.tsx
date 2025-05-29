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
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { EditableGlobalSettings, ValidationErrors } from '@/types/configuration';

interface GlobalSettingsFormProps {
  settings: EditableGlobalSettings;
  validationErrors: ValidationErrors;
  onSettingChange: (field: keyof EditableGlobalSettings, value: string) => void;
}

const GlobalSettingsForm: React.FC<GlobalSettingsFormProps> = ({
  settings,
  validationErrors,
  onSettingChange,
}) => {
  return (
    <>
      <h3 className="font-semibold text-lg mb-2">Ajustes Globales</h3>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="h1Text" className="text-right col-span-1">Título H1</Label>
        <Input 
          id="h1Text" 
          value={settings.h1Text} 
          onChange={(e) => onSettingChange('h1Text', e.target.value)} 
          className="col-span-3" 
        />
      </div>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="logoUrl" className="text-right col-span-1">URL del Logo</Label>
        <Input 
          id="logoUrl" 
          value={settings.logoUrl} 
          onChange={(e) => onSettingChange('logoUrl', e.target.value)} 
          className="col-span-3" 
        />
      </div>
      <div className="grid grid-cols-4 items-start gap-4">
        <Label htmlFor="positiveWarning" className="text-right col-span-1 pt-2">Aviso Positivo (seg)</Label>
        <div className="col-span-3">
          <Input 
            id="positiveWarning" 
            type="number" 
            value={settings.positiveWarningThreshold} 
            onChange={(e) => onSettingChange('positiveWarningThreshold', e.target.value)} 
            className="w-full"
            placeholder="Ej: 30"
          />
          {validationErrors.settingsPositiveWarning && (
            <p className="text-sm text-destructive mt-1">{validationErrors.settingsPositiveWarning}</p>
          )}
        </div>
      </div>
      <div className="grid grid-cols-4 items-start gap-4">
        <Label htmlFor="negativeWarning" className="text-right col-span-1 pt-2">Aviso Negativo (seg)</Label>
        <div className="col-span-3">
          <Input 
            id="negativeWarning" 
            type="number" 
            value={settings.negativeWarningThreshold} 
            onChange={(e) => onSettingChange('negativeWarningThreshold', e.target.value)} 
            className="w-full"
            placeholder="Ej: -30"
          />
          {validationErrors.settingsNegativeWarning && (
            <p className="text-sm text-destructive mt-1">{validationErrors.settingsNegativeWarning}</p>
          )}
        </div>
      </div>
    </>
  );
};

export default GlobalSettingsForm;
