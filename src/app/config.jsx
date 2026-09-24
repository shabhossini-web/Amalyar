import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from './auth.jsx';
import { DEFAULT_VERTICAL, termsFor } from '../lib/terms.js';
import { applyBrand } from '../lib/brand-palette.js';
import { applyTheme, resolveTheme, storedTheme } from '../lib/theme.js';
import { profileFromConfig } from '../lib/profile.js';

const Ctx = createContext(null);

/**
 * پیکربندیِ شرکت — حوزهٔ کاری و واژگانِ برآمده از آن.
 *
 * فقط کلیدِ حوزه از سرور می‌آید؛ خودِ دیکشنریِ واژه‌ها در کلاینت است. دلیل:
 * این‌ها متنِ رابط‌اند، با همان نسخه‌ای که رابط را می‌سازد deploy می‌شوند، و
 * آوردنشان از API فقط یک رفت‌وبرگشت و یک پرشِ متن اضافه می‌کرد.
 *
 * تا وقتی پاسخ نرسیده، واژگانِ پیش‌فرض استفاده می‌شوند — نه رشتهٔ خالی.
 */
export function ConfigProvider({ children }) {
  /* ⚠️ `statuses` هم پیش‌فرضِ خالی دارد: صفحه‌ها پیش از رسیدنِ `/config` رندر
     می‌شوند و `cfg.statuses.note` روی `undefined` می‌ترکید. */
  const [config, setConfig] = useState({
    vertical: DEFAULT_VERTICAL, defaultKind: 'surgery', brandName: null, brand: {}, verticals: [],
    statuses: {
      visit: [], appointment: [], note: [], order: [], orderKind: [], reminder: [], reminderKind: [], intake: [],
      decision: [], anesthesia: [], disposition: [], asa: [], anticoag: [], side: [], clavien: [], waitlist: [], decisionClose: [],
    },
    /* اندازه‌های علائمِ حیاتی (واحد و بازه) — همان کاتالوگی که سرور با آن می‌سنجد. */
    vitals: [],
  });
  /**
   * خطا نگه داشته می‌شود، بلعیده نمی‌شود.
   *
   * ⚠️ قبلاً catch خالی بود: اگر `/config` نمی‌آمد، رابط با واژگانِ پیش‌فرض کار
   * می‌کرد ولی صفحهٔ تنظیمات فهرستِ حوزه‌ها را **بی‌هیچ پیامی** خالی نشان
   * می‌داد — کاربر صفحه را «ناقص» می‌دید و هیچ سرنخی نداشت. رابط باید بدونِ
   * پیکربندی هم کار کند، ولی باید بگوید که نشد.
   */
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    try {
      const fresh = await api('/config');
      setConfig((c) => ({ ...c, ...fresh }));
      /**
       * رنگِ شرکت روی `<html>` می‌نشیند، نه در state.
       *
       * ⚠️ عمداً این‌جاست و نه در یک `useEffect`ِ جدا: رنگ باید همان لحظه‌ای
       * که پیکربندی می‌رسد اعمال شود. اگر منتظرِ رندرِ بعدی می‌ماند، صفحه یک
       * فریم با بنفشِ پیش‌فرض دیده می‌شد و بعد می‌پرید به رنگِ شرکت — و
       * دقیقاً همان اولین فریم است که کاربر «رنگِ برنامه» می‌خواندش.
       */
      applyBrand(fresh?.brand?.color);
      /**
       * پیش‌فرضِ تم از **حوزه** می‌آید (مطب روشن، بقیه تیره — `DECISIONS.md` #۳)،
       * ولی فقط تا وقتی کاربر خودش انتخابی نکرده باشد.
       *
       * ⚠️ `storedTheme()` شرطِ لازم است نه تزئین: بدونش هر بار که `/config`
       * می‌رسید، انتخابِ کاربر با پیش‌فرضِ حوزه بازنویسی می‌شد — یعنی سوییچ کار
       * می‌کرد و یک لحظه بعد خودش برمی‌گشت.
       */
      if (!storedTheme()) applyTheme(resolveTheme(fresh?.vertical));
      setError(null);
      return true;
    } catch (e) {
      setError(e?.status ? `${e.message} (کد ${e.status})` : e?.message || 'ارتباط با سرور برقرار نشد');
      return false;
    }
  }, []);

  /**
   * ⚠️ به `user?.id` هم گره خورده، نه فقط mount: `/config` احراز می‌خواهد و
   * وقتی اپ پیش از ورود بالا می‌آمد، این fetch یک‌بار ۴۰۱ می‌گرفت و خطا تا
   * رفرشِ کاملِ صفحه می‌ماند — «تنظیماتِ شرکت» با بنرِ Unauthorized باز می‌شد
   * (اسکرین‌شاتِ کاربر). حالا هر ورود/تعویضِ حساب یک بازخوانیِ تازه است.
   */
  const { user } = useAuth();
  useEffect(() => { reload(); }, [reload, user?.id]);

  /* نوعِ نصب و خدمات همیشه از یک قاعده (`lib/profile.js`)؛ mockی که فقط
     `vertical` دارد همان چیزی را می‌بیند که سرور برای نصبِ بی‌ردیفِ خدمات می‌گوید. */
  const value = useMemo(
    () => ({ ...config, ...profileFromConfig(config), t: termsFor(config.vertical), error, reload }),
    [config, error, reload],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** واژگان + پیکربندی. خارج از Provider هم امن است (پیش‌فرض برمی‌گردد). */
export function useConfig() {
  return useContext(Ctx) ?? {
    vertical: DEFAULT_VERTICAL, defaultKind: 'surgery', brandName: null, brand: {}, verticals: [], error: null,
    statuses: {
      visit: [], appointment: [], note: [], order: [], orderKind: [], reminder: [], reminderKind: [], intake: [],
      decision: [], anesthesia: [], disposition: [], asa: [], anticoag: [], side: [], clavien: [], waitlist: [], decisionClose: [],
    },
    vitals: [],
    ...profileFromConfig({ vertical: DEFAULT_VERTICAL }),
    t: termsFor(DEFAULT_VERTICAL), reload: () => {},
  };
}

/**
 * **برچسبِ وضعیت‌ها از سرور** — `{ visit, appointment, note }`، هر کدام
 * `[{key,label}]`.
 *
 * ⚠️ فقط برای جایی که باید **همهٔ گزینه‌ها** را بشماری (فیلتر، کشویی). برچسبِ
 * یک ردیفِ مشخص از خودِ همان ردیف می‌آید (`opStatusFa`, `statusFa`, `kindFa`)؛
 * دو مسیرِ برچسب‌زنی همان واگرایی را برمی‌گرداند که این‌جا بسته شد.
 */
export function useStatusList(kind) {
  const rows = useConfig().statuses?.[kind] ?? [];
  return rows;
}

/**
 * نگاشتِ `{کلید: برچسب}`ِ یک خانوادهٔ وضعیت — برای ردیف‌هایی که برچسبشان را
 * همراهِ خودشان نمی‌آورند (مثلِ سفارشی که از `/orders` خام می‌آید).
 *
 * ⚠️ `useMemo` روی خودِ آرایه: `useConfig()` با هر رندر آبجکتِ تازه نمی‌سازد،
 * پس مرجعِ `rows` پایدار است و نگاشت یک‌بار ساخته می‌شود.
 */
export function useStatusMap(kind) {
  const rows = useStatusList(kind);
  return useMemo(() => Object.fromEntries(rows.map((r) => [r.key, r.label])), [rows]);
}

/** میان‌بر برای جایی که فقط واژه لازم است. */
export const useTerms = () => useConfig().t;
