import React, { Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// The E2E-only harness is tree-shaken from normal builds and never ships in production deployments.
if (import.meta.env.VITE_E2E_PREVIEW === '1') {
  void import('./e2e/syncOutboxHarness').then(({ installSyncOutboxE2EHarness }) => installSyncOutboxE2EHarness());
}

/** If the code of a page cannot be downloaded (no connection while loading), say so instead of a blank page. */
function loadFailed(what: string) {
  return {
    default: () => <main className="tab-loading tab-load-failed" role="alert">
      <p>No se ha podido cargar {what}. Comprueba la conexión y recarga la página: lo guardado en este navegador no se pierde.</p>
      <button type="button" className="button primary" onClick={() => window.location.reload()}>Recargar</button>
    </main>,
  };
}

// Judges keep their public acta route; the manager and tabulation now share one application shell.
const JudgeActaApp = lazy(() => import('./tabulation/JudgeActaApp').catch(() => loadFailed('el acta')));
const isTabulation = /^\/tabulacion(\/|$)/.test(window.location.pathname);
if (isTabulation) window.history.replaceState(null, '', '/#tabulation');
const isJudgeActa = /^\/acta(\/|$)/.test(window.location.pathname);

const root = document.getElementById('root');
if (!root) throw new Error('No se encontró el elemento raíz de la aplicación.');

createRoot(root).render(
  <React.StrictMode>
    {isJudgeActa
      ? <Suspense fallback={<div className="tab-loading">Cargando el acta…</div>}><JudgeActaApp /></Suspense>
      : <App />}
  </React.StrictMode>,
);
