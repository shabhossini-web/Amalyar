import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import './ui.css';

/**
 * نوارِ تب — **تک‌منبع** برای همهٔ صفحه‌ها.
 *
 * تا قبل از این، شش صفحه نوارِ تبِ دست‌سازِ خودشان را داشتند با شش CSSِ جدا؛
 * دو تایشان بنفش بودند، یکی کهربایی، یکی داخلِ قاب. تبِ فعال هم با عوض‌شدنِ
 * `className` **می‌پرید**: پس‌زمینه از یک دکمه ناپدید و روی دکمهٔ بعدی ظاهر
 * می‌شد و چشم رابطه‌شان را نمی‌گرفت.
 *
 * حالا قرصِ فعال یک المانِ **واحد** است که بینِ تب‌ها **می‌لغزد** — پس
 * هیچ‌وقت دو تب هم‌زمان فعال به‌نظر نمی‌رسند و «کدام تب فعال شد» یک حرکتِ
 * قابلِ دنبال‌کردن است، نه یک پرشِ ناگهانی.
 *
 * ⚠️ **قرص هرگز unmount نمی‌شود** و `layoutId` ندارد — تصمیمی که از یک باگِ
 * واقعی درآمده، نه از سلیقه. نسخهٔ قبلی قرص را فقط داخلِ دکمهٔ فعال رندر
 * می‌کرد و با `layoutId` جابه‌جایش می‌کرد؛ یعنی هر بار که کاربر تب عوض
 * می‌کرد، یک المانِ shared-layout از DOM می‌رفت و یکی دیگر می‌آمد. اگر این
 * نوار داخلِ شیتی بود که `AnimatePresence` دارد، حسابداریِ framer گیر می‌کرد
 * و **خروجِ شیت هرگز تمام نمی‌شد**: پوششِ `*-overlay` نامرئی روی صفحه می‌ماند
 * و همهٔ کلیک‌ها را می‌بلعید. کاربر می‌دید فرم بسته شد ولی هیچ دکمه‌ای دیگر
 * کار نمی‌کرد.
 *
 * قبلاً این را با «unmount نکردنِ گامِ ۱ در شیتِ مراجعه» دور زده بودیم — یک
 * وصله سرِ یک مصرف‌کننده، در حالی که `BillingSheet` و فرم‌ساز و شیتِ تعریف‌ها
 * هم همین تب را داشتند. حالا ریشه بسته است: موقعیتِ دکمهٔ فعال اندازه‌گیری
 * می‌شود و قرص با `x/y/width/height` به آن‌جا می‌رود.
 */
export default function Tabs({
  items,
  value,
  onChange,
  tone = 'brand',
  variant = 'fill',
  className = '',
  label,
}) {
  const navRef = useRef(null);
  const [box, setBox] = useState(null);
  const still = useReducedMotion();

  /* `offset*` و نه `getBoundingClientRect`: مختصاتِ offset از قبل نسبت به
     محتوای نوار است، پس نوارِ اسکرولی (`variant="scroll"`) هم بدونِ حساب‌کردنِ
     `scrollLeft` درست می‌افتد — و در RTL که `scrollLeft` منفی می‌شود، اصلاً
     مسئله‌ای نمی‌ماند.

     ⚠️ `setBox` فقط وقتی صدا زده می‌شود که عدد **واقعاً** عوض شده باشد. بدونِ
     این مقایسه هر بار یک شیءِ تازه ساخته می‌شد، React آن را تغییرِ state
     می‌دید، دوباره رندر می‌کرد و افکت دوباره اندازه می‌گرفت — حلقهٔ رندر. در
     ظاهرِ صفحه دیده نمی‌شد (قرص سرِ جایش بود) ولی برنامه را می‌سوزاند. */
  const measure = useCallback(() => {
    const nav = navRef.current;
    const btn = nav?.querySelector('button[aria-selected="true"]');
    if (!btn) { setBox((b) => (b === null ? b : null)); return; }
    const next = { x: btn.offsetLeft, y: btn.offsetTop, width: btn.offsetWidth, height: btn.offsetHeight };
    setBox((b) => (b && b.x === next.x && b.y === next.y && b.width === next.width && b.height === next.height ? b : next));
  }, []);

  /* ⚠️ کلیدِ تب‌ها، نه خودِ آرایه: تقریباً همهٔ مصرف‌کننده‌ها `items` را inline
     می‌سازند، پس هویتش هر رندر عوض می‌شود و اگر در وابستگی‌ها بیاید، افکت
     هر رندر اجرا می‌شود. */
  const sig = items.map((i) => i.key).join('|');

  useLayoutEffect(measure, [measure, value, sig]);

  /* عرضِ دکمه‌ها با تغییرِ عرضِ صفحه و با آمدنِ فونت عوض می‌شود؛ بدونِ این،
     قرص سرِ چرخشِ گوشی یا بعد از لود شدنِ Vazirmatn یک تب عقب می‌ماند. */
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    nav.querySelectorAll('button').forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [measure, sig]);

  /* کلیدهای جهت + roving tabindex (W0.6): فقط تبِ فعال در زنجیرهٔ Tab است و
     Home/End/فلش‌ها بینِ تب‌ها می‌گردند — الگوی WAI-ARIA برای tablist، وگرنه
     کاربرِ صفحه‌کلید باید از روی تک‌تکِ تب‌ها Tab می‌زد. در RTL فلشِ چپ «بعدی»
     است چون تبِ بعدی سمتِ چپ نشسته؛ جهت از خودِ نوار خوانده می‌شود نه از یک
     ثابت. انتخاب با خودِ حرکت انجام می‌شود (فعال‌سازیِ خودکار). */
  const activeIdx = items.findIndex((i) => i.key === value);
  const onKeyDown = (e) => {
    const n = items.length;
    if (!n || !['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    const rtl = getComputedStyle(navRef.current).direction === 'rtl';
    let next;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else {
      const forward = (e.key === 'ArrowLeft') === rtl;
      next = activeIdx < 0 ? (forward ? 0 : n - 1) : (activeIdx + (forward ? 1 : -1) + n) % n;
    }
    e.preventDefault();
    const key = items[next].key;
    if (key !== value) onChange(key);
    navRef.current?.querySelectorAll('button[role="tab"]')[next]?.focus();
  };

  return (
    <nav ref={navRef} className={`ui-tabs ui-tabs-${variant} ui-tone-${tone} ${className}`} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {box && (
        <motion.span
          className="ui-tab-pill"
          aria-hidden="true"
          /* `initial={false}` یعنی اولین رندر بدونِ انیمیشن سرِ جایش می‌نشیند؛
             وگرنه قرص هر بار که نوار mount می‌شود از گوشهٔ صفحه می‌آمد. */
          initial={false}
          animate={box}
          // فنر، نه خطی: حرکتِ خطی مکانیکی به‌نظر می‌رسد. `duration: 0` برای
          // کسی که «حرکتِ کمتر» را انتخاب کرده — پرش، ولی بی‌سرگیجه.
          transition={still ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
        />
      )}
      {items.map((it, i) => {
        const on = it.key === value;
        const Icon = it.icon;
        return (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={on}
            /* اگر هیچ تبی فعال نیست، اولی در زنجیره می‌ماند تا نوار از دسترس نیفتد. */
            tabIndex={on || (activeIdx < 0 && i === 0) ? 0 : -1}
            className={on ? 'on' : ''}
            onClick={() => onChange(it.key)}
          >
            <span className="ui-tab-in">
              {Icon && (
                <motion.span
                  className="ui-tab-ic"
                  animate={still ? {} : { scale: on ? 1 : 0.9, opacity: on ? 1 : 0.65 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                >
                  <Icon size={15} />
                </motion.span>
              )}
              {it.label}
              {it.badge ? <i className="ui-tab-badge">{it.badge}</i> : null}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
