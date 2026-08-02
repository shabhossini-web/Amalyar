import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { J_DAYS, J_MONTHS, jDayOfWeek, jMonthDays, jParse, jStr, jToFa, jToday, toEnDigits } from '../lib/jalali.js';
import './jdate.css';
import { Calendar as CalendarIcon, ChevronEnd, Close } from '../ui/icons.jsx';


/**
 * ورودیِ تاریخِ شمسی + تقویمِ بازشونده.
 *
 * چرا کامپوننتِ مشترک: هشت جای برنامه تاریخِ شمسی می‌گیرند و تا امروز هرکدام
 * یک input متنی با placeholderِ خودشان بودند. یک قاعدهٔ نمایش/اعتبارسنجی، یک جا.
 *
 * ⚠️ تقویم با portal روی <body> و در **وسطِ صفحه** باز می‌شود، نه چسبیده به
 * فیلد: نیمی از این فیلدها داخلِ شیتِ اسکرول‌شونده‌اند و پاپ‌آپِ چسبیده یا زیرِ
 * لبه گم می‌شد یا با اسکرول از فیلدش جدا می‌افتاد.
 *
 * تایپِ مستقیم هم باز می‌ماند — کاربرِ حرفه‌ای سریع‌تر تایپ می‌کند تا کلیک.
 */
export default function JDate({
  label, value, onChange, placeholder = '۱۴۰۵/۰۱/۰۱',
  mode = 'date', // date | birth (بازهٔ سال فرق می‌کند)
  className = 'db-field', disabled, hint,
}) {
  const [open, setOpen] = useState(false);
  const bad = !!value?.trim() && !jParse(value);

  return (
    <label className={`${className} jd-wrap${bad ? ' bad' : ''}`}>
      {label && <span>{label}</span>}
      <div className="jd-row">
        <input
          type="text" dir="ltr" inputMode="numeric"
          value={value ?? ''}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => onChange(normalize(e.target.value))}
        />
        <button
          type="button" className="jd-btn" disabled={disabled}
          title="تقویم" aria-label="انتخاب از تقویم"
          onClick={() => setOpen(true)}
        >
          <CalendarIcon width="16" height="16" />
        </button>
      </div>
      {hint && <em className="jd-hint">{hint}</em>}
      {bad && <em className="jd-err">تاریخ باید به شکلِ ۱۴۰۵/۰۵/۰۷ باشد</em>}
      {open && (
        <CalendarIcon
          value={value}
          mode={mode}
          title={label}
          onPick={(v) => { onChange(v); setOpen(false); }}
          onClose={() => setOpen(false)}
        />
      )}
    </label>
  );
}

/** «۵/۷/۱۴۰۵» و «14050507» هم پذیرفته می‌شوند؛ نامعتبر دست‌نخورده برمی‌گردد. */
function normalize(v) {
  const raw = toEnDigits(String(v ?? '')).trim().replace(/[-.]/g, '/');
  if (!raw) return '';
  const packed = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  const parts = packed ? [packed[1], packed[2], packed[3]] : raw.split('/');
  if (parts.length !== 3) return raw;
  const [y, m, d] = parts.map(Number);
  if (!y || !m || !d || m > 12 || d > 31) return raw;
  const out = jStr(y, m, d);
  return jParse(out) ? out : raw;
}

/**
 * تقویمِ ماهانه. وسطِ صفحه، روی <body> از طریق portal — تا z-indexِ شیتِ
 * والد (و overflowِ اسکرول‌بار) نتواند نصفش را ببرد.
 */
function Calendar({ value, mode, title, onPick, onClose }) {
  const [ty, tm] = jToday();
  const picked = jParse(value);
  const [y, setY] = useState(picked ? picked[0] : mode === 'birth' ? ty - 30 : ty);
  const [m, setM] = useState(picked ? picked[1] : tm);

  // Esc همیشه ببندد — تقویمِ وسطِ صفحه بدونِ راهِ فرار، حبس است.
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onClose]);

  const years = useMemo(() => {
    const from = mode === 'birth' ? 1300 : ty - 5;
    const to = mode === 'birth' ? ty : ty + 5;
    return Array.from({ length: to - from + 1 }, (_, i) => to - i);
  }, [mode, ty]);

  const days = jMonthDays(y, m);
  const lead = jDayOfWeek(y, m, 1);
  const today = jToday();

  const step = (delta) => {
    let nm = m + delta;
    let ny = y;
    if (nm < 1) { nm = 12; ny -= 1; }
    if (nm > 12) { nm = 1; ny += 1; }
    setY(ny); setM(nm);
  };

  return createPortal(
    <div className="jd-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="jd-cal" role="dialog" aria-modal="true" aria-label={title || 'انتخابِ تاریخ'}>
        <header className="jd-cal-head">
          <b>{title || 'انتخابِ تاریخ'}</b>
          <button type="button" className="jd-x" onClick={onClose} aria-label="بستن"><Close width="17" height="17" /></button>
        </header>

        <div className="jd-nav">
          <button type="button" onClick={() => step(-1)} aria-label="ماهِ قبل"><ChevronEnd width="16" height="16" /></button>
          <select value={m} onChange={(e) => setM(Number(e.target.value))} aria-label="ماه">
            {J_MONTHS.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
          </select>
          <select value={y} onChange={(e) => setY(Number(e.target.value))} aria-label="سال">
            {years.map((yy) => <option key={yy} value={yy}>{jToFa(yy)}</option>)}
          </select>
          {/* جهتِ فلش‌ها در RTL برعکس است: «بعدی» سمتِ چپ. */}
          <button type="button" onClick={() => step(1)} aria-label="ماهِ بعد" className="jd-next"><ChevronEnd width="16" height="16" /></button>
        </div>

        <div className="jd-grid">
          {J_DAYS.map((d) => <i key={d} className="jd-dow">{d}</i>)}
          {Array.from({ length: lead }, (_, i) => <span key={`e${i}`} className="jd-empty" />)}
          {Array.from({ length: days }, (_, i) => i + 1).map((d) => {
            const isToday = today[0] === y && today[1] === m && today[2] === d;
            const isSel = picked && picked[0] === y && picked[1] === m && picked[2] === d;
            return (
              <button
                key={d} type="button"
                className={`jd-day${isToday ? ' today' : ''}${isSel ? ' sel' : ''}`}
                onClick={() => onPick(jStr(y, m, d))}
              >
                {jToFa(d)}
              </button>
            );
          })}
        </div>

        <footer className="jd-cal-foot">
          <button type="button" className="jd-ghost" onClick={() => onPick('')}>پاک‌کردن</button>
          <button type="button" className="jd-todaybtn" onClick={() => onPick(jStr(...jToday()))}>امروز</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
