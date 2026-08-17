import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import Overlay from './Overlay.jsx';
import { Close } from './icons.jsx';
import './pick.css';

/**
 * بازشوی انتخاب — جایگزینِ `<select>`ِ بومی برای فهرست‌های موجودیت.
 *
 * چرا selectِ بومی نه: روی ویندوز، پاپ‌آپِ بومی روی صفحهٔ شیشه‌ایِ ما هم
 * **کند باز می‌شود** هم ناقص رنگ می‌خورد (گزینه‌ها تا repaint بعدی سیاه
 * می‌مانند) — روی نصبِ واقعی دیده شد. این بازشو داخلِ خودِ صفحه است، پس
 * روی هر سه سکو یک شکل و یک سرعت دارد.
 *
 * ⚠️ مثلِ `TimePick` و `JDate` با portal **وسطِ صفحه** باز می‌شود، نه چسبیده
 * به فیلد: نیمی از این فیلدها داخلِ شیتِ اسکرول‌شونده‌اند و پاپ‌آپِ چسبیده یا
 * زیرِ لبهٔ شیت گم می‌شد یا با اسکرول از فیلدش جدا می‌افتاد.
 *
 * فهرستِ بلند جستجو می‌گیرد (بالای ۷ گزینه) — همان دلیلی که کاربر در
 * selectِ بومیِ ۴۰ جراح باید تایپِ کور می‌کرد.
 */
export default function Pick({
  value,
  onChange,
  options,
  label,                       // عنوانِ پنل — معمولاً همان برچسبِ فیلد
  placeholder = '— انتخاب —',
  clearable = true,
  labelOf,                     // نامِ نمایشیِ هر گزینه؛ پیش‌فرض name/title/displayName
  disabled,
}) {
  const [open, setOpen] = useState(false);
  const nameOf = (o) => (labelOf ? labelOf(o) : (o.name || o.title || o.displayName || ''));
  const current = options.find((o) => o.id === value);

  return (
    <>
      <button
        type="button"
        className={`pk-btn${current ? '' : ' empty'}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span>{current ? nameOf(current) : placeholder}</span>
        <i className="pk-caret" aria-hidden="true" />
      </button>
      <AnimatePresence>
        {open && (
          <PickPanel
            title={label}
            options={options}
            value={value}
            nameOf={nameOf}
            clearable={clearable}
            placeholder={placeholder}
            onPick={(id) => { onChange(id); setOpen(false); }}
            onClose={() => setOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function PickPanel({ title, options, value, nameOf, clearable, placeholder, onPick, onClose }) {
  const [q, setQ] = useState('');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const term = q.trim();
  const shown = useMemo(
    () => (term ? options.filter((o) => String(nameOf(o)).includes(term)) : options),
    [term, options, nameOf],
  );

  return createPortal(
    <Overlay
      backdrop="pk-overlay"
      panel="pk-panel"
      onClose={onClose}
      role="dialog" aria-modal="true" aria-label={title || 'انتخاب'}
    >
      <header className="pk-head">
        <b>{title || 'انتخاب'}</b>
        <button type="button" className="pk-x" onClick={onClose} aria-label="بستن"><Close width="17" height="17" /></button>
      </header>

      {options.length > 7 && (
        <input
          className="pk-search"
          type="text"
          value={q}
          autoFocus
          placeholder="جستجو…"
          onChange={(e) => setQ(e.target.value)}
        />
      )}

      <div className="pk-list" role="listbox">
        {clearable && !term && (
          <button
            type="button" role="option" aria-selected={value == null}
            className={`pk-item pk-clear${value == null ? ' on' : ''}`}
            onClick={() => onPick(null)}
          >
            {placeholder}
          </button>
        )}
        {shown.map((o) => (
          <button
            key={o.id} type="button" role="option" aria-selected={o.id === value}
            className={`pk-item${o.id === value ? ' on' : ''}`}
            onClick={() => onPick(o.id)}
          >
            {nameOf(o)}
          </button>
        ))}
        {shown.length === 0 && <div className="pk-none">چیزی پیدا نشد</div>}
      </div>
    </Overlay>,
    document.body,
  );
}
