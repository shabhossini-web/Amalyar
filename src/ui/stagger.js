import { useReducedMotion } from 'framer-motion';

const STEP = 0.035;   // فاصلهٔ ورودِ دو ردیفِ پشتِ‌سرِ هم
const HEAD = 11;      // فقط ردیف‌های ۰ تا ۱۱ حرکت می‌گیرند

/**
 * ورودِ پلکانیِ ردیف‌های فهرست.
 *
 * چرا نه روی همهٔ ردیف‌ها: فهرستِ انبار می‌تواند دویست لات باشد. دویست
 * انیمیشنِ هم‌زمان یعنی دویست لایهٔ ترکیب و یک فریمِ افتاده روی موبایل — و
 * ردیفِ دویستم آن‌قدر پایین است که کسی ورودش را نمی‌بیند. پس فقط **سرِ
 * فهرست** (یک صفحهٔ دیده‌شونده) حرکت می‌گیرد و بقیه همان‌جا هستند.
 *
 * ⚠️ محوشدن با `filter: opacity()` است نه `opacity`. چند ردیف حالتِ CSSِ
 * کم‌رنگ دارند — `.iv-row.zero { opacity: .55 }` برای لاتِ بی‌موجودی و
 * `.iv-row.st-closed { opacity: .72 }` برای حوالهٔ بسته. اگر framer روی
 * `opacity` می‌نوشت، استایلِ inline آن قاعده‌ها را می‌خورد و لاتِ صفر مثلِ
 * لاتِ پر دیده می‌شد؛ یعنی انیمیشن یک **دادهٔ غلط** نشان می‌داد. `filter`
 * ضرب می‌شود، پس هر دو سرِ جای خودشان می‌مانند.
 *
 * استفاده:
 *   const row = useStagger();
 *   {rows.map((r, i) => <motion.article key={r.id} {...row(i)} className="iv-row">…)}
 */
export function useStagger() {
  const still = useReducedMotion();
  return (i) => {
    if (still || i > HEAD) return {};
    return {
      initial: { filter: 'opacity(0)', y: 8 },
      animate: { filter: 'opacity(1)', y: 0 },
      transition: { duration: 0.26, delay: i * STEP, ease: [0.22, 0.61, 0.36, 1] },
      // ⚠️ همان قاعدهٔ `ui/Overlay.jsx`: بدونِ `onUpdate`، framer فیلتر را با
      // Web Animations API اجرا می‌کند و در style نمی‌نویسد. لحظه‌ای که
      // انیمیشن تمام و لغو می‌شود، مقدارِ محاسبه‌شده یک فریم به مقدارِ inline
      // — یعنی `opacity(0)` — برمی‌گردد و ردیف **درست در پایانِ ورودش** یک
      // فریم ناپدید می‌شود. در فیلمِ فریم‌به‌فریم دیده شد: ۰٫۹۸ → ۰٫۰۰ → ۱٫۰۰.
      onUpdate: noop,
    };
  };
}

const noop = () => {};
