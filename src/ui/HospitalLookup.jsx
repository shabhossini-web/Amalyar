import { useEffect, useId, useState } from 'react';
import { api } from '../lib/api.js';
import { Hospital } from './icons.jsx';
import './hospital-lookup.css';

/**
 * بیمارستان — کادرِ جست‌وجو با پیشنهادِ **زیرِ کادر** (combobox).
 *
 * ⚠️ مالک، ۱۴۰۵/۰۷/۰۴ (فرمِ نورومانیتورینگ): «انتخابِ بیمارستان‌ها بهم ریخته؛ وقتی تایپ
 * می‌شود گزینه‌ها زیرش بیایند». تا دیروز هر پاسخِ سرور — با کادرِ خالی سی بیمارستانِ اولِ
 * الفبا — دیواری از دکمه زیرِ کادر می‌ساخت که هیچ‌وقت بسته نمی‌شد.
 *
 * حالا فهرست فقط وقتی باز است که کادر فوکوس دارد و چیزی تایپ شده؛ با لمس یا Enter انتخاب و
 * بسته می‌شود، با Escape یا بیرون‌رفتن هم. نامِ آزاد پذیرفته است (شناسهٔ صفر): بیمارستانی که
 * در فهرست نیست را شرکت هنگامِ تأیید تعیین می‌کند (`matchIntakeHospital`).
 */
export default function HospitalLookup({ token, value = '', onChange, disabled, error, label = 'بیمارستان', required = false }) {
  const [options, setOptions] = useState([]);
  const [warning, setWarning] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  /* جست‌وجویی که پاسخش رسیده — تا «در فهرست نیست» فقط بعد از پاسخِ واقعی دیده شود، نه حینِ تایپ. */
  const [answered, setAnswered] = useState('');
  const id = useId();
  const q = String(value ?? '').trim();

  useEffect(() => {
    /* کادرِ خالی چیزی پیشنهاد نمی‌دهد — همان دیوارِ سی‌تایی که مالک نمی‌خواست. */
    if (!open || !q) { setOptions([]); return undefined; }
    let live = true;
    const timer = setTimeout(() => {
      api(`/public/intake/form/${token}/hospitals?q=${encodeURIComponent(q)}`)
        .then((rows) => { if (live) { setOptions(Array.isArray(rows) ? rows.slice(0, 8) : []); setActive(-1); setWarning(''); setAnswered(q); } })
        .catch(() => { if (live) setWarning('فهرست باز نشد؛ نام بیمارستان را کامل بنویسید تا شرکت بررسی کند.'); });
    }, 200);
    return () => { live = false; clearTimeout(timer); };
  }, [token, q, open]);

  const shown = open && options.length > 0;
  const choose = (h) => { onChange(h.name, h.id); setOpen(false); setOptions([]); setActive(-1); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown' && options.length) { e.preventDefault(); setOpen(true); setActive((i) => (i + 1) % options.length); }
    else if (e.key === 'ArrowUp' && options.length) { e.preventDefault(); setActive((i) => (i <= 0 ? options.length - 1 : i - 1)); }
    else if (e.key === 'Enter' && shown && active >= 0) { e.preventDefault(); choose(options[active]); }
    else if (e.key === 'Escape' && shown) { e.preventDefault(); setOpen(false); }
  };

  return (
    <div className={`hospital-lookup pf-field${error ? ' bad' : ''}`}>
      <span id={`${id}-label`}>
        {label}{required && <i className="hl-star" aria-label="اجباری"> *</i>}
      </span>
      <div className="hl-box">
        <input
          role="combobox" aria-labelledby={`${id}-label`} aria-autocomplete="list"
          aria-expanded={shown} aria-controls={`${id}-list`}
          aria-activedescendant={shown && active >= 0 ? `${id}-o${active}` : undefined}
          value={value} disabled={disabled} autoComplete="off"
          placeholder="نام بیمارستان را بنویسید"
          onChange={(e) => { onChange(e.target.value, 0); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKey}
        />
        {shown && (
          <ul id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`} className="hl-list">
            {options.map((h, i) => (
              <li
                key={h.id} id={`${id}-o${i}`} role="option" aria-selected={i === active}
                className={i === active ? 'on' : ''}
                /* ⚠️ mousedown نه click: کلیک بعد از blurِ کادر می‌رسد و فهرست پیش از آن بسته شده بود. */
                onMouseDown={(e) => { e.preventDefault(); choose(h); }}
                onMouseEnter={() => setActive(i)}
              >
                <Hospital width="15" height="15" aria-hidden="true" />
                <span>{h.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {/* بی‌نتیجه: نامِ آزاد پذیرفته است — بیمار باید بداند لازم نیست چیزی از فهرست پیدا کند. */}
      {open && q && answered === q && !options.length && !warning && (
        <p role="status">این نام در فهرست نیست؛ همین را بنویسید، شرکت بررسی می‌کند.</p>
      )}
      {error && <p role="alert">{error}</p>}
      {warning && <p>{warning}</p>}
    </div>
  );
}
