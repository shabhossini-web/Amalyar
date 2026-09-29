import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import { badTime, faTime, minToTime, normTime } from '../lib/time.js';
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
 * ⚠️ انتخابگر یک **ساعتِ دیجیتالِ دوستونه** است: ساعت و دقیقه جدا، هرکدام
 * با چرخِ اسکرول یا کلیک. نسخهٔ اول ۹۶ دکمهٔ پشتِ‌هم بود که مالکِ محصول
 * درست گفت «خشک و زشت» — گشتن در فهرستِ تخت کارِ چشم را زیاد می‌کند، در
 * حالی که آدم ساعت را به‌شکلِ «عدد بالا/پایین» تصور می‌کند.
 *
 * ⚠️ با portal روی <body> و **وسطِ صفحه** باز می‌شود، نه چسبیده به
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
  /* قالب، نه مقدار: «۰۸:۳۰» در کادرِ خالیِ عملِ بی‌ساعت شبیهِ ساعتِ ثبت‌شده بود (بازبینیِ UX ۱۴۰۵/۰۷). */
  placeholder = 'ساعت : دقیقه',
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
          <ClockPick
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
 * ساعتِ دیجیتالِ دوستونه — ساعت و دقیقه جدا.
 *
 * ⚠️ **چرخش با اسکرولِ خودِ مرورگر است، نه شبیه‌سازیِ دستیِ درگ.** با
 * `scroll-snap` هم چرخِ ماوس کار می‌کند، هم کشیدنِ انگشت با شتابِ طبیعیِ
 * موبایل، هم `PageUp/Down` و کیبورد. هر پیاده‌سازیِ دستی یکی از این سه را
 * از دست می‌داد و روی iOS مثلِ سنگ حرکت می‌کرد.
 *
 * ⚠️ انتخاب وقتی ثبت می‌شود که اسکرول **بایستد** (debounce)، نه در هر فریم:
 * وگرنه عبور از روی ۱۷ عدد، هفده بار `onChange` می‌فرستاد.
 *
 * ⚠️ فاصله‌گذارِ بالا و پایین (`tp-pad`) تزئینی نیست: بدونِ آن اولین و آخرین
 * عدد هرگز به وسطِ کادر نمی‌رسند و ۰۰ و ۵۹ عملاً انتخاب‌نشدنی می‌شوند.
 */
function ClockPick({ value, step, title, onPick, onClose }) {
  const parts = /^(\d{2}):(\d{2})$/.exec(value || '');
  const [h, setH] = useState(parts ? Number(parts[1]) : 8);
  const [m, setM] = useState(parts ? Number(parts[2]) : 0);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const two = (n) => String(n).padStart(2, '0');
  const now = () => { const d = new Date(); return minToTime(d.getHours() * 60 + d.getMinutes()); };
  /* گامِ دقیقه از `step` می‌آید ولی هرگز درشت‌تر از ۵ نمی‌شود: چرخِ دقیقه با
     گامِ ۱۵ فقط چهار عدد دارد و دیگر «ساعت» به‌نظر نمی‌رسد. تایپِ آزاد هم
     همیشه باز است، پس دقتِ دلخواه از دست نمی‌رود. */
  const mStep = Math.min(5, Math.max(1, step >= 15 ? 5 : step));
  const minutes = useMemo(
    () => Array.from({ length: Math.ceil(60 / mStep) }, (_, i) => i * mStep),
    [mStep],
  );
  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);

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

      {/* نمایشگرِ بزرگ — کاربر پیش از تأیید عددِ نهایی را می‌بیند. */}
      <div className="tp-read" dir="ltr">
        <span>{faTime(two(h))}</span><i>:</i><span>{faTime(two(m))}</span>
      </div>

      <div className="tp-wheels">
        <Wheel label="ساعت" items={hours} value={h} onChange={setH} />
        <Wheel label="دقیقه" items={minutes} value={m} onChange={setM} />
      </div>

      <footer className="tp-foot">
        <button type="button" className="tp-ghost" onClick={() => onPick('')}>پاک‌کردن</button>
        <button type="button" className="tp-ghost" onClick={() => onPick(now())}>اکنون</button>
        <button type="button" className="tp-ok" onClick={() => onPick(`${two(h)}:${two(m)}`)}>تأیید</button>
      </footer>
    </Overlay>,
    document.body,
  );
}

/**
 * یک ستونِ چرخشی.
 *
 * ⚠️ **انحنای استوانه‌ای از موقعیتِ اسکرولِ بومی می‌آید، نه از حلقهٔ درگِ
 * دست‌ساز.** نمونه‌های آمادهٔ «چرخِ گزینه» ظاهرِ درستی دارند ولی برای رسیدن
 * به آن، اسکرولِ مرورگر را با `touch-action: none` خاموش و با رویدادِ
 * pointer بازسازی می‌کنند — و همان‌جا شتابِ لمسِ موبایل، چرخِ ماوس،
 * کیبورد و اسکرول‌بارِ سافاری از دست می‌رود. این‌جا اسکرول بومی می‌ماند و
 * فقط **رنگ‌آمیزیِ سه‌بعدی** روی آن سوار می‌شود: هر عدد بر پایهٔ فاصله‌اش
 * از مرکز می‌چرخد، کوچک و کم‌رنگ و مات می‌شود.
 */
function Wheel({ label, items, value, onChange }) {
  const ref = useRef(null);
  const settle = useRef(null);
  const frame = useRef(0);
  /* ⚠️ نگهبانِ ضدِ حلقه: وقتی خودمان اسکرول می‌کنیم، رویدادِ scroll نباید
     دوباره مقدار را عوض کند — وگرنه چرخ روی عددِ همسایه می‌لرزد. */
  const programmatic = useRef(false);

  /* هندسهٔ استوانه: `d` فاصلهٔ هر عدد از مرکز برحسبِ «ردیف» است. چرخش خطی،
     ولی کوچک‌شدن و محوشدن **درجه‌دو** — لبه‌ها سریع‌تر عقب می‌نشینند و حس
     گردیِ درام می‌دهند، همان‌طور که در چرخِ واقعی نور از لبه کم می‌شود. */
  const paint = () => {
    const el = ref.current;
    if (!el) return;
    const mid = el.clientHeight / 2;
    for (let i = 0; i < items.length; i += 1) {
      const it = el.children[i + 1]; // +۱ برای فاصله‌گذارِ بالا
      if (!it) continue;
      const d = (it.offsetTop - el.scrollTop + it.clientHeight / 2 - mid) / it.clientHeight;
      const a = Math.min(Math.abs(d), 3.2);
      it.style.setProperty('--d', d.toFixed(3));
      it.style.setProperty('--s', (1 - 0.06 * a * a).toFixed(3));
      /* ⚠️ کفِ ۰٫۴۵ و ضریبِ ملایم: نسخهٔ اول لبه‌ها را تا ۰٫۱۲ می‌برد و
         ردیفِ دومِ بالا و پایین عملاً ناپیدا می‌شد — کاربر دیگر نمی‌دید به
         کدام سمت باید بچرخد. چرخ باید گرد به‌نظر برسد، نه نصفه‌کور. */
      it.style.setProperty('--f', Math.max(0.45, 1 - 0.16 * a * a).toFixed(3));
      it.style.setProperty('--b', `${(a > 1.6 ? (a - 1.6) * 0.5 : 0).toFixed(2)}px`);
    }
  };
  // ⚠️ در هر فریم یک‌بار، نه در هر رویدادِ scroll: اسکرولِ لمسی ده‌ها رویداد
  //    در یک فریم می‌فرستد و بدونِ این، هر کدام یک layout کامل می‌گیرد.
  const schedulePaint = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => { frame.current = 0; paint(); });
  };

  const centerOn = (idx, smooth) => {
    const el = ref.current;
    const item = el?.children[idx + 1]; // +۱ برای فاصله‌گذارِ بالا
    if (!el || !item) return;
    programmatic.current = true;
    el.scrollTo({ top: item.offsetTop - el.clientHeight / 2 + item.clientHeight / 2, behavior: smooth ? 'smooth' : 'auto' });
    clearTimeout(settle.current);
    settle.current = setTimeout(() => { programmatic.current = false; }, smooth ? 420 : 60);
  };

  // بازکردنِ پنل → مقدارِ فعلی وسطِ کادر
  useEffect(() => {
    centerOn(items.indexOf(value), false);
    paint();
    return () => cancelAnimationFrame(frame.current);
    /* eslint-disable-next-line */
  }, []);

  const onScroll = () => {
    // ⚠️ بیرون از نگهبان: اسکرولِ برنامه‌ای هم باید رنگ بخورد
    schedulePaint();
    if (programmatic.current) return;
    clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const mid = el.scrollTop + el.clientHeight / 2;
      let best = 0; let bestD = Infinity;
      for (let i = 0; i < items.length; i += 1) {
        const it = el.children[i + 1];
        if (!it) continue;
        const d = Math.abs(it.offsetTop + it.clientHeight / 2 - mid);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (items[best] !== value) onChange(items[best]);
    }, 110);
  };

  return (
    <div className="tp-wheel">
      <span className="tp-wlabel">{label}</span>
      {/* ⚠️ نوارِ وسط **داخلِ کادرِ خودِ ستون** است، نه هم‌ترازِ کلِ چرخ.
          نسخهٔ اول نوار را کنارِ برچسب می‌گذاشت و با یک `margin`ِ دستی
          بلندیِ برچسب را جبران می‌کرد؛ نتیجه این شد که نوار یک ردیف
          پایین‌ترِ عددِ انتخاب‌شده می‌افتاد و کاربر عددی می‌دید که با
          هایلایت نمی‌خواند. حالا مرکزِ نوار همان مرکزِ ستون است. */}
      <div className="tp-view">
        <div className="tp-band" aria-hidden="true" />
        <div
          className="tp-col" ref={ref} onScroll={onScroll} dir="ltr"
          role="listbox" aria-label={label} tabIndex={0}
        >
          <div className="tp-pad" />
          {items.map((n, i) => (
            <button
              key={n} type="button" role="option" aria-selected={n === value}
              className={`tp-num${n === value ? ' on' : ''}`}
              onClick={() => { onChange(n); centerOn(i, true); }}
            >
              {faTime(String(n).padStart(2, '0'))}
            </button>
          ))}
          <div className="tp-pad" />
        </div>
      </div>
    </div>
  );
}
