import { useEffect, useMemo, useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

const noop = () => {};

/* ── لایه‌ها: کدام پوشش «رویی» است (W0.6) ─────────────────────────────
   Escape فقط بالاترین لایه را می‌بندد. پوشش‌ها تودرتو می‌شوند (پرسشِ تسویه روی
   شیتِ صورت‌حساب) و اگر هر کدام مستقل به Escape گوش می‌داد، یک کلید هر دو را
   می‌بست. انتخابگرها (`Pick`, `TimePick`, تقویمِ `JDate`) از قبل با شنوندهٔ
   capture روی window و `stopPropagation` خودشان را می‌بندند — کلید هرگز به این‌جا
   نمی‌رسد، که درست است: آن‌ها همیشه رویی‌ترین لایه‌اند. */
const layers = [];

/* چه چیزی با Tab قابلِ رسیدن است — فقط آنچه واقعاً دیده می‌شود؛ گامِ پنهانِ
   شیتِ مراجعه (`hidden`) نباید در حلقه بیفتد. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), '
  + 'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
const focusables = (root) => [...root.querySelectorAll(FOCUSABLE)]
  .filter((n) => n.getClientRects().length > 0 && !n.closest('[hidden]'));

/**
 * پوششِ شیت/مودال — **تک‌منبع** برای همهٔ پنجره‌های روی‌هم.
 *
 * تا پیش از این هفده جای برنامه همین چند خط را دست‌نویس تکرار می‌کردند:
 * یک `div` با کلاسِ `*-overlay`، یک `onClick` که فقط اگر روی خودِ پس‌زمینه
 * بود ببندد، و یک `section` داخلش. چهار تا از این‌ها انیمیشنِ ورود داشتند
 * (آن هم با `@keyframes`ِ جدا برای هرکدام) و سیزده تای دیگر هیچ.
 *
 * ⚠️ اما مسئلهٔ اصلی **بسته‌شدن** بود، نه باز‌شدن: با رندرِ شرطی، شیت در یک
 * فریم از DOM حذف می‌شد. `@keyframes` هیچ کاری از دستش برنمی‌آید چون المان
 * دیگر وجود ندارد. برای همین ورود نرم بود و خروج، پرش. حالا `AnimatePresence`
 * در **والد** حذف را تا پایانِ انیمیشنِ خروج نگه می‌دارد.
 *
 * ⚠️ `AnimatePresence` باید دورِ همان `{x && <Sheet/>}`ِ والد بپیچد، نه اینکه
 * داخلِ خودِ شیت بنشیند: اگر داخل باشد، وقتی شیت unmount می‌شود خودِ
 * `AnimatePresence` هم با آن می‌رود و چیزی نمی‌ماند که خروج را اجرا کند.
 *
 * حرکت — «بازشونده» (`pop`) برای دیالوگ‌های وسطِ صفحه، «بالاآینده» (`rise`)
 * برای شیت‌هایی که در موبایل از لبهٔ پایین می‌آیند. خروج کوتاه‌تر از ورود است؛
 * بسته‌شدنِ کُند حسِ کندیِ برنامه می‌دهد.
 *
 * صفحه‌کلید و صفحه‌خوان (W0.6) — همه این‌جا، نه در هفده مصرف‌کننده:
 *  - **Escape** می‌بندد (فقط بالاترین لایه، و فقط وقتی `closable` است — همان
 *    قاعدهٔ کلیکِ پس‌زمینه: وسطِ درخواست هیچ راهی نباید شیت را ببندد).
 *  - **فوکوس** هنگامِ باز شدن به داخلِ پنجره می‌آید — روی خودِ پنل، نه اولین
 *    ورودی: فوکوس روی ورودی در موبایل کیبورد را بالا می‌آورد و صفحه را
 *    می‌پراند؛ مصرف‌کننده‌ای که جای دقیق‌تری می‌خواهد `autoFocus` می‌گذارد و
 *    این‌جا دست نمی‌خورد. هنگامِ بسته شدن فوکوس به دکمه‌ای برمی‌گردد که پنجره
 *    را باز کرده بود، وگرنه کاربرِ صفحه‌کلید بعد از بستن سرِ `body` می‌افتد.
 *  - **Tab** داخلِ پنجره می‌چرخد (focus trap) — پشتِ پوشش چیزی هست که دیده
 *    نمی‌شود ولی بدونِ این، با Tab قابلِ رسیدن بود.
 *  - `role="dialog"` + `aria-modal` پیش‌فرض است تا صفحه‌خوان بازشدنِ پنجره را
 *    اعلام کند؛ مصرف‌کننده با `aria-label` نامش را می‌دهد و با `role` می‌تواند
 *    عوضش کند.
 */
export default function Overlay({
  backdrop,             // کلاسِ پس‌زمینه — همان `iv-overlay` / `df-overlay` / …
  panel,                // کلاسِ خودِ شیت — `iv-sheet sm` / `glass db-sheet` / …
  as: Tag = 'div',      // شیت گاهی `section` است و گاهی `form`
  from = 'center',      // center → باز می‌شود · bottom → از لبهٔ پایین بالا می‌آید
  onClose,
  closable = true,      // وقتی درخواستی در جریان است، کلیکِ پس‌زمینه نباید ببندد
  children,
  ...rest               // به شیت می‌رسد: onSubmit، role، aria-*
}) {
  const still = useReducedMotion();
  const Panel = motion[Tag] ?? motion.div;
  const panelRef = useRef(null);
  /* ref، نه وابستگیِ افکت: `onClose` تقریباً در همهٔ مصرف‌کننده‌ها inline است و
     هر رندر هویتِ تازه دارد؛ اگر وابستگی بود، لایه هر رندر از نو ثبت می‌شد و
     ترتیبِ پشته به هم می‌خورد. */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closableRef = useRef(closable);
  closableRef.current = closable;

  /* Escape — فقط بالاترین لایه. شنونده روی document است نه روی پنل، چون فوکوس
     ممکن است روی body باشد (کلیک روی جایی که فوکوس نمی‌گیرد) و آن‌وقت رویدادِ
     پنل هرگز نمی‌آمد. */
  useEffect(() => {
    const layer = {};
    layers.push(layer);
    const onKey = (e) => {
      if (e.key !== 'Escape' || layers[layers.length - 1] !== layer || !closableRef.current) return;
      e.preventDefault();
      onCloseRef.current?.();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const i = layers.indexOf(layer);
      if (i >= 0) layers.splice(i, 1);
    };
  }, []);

  /* فوکوس: ورود به پنل، بازگشت به بازکننده. */
  useEffect(() => {
    const el = panelRef.current;
    const opener = document.activeElement;
    if (el && !el.contains(opener)) el.focus({ preventScroll: true });
    return () => {
      /* هنگامِ unmount المانِ فوکوس‌دار از DOM رفته و مرورگر فوکوس را روی body
         انداخته؛ اگر کاربر همان لحظه جای دیگری را فوکوس کرده، دست نمی‌زنیم. */
      const active = document.activeElement;
      const stranded = !active || active === document.body || (el && el.contains(active));
      if (stranded && opener && opener !== document.body && opener.isConnected && typeof opener.focus === 'function') {
        opener.focus({ preventScroll: true });
      }
    };
  }, []);

  const { onKeyDown: userKeyDown, role = 'dialog', tabIndex = -1, ...panelProps } = rest;
  const modal = panelProps['aria-modal'] ?? (role === 'dialog' || role === 'alertdialog' ? 'true' : undefined);

  const trapTab = (e) => {
    userKeyDown?.(e);
    if (e.key !== 'Tab' || e.defaultPrevented) return;
    const el = panelRef.current;
    if (!el) return;
    /* پوششِ بیرونی (تودرتو) نباید همین Tab را دوباره حساب کند. */
    e.stopPropagation();
    const items = focusables(el);
    if (!items.length) { e.preventDefault(); el.focus(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    const inside = el.contains(active) && active !== el;
    if (e.shiftKey && (!inside || active === first)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (inside ? active === last : active !== el)) { e.preventDefault(); first.focus(); }
  };

  // حالت‌ها **variant**اند و با `useMemo` هویتِ ثابت دارند: هر رندرِ والد
  // (که در شیتِ فرم زیاد اتفاق می‌افتد) نباید هدفِ تازه‌ای به framer بدهد.
  const V = useMemo(() => {
    const rise = from === 'bottom';
    return {
      // با «حرکتِ کمتر» فقط محو/ظاهر می‌شود — بدونِ جابه‌جایی و بدونِ مقیاس.
      hidden: still ? { opacity: 0 } : rise ? { opacity: 0, y: 40 } : { opacity: 0, scale: 0.94, y: 10 },
      shown: {
        opacity: 1, y: 0, scale: 1,
        transition: still
          ? { duration: 0 }
          : { type: 'spring', stiffness: 380, damping: 32, opacity: { duration: 0.18 } },
      },
      // خروج سریع و **خطی**؛ فنر در خروج کش می‌آید و بسته‌شدن کُند حس می‌شود.
      gone: {
        ...(still ? { opacity: 0 } : rise ? { opacity: 0, y: 28 } : { opacity: 0, scale: 0.97, y: 6 }),
        transition: { duration: still ? 0 : 0.15, ease: 'easeIn' },
      },
    };
  }, [from, still]);

  const fade = useMemo(() => ({
    hidden: { opacity: 0 },
    shown: { opacity: 1, transition: { duration: still ? 0 : 0.18, ease: 'easeOut' } },
    gone: { opacity: 0, transition: { duration: still ? 0 : 0.15 } },
  }), [still]);

  return (
    <motion.div
      className={backdrop}
      variants={fade}
      initial="hidden"
      animate="shown"
      exit="gone"
      onUpdate={noop}
      onClick={(e) => { if (e.target === e.currentTarget && closable) onClose(); }}
    >
      <Panel
        ref={panelRef}
        className={panel}
        variants={V}
        // ⚠️ پنل خودش `initial/animate/exit` را اعلام می‌کند و از والد ارث
        // نمی‌برد؛ وگرنه نامِ variantِ والد روی پنل هم اعمال می‌شد و دو انیمیشن
        // روی هم می‌افتاد.
        initial="hidden"
        animate="shown"
        exit="gone"
        // ⚠️ این `onUpdate`ِ تهی تزئینی نیست: بدونِ آن framer شفافیت را با
        // Web Animations API اجرا می‌کند و مقدار را در style نمی‌نویسد. وقتی
        // انیمیشنِ خروج تمام می‌شود، آن انیمیشن لغو می‌شود و شفافیت یک فریم به
        // مقدارِ inlineِ قدیمی (۱) برمی‌گردد — یک **چشمکِ** کوتاه درست پیش از
        // ناپدید‌شدن. در اندازه‌گیری: ۰٫۱۰ → ۱٫۰۰ → حذف. با وجودِ onUpdate،
        // framer مسیرِ جاوااسکریپتی را می‌گیرد و مقدار همیشه در style می‌نشیند.
        onUpdate={noop}
        role={role}
        aria-modal={modal}
        tabIndex={tabIndex}
        onKeyDown={trapTab}
        {...panelProps}
      >
        {children}
      </Panel>
    </motion.div>
  );
}
