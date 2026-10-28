import { useState } from 'react';

function normalizeSearchText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-ES').trim();
}
export type PickerOption = { id: string; name: string; active?: boolean; disabledReason?: string };
export function SearchableEntityPicker({ label, options, value, onChange, multiple = false }: {
  label: string; options: PickerOption[]; value: string | string[]; onChange: (value: string | string[]) => void; multiple?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const selectedIds = multiple ? value as string[] : [value as string].filter(Boolean);
  const normalized = normalizeSearchText(query);
  const filtered = options.filter((option) => (selectedIds.includes(option.id) || option.active !== false) && (!normalized || normalizeSearchText(option.name).includes(normalized)));
  const visible = expanded || normalized ? filtered : filtered.slice(0, 5);
  const toggle = (option: PickerOption) => {
    const selected = selectedIds.includes(option.id);
    if (option.disabledReason && !selected) return;
    if (multiple) onChange(selected ? selectedIds.filter((id) => id !== option.id) : [...selectedIds, option.id]);
    else { onChange(selected ? '' : option.id); setQuery(''); setExpanded(false); }
  };
  return <div className={'entity-picker' + (multiple ? ' multiple' : '')}>
    <label className="entity-picker-label">{label}</label>
    <input type="search" aria-label={'Buscar ' + label} placeholder="Buscar por nombre…" value={query} onChange={(event) => { setQuery(event.target.value); setExpanded(false); }} />
    {multiple && selectedIds.length > 0 && <div className="entity-picker-selected">{selectedIds.map((id) => { const option = options.find((item) => item.id === id); return <button type="button" key={id} className="incompatibility-chip" title={'Quitar ' + (option?.name ?? id)} onClick={() => toggle(option ?? { id, name: id })}>{option?.name ?? id}<span aria-hidden="true"> ×</span></button>; })}</div>}
    {selectedIds.length > 0 && !multiple && <div className="entity-picker-selected"><span className="entity-picker-single-selected">{options.find((option) => option.id === selectedIds[0])?.name ?? selectedIds[0]}</span><button type="button" className="picker-clear" onClick={() => onChange('')} aria-label={'Quitar selección de ' + label}>Cambiar</button></div>}
    <div className="entity-picker-options">{visible.map((option) => { const selected = selectedIds.includes(option.id); return <label key={option.id} className={'entity-picker-option' + (selected ? ' selected' : '')} title={option.disabledReason || undefined}><input type={multiple ? 'checkbox' : 'radio'} name={multiple ? undefined : label} checked={selected} disabled={Boolean(option.disabledReason && !selected)} onChange={() => toggle(option)} /><span>{option.name}{option.active === false ? ' · Inactivo' : ''}{option.disabledReason && !selected ? ' · ' + option.disabledReason : ''}</span></label>; })}{!visible.length && <small className="muted">No hay coincidencias.</small>}</div>
    {!normalized && filtered.length > 5 && <button type="button" className="picker-expand" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>{expanded ? 'Mostrar menos' : 'Mostrar todos (' + filtered.length + ')'}</button>}
  </div>;
}
