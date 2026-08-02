import { motion } from 'framer-motion';

/**
 * آیکون‌های **متحرک** — جدا از `icons.jsx`.
 *
 * دلیلِ جدایی: `icons.jsx` هیچ وابستگی ندارد و هر جا (حتی چاپ) قابلِ استفاده
 * است؛ این‌ها به `framer-motion` وابسته‌اند. اگر یکی می‌شدند، هر صفحه‌ای که یک
 * آیکونِ ساده می‌خواست کلِ کتابخانهٔ انیمیشن را با خودش می‌آورد.
 *
 * ⚠️ اینها هم زیرِ `src/ui/` می‌مانند تا قاعدهٔ «هیچ `<svg>` بیرونِ این پوشه»
 * نشکند. وسوسه این بود که چون متحرک‌اند در خودِ صفحه بمانند — همان استدلالی که
 * اول ۸۰ آیکون را در ۱۸ فایل پخش کرد.
 */

const BASE = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: 'false',
};

/**
 * تیکی که **کشیده می‌شود**، نه اینکه ظاهر شود.
 *
 * `pathLength` از صفر تا یک می‌رود؛ چشم حرکتِ قلم را دنبال می‌کند و همین چند
 * دهمِ ثانیه، «موفق شد» را از یک تغییرِ آنیِ پیکسل به یک **رویداد** تبدیل
 * می‌کند. با ایموجی یا نویسهٔ متنی اصلاً ممکن نبود.
 */
export function DrawCheck({ size = 24, strokeWidth = 2.6, delay = 0.38, duration = 0.4, ...rest }) {
  return (
    <svg {...BASE} width={size} height={size} strokeWidth={strokeWidth} {...rest}>
      <motion.path
        d="M5 12.5l4.5 4.5L19 7.5"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1, transition: { delay, duration, ease: 'easeOut' } }}
      />
    </svg>
  );
}

/** ضربدرِ کشیده‌شونده — دو خط پشتِ هم، تا «رد شد» هم حرکت داشته باشد. */
export function DrawCross({ size = 24, strokeWidth = 2.6, delay = 0.38, ...rest }) {
  return (
    <svg {...BASE} width={size} height={size} strokeWidth={strokeWidth} {...rest}>
      <motion.path
        d="M6.5 6.5l11 11"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1, transition: { delay, duration: 0.28 } }}
      />
      <motion.path
        d="M17.5 6.5l-11 11"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1, transition: { delay: delay + 0.2, duration: 0.28 } }}
      />
    </svg>
  );
}
