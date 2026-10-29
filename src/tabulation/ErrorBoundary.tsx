import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Download, RotateCcw, TriangleAlert } from 'lucide-react';
import { emergencyDump } from './emergency';
import { downloadFile } from './ui';

interface Props {
  children: ReactNode;
  /** Changing it (e.g. the open view) clears the error. */
  resetKey: string;
  onError: (error: Error, info: ErrorInfo) => void;
  /** Shown as a page of its own, when there is no shell around it. */
  page?: boolean;
}

interface State { error: Error | null }

export function downloadEmergencyCopy() {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  downloadFile('tabulacion-copia-de-emergencia-' + stamp + '.json', emergencyDump(window.localStorage), 'application/json');
}

/** A failing screen never takes the rest of the tabulation down: the data stays saved and can be copied. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError(error, info);
  }

  componentDidUpdate(previous: Props) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const panel = <section className="panel tab-crash" role="alert">
      <div className="panel-title"><div><h3><TriangleAlert size={18} /> Esta pantalla ha fallado</h3>
        <p>Los datos guardados no se han perdido. Descarga la copia de emergencia antes de seguir; si el fallo se repite, recarga la página o abre otra pantalla.</p></div></div>
      <pre className="tab-crash-detail">{this.state.error.message}</pre>
      <div className="tab-actions">
        <button type="button" className="button primary" onClick={downloadEmergencyCopy}><Download size={16} /> Copia de emergencia</button>
        <button type="button" className="button secondary" onClick={() => this.setState({ error: null })}><RotateCcw size={16} /> Reintentar</button>
        <button type="button" className="button ghost" onClick={() => window.location.reload()}>Recargar la página</button>
      </div>
    </section>;
    return this.props.page ? <main className="tab-crash-page">{panel}</main> : panel;
  }
}
