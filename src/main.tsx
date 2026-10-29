import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

/** If the code of a page cannot be downloaded (no connection while loading), say so instead of a blank page. */
function loadFailed(what: string) {
  return {
    default: () => <main className="tab-loading tab-load-failed" role="alert">
      <p>No se ha podido cargar {what}. Comprueba la conexión y recarga la página: lo guardado en este navegador no se pierde.</p>
      <button type="button" className="button primary" onClick={() => window.location.reload()}>Recargar</button>
    </main>,
  };
}

// The local tabulation and the judges' acta page are separate, frontend-only apps: no login, no API polling.
const TabulationApp = lazy(() => import('./tabulation/TabulationApp').catch(() => loadFailed('la tabulación')));
const JudgeActaApp = lazy(() => import('./tabulation/JudgeActaApp').catch(() => loadFailed('el acta')));
const isTabulation = /^\/tabulacion(\/|$)/.test(window.location.pathname);
const isJudgeActa = /^\/acta(\/|$)/.test(window.location.pathname);

const root = document.getElementById('root');
if (!root) throw new Error('No se encontró el elemento raíz de la aplicación.');

createRoot(root).render(
  <React.StrictMode>
    {isTabulation
      ? <Suspense fallback={<div className="tab-loading">Cargando tabulación…</div>}><TabulationApp /></Suspense>
      : isJudgeActa
        ? <Suspense fallback={<div className="tab-loading">Cargando el acta…</div>}><JudgeActaApp /></Suspense>
        : <App />}
  </React.StrictMode>,
);
