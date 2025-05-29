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

import React, { useMemo } from 'react';
import ChronometerHeader from './ChronometerHeader';
import CategoryNavigation from './CategoryNavigation';
import CategoryDetail from './CategoryDetail';
import PositionNavigation from './PositionNavigation';
import ExamenCruzadoNavigation from './ExamenCruzadoNavigation';
import { Button } from '@/components/ui/button';
import { Settings, ListChecks } from 'lucide-react';
import ConfigurationModal from './ConfigurationModal';
import SummaryModal from './SummaryModal';
import { useChronometerStore } from '@/stores/chronometerStore';
import { AccessibilityProvider } from './AccessibilityProvider';

const DebateChronometerPage: React.FC = () => {
  const {
    categories,
    globalSettings,
    activeCategoryId,
    activePositionType,
    timerStates,
    isConfigModalOpen,
    isSummaryModalOpen,
    setActiveCategoryId,
    setActivePositionType,
    setConfigModalOpen,
    setSummaryModalOpen,
    saveConfiguration,
    selectCategory,
    updateQuestions
  } = useChronometerStore();

  const summaryData = useMemo(() => {
    return categories.map(cat => {
      const catTimers = [];
      
      if (timerStates[`${cat.id}_favor`]) catTimers.push(timerStates[`${cat.id}_favor`]);
      if (timerStates[`${cat.id}_contra`]) catTimers.push(timerStates[`${cat.id}_contra`]);
      
      if (cat.type === 'introduccion' && cat.hasExamenCruzado) {
        if (cat.timeExamenCruzadoFavor !== undefined && timerStates[`${cat.id}_examen_favor`]) {
          catTimers.push(timerStates[`${cat.id}_examen_favor`]);
        }
        if (cat.timeExamenCruzadoContra !== undefined && timerStates[`${cat.id}_examen_contra`]) {
          catTimers.push(timerStates[`${cat.id}_examen_contra`]);
        }
      }
      
      return {
        categoryId: cat.id,
        categoryName: cat.name,
        categoryType: cat.type,
        questions: cat.type === 'refutacion' ? cat.questions : undefined,
        minQuestions: cat.type === 'refutacion' ? cat.minQuestions : undefined,
        hasExamenCruzado: cat.type === 'introduccion' ? cat.hasExamenCruzado : undefined,
        examenCruzadoIntroduccionUsed: cat.type === 'introduccion' ? cat.examenCruzadoIntroduccionUsed : undefined,
        timers: catTimers.filter(Boolean)
      };
    });
  }, [categories, timerStates]);

  const activeCategoryData = useMemo(() => {
    return categories.find(cat => cat.id === activeCategoryId) || null;
  }, [categories, activeCategoryId]);

  return (
    <AccessibilityProvider>
      <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
        <div className="container mx-auto">
          <ChronometerHeader logoUrl={globalSettings.logoUrl} h1Text={globalSettings.h1Text} />

          <CategoryNavigation 
            categories={categories}
            activeCategory={activeCategoryId}
            onSelectCategory={selectCategory}
          />

          {activeCategoryData && (
            <div className="mt-2 mb-4">
              <PositionNavigation
                activeCategory={activeCategoryData}
                activePositionType={activePositionType}
                onSelectPosition={setActivePositionType}
              />
              {activeCategoryData.type === 'introduccion' && activeCategoryData.hasExamenCruzado &&
               (activeCategoryData.timeExamenCruzadoFavor !== undefined || activeCategoryData.timeExamenCruzadoContra !== undefined) && (
                <ExamenCruzadoNavigation
                  activeCategory={activeCategoryData}
                  activePositionType={activePositionType}
                  onSelectPosition={setActivePositionType}
                />
              )}
            </div>
          )}

          <main className="mt-6">
            {activeCategoryData && activePositionType ? (
              <CategoryDetail 
                category={activeCategoryData}
                settings={globalSettings}
                activePositionType={activePositionType}
                onQuestionUpdate={updateQuestions}
              />
            ) : activeCategoryData && !activePositionType ? (
              <div className="text-center p-12 bg-card/80 rounded-lg shadow">
                <p className="text-lg text-card-foreground">Selecciona un turno para visualizar el cronómetro.</p>
              </div>
            ) : (
              <div className="text-center p-12 bg-card/80 rounded-lg shadow">
                <p className="text-lg text-card-foreground">Selecciona una categoría para comenzar.</p>
              </div>
            )}
          </main>

          <footer className="mt-12 flex justify-center md:justify-end space-x-4 py-4">
            <Button variant="outline" onClick={() => setSummaryModalOpen(true)}>
              <ListChecks className="mr-2 h-5 w-5" />
              Resumen
            </Button>
            <Button variant="outline" onClick={() => setConfigModalOpen(true)}>
              <Settings className="mr-2 h-5 w-5" />
              Configuración
            </Button>
          </footer>
        </div>

        <ConfigurationModal
          isOpen={isConfigModalOpen}
          onClose={() => setConfigModalOpen(false)}
          currentCategories={categories}
          currentSettings={globalSettings}
          onSave={saveConfiguration}
        />

        <SummaryModal
          isOpen={isSummaryModalOpen}
          onClose={() => setSummaryModalOpen(false)}
          summaryData={summaryData}
          allCategories={categories}
        />
      </div>
    </AccessibilityProvider>
  );
};

export default DebateChronometerPage;
