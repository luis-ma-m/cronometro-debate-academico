import { useState } from 'react';
import { Plus, Send, Trash2, X } from 'lucide-react';
import type { FeaturedMessage, FeaturedMessageSubtitle, PhysicalRoom } from '../domain';

type DraftSubtitle = { id: string; text: string; hasTimer: boolean; minutes: string; seconds: string };
type Props = {
  rooms: PhysicalRoom[];
  activeMessage?: FeaturedMessage;
  saving: boolean;
  onClose: () => void;
  onPublish: (message: FeaturedMessage) => Promise<boolean>;
  onClear: () => Promise<boolean>;
};

const makeId = () => globalThis.crypto?.randomUUID?.() ?? 'msg-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const toDraft = (item: FeaturedMessageSubtitle & { durationSeconds: number }): DraftSubtitle => ({
  id: item.id, text: item.text, hasTimer: Number.isFinite(item.durationSeconds) && item.durationSeconds > 0,
  minutes: String(Math.floor(item.durationSeconds / 60)),
  seconds: String(item.durationSeconds % 60).padStart(2, '0'),
});

export function FeaturedMessageManager({ rooms, activeMessage, saving, onClose, onPublish, onClear }: Props) {
  const [title, setTitle] = useState(activeMessage?.title ?? '');
  const [subtitles, setSubtitles] = useState<DraftSubtitle[]>(() => activeMessage?.subtitles.map(toDraft) ?? [
    { id: makeId(), text: '', hasTimer: true, minutes: '05', seconds: '00' },
    { id: makeId(), text: '', hasTimer: true, minutes: '02', seconds: '00' },
  ]);
  const [allRooms, setAllRooms] = useState(!activeMessage || activeMessage.targetPhysicalRoomIds.length === 0);
  const [selectedRoomIds, setSelectedRoomIds] = useState<string[]>(activeMessage?.targetPhysicalRoomIds ?? []);
  const [error, setError] = useState('');

  const updateSubtitle = (id: string, patch: Partial<DraftSubtitle>) =>
    setSubtitles((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));

  const publish = async () => {
    setError('');
    if (!title.trim()) { setError('Escribe un título para el mensaje.'); return; }
    if (subtitles.length < 2) { setError('Añade al menos dos subtítulos.'); return; }
    const normalized = subtitles.map((item) => {
      const minutes = Number(item.minutes);
      const seconds = Number(item.seconds);
      return { id: item.id, text: item.text.trim(), ...(item.hasTimer ? { durationSeconds: minutes * 60 + seconds } : {}) };
    });
    if (normalized.some((item) => !item.text || ('durationSeconds' in item && (!Number.isInteger(item.durationSeconds) || item.durationSeconds <= 0)))) {
      setError('Cada subtítulo debe tener texto y, si se activa, un contador superior a cero.');
      return;
    }
    if (subtitles.some((item) => item.hasTimer && (!/^\\d+$/.test(item.minutes) || !/^\\d{1,2}$/.test(item.seconds) || Number(item.seconds) > 59))) {
      setError('Indica minutos válidos y segundos entre 00 y 59.');
      return;
    }
    if (!allRooms && selectedRoomIds.length === 0) { setError('Selecciona al menos una sala o activa «Todas las salas».'); return; }
    const message: FeaturedMessage = {
      id: makeId(),
      title: title.trim(),
      subtitles: normalized,
      targetPhysicalRoomIds: allRooms ? [] : selectedRoomIds,
      publishedAt: Date.now(),
    };
    const ok = await onPublish(message);
    if (!ok) setError('No se ha podido publicar el mensaje. Revisa el error del gestor e inténtalo de nuevo.');
  };

  const clear = async () => {
    setError('');
    const ok = await onClear();
    if (!ok) setError('No se ha podido retirar el mensaje destacado.');
  };

  return <div className="featured-manager-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section className="featured-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="featured-manager-title">
      <header className="featured-manager-header">
        <div><span className="eyebrow">COMUNICACIÓN A LAS SALAS</span><h2 id="featured-manager-title">Mensaje destacado</h2><p>Publica un aviso con contadores independientes en las pantallas de las salas seleccionadas.</p></div>
        <button className="icon-button" type="button" onClick={onClose} disabled={saving} aria-label="Cerrar"><X size={18} /></button>
      </header>
      <label className="featured-field">Título principal<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="Ej. Comida y reanudación del torneo" /></label>
      <div className="featured-subtitle-heading"><div><b>Subtítulos y contadores</b><small>Puedes añadir un contador independiente a cada subtítulo; no es obligatorio.</small></div><button type="button" className="button secondary" onClick={() => setSubtitles((current) => [...current, { id: makeId(), text: '', hasTimer: true, minutes: '01', seconds: '00' }])}><Plus size={15} /> Añadir subtítulo</button></div>
      <div className="featured-subtitle-list">{subtitles.map((item, index) => <article className="featured-subtitle-editor" key={item.id}>
        <div className="featured-subtitle-editor-top"><b>Subtítulo {index + 1}</b>{subtitles.length > 2 && <button type="button" className="icon-button" aria-label={'Eliminar subtítulo ' + (index + 1)} onClick={() => setSubtitles((current) => current.filter((value) => value.id !== item.id))}><Trash2 size={14} /></button>}</div>
        <label className="featured-field">Texto<input value={item.text} onChange={(event) => updateSubtitle(item.id, { text: event.target.value })} maxLength={180} placeholder="Ej. La siguiente ronda comienza en..." /></label>
        <div className="featured-duration"><label className="featured-timer-toggle"><input type="checkbox" checked={item.hasTimer} onChange={(event) => updateSubtitle(item.id, { hasTimer: event.target.checked })} /> Incluir contador</label><label>Minutos<input type="number" min="0" max="1440" value={item.minutes} disabled={!item.hasTimer} onChange={(event) => updateSubtitle(item.id, { minutes: event.target.value })} /></label><label>Segundos<input type="number" min="0" max="59" value={item.seconds} disabled={!item.hasTimer} onChange={(event) => updateSubtitle(item.id, { seconds: event.target.value })} /></label></div>
      </article>)}</div>
      <section className="featured-room-targets"><b>Salas destinatarias</b><label className="featured-room-option"><input type="checkbox" checked={allRooms} onChange={(event) => setAllRooms(event.target.checked)} /> Todas las salas ({rooms.length})</label>{!allRooms && <div className="featured-room-list">{rooms.map((room) => <label className="featured-room-option" key={room.id}><input type="checkbox" checked={selectedRoomIds.includes(room.id)} onChange={(event) => setSelectedRoomIds((current) => event.target.checked ? [...current, room.id] : current.filter((id) => id !== room.id))} /> {room.name}</label>)}</div>}</section>
      {activeMessage && <p className="featured-active-note">Hay un mensaje destacado publicado. Publicar uno nuevo lo sustituirá en las salas destinatarias.</p>}
      {error && <p className="error featured-manager-error" role="alert">{error}</p>}
      <footer className="featured-manager-actions">{activeMessage && <button type="button" className="button ghost" onClick={() => void clear()} disabled={saving}><Trash2 size={15} /> Retirar mensaje</button>}<span /> <button type="button" className="button secondary" onClick={onClose} disabled={saving}>Cancelar</button><button type="button" className="button primary" onClick={() => void publish()} disabled={saving}><Send size={15} /> {saving ? 'Publicando…' : 'Publicar mensaje'}</button></footer>
    </section>
  </div>;
}
