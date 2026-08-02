import { useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

const noop = () => {};

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
        {...rest}
      >
        {children}
      </Panel>
    </motion.div>
  );
}
