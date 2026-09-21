import { useEffect, useState } from 'react';
import { useAuth } from './auth.jsx';
import { useTerms } from './config.jsx';
import { ArrowStart, Bank, Book, Box, Calendar, Chart, Chat, Clock, Dispatch, Doctor, Form, FormEdit, Gear, Globe, Lock, Mail, NoteSearch, Patients, Slots, Sparkle, Tag, Truck, Users, Wave , Arrive, Pathway } from '../ui/icons.jsx';

/**
 * کاتالوگِ ابزارها — **تنها** جای تعریفِ کاشی‌ها.
 *
 * تا W2.3 این فهرست داخلِ `Launcher.jsx` بود؛ حالا صفحهٔ «امروز» هم کشوی
 * «همهٔ ابزارها» را از همین‌جا می‌سازد. دو نسخه یعنی ماژولِ تازه‌ای که در یکی
 * هست و در دیگری نیست — همان چیزی که `AGENTS.md` دربارهٔ دو منبعِ حقیقت می‌گوید.
 *
 * `min` = حداقلِ سطح (۱ بازدید … ۶ سوپرادمین) و فقط **fallback** است تا پیش از
 * رسیدنِ پاسخِ `/features` کاشی‌ها نپرند؛ تصمیمِ واقعی از سرور می‌آید (`allowed`).
 *
 * ⚠️ **قانون (W3.7): هیچ آیکونی برای دو ماژول.** تا دیروز `Wave` سه کاشی را
 * می‌پوشاند (جراح، دستیار، کارشناس)، `Book` سه‌تا و `Chart`/`Clock` دوتا —
 * یعنی بازشناسیِ بصری صفر و کاربر هر بار مجبور به **خواندن**. آیکونِ تازه در
 * `src/ui/icons.jsx` ساخته می‌شود، نه با قرض‌گرفتن از کاشیِ دیگر.
 * نگهبانِ ماشینی: `node scripts/verify-module-icons.js`.
 *
 * ⚠️ **نام بر پایهٔ کارِ کاربر، نه نامِ ابزار** (یافتهٔ B3 سندِ بازبینی):
 * «داشبورد مدیریت» → «بیماران»، «ثبت‌نامِ بیماران» → «پذیرش». واژه‌هایی مثل
 * «پرتال» و «پنل» می‌گویند این *چه ابزاری است*، نه اینکه کاربر **چه کاری**
 * می‌کند.
 */
export const HERO = { key: 'dashboard', label: 'بیماران', desc: 'ثبت بیماران، مالی، گزارش‌ها', icon: Patients, ready: true, min: 5, to: '/app/dashboard' };

export const DAILY = [
  { key: 'surgeon', label: 'پرتال جراح', icon: Doctor, ready: true, min: 2, to: '/app/surgeon' },
  { key: 'formgen', label: 'پذیرش', icon: Form, ready: true, min: 5, to: '/app/intake' },
  { key: 'messenger', label: 'پیام‌رسان', icon: Chat, ready: true, min: 2, to: '/app/chat' },
];

export const TOOLS = [
  /* CRM زیرِ همان featureِ formgen (feature override): تفکیکِ مجوز وقتی معنا
     دارد که داده‌اش از جای دیگری بیاید — فعلاً تماماً از ثبت‌نام‌هاست. */
  { key: 'crm', feature: 'formgen', label: 'تحلیل و CRM', icon: Chart, tint: 'blue', ready: true, min: 5, to: '/app/crm' },
  { key: 'reminders', feature: 'dashboard', label: 'یادآوری‌ها', icon: Clock, tint: 'teal', ready: true, min: 5, to: '/app/reminders' },
  { key: 'accounting', label: 'حسابداری', icon: Bank, tint: 'violet', ready: true, min: 5, to: '/app/accounting' },
  /* میزِ پذیرش — پایین‌ترین سطحِ کاری، چون منشی بیمار را می‌پذیرد. */
  { key: 'frontdesk', label: 'میزِ پذیرش', icon: Arrive, tint: 'cyan', ready: true, min: 2, to: '/app/frontdesk' },
  /* نامِ کاشی = عنوانِ صفحه (قانون ۲۴). «مسیرِ درمان» نه «الگوها»: کاربر
     دنبالِ مسیرِ بیمار می‌گردد، نه دنبالِ ابزارِ ساختِ الگو. */
  { key: 'pathway', label: 'مسیرِ درمان', icon: Pathway, tint: 'violet', ready: true, min: 2, to: '/app/pathways' },
  { key: 'calendar', label: 'تقویم عمل‌ها', icon: Calendar, tint: 'green', ready: true, min: 4, to: '/app/calendar' },
  /* برنامهٔ کاری — `docs/BOOKING.md`. کنارِ تقویم می‌نشیند چون هم‌خانواده‌اند:
     یکی می‌گوید چه شد، آن یکی می‌گوید چه وقتی می‌شود. */
  { key: 'schedule', label: 'برنامهٔ کاری', icon: Slots, tint: 'green', ready: true, min: 5, to: '/app/schedule' },
  { key: 'dispatch', label: 'چینشِ نیروها', icon: Dispatch, tint: 'amber', ready: true, min: 4, to: '/app/dispatch' },
  { key: 'letter', label: 'نامهٔ اداری', icon: Mail, tint: 'blue', ready: true, min: 5, to: '/app/letters' },
  { key: 'notes', feature: 'dashboard', label: 'جستجوی بالینی', icon: NoteSearch, tint: 'teal', ready: true, min: 3, to: '/app/notes' },
  { key: 'assistant', label: 'دستیارِ هوشمند', icon: Sparkle, tint: 'violet', ready: true, min: 5, to: '/app/assistant' },
  { key: 'tech', label: 'پنل کارشناسی', icon: Wave, tint: 'teal', ready: true, min: 2, to: '/app/tech' },
  { key: 'transport', label: 'حمل‌ونقل', icon: Truck, tint: 'amber', ready: true, min: 2, to: '/app/transport' },
  { key: 'inventory', label: 'انبار', icon: Box, tint: 'green', ready: true, min: 3, to: '/app/inventory' },
  { key: 'definitions', label: 'تعاریف پایه', icon: Tag, tint: 'teal', ready: true, min: 5, to: '/app/definitions' },
  { key: 'forms', label: 'فرم‌ساز', icon: FormEdit, tint: 'violet', ready: true, min: 6, to: '/app/forms' },
  { key: 'users', label: 'کاربران', icon: Users, tint: 'violet', ready: true, min: 6, to: '/app/users' },
  { key: 'access', label: 'سطوحِ دسترسی', icon: Lock, tint: 'blue', ready: true, min: 6, to: '/app/access' },
  { key: 'site', label: 'سایتِ معرفی', icon: Globe, tint: 'blue', ready: true, min: 5, to: '/app/site' },
  { key: 'settings', label: 'تنظیماتِ شرکت', icon: Gear, tint: 'amber', ready: true, min: 6, to: '/app/settings' },
];

export { ArrowStart };

/**
 * کاشی‌هایی که این کاربر اجازه دارد.
 *
 * ⚠️ تصمیم از **سرور** می‌آید (`allowed`)، نه از حسابِ سطح در کلاینت: رانندهٔ
 * سطح ۲ نباید کاشیِ «پنلِ کارشناسی» را ببیند و برعکس. `min` فقط تا رسیدنِ پاسخ.
 */
export function useAllowedTools() {
  const { user } = useAuth();
  const t = useTerms();
  const lvl = user?.level ?? 0;
  const [features, setFeatures] = useState(null); // key → {allowed, …}
  useEffect(() => {
    let alive = true;
    import('../lib/api.js').then(({ api }) =>
      api('/features')
        .then((rows) => { if (alive) setFeatures(Object.fromEntries(rows.map((r) => [r.key, r]))); })
        .catch(() => {}),
    );
    return () => { alive = false; };
  }, []);

  const allowed = (t) => {
    const f = features?.[t.feature ?? t.key];
    if (f) return !!f.allowed;
    return lvl >= t.min;
  };
  const hero = allowed(HERO) ? HERO : null;
  /* نامِ کاشیِ پزشک از واژگانِ حوزه می‌آید («پرتال جراح» / «میزِ پزشک») — قانونِ ۲۴؛
     کاتالوگِ ثابت بالا فقط پشتیبان است تا نگهبانِ آیکون‌ها بتواند بخواندش. */
  const daily = DAILY.filter(allowed).map((x) => (x.key === 'surgeon' ? { ...x, label: t.portal } : x));
  const tools = TOOLS.filter(allowed);
  return { hero, daily, tools, loading: features === null, nothing: !hero && !daily.length && !tools.length };
}

/** اسپاتلایتِ دنبال‌کنندهٔ اشاره‌گر روی کارتِ شیشه‌ای (قانونِ ۱۰). */
export function track(e) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
  el.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
}
