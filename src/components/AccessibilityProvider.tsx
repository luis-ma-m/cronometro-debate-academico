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

import React, { createContext, useContext, useEffect, useCallback } from 'react';
import { useChronometerStore } from '@/stores/chronometerStore';

interface AccessibilityContextType {
  announceTime: (message: string) => void;
  setAccessibilityMode: (mode: 'default' | 'high-contrast' | 'dyslexic-friendly') => void;
}

const AccessibilityContext = createContext<AccessibilityContextType | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export const useAccessibility = () => {
  const context = useContext(AccessibilityContext);
  if (!context) {
    throw new Error('useAccessibility must be used within AccessibilityProvider');
  }
  return context;
};

interface AccessibilityProviderProps {
  children: React.ReactNode;
}

export const AccessibilityProvider: React.FC<AccessibilityProviderProps> = ({ children }) => {
  const { 
    accessibilityMode, 
    setAccessibilityMode: setStoreAccessibilityMode,
    categories,
    activeCategoryId,
    activePositionType,
    setActiveCategoryId,
    setActivePositionType
  } = useChronometerStore();

  const announceTime = useCallback((message: string) => {
    const announcement = document.getElementById('time-announcer');
    if (announcement) announcement.textContent = message;
  }, []);

  const setAccessibilityMode = useCallback((mode: 'default' | 'high-contrast' | 'dyslexic-friendly') => {
    setStoreAccessibilityMode(mode);
    
    // Apply theme classes to document root
    const root = document.documentElement;
    root.classList.remove('high-contrast', 'dyslexic-friendly');
    
    if (mode === 'high-contrast') {
      root.classList.add('high-contrast');
    } else if (mode === 'dyslexic-friendly') {
      root.classList.add('dyslexic-friendly');
    }
  }, [setStoreAccessibilityMode]);

  // Apply accessibility mode on mount and changes
  useEffect(() => {
    setAccessibilityMode(accessibilityMode);
  }, [accessibilityMode, setAccessibilityMode]);

  // Navigate to next speech/position
  const navigateToNext = useCallback(() => {
    if (!activeCategoryId) {
      // Select first category if none selected
      if (categories.length > 0) {
        setActiveCategoryId(categories[0].id);
      }
      return;
    }

    const currentCategory = categories.find(cat => cat.id === activeCategoryId);
    if (!currentCategory) return;

    if (!activePositionType) {
      // Select first available position
      setActivePositionType('favor');
      return;
    }

    // Navigate through positions within current category
    if (activePositionType === 'favor') {
      setActivePositionType('contra');
    } else if (activePositionType === 'contra') {
      // Check if examen cruzado is available
      if (currentCategory.type === 'introduccion' && 
          currentCategory.hasExamenCruzado && 
          currentCategory.timeExamenCruzadoFavor !== undefined) {
        setActivePositionType('examen_favor');
      } else {
        // Move to next category
        const currentIndex = categories.findIndex(cat => cat.id === activeCategoryId);
        if (currentIndex < categories.length - 1) {
          setActiveCategoryId(categories[currentIndex + 1].id);
          setActivePositionType('favor');
        }
      }
    } else if (activePositionType === 'examen_favor') {
      if (currentCategory.timeExamenCruzadoContra !== undefined) {
        setActivePositionType('examen_contra');
      } else {
        // Move to next category
        const currentIndex = categories.findIndex(cat => cat.id === activeCategoryId);
        if (currentIndex < categories.length - 1) {
          setActiveCategoryId(categories[currentIndex + 1].id);
          setActivePositionType('favor');
        }
      }
    } else if (activePositionType === 'examen_contra') {
      // Move to next category
      const currentIndex = categories.findIndex(cat => cat.id === activeCategoryId);
      if (currentIndex < categories.length - 1) {
        setActiveCategoryId(categories[currentIndex + 1].id);
        setActivePositionType('favor');
      }
    }
  }, [activeCategoryId, activePositionType, categories, setActiveCategoryId, setActivePositionType]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Only handle shortcuts when not in an input field
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (event.code) {
        case 'Space':
          event.preventDefault();
          // Toggle current active timer
          if (activeCategoryId && activePositionType) {
            const toggleEvent = new CustomEvent('chronometer-toggle', {
              detail: { categoryId: activeCategoryId, position: activePositionType }
            });
            window.dispatchEvent(toggleEvent);
          }
          break;
          
        case 'KeyR':
          event.preventDefault();
          // Reset current active timer
          if (activeCategoryId && activePositionType) {
            const resetEvent = new CustomEvent('chronometer-reset', {
              detail: { categoryId: activeCategoryId, position: activePositionType }
            });
            window.dispatchEvent(resetEvent);
          }
          break;
          
        case 'ArrowRight':
          event.preventDefault();
          // Navigate to next speech/position
          navigateToNext();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeCategoryId, activePositionType, navigateToNext]);

  return (
    <AccessibilityContext.Provider value={{ announceTime, setAccessibilityMode }}>
      {children}
      {/* ARIA live region for announcements */}
      <div
        id="time-announcer"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      />
    </AccessibilityContext.Provider>
  );
};
