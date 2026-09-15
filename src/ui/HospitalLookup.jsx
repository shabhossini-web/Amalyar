import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import './hospital-lookup.css';

export default function HospitalLookup({ token, value = '', onChange, disabled, error }) {
  const [options, setOptions] = useState([]), [warning, setWarning] = useState('');
  useEffect(() => { let live = true; const timer = setTimeout(() => api(`/public/intake/form/${token}/hospitals?q=${encodeURIComponent(value)}`).then(rows => { if (live) { setOptions(rows); setWarning(''); } }).catch(() => { if (live) setWarning('فهرست باز نشد؛ نام بیمارستان را بنویسید تا شرکت بررسی کند.'); }), 200); return () => { live = false; clearTimeout(timer); }; }, [token, value]);
  return <section className="hospital-lookup"><label className="ia-field"><span>بیمارستان</span><input value={value} disabled={disabled} onChange={e => onChange(e.target.value, 0)} placeholder="نام بیمارستان را بنویسید یا از گزینه‌ها انتخاب کنید" /></label>
    <div className="bl-code-hits">{options.map(h => <button type="button" className="bl-mini" key={h.id} disabled={disabled} onClick={() => onChange(h.name, h.id)}>{h.name}</button>)}</div>
    {error && <p role="alert">{error}</p>}{warning && <p>{warning}</p>}
  </section>;
}
