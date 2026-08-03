import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, useReducedMotion } from 'framer-motion';
import { badTime, faTime, minToTime, normTime, timeSlots } from '../lib/time.js';
import { toEnDigits } from '../lib/jalali.js';
import './timepick.css';
import { Clock, Close } from './icons.jsx';
import Overlay from './Overlay.jsx';

/**
 * ورودیِ ساعت — **هم تایپ، هم انتخاب**.
 *
 * چرا کامپوننتِ مشترک: سه جای برنامه ساعت می‌گیرند (فرمِ مراجعه، پنلِ چینش،
 * دفترِ کارِ کارشناس) و هر سه یک `<input type="text">`ِ خالی با placeholderِ
 * «۰۸:۳۰» بودند. کاربر باید کورکورانه تایپ می‌کرد و قاعدهٔ اعتبارسنجی در دو
 * فایل جدا نوشته شده بود. یک قاعده، یک رابط، یک جا.
 *
 * ⚠️ چرا فقط `<select>` نیست: کاربرِ حرفه‌ای پشتِ میز سریع‌تر «۸۳۰» تایپ
 * می‌کند تا اینکه در ۹۶ گزینه دنبالِ ۰۸:۳۰ بگردد؛ ولی کارشناس با یک دست و
 * گوشی داخلِ اتاقِ عمل ترجیح می‌دهد بزند. هر دو راه باز است و هر دو روی یک
 * مقدار کار می‌کنند.
 *
 * ⚠️ فهرست با portal روی <body> و **وسطِ صفحه** باز می‌شود، نه چسبیده به
 * فیلد — دقیقاً به همان دلیلِ تقویمِ شمسی (`JDate`): نیمی از این فیلدها داخلِ
 * شیتِ اسکرول‌شونده‌اند و پاپ‌آپِ چسبیده یا زیرِ لبه گم می‌شد یا با اسکرول از
 * فیلدش جدا می‌افتاد.
 *
 * ⚠️ مقدارِ بیرون‌داده همیشه لاتین است (سرور `HH:MM` می‌خواهد) ولی آنچه در
 * فیلد دیده می‌شود فارسی است. تبدیل **رقم‌به‌رقم** و هم‌طول است، برای همین
 * مکان‌نمای وسطِ متن سرِ جایش می‌ماند.
 */
export default function TimePick({
  label,
  value,
  onChange,                 // هر کلید — متنِ خام (فقط ارقام لاتین‌شده)
  onCommit,                 // خروج از فیلد / انتخاب از فهرست — مقدارِ نرمال‌شده
  step = 15,
  placeholder = '۰۸:۳۰',
  className = 'db-field',
  disabled,
  hint,
}) {
  const [open, setOpen] = useState(false);
  const v = String(value ?? '');
  const bad = badTime(v);

  // انتخاب هم `onChange` می‌خورد هم `onCommit`: والدِ کنترل‌شده باید مقدار را
  // ببیند، و والدی که روی commit ذخیره می‌کند باید درخواستش را بفرستد.
  const commit = (next) => { onChange(next); onCommit?.(next); };

  return (
    <label className={`${className} tp-wrap${bad ? ' bad' : ''}`}>
      {label && <span>{label}</span>}
      <div className="tp-row">
        <input
          type="text" dir="ltr" inputMode="numeric" autoComplete="off"
          className="tp-input"
          value={faTime(v)}
          disabled={disabled}
          placeholder={placeholder}
          aria-invalid={bad || undefined}
          onChange={(e) => onChange(toEnDigits(e.target.value))}
          onBlur={(e) => {
            const next = normTime(toEnDigits(e.target.value));
            if (next !== v) commit(next);
          }}
        />
        <button
          type="button" className="tp-btn" disabled={disabled}
          title="انتخابِ ساعت" aria-label="انتخابِ ساعت از فهرست"
          onClick={() => setOpen(true)}
        >
          <Clock width="16" height="16" />
        </button>
      </div>
      {hint && <em className="tp-hint">{hint}</em>}
      {bad && <em className="tp-err">ساعت باید به شکلِ ۰۸:۳۰ باشد</em>}
      <AnimatePresence>
        {open && (
          <SlotList
            value={normTime(v)}
            step={step}
            title={label}
            onPick={(picked) => { commit(picked); setOpen(false); }}
            onClose={() => setOpen(false)}
          />
        )}
      </AnimatePresence>
    </label>
  );
}

/**
 * فهرستِ ساعت‌ها — هر ساعتِ روز یک ردیف، گام‌ها در همان ردیف.
 *
 * ⚠️ چیدمانِ «۹۶ دکمه پشتِ هم» روی موبایل غیرقابل‌استفاده بود: کاربر باید تا
 * وسطِ فهرست اسکرول می‌کرد تا بفهمد کجاست. با ردیف‌بندیِ ساعتی، عنوانِ ساعت
 * لنگر است و چشم مستقیم می‌رود سرِ ۰۸.
 */
function SlotList({ value, step, title, onPick, onClose }) {
  const still = useReducedMotion();
  const listRef = useRef(null);
  const selRef = useRef(null);

  const rows = useMemo(() => {
    const byHour = new Map();
    for (const t of timeSlots(step, value)) {
      const h = t.slice(0, 2);
      if (!byHour.has(h)) byHour.set(h, []);
      byHour.get(h).push(t);
    }
    return [...byHour.entries()];
  }, [step, value]);

  // Esc همیشه ببندد — فهرستِ وسطِ صفحه بدونِ راهِ فرار، حبس است.
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onClose]);

  // ⚠️ بدونِ این پرش، فهرست همیشه از ۰۰:۰۰ باز می‌شد و کاربر برای دیدنِ ساعتِ
  //    فعلیِ خودش باید دستی پایین می‌آمد. مقصد وسطِ کادر می‌نشیند تا ساعتِ
  //    قبل و بعدش هم دیده شود.
  useEffect(() => {
    const el = selRef.current ?? listRef.current?.querySelector('[data-anchor="1"]');
    el?.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
  }, [still]);

  const now = () => { const d = new Date(); return minToTime(d.getHours() * 60 + d.getMinutes()); };

  return createPortal(
    <Overlay
      backdrop="tp-overlay"
      panel="tp-panel"
      onClose={onClose}
      role="dialog" aria-modal="true" aria-label={title || 'انتخابِ ساعت'}
    >
      <header className="tp-head">
        <b>{title || 'انتخابِ ساعت'}</b>
        <button type="button" className="tp-x" onClick={onClose} aria-label="بستن"><Close width="17" height="17" /></button>
      </header>

      <div className="tp-list" ref={listRef}>
        {rows.map(([h, slots]) => (
          <div className="tp-hour" key={h}>
            {/* ساعت با ارقامِ فارسی نوشته می‌شود ولی `dir="ltr"` می‌ماند،
                وگرنه «۰۸» در ستونِ راست‌چین جابه‌جا دیده می‌شود. */}
            <i className="tp-hlabel" dir="ltr">{faTime(h)}</i>
            <div className="tp-slots">
              {slots.map((t) => {
                const sel = t === value;
                // ⚠️ لنگرِ پیش‌فرضِ اسکرول وقتی هنوز ساعتی انتخاب نشده: ۰۸:۰۰،
                //    چون تقریباً همهٔ عمل‌ها صبح شروع می‌شوند.
                const anchor = !value && t === '08:00';
                return (
                  <button
                    key={t} type="button" dir="ltr"
                    ref={sel ? selRef : undefined}
                    data-anchor={anchor ? '1' : undefined}
                    className={`tp-slot${sel ? ' sel' : ''}`}
                    aria-pressed={sel}
                    onClick={() => onPick(t)}
                  >
                    {faTime(t)}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <footer className="tp-foot">
        <button type="button" className="tp-ghost" onClick={() => onPick('')}>پاک‌کردن</button>
        <button type="button" className="tp-now" onClick={() => onPick(now())}>اکنون</button>
      </footer>
    </Overlay>,
    document.body,
  );
}
