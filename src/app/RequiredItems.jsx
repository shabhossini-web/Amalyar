import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { toEnDigits } from '../lib/identity.js';
import { Plus, Trash } from '../ui/icons.jsx';

/** Operational requirements; choosing a product never consumes stock or creates a charge. */
export default function RequiredItems({ value, onChange, disabled, endpoint = '/items' }) {
  const [items, setItems] = useState([]), [query, setQuery] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => api(`${endpoint}?q=${encodeURIComponent(query)}`).then(rows => { if (active) { setItems(rows); setError(''); } }).catch(e => { if (active) setError(e.message); }), 200);
    return () => { active = false; clearTimeout(timer); };
  }, [endpoint, query]);
  const change = (i, patch) => onChange(value.map((row, n) => n === i ? { ...row, ...patch } : row));
  return <fieldset className="ri-editor" disabled={disabled}>
    <legend>اقلام و تعداد موردنیاز بیمار</legend>
    <p className="db-hint">این فهرست برای آماده‌سازی بر اساس دستور جراح است؛ ثبت مصرف و صورتحساب در مرحلهٔ مربوط انجام می‌شود.</p>
    <label className="ia-field"><span>جستجوی کالا در تعاریف پایه</span><input value={query} onChange={e => setQuery(e.target.value)} /></label>
    {error && <p role="alert">{error}</p>}
    {value.map((row, i) => <div className="ri-row" key={i}>
      <label className="ia-field"><span>کالا {i + 1}</span><select aria-label={`کالا ${i + 1}`} value={row.itemId || ''} onChange={e => { const item = items.find(x => x.id === Number(e.target.value)); change(i, { itemId: Number(e.target.value), name: item?.name }); }}>
        <option value="">انتخاب کالا</option>
        {row.itemId && !items.some(x => x.id === row.itemId) && <option value={row.itemId}>{row.name || `کالا ${row.itemId}`}</option>}
        {items.filter(x => x.active !== false).map(item => <option key={item.id} value={item.id}>{[item.name, item.size].filter(Boolean).join(' · ')}</option>)}
      </select></label>
      <label className="ia-field"><span>تعداد {i + 1}</span><input inputMode="numeric" value={row.quantity ?? ''} onChange={e => change(i, { quantity: Number(toEnDigits(e.target.value)) })} /></label>
      <label className="ia-field"><span>اندازه یا مشخصات تکمیلی {i + 1}</span><input value={row.notes || ''} onChange={e => change(i, { notes: e.target.value })} maxLength={1000} /></label>
      <button type="button" className="ri-delete" aria-label={`حذف کالای موردنیاز ${i + 1}`} onClick={() => onChange(value.filter((_, n) => n !== i))}><Trash width="16" height="16" /> حذف</button>
    </div>)}
    <button type="button" className="bl-mini" onClick={() => onChange([...value, { itemId: 0, quantity: 1, notes: '' }])}><Plus width="16" height="16" /> افزودن کالای موردنیاز</button>
  </fieldset>;
}
