
import React, { createContext, useContext, useEffect } from 'react';
import { useChronometerStore } from '@/stores/chronometerStore';

interface AccessibilityContextType {
  announceTime: (message: string) => void;
  setAccessibilityMode: (mode: 'default' | 'high-contrast' | 'dyslexic-friendly') => void;
}

const AccessibilityContext = createContext<AccessibilityContextType | null>(null);

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
  const { accessibilityMode, setAccessibilityMode: setStoreAccessibilityMode } = useChronometerStore();

  const announceTime = (message: string) => {
    const announcement = document.getElementById('time-announcer');
    if (announcement) {
      announcement.textContent = message;
    }
  };

  const setAccessibilityMode = (mode: 'default' | 'high-contrast' | 'dyslexic-friendly') => {
    setStoreAccessibilityMode(mode);
    
    // Apply theme classes to document root
    const root = document.documentElement;
    root.classList.remove('high-contrast', 'dyslexic-friendly');
    
    if (mode === 'high-contrast') {
      root.classList.add('high-contrast');
    } else if (mode === 'dyslexic-friendly') {
      root.classList.add('dyslexic-friendly');
    }
  };

  // Apply accessibility mode on mount and changes
  useEffect(() => {
    setAccessibilityMode(accessibilityMode);
  }, [accessibilityMode]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Only handle shortcuts when not in an input field
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      const store = useChronometerStore.getState();
      
      switch (event.code) {
        case 'Space':
          event.preventDefault();
          // Toggle current active timer
          if (store.activeCategoryId && store.activePositionType) {
            // This will be handled by the active timer component
            const event = new CustomEvent('chronometer-toggle', {
              detail: { categoryId: store.activeCategoryId, position: store.activePositionType }
            });
            window.dispatchEvent(event);
          }
          break;
          
        case 'KeyR':
          event.preventDefault();
          // Reset current active timer
          if (store.activeCategoryId && store.activePositionType) {
            const event = new CustomEvent('chronometer-reset', {
              detail: { categoryId: store.activeCategoryId, position: store.activePositionType }
            });
            window.dispatchEvent(event);
          }
          break;
          
        case 'ArrowRight':
          event.preventDefault();
          // Navigate to next speech/position
          const event = new CustomEvent('chronometer-next');
          window.dispatchEvent(event);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
