import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// The local tabulation is a separate, frontend-only app: no login, no API polling.
const TabulationApp = lazy(() => import('./tabulation/TabulationApp'));
const isTabulation = /^\/tabulacion(\/|$)/.test(window.location.pathname);

const root = document.getElementById('root');
if (!root) throw new Error('No se encontró el elemento raíz de la aplicación.');

createRoot(root).render(
  <React.StrictMode>
    {isTabulation
      ? <Suspense fallback={<div className="tab-loading">Cargando tabulación…</div>}><TabulationApp /></Suspense>
      : <App />}
  </React.StrictMode>,
);
