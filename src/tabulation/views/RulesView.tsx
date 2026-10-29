import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { penaltyConversionWarning } from '../results';
import { presetSettings, PRESET_OPTIONS } from '../presets';
import { TIEBREAK_LABELS, type PresetId, type TabSettings, type TabTournament, type TiebreakKey } from '../types';
import { whatsAppNumber } from '../whatsapp';
import { Field, Notice, type ViewProps } from '../ui';

function NumberField({ label, value, onChange, min, max, step = 1, hint, disabled }: {
  label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; hint?: string; disabled?: boolean;
}) {
  return <Field label={label} hint={hint}>
    <input type="number" value={value} min={min} max={max} step={step} disabled={disabled} onChange={(event) => {
      const next = Number(event.target.value);
      if (event.target.value !== '' && Number.isFinite(next)) onChange(next);
    }} />
  </Field>;
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <label className="check-item tab-toggle"><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
}

/** Bracket order typed as "1,8,3,6,2,7,4,5"; it only applies when it is a full permutation of the break. */
function SeedOrderField({ value, breakSize, onChange }: { value: number[]; breakSize: number; onChange: (value: number[]) => void }) {
  const [text, setText] = useState(value.join(', '));
  const isOrder = (list: number[]) => !list.length || (list.length === breakSize && [...list].sort((x, y) => x - y).every((seed, index) => seed === index + 1));
  const valid = isOrder(text.split(/[^0-9]+/).filter(Boolean).map(Number));
  return <Field label="Orden del cuadro (opcional)" hint={valid ? 'Cabezas de serie por parejas en el orden del cuadro; vacío = 1–8, 4–5, 2–7, 3–6. ADUMA (art. 31): 1, 8, 3, 6, 2, 7, 4, 5.' : 'Debe incluir cada puesto del 1 al ' + breakSize + ' una vez.'}>
    <input value={text} className={valid ? '' : 'tab-input-error'} placeholder="1, 8, 3, 6, 2, 7, 4, 5" onChange={(event) => {
      setText(event.target.value);
      const next = event.target.value.split(/[^0-9]+/).filter(Boolean).map(Number);
      if (isOrder(next)) onChange(next);
    }} />
  </Field>;
}

export function RulesView({ tournament, update, notify, store }: ViewProps) {
  const { settings } = tournament;
  const [presetChoice, setPresetChoice] = useState<Exclude<PresetId, 'custom'>>(settings.presetId === 'custom' ? 'ledu-groups' : settings.presetId);
  const hasRounds = tournament.rounds.length > 0;
  const set = <K extends keyof TabSettings>(key: K, value: TabSettings[K]) =>
    update((current) => ({ ...current, settings: { ...current.settings, [key]: value, presetId: 'custom' } }));
  const conversionWarning = penaltyConversionWarning(settings);
  // Not a rule: changing it keeps the regulation preset.
  const setWhatsApp = (patch: Partial<NonNullable<TabTournament['whatsapp']>>) =>
    update((current) => ({ ...current, whatsapp: { deskPhone: current.whatsapp?.deskPhone ?? '', baseUrl: current.whatsapp?.baseUrl ?? '', ...patch } }));
  const unusedTiebreaks = (Object.keys(TIEBREAK_LABELS) as TiebreakKey[]).filter((key) => !settings.tiebreaks.includes(key));
  const moveTiebreak = (index: number, delta: number) => {
    const list = [...settings.tiebreaks];
    const [item] = list.splice(index, 1);
    list.splice(index + delta, 0, item);
    set('tiebreaks', list);
  };

  const applyPreset = () => {
    const next = presetSettings(presetChoice);
    if (hasRounds && next.stage !== settings.stage) {
      notify('No se puede cambiar de ' + (settings.stage === 'groups' ? 'liguilla de grupos' : 'sistema suizo') + ' a otro formato con rondas ya generadas.', 'error');
      return;
    }
    if (!window.confirm('¿Aplicar el reglamento «' + PRESET_OPTIONS.find((option) => option.id === presetChoice)?.label + '»? Se sustituirán todos los criterios de esta página.')) return;
    store.backup('Antes de aplicar un reglamento');
    update((current) => ({ ...current, settings: next }), { type: 'settings.preset', message: 'Aplicado el reglamento «' + PRESET_OPTIONS.find((option) => option.id === presetChoice)?.label + '».' });
    notify('Reglamento aplicado. Las clasificaciones se recalculan con los nuevos criterios.');
  };

  return <>
    <div className="page-heading"><div><p className="eyebrow">CONFIGURACIÓN</p><h2>Reglas del torneo</h2><p className="muted">Los valores de partida siguen el reglamento LEDU 2024 o el del Torneo Nacional UC3M. Comprueba siempre las bases de tu edición: cualquier cambio recalcula al momento actas y clasificaciones.</p></div></div>

    <section className="panel">
      <div className="panel-title"><div><h3>Torneo y reglamento de partida</h3><p>Estado actual: {settings.presetId === 'custom' ? 'reglas personalizadas' : PRESET_OPTIONS.find((option) => option.id === settings.presetId)?.label}.</p></div></div>
      <div className="tab-form-grid">
        <Field label="Nombre del torneo"><input value={tournament.name} onChange={(event) => update((current) => ({ ...current, name: event.target.value }))} /></Field>
        <Field label="Reglamento" hint={PRESET_OPTIONS.find((option) => option.id === presetChoice)?.description}>
          <select value={presetChoice} onChange={(event) => setPresetChoice(event.target.value as Exclude<PresetId, 'custom'>)}>{PRESET_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
        </Field>
      </div>
      <div className="tab-actions"><button type="button" className="button secondary" onClick={applyPreset}>Aplicar reglamento</button></div>
    </section>

    <section className="panel">
      <div className="panel-title"><div><h3>Fase clasificatoria y eliminatorias</h3><p>{hasRounds ? 'El formato no se puede cambiar porque ya hay rondas generadas.' : 'Liguilla: todos contra todos dentro de cada grupo. Suizo: cada ronda empareja 1.º–2.º, 3.º–4.º… sin repetir rival.'}</p></div></div>
      <div className="tab-form-grid">
        <Field label="Formato"><select value={settings.stage} disabled={hasRounds} onChange={(event) => set('stage', event.target.value as TabSettings['stage'])}>
          <option value="groups">Liguilla de grupos</option><option value="swiss">Sistema suizo</option>
        </select></Field>
        {settings.stage === 'groups' ? <>
          <NumberField label="Número de grupos" value={settings.groupCount} min={1} max={16} onChange={(value) => set('groupCount', Math.max(1, Math.round(value)))} disabled={tournament.groups.length > 0} hint={tournament.groups.length ? 'Los grupos ya están sorteados.' : undefined} />
          <NumberField label="Clasificados por grupo" value={settings.groupAdvance} min={1} max={8} onChange={(value) => set('groupAdvance', Math.max(1, Math.round(value)))} hint="El cuadro necesita un total de 2, 4, 8 o 16 equipos." />
        </> : <>
          <NumberField label="Rondas suizas" value={settings.swissRounds} min={1} max={12} onChange={(value) => set('swissRounds', Math.max(1, Math.round(value)))} />
          <NumberField label="Equipos que pasan a eliminatorias" value={settings.breakSize} min={2} max={32} onChange={(value) => set('breakSize', Math.max(2, Math.round(value)))} hint="2, 4, 8, 16 o 32." />
        </>}
        <Field label="Cuadro eliminatorio" hint="Re-sembrar: en cada ronda el mejor clasificado restante se enfrenta al peor (UC3M).">
          <select value={settings.bracketMode} onChange={(event) => set('bracketMode', event.target.value as TabSettings['bracketMode'])}>
            <option value="fixed">Cuadro fijo: cada ganador sigue su camino</option><option value="reseed">Re-sembrar en cada ronda</option>
          </select>
        </Field>
        <SeedOrderField key={settings.breakSize} value={settings.bracketSeedOrder} breakSize={settings.breakSize} onChange={(value) => set('bracketSeedOrder', value)} />
        <NumberField label="Equipos previstos" value={settings.expectedTeams} min={0} max={200} onChange={(value) => set('expectedTeams', Math.max(0, Math.round(value)))} hint="Solo para el contador y el diagnóstico; 0 = sin previsión." />
      </div>
      <Toggle label="Evitar enfrentar equipos de la misma institución (sorteos y emparejamientos)" checked={settings.avoidSameInstitution} onChange={(value) => set('avoidSameInstitution', value)} />
      <Toggle label="Rondas a ciegas: la clasificación no se proyecta hasta acabar la fase y el orden de las salas no revela posiciones (ADUMA art. 29)" checked={settings.blindQualifying} onChange={(value) => set('blindQualifying', value)} />
    </section>

    <section className="panel">
      <div className="panel-title"><div><h3>Jueces y posturas</h3><p>{settings.oddPanels ? 'Paneles impares: el voto de la mayoría decide el debate y, si hubiera empate, decide el juez principal.' : 'Con acta conjunta un panel de dos jueces es válido: si faltan jueces, los paneles bajan de uno en uno.'}</p></div></div>
      <div className="tab-form-grid">
        <NumberField label="Jueces por debate (clasificatoria)" value={settings.qualifyingPanelSize} min={1} max={9} step={settings.oddPanels ? 2 : 1} onChange={(value) => set('qualifyingPanelSize', Math.max(1, Math.round(value)))} />
        <NumberField label="Jueces por debate (eliminatorias)" value={settings.eliminationPanelSize} min={1} max={9} step={settings.oddPanels ? 2 : 1} onChange={(value) => set('eliminationPanelSize', Math.max(1, Math.round(value)))} />
        <Field label="Incompatibilidad objetiva" hint="Compartir institución con un equipo cuenta siempre como objetiva. Las subjetivas se evitan mientras haya alternativa.">
          <select value={settings.conflictPolicy} onChange={(event) => set('conflictPolicy', event.target.value as TabSettings['conflictPolicy'])}>
            <option value="hard">Nunca se asigna (LEDU, UC3M)</option><option value="lastResort">Solo si el debate se quedaría sin juez, y nunca como vocal (ADUMA)</option>
          </select>
        </Field>
        <Field label="Posturas en la clasificatoria" hint="En eliminatorias la postura siempre se sortea.">
          <select value={settings.qualifyingSideMode} onChange={(event) => set('qualifyingSideMode', event.target.value as TabSettings['qualifyingSideMode'])}>
            <option value="draw">Sorteo antes de cada debate (LEDU, ADUMA)</option><option value="balanced">Fijadas por la tabulación, equilibradas (UC3M)</option>
          </select>
        </Field>
      </div>
      <Toggle label="Paneles impares obligatorios (desmárcalo si el acta conjunta admite paneles de dos jueces)" checked={settings.oddPanels} onChange={(value) => set('oddPanels', value)} />
    </section>

    <section className="panel">
      <div className="panel-title"><div><h3>Acta</h3><p>{settings.ballotMode === 'joint' ? 'Acta conjunta: el jurado declara el ganador y los ítems netos (ítems menos faltas) desempatan la clasificación.' : 'Cada juez puntúa a ambos equipos; su voto es para el que obtiene más puntos netos, sin empates posibles.'}</p></div></div>
      <div className="tab-form-grid">
        <Field label="Tipo de acta"><select value={settings.ballotMode} onChange={(event) => set('ballotMode', event.target.value as TabSettings['ballotMode'])}>
          <option value="judges">Un acta por juez (LEDU, UC3M)</option><option value="joint">Acta conjunta del jurado (ADUMA)</option>
        </select></Field>
        {settings.ballotMode === 'joint' ? <>
          <NumberField label="Nota mínima por ítem" value={settings.itemMin} onChange={(value) => set('itemMin', value)} />
          <NumberField label="Nota máxima por ítem" value={settings.itemMax} onChange={(value) => set('itemMax', value)} />
        </> : <>
          <NumberField label="Puntuación mínima por juez" value={settings.scoreMin} onChange={(value) => set('scoreMin', value)} />
          <NumberField label="Puntuación máxima por juez" value={settings.scoreMax} onChange={(value) => set('scoreMax', value)} />
        </>}
      </div>
      {settings.ballotMode === 'joint'
        ? settings.rubric.length > 0 && <ol className="tab-rubric">{settings.rubric.map((item) => <li key={item.id}><b>{item.name}</b> <small>({item.section})</small> {item.description}</li>)}</ol>
        : <>
          <Toggle label="Quitar la nota más alta y la más baja cuando hay más de tres jueces (LEDU art. 31.4)" checked={settings.trimExtremes} onChange={(value) => set('trimExtremes', value)} />
          <Toggle label="Las actas ya incluyen el descuento de faltas (no descontar de nuevo)" checked={settings.scoresIncludePenalties} onChange={(value) => set('scoresIncludePenalties', value)} />
        </>}
    </section>

    {settings.ballotMode === 'joint' && <section className="panel">
      <div className="panel-title"><div><h3>Actas por WhatsApp</h3><p>Cada juez principal recibe por WhatsApp el enlace de su debate, rellena el acta en el móvil y la envía a la mesa con un código que la tabulación comprueba. No usa ningún servidor: basta con que esta página esté publicada.</p></div></div>
      <div className="tab-form-grid">
        <Field label="Móvil de la mesa de tabulación (WhatsApp)" hint={whatsAppNumber(tournament.whatsapp?.deskPhone ?? '') ? 'Las actas llegarán al +' + whatsAppNumber(tournament.whatsapp?.deskPhone ?? '') + '.' : 'Vacío: el juez elige el chat al enviar.'}>
          <input type="tel" value={tournament.whatsapp?.deskPhone ?? ''} placeholder="600 11 22 33" onChange={(event) => setWhatsApp({ deskPhone: event.target.value })} />
        </Field>
        <Field label="Dirección pública de la página del acta" hint={'Vacío: ' + window.location.origin + '. Cámbiala solo si esta tabulación no está publicada (por ejemplo, si la usas en local).'}>
          <input type="url" value={tournament.whatsapp?.baseUrl ?? ''} placeholder={window.location.origin} onChange={(event) => setWhatsApp({ baseUrl: event.target.value })} />
        </Field>
      </div>
    </section>}

    <section className="panel">
      <div className="panel-title"><div><h3>Oradores</h3><p>Nota de cada intervención (introducción, 1.ª refutación, 2.ª refutación y conclusión) para los premios individuales.</p></div></div>
      <Toggle label="Registrar notas de oradores" checked={settings.speakerScores} onChange={(value) => set('speakerScores', value)} />
      {settings.speakerScores && <div className="tab-form-grid">
        <NumberField label="Nota mínima" value={settings.speakerScoreMin} onChange={(value) => set('speakerScoreMin', value)} step={0.5} />
        <NumberField label="Nota máxima" value={settings.speakerScoreMax} onChange={(value) => set('speakerScoreMax', value)} step={0.5} />
        <NumberField label="Incremento" value={settings.speakerScoreStep} min={0} onChange={(value) => set('speakerScoreStep', Math.max(0, value))} step={0.5} hint="0,5 admite medios puntos; 1 solo enteros." />
        <Field label="Ranking de oradores"><select value={settings.speakerMetric} onChange={(event) => set('speakerMetric', event.target.value as TabSettings['speakerMetric'])}>
          <option value="sum">Suma de notas</option><option value="average">Media de notas</option>
        </select></Field>
      </div>}
    </section>

    <section className="panel">
      <div className="panel-title"><div><h3>Penalizaciones</h3><p>Se anotan por equipo en cada acta y se descuentan de la puntuación de cada juez antes de calcular su voto.</p></div></div>
      <div className="tab-form-grid">
        <Field label="Conversión de avisos"><select value={settings.warningConversion} onChange={(event) => set('warningConversion', event.target.value as TabSettings['warningConversion'])}>
          <option value="ledu">LEDU: 2 avisos = leve, 4 = 2 leves, desde el 5.º cada aviso es leve</option>
          <option value="aduma">ADUMA: el primer aviso no penaliza; cada aviso siguiente es una leve</option>
          <option value="pairs">Cada 2 avisos, una falta leve</option>
          <option value="none">Los avisos no penalizan</option>
        </select></Field>
        <NumberField label="Puntos por falta leve" value={settings.minorPoints} min={0} step={0.5} onChange={(value) => set('minorPoints', value)} />
        <Field label="Acumulación de faltas leves"><select value={settings.minorEscalation} onChange={(event) => set('minorEscalation', event.target.value as TabSettings['minorEscalation'])}>
          <option value="blocks">Cada bloque de leves forma una grave</option><option value="aduma">ADUMA: con 2 o más leves, todas menos una pasan a graves</option>
        </select></Field>
        {settings.minorEscalation === 'blocks' && <NumberField label="Faltas leves que forman una grave" value={settings.minorsPerMajor} min={0} onChange={(value) => set('minorsPerMajor', Math.max(0, Math.round(value)))} hint="0 desactiva la acumulación." />}
        <Field label="Falta grave"><select value={settings.majorMode} onChange={(event) => set('majorMode', event.target.value as TabSettings['majorMode'])}>
          <option value="forfeit">Derrota automática con todos los votos (LEDU)</option><option value="points">Descuenta puntos (UC3M)</option>
        </select></Field>
        {settings.majorMode === 'points' && <NumberField label="Puntos por falta grave" value={settings.majorPoints} min={0} step={0.5} onChange={(value) => set('majorPoints', value)} />}
        <NumberField label="Puntos del equipo que pierde por falta o descalificación" value={settings.forfeitLoserPoints} onChange={(value) => set('forfeitLoserPoints', value)} />
        <Field label="Puntos del ganador en ese caso"><select value={settings.forfeitWinnerPoints} onChange={(event) => set('forfeitWinnerPoints', event.target.value as TabSettings['forfeitWinnerPoints'])}>
          <option value="average">Su media en el resto de la fase (LEDU)</option><option value="ballots">Los de las actas, si se completó el debate (UC3M)</option>
          <option value="roundAverage">La media de ítems de la ronda (ADUMA)</option>
        </select></Field>
      </div>
      {conversionWarning && <Notice kind="warning">{conversionWarning}</Notice>}
    </section>

    <section className="panel">
      <div className="panel-title"><div><h3>Criterios de clasificación</h3><p>Primero siempre las victorias. Cuando un criterio separa parte de un empate, los que siguen empatados se vuelven a comparar desde el principio, solo entre ellos.</p></div></div>
      <ol className="tab-tiebreaks">
        <li><span>Victorias</span></li>
        {settings.tiebreaks.map((key, index) => <li key={key}>
          <span>{TIEBREAK_LABELS[key]}</span>
          <button type="button" className="icon-button" aria-label="Subir" disabled={index === 0} onClick={() => moveTiebreak(index, -1)}><ArrowUp size={14} /></button>
          <button type="button" className="icon-button" aria-label="Bajar" disabled={index === settings.tiebreaks.length - 1} onClick={() => moveTiebreak(index, 1)}><ArrowDown size={14} /></button>
          <button type="button" className="icon-button danger-action" aria-label={'Quitar ' + TIEBREAK_LABELS[key]} onClick={() => set('tiebreaks', settings.tiebreaks.filter((item) => item !== key))}><Trash2 size={14} /></button>
        </li>)}
      </ol>
      {unusedTiebreaks.length > 0 && <div className="tab-actions">
        {unusedTiebreaks.map((key) => <button key={key} type="button" className="button ghost" onClick={() => set('tiebreaks', [...settings.tiebreaks, key])}><Plus size={14} /> {TIEBREAK_LABELS[key]}</button>)}
      </div>}
      <p className="muted">Los criterios de enfrentamiento directo solo se aplican cuando todos los equipos empatados se han enfrentado entre sí.</p>
      <Field label="Si el empate persiste">
        <select value={settings.tiebreakFallback} onChange={(event) => set('tiebreakFallback', event.target.value as TabSettings['tiebreakFallback'])}>
          <option value="manual">Mantener el empate hasta que la organización fije el orden (debate de desempate, LEDU)</option>
          <option value="lots">Sorteo reproducible (moneda, UC3M)</option>
        </select>
      </Field>
    </section>
  </>;
}
