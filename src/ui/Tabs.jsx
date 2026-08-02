import { useId } from 'react';
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
 * ⚠️ حالا قرصِ فعال یک المانِ **واحد** است که با `layoutId` بینِ تب‌ها
 * **می‌لغزد**. همین یک تغییر، «کدام تب فعال شد» را از یک پرشِ ناگهانی به یک
 * حرکتِ قابلِ دنبال‌کردن تبدیل می‌کند — و چون یک المان است، هیچ‌وقت دو تب
 * هم‌زمان فعال به‌نظر نمی‌رسند.
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
  // ⚠️ شناسهٔ یکتا per instance. اگر `layoutId` ثابت بود، دو نوارِ تب در یک
  // صفحه قرصشان را به هم قرض می‌دادند و قرص از این نوار به آن یکی پرواز می‌کرد.
  const pill = `tabpill-${useId()}`;
  const still = useReducedMotion();

  return (
    <nav className={`ui-tabs ui-tabs-${variant} ui-tone-${tone} ${className}`} role="tablist" aria-label={label}>
      {items.map((it) => {
        const on = it.key === value;
        const Icon = it.icon;
        return (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={on}
            className={on ? 'on' : ''}
            onClick={() => onChange(it.key)}
          >
            {on && (
              <motion.span
                className="ui-tab-pill"
                layoutId={pill}
                // فنر، نه خطی: حرکتِ خطی مکانیکی به‌نظر می‌رسد. `duration: 0`
                // برای کسی که «حرکتِ کمتر» را انتخاب کرده — پرش، ولی بی‌سرگیجه.
                transition={still ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
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
