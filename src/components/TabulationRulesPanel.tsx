import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, RefreshCw, Save } from 'lucide-react';
import { getTabulationSettings, saveTabulationSettings, type PersistedTabulationSettings } from '../api';
import { makeTabId, type TabSettings } from '../tabulation/types';
import { createTabTournament } from '../tabulation/presets';
import { RulesView } from '../tabulation/views/RulesView';
import type { TabStore } from '../tabulation/store';

export function TabulationRulesPanel({ token }: { token: string }) {
  const [record, setRecord] = useState<PersistedTabulationSettings | null>(null);
  const [settings, setSettings] = useState<TabSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const reload = async (discardPending = false) => {
    if (dirty && !discardPending && !window.confirm('Hay cambios locales sin guardar. Si recargas, se descartarán. ¿Quieres continuar?')) return;
    setLoading(true);
    setError('');
    try {
      const result = await getTabulationSettings(token);
      setRecord(result);
      setSettings(result.settings);
      setDirty(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se han podido cargar las reglas.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (dirty) {
      setError('La sesión ha cambiado mientras había reglas sin guardar. Se han conservado tus cambios locales.');
      return;
    }
    void reload(true);
  }, [token]);

  const baseTournament = useMemo(
    () => createTabTournament('Reglas oficiales del torneo', settings?.presetId ?? 'ledu-groups'),
    [settings?.presetId],
  );

  const updateRules = (mutator: (current: typeof baseTournament) => typeof baseTournament) => {
    if (!settings) return false;
    const next = mutator({ ...baseTournament, settings });
    setSettings(next.settings);
    setDirty(true);
    setNotice('');
    return true;
  };

  const save = async () => {
    if (!record || !settings || !dirty || saving) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await saveTabulationSettings(token, record.revision, settings, makeTabId('tabsettings'));
      setRecord(result);
      setSettings(result.settings);
      setDirty(false);
      setNotice('Reglas guardadas como versión ' + result.revision + '.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se han podido guardar las reglas.');
    } finally {
      setSaving(false);
    }
  };

  const storeStub = useMemo(() => ({ backup: () => undefined }) as unknown as TabStore, []);
  const tournament = settings ? { ...baseTournament, settings } : baseTournament;

  return <section className="panel tabulation-manager-rules">
    <div className="panel-title">
      <div><h3>Reglas de tabulación</h3><p>Configuración oficial persistida en el gestor. Las reglas se guardan con revisión e historial; no se publican hasta pulsar Guardar.</p></div>
      <div className="tab-actions">
        <button type="button" className="button secondary" onClick={() => void reload()} disabled={loading || saving}><RefreshCw size={15} /> Recargar</button>
        <button type="button" className="button primary" onClick={() => void save()} disabled={loading || saving || !dirty || !settings}><Save size={15} /> {saving ? 'Guardando…' : 'Guardar reglas'}</button>
      </div>
    </div>
    {loading && <p className="muted">Cargando reglas oficiales…</p>}
    {error && <div className="notice error-notice"><AlertCircle size={16} />{error}</div>}
    {notice && <div className="success-notice"><CheckCircle2 size={16} />{notice}</div>}
    {!loading && record && <p className="muted">Versión {record.revision} · {record.updatedAt ? 'Actualizada ' + new Date(record.updatedAt).toLocaleString('es-ES') : 'Preset inicial LEDU aplicado al primer uso'} · {dirty ? 'Cambios sin guardar' : 'Sin cambios pendientes'}</p>}
    {!loading && settings && <RulesView
      tournament={tournament}
      outcomes={new Map()}
      update={updateRules}
      notify={(message, kind) => { setNotice(message); if (kind === 'error') setError(message); }}
      store={storeStub}
      managerMode
    />}
  </section>;
}
