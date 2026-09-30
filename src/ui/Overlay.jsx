import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import './overlay.css';

const noop = () => {};

/* ── «برگشت»ِ گوشی و مرورگر (بازبینیِ UX ۱۴۰۵/۰۷ — surgery-06) ────────────────────────────
   پنجره‌ای که `history` دارد یک ورودیِ تاریخچه با **همان نشانی** می‌سازد تا «برگشت» اول خودِ پنجره را
   ببندد، نه صفحه را (فرمِ عملِ بازشده از فهرستِ انتظار با «برگشت» همراهِ کلِ صفحه می‌رفت).
   `state`ِ روتر (`idx`/`key`) کپی می‌شود: روتر ورودیِ ما را همان صفحه می‌بیند و با برداشتنش
   جابه‌جا نمی‌شود. `history.back()` ناهم‌گام است؛ پنجره‌ای که در همان فاصله باز شود (ذخیره ← فرمِ
   عملِ تازه) صبر می‌کند تا برگشتِ قبلی برسد، وگرنه همان برگشت ورودیِ پنجرهٔ تازه را برمی‌داشت. و
   ورودیِ جامانده از پنجره‌ای که با ناوبری رفت بازیافت می‌شود، نه اینکه زیرِ ورودیِ تازه انباشته شود. */
const liveEntries = new Set();
let backPending = false;
const afterBack = [];
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (!backPending) return;
    backPending = false;
    afterBack.splice(0).forEach((f) => f());
  });
}
function useBackEntry(enabled, onBack) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;
    const token = `ov-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    let armed = false; let mine = false; let gone = false;
    const push = () => {
      const st = window.history.state ?? {};
      const next = { ...st, amalyarOverlay: token };
      if (st.amalyarOverlay && !liveEntries.has(st.amalyarOverlay)) window.history.replaceState(next, '');
      else window.history.pushState(next, '');
      mine = true;
    };
    const onPop = () => {
      if (!mine || window.history.state?.amalyarOverlay === token) return;
      mine = false;
      /* `true` یعنی «بسته نشد» (تغییرِ ذخیره‌نشده، درخواستِ در جریان) — ورودی دوباره ساخته می‌شود. */
      if (onBackRef.current?.()) push();
    };
    const arm = () => {
      if (gone) return;
      armed = true;
      liveEntries.add(token);
      push();
      window.addEventListener('popstate', onPop);
    };
    if (backPending) afterBack.push(arm); else arm();
    return () => {
      gone = true;
      if (!armed) return;
      liveEntries.delete(token);
      window.removeEventListener('popstate', onPop);
      /* بسته شد از راهِ دیگر (ضربدر، ذخیره) — ورودیِ خودش را برمی‌دارد تا «برگشتِ» بعدی صفحه را ببرد. */
      if (mine && window.history.state?.amalyarOverlay === token) { backPending = true; window.history.back(); }
    };
  }, [enabled]);
}

/* بستنِ «محافظت‌شده» برای دکمه‌های داخلِ پنجره (ضربدر، انصراف) — همان مسیری که Escape و
   پس‌زمینه می‌روند، تا پرسشِ «تغییرِ ذخیره‌نشده» از هیچ راهی دور زده نشود. */
const CloseCtx = createContext(null);
/** بستنِ پنجرهٔ دربرگیرنده از داخلش؛ بیرون از `Overlay` همان `null`. */
export const useOverlayClose = () => useContext(CloseCtx);

/**
 * ضربدر/انصرافِ پنجره — `onClick`ش همان بستنِ محافظت‌شدهٔ `Overlay` است. مصرف‌کننده‌ای که خودش
 * `Overlay` را رندر می‌کند نمی‌تواند هوکِ کانتکستِ آن را صدا بزند (کانتکست زیرِ اوست، نه بالایش)؛
 * این دکمه داخلِ پنجره رندر می‌شود و به آن می‌رسد.
 */
export function CloseButton({ children, ...rest }) {
  const close = useOverlayClose();
  return <button type="button" {...rest} onClick={() => close?.()}>{children}</button>;
}

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
 *
 * **نگهبانِ تغییرِ ذخیره‌نشده** (اختیاری، بازبینیِ UX ۱۴۰۵/۰۷ — clinic-daily-08): پزشک روی گوشی
 * شکایت و شرحِ حال را نوشت و یک لمسِ پس‌زمینه، ضربدر یا Escape همه را بی‌پرسش دور ریخت.
 *  - `dirty` — تا وقتی درست است، **هر** راهِ بستن (Escape، پس‌زمینه، `CloseButton`) اول می‌پرسد:
 *    «ذخیره / دور ریختن / ادامهٔ ویرایش».
 *  - `onSave` — کارِ گزینهٔ «ذخیره»: تابع، یا `'submit'` یعنی همان ارسالِ خودِ فرم (`requestSubmit`)
 *    با همهٔ اعتبارسنجی‌هایش. نبودش یعنی چیزی برای ذخیره نیست و پرسش دوگزینه‌ای می‌شود.
 *  - `backdropClose={false}` — فرم‌های بلند با لمسِ پس‌زمینه اصلاً بسته نمی‌شوند؛ آن لمس بیشتر
 *    اشتباهِ انگشت است تا خواستنِ بستن.
 *  - `history` — «برگشت»ِ گوشی/مرورگر اول همین پنجره را می‌بندد (با همان پرسش اگر `dirty` است)؛
 *    پیش‌فرض خاموش، برای شیت‌های کاری که کاربر رویشان می‌ماند (بالا، `useBackEntry`).
 */
export default function Overlay({
  backdrop,             // کلاسِ پس‌زمینه — همان `iv-overlay` / `df-overlay` / …
  panel,                // کلاسِ خودِ شیت — `iv-sheet sm` / `glass db-sheet` / …
  as: Tag = 'div',      // شیت گاهی `section` است و گاهی `form`
  from = 'center',      // center → باز می‌شود · bottom → از لبهٔ پایین بالا می‌آید
  onClose,
  closable = true,      // وقتی درخواستی در جریان است، کلیکِ پس‌زمینه نباید ببندد
  dirty = false,        // تغییرِ ذخیره‌نشده — بستن اول می‌پرسد (بالا)
  onSave,               // «ذخیره»ِ همان پرسش: تابع یا 'submit'
  backdropClose = true, // فرمِ بلند: لمسِ پس‌زمینه نمی‌بندد
  history = false,      // «برگشت»ِ گوشی/مرورگر اول همین پنجره را می‌بندد
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
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const [asking, setAsking] = useState(false);
  const askingRef = useRef(asking);
  askingRef.current = asking;
  /* «برگشت» روی پرسشِ باز یعنی «ادامهٔ ویرایش»؛ روی پنجرهٔ دست‌خورده همان پرسش؛ وگرنه بستن. */
  useBackEntry(history, () => {
    if (askingRef.current) { setAsking(false); return true; }
    if (!closableRef.current) return true;
    if (dirtyRef.current) { setAsking(true); return true; }
    onCloseRef.current?.();
    return false;
  });
  /** تنها مسیرِ بستن: تغییرِ ذخیره‌نشده اول پرسیده می‌شود. هویتِ ثابت — مقدارِ کانتکست است. */
  const requestClose = useCallback(() => {
    if (!closableRef.current) return;
    if (dirtyRef.current) { setAsking(true); return; }
    onCloseRef.current?.();
  }, []);
  const save = () => {
    setAsking(false);
    if (onSave === 'submit') panelRef.current?.requestSubmit?.();
    else onSave?.();
  };

  /* Escape — فقط بالاترین لایه. شنونده روی document است نه روی پنل، چون فوکوس
     ممکن است روی body باشد (کلیک روی جایی که فوکوس نمی‌گیرد) و آن‌وقت رویدادِ
     پنل هرگز نمی‌آمد. */
  useEffect(() => {
    const layer = {};
    layers.push(layer);
    const onKey = (e) => {
      if (e.key !== 'Escape' || layers[layers.length - 1] !== layer || !closableRef.current) return;
      e.preventDefault();
      requestClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const i = layers.indexOf(layer);
      if (i >= 0) layers.splice(i, 1);
    };
  }, [requestClose]);

  /* فوکوس: ورود به پنل، بازگشت به بازکننده.
     ⚠️ بازکننده **هنگامِ رندرِ اول** گرفته می‌شود، نه در effect: کادری با `autoFocus` درونِ پنل (جست‌وجوی
     گامِ ۱ِ «مراجعهٔ جدید») در commit فوکوس را می‌گیرد و effect آن کادرِ درونی را «بازکننده» می‌دید —
     با بسته‌شدنِ پنجره کادر از DOM می‌رفت و فوکوس روی body رها می‌شد (w0-6-a11y). */
  const [openerAtMount] = useState(() => (typeof document === 'undefined' ? null : document.activeElement));
  useEffect(() => {
    const el = panelRef.current;
    const opener = openerAtMount && !(el && el.contains(openerAtMount)) ? openerAtMount : document.activeElement;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
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
      onClick={(e) => { if (e.target === e.currentTarget && backdropClose) requestClose(); }}
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
        <CloseCtx.Provider value={requestClose}>{children}</CloseCtx.Provider>
      </Panel>
      <AnimatePresence>
        {asking && (
          <UnsavedPrompt
            onSave={onSave ? save : null}
            onDiscard={() => { setAsking(false); onCloseRef.current?.(); }}
            onCancel={() => setAsking(false)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * پوستهٔ مشترکِ پرسش‌های کوتاه (`alertdialog`) — عنوان، یک جملهٔ پیامد، ردیفِ دکمه‌ها.
 * در `document.body` رندر می‌شود: پنلِ شیت در حینِ انیمیشن `transform` دارد و `position: fixed`ِ
 * فرزندش را به خودش می‌چسباند، نه به صفحه. Escape و لمسِ پس‌زمینهٔ خودِ پرسش همان `onCancel` است —
 * امن‌ترین گزینه، نه کارِ برگشت‌ناپذیر.
 */
function Ask({ title, text, busy, onCancel, children }) {
  const hid = useId();
  const did = useId();
  if (typeof document === 'undefined') return null;
  return createPortal(
    <Overlay
      backdrop="ov-ask-overlay" panel="ov-ask" as="section" from="center"
      role="alertdialog" aria-labelledby={hid} aria-describedby={text ? did : undefined}
      closable={!busy} onClose={onCancel}
    >
      <b id={hid} className="ov-ask-title">{title}</b>
      {text && <p id={did} className="ov-ask-text">{text}</p>}
      <div className="ov-ask-acts">{children}</div>
    </Overlay>,
    document.body,
  );
}

/**
 * **پرسشِ تغییرِ ذخیره‌نشده** — سه گزینه: «ذخیره» / «دور ریختن» / «ادامهٔ ویرایش».
 *
 * هم نگهبانِ `Overlay` از آن استفاده می‌کند و هم صفحه‌ای که پنجره نیست ولی از یک نمای ویرایش بیرون
 * می‌رود (میزِ اتاقِ عمل ← «فهرستِ روز»).
 */
export function UnsavedPrompt({ onSave, onDiscard, onCancel, busy = false, title, text }) {
  return (
    <Ask
      title={title ?? 'تغییرها ذخیره نشده‌اند'}
      text={text ?? 'اگر بدونِ ذخیره ببندید، آنچه نوشته‌اید از بین می‌رود.'}
      busy={busy} onCancel={onCancel}
    >
      {onSave && (
        <button type="button" className="ov-ask-btn is-primary" data-unsaved="save" onClick={onSave} disabled={busy}>
          {busy ? 'در حالِ ذخیره…' : 'ذخیره'}
        </button>
      )}
      <button type="button" className="ov-ask-btn" data-unsaved="keep" onClick={onCancel} disabled={busy}>ادامهٔ ویرایش</button>
      <button type="button" className="ov-ask-btn is-drop" data-unsaved="discard" onClick={onDiscard} disabled={busy}>دور ریختن</button>
    </Ask>
  );
}

/**
 * **تأییدِ کارِ برگشت‌ناپذیر** (بازبینیِ UX ۱۴۰۵/۰۷ — clinic-daily-15): حذفِ تعریف، فیلد یا فرم با یک
 * لمس و بی‌پرسش انجام می‌شد. عنوان **نامِ خودِ مورد** را می‌گوید و متن **پیامدش** را — «مطمئنید؟» به
 * کسی نمی‌گوید چه اتفاقی می‌افتد (همان قاعدهٔ «بازگرداندن به قالب»ِ فرم‌ساز).
 */
export function ConfirmDialog({ title, text, confirmLabel = 'حذف', cancelLabel = 'انصراف', busy = false, onConfirm, onCancel }) {
  return (
    <Ask title={title} text={text} busy={busy} onCancel={onCancel}>
      <button type="button" className="ov-ask-btn is-danger" data-confirm="yes" onClick={onConfirm} disabled={busy}>
        {busy ? 'در حالِ انجام…' : confirmLabel}
      </button>
      <button type="button" className="ov-ask-btn" data-confirm="no" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
    </Ask>
  );
}
