import { useEffect, useState } from 'react';
import { useAuth } from './auth.jsx';
import { useTerms } from './config.jsx';
import { ArrowStart, Bank, Book, Box, Calendar, Chart, Chat, Clock, Dispatch, Doctor, Form, FormEdit, Gear, Globe, Lock, Mail, NoteSearch, Patients, Slots, Sparkle, Tag, Theatre, Truck, Users, Wave , Arrive, Pathway, Waitlist } from '../ui/icons.jsx';

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
 * «داشبورد مدیریت» → «بیماران». «پذیرش» هم «ثبت‌نام‌های آنلاین» شد (بازبینیِ UX ۱۴۰۵/۰۷):
 * کنارِ «میزِ پذیرش» دو کاشیِ تقریباً هم‌نام بودند و منشی‌ای که بیمارِ رسیده را می‌پذیرفت
 * اولی (صفِ ثبت‌نام‌های اینترنتی) را می‌زد. واژه‌هایی مثل
 * «پرتال» و «پنل» می‌گویند این *چه ابزاری است*، نه اینکه کاربر **چه کاری**
 * می‌کند.
 */
export const HERO = { key: 'dashboard', label: 'بیماران', desc: 'ثبت بیماران، مالی، گزارش‌ها', icon: Patients, ready: true, min: 5, to: '/app/dashboard' };

export const DAILY = [
  { key: 'surgeon', label: 'پرتال جراح', icon: Doctor, ready: true, min: 2, to: '/app/surgeon' },
  { key: 'formgen', label: 'ثبت‌نام‌های آنلاین', icon: Form, ready: true, min: 5, to: '/app/intake' },
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
  /* اتاقِ عمل کنارِ میزِ پذیرش می‌نشیند چون هم‌خانواده‌اند: هر دو کارِ **همین
     امروز**اند و هر دو سطحِ کارشناس. نام «اتاقِ عمل» است نه «نمای اتاقِ عمل» —
     نامِ کاشی همان کاری است که کاربر می‌کند، نه نامِ ابزار (قانونِ ۲۴). */
  { key: 'theatre', label: 'اتاقِ عمل', icon: Theatre, tint: 'teal', ready: true, min: 2, to: '/app/theatre' },
  { key: 'waitlist', label: 'فهرستِ انتظارِ عمل', icon: Waitlist, tint: 'amber', ready: true, min: 2, to: '/app/waitlist' },
  /* نامِ کاشی = عنوانِ صفحه (قانون ۲۴). «مسیرِ درمان» نه «الگوها»: کاربر
     دنبالِ مسیرِ بیمار می‌گردد، نه دنبالِ ابزارِ ساختِ الگو. */
  { key: 'pathway', label: 'مسیرِ درمان', icon: Pathway, tint: 'violet', ready: true, min: 2, to: '/app/pathways' },
  { key: 'calendar', label: 'تقویم عمل‌ها', icon: Calendar, tint: 'green', ready: true, min: 4, to: '/app/calendar' },
  /* برنامهٔ کاری — `docs/BOOKING.md`. کنارِ تقویم می‌نشیند چون هم‌خانواده‌اند:
     یکی می‌گوید چه شد، آن یکی می‌گوید چه وقتی می‌شود. */
  { key: 'schedule', label: 'برنامهٔ کاری', icon: Slots, tint: 'green', ready: true, min: 5, to: '/app/schedule', perm: 'definitions.read' },
  { key: 'dispatch', label: 'چینشِ نیروها', icon: Dispatch, tint: 'amber', ready: true, min: 4, to: '/app/dispatch' },
  { key: 'letter', label: 'نامهٔ اداری', icon: Mail, tint: 'blue', ready: true, min: 5, to: '/app/letters' },
  { key: 'notes', feature: 'dashboard', label: 'جستجوی بالینی', icon: NoteSearch, tint: 'teal', ready: true, min: 3, to: '/app/notes' },
  { key: 'assistant', label: 'دستیارِ هوشمند', icon: Sparkle, tint: 'violet', ready: true, min: 5, to: '/app/assistant' },
  { key: 'tech', label: 'پنل کارشناسی', icon: Wave, tint: 'teal', ready: true, min: 2, to: '/app/tech' },
  { key: 'transport', label: 'حمل‌ونقل', icon: Truck, tint: 'amber', ready: true, min: 2, to: '/app/transport' },
  { key: 'inventory', label: 'انبار', icon: Box, tint: 'green', ready: true, min: 3, to: '/app/inventory' },
  { key: 'definitions', label: 'تعاریف پایه', icon: Tag, tint: 'teal', ready: true, min: 5, to: '/app/definitions', perm: 'definitions.read' },
  { key: 'forms', label: 'فرم‌ساز', icon: FormEdit, tint: 'violet', ready: true, min: 6, to: '/app/forms', perm: 'forms.read' },
  { key: 'users', label: 'کاربران', icon: Users, tint: 'violet', ready: true, min: 6, to: '/app/users' },
  { key: 'access', label: 'سطوحِ دسترسی', icon: Lock, tint: 'blue', ready: true, min: 6, to: '/app/access' },
  { key: 'site', label: 'سایتِ معرفی', icon: Globe, tint: 'blue', ready: true, min: 5, to: '/app/site' },
  { key: 'settings', label: 'تنظیماتِ شرکت', icon: Gear, tint: 'amber', ready: true, min: 6, to: '/app/settings' },
];

export { ArrowStart };

/**
 * گروه‌های کاشی — در لانچر و کشوی «همهٔ ابزارها» (بازبینیِ UX ۱۴۰۵/۰۷: ۲۲ کاشیِ بی‌گروه کنارِ هم
 * و ابزارهای روزانه لابه‌لای ابزارهای مدیریتی). ترتیبِ کلیدها همان ترتیبِ نمایش است؛ ابزارِ
 * روزانه بالا. کاشیِ تازه‌ای که این‌جا نیامده ته گروهِ آخر می‌نشیند — گم نمی‌شود.
 */
export const TOOL_GROUPS = [
  { key: 'daily', label: 'کارِ روزانه', keys: ['frontdesk', 'formgen', 'surgeon', 'theatre', 'tech', 'dispatch', 'transport', 'messenger', 'reminders'] },
  { key: 'care', label: 'بیمار و درمان', keys: ['dashboard', 'calendar', 'schedule', 'waitlist', 'pathway', 'notes'] },
  { key: 'money', label: 'مالی', keys: ['accounting', 'inventory', 'crm'] },
  { key: 'admin', label: 'مدیریت و تنظیمات', keys: ['letter', 'assistant', 'definitions', 'forms', 'users', 'access', 'site', 'settings'] },
];

/** کاشی‌های مجاز، گروه‌بندی‌شده — گروهِ خالی نمی‌آید. */
export function groupTools(list) {
  const byKey = new Map(list.filter(Boolean).map((x) => [x.key, x]));
  const placed = new Set();
  const groups = TOOL_GROUPS.map((g) => {
    const tools = g.keys.map((k) => byKey.get(k)).filter(Boolean);
    tools.forEach((x) => placed.add(x.key));
    return { key: g.key, label: g.label, tools };
  });
  const rest = [...byKey.values()].filter((x) => !placed.has(x.key));
  if (rest.length) groups[groups.length - 1].tools.push(...rest);
  return groups.filter((g) => g.tools.length > 0);
}

/* `perm` روی کاشی‌ای که کلیدِ ماژولِ خودش را ندارد: مجوزی که داده‌اش را باز می‌کند. کاشی با
   سطح (`min`) دیده می‌شود و «سطوحِ دسترسی» همین را زیرِ «کاشی‌های بی‌کلید» می‌نویسد، تا مدیر
   بداند برای بستنِ «تعاریف پایه» کدام ردیف را باید عوض کند. */
const ALL = [HERO, ...DAILY, ...TOOLS];

/**
 * نامِ یک کاشی — **تنها** منبعِ نامِ ماژول در رابط.
 *
 * بازبینیِ UX (۱۴۰۵/۰۷): کاشیِ «کاربران» صفحهٔ «مدیریت کاربران» را باز می‌کرد و همان در
 * «سطوحِ دسترسی» «مدیریتِ کاربران» نام داشت؛ «بیماران» آن‌جا «داشبورد مدیریت» بود و
 * «پذیرش» «فرم‌ساز» — مدیر نمی‌فهمید کدام کلید کدام کاشی را خاموش می‌کند. حالا عنوانِ
 * صفحه (`<h1>`)، `document.title` و برچسبِ ردیفِ دسترسی همه از همین می‌خوانند.
 * واژهٔ حوزه (قانونِ ۲۴) هم همین‌جا اعمال می‌شود: «میزِ پزشک»، «تنظیماتِ مطب».
 */
export function toolLabel(key, t) {
  const x = ALL.find((y) => y.key === key);
  if (!x) return null;
  if (key === 'surgeon' && t?.portal) return t.portal;
  /* تقویم و CRM هم نامِ حوزه‌ای دارند («تقویمِ نوبت‌ها» در مطب) — بازبینیِ UX: clinic-daily-05. */
  if (key === 'calendar' && t?.calendar) return t.calendar;
  if (key === 'crm' && t?.crm) return t.crm;
  if (key === 'settings' && t?.org) return `تنظیماتِ ${t.org}`;
  return x.label;
}

/** یک کاشی با نامِ حوزه‌ایِ خودش — `null` اگر چنین کلیدی در کاتالوگ نیست. */
export function toolOf(key, t) {
  const x = ALL.find((y) => y.key === key);
  return x ? { ...x, label: toolLabel(key, t) } : null;
}

/** کاشی‌هایی که یک کلیدِ ماژول (`feature`) بازشان می‌کند — «سطوحِ دسترسی» زیرِ هر ردیف همین را می‌نویسد. */
export const toolsOfFeature = (fkey, t) => ALL.filter((x) => (x.feature ?? x.key) === fkey).map((x) => toolOf(x.key, t));

/** همهٔ کاشی‌ها با نامِ حوزه‌ای — برای صفحه‌ای که باید بداند کدام‌ها کلیدِ ماژول ندارند. */
export const allTools = (t) => ALL.map((x) => toolOf(x.key, t));

/**
 * عنوانِ صفحه‌ای که یک کاشی بازش می‌کند: نامِ همان کاشی، و `document.title` به شکلِ
 * «نام — عمل‌یار» (نامِ صفحه اول، تا در زبانهٔ باریکِ مرورگر دیده شود).
 */
export function useToolTitle(key) {
  const t = useTerms();
  const tool = toolOf(key, t);
  const label = tool?.label ?? '';
  useEffect(() => { if (label) document.title = `${label} — عمل‌یار`; }, [label]);
  return { label, icon: tool?.icon ?? null };
}

/*
 * `/features` یک‌بار برای همهٔ مصرف‌کننده‌های هم‌زمان (نوارِ پوسته، جستجو، «امروز»، لانچر) —
 * هرکدام تا پیش از این درخواستِ خودش را می‌فرستاد. کلید = حساب، عمرِ کوتاه (۱۵ ثانیه).
 */
let featuresCache = null; // { who, at, promise }
function fetchFeatures(who) {
  const now = Date.now();
  if (featuresCache && featuresCache.who === who && now - featuresCache.at < 15_000) return featuresCache.promise;
  const promise = import('../lib/api.js').then(({ api }) => api('/features'));
  featuresCache = { who, at: now, promise };
  promise.catch(() => { if (featuresCache?.promise === promise) featuresCache = null; });
  return promise;
}

/**
 * کشِ `/features` را دور بریز — بعد از هر تغییرِ ماژول در «سطوحِ دسترسی» (بازبینیِ خصمانه، R10).
 * بی‌این، کاشیِ ماژولی که همین حالا خاموش شد تا ۱۵ ثانیه در پوسته، جستجو و «امروز» می‌ماند و
 * مدیر خیال می‌کرد کلید کار نکرده. کاشی‌های صفحه‌های بعدی از پاسخِ تازه ساخته می‌شوند.
 */
export function invalidateFeatures() {
  featuresCache = null;
}

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
    fetchFeatures(user?.id)
        .then((rows) => { if (alive) setFeatures(Object.fromEntries(rows.map((r) => [r.key, r]))); })
        /* ⚠️ شکستِ این درخواست باید به **پشتیبانِ `min`** برگردد، نه به انتظارِ ابدی.
           تا دیروز `catch` خالی بود و `features` روی `null` می‌ماند؛ برای لانچر
           بی‌اثر بود (فقط فهرست خالی می‌شد) ولی میزِ پزشک روی همین `loading`
           رندر را نگه می‌دارد و صفحه تا ابد «در حالِ بارگذاری…» می‌ماند.
           `{}` یعنی «پاسخی نیامد»: `allowed()` به `lvl >= t.min` برمی‌گردد. */
        .catch(() => { if (alive) setFeatures({}); });
    return () => { alive = false; };
    /* حسابِ دیگر (`/auth/switch` در همین زبانه) یعنی کاشی‌های دیگر — دوباره پرسیده می‌شود. */
  }, [user?.id]);

  const allowed = (t) => {
    const f = features?.[t.feature ?? t.key];
    if (f) return !!f.allowed;
    return lvl >= t.min;
  };
  const hero = allowed(HERO) ? HERO : null;
  /* نامِ کاشیِ پزشک از واژگانِ حوزه می‌آید («پرتال جراح» / «میزِ پزشک») — قانونِ ۲۴؛
     کاتالوگِ ثابت بالا فقط پشتیبان است تا نگهبانِ آیکون‌ها بتواند بخواندش. */
  const daily = DAILY.filter(allowed).map((x) => ({ ...x, label: toolLabel(x.key, t) }));
  const tools = TOOLS.filter(allowed).map((x) => ({ ...x, label: toolLabel(x.key, t) }));
  return { hero, daily, tools, loading: features === null, nothing: !hero && !daily.length && !tools.length };
}

/** اسپاتلایتِ دنبال‌کنندهٔ اشاره‌گر روی کارتِ شیشه‌ای (قانونِ ۱۰). */
export function track(e) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
  el.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
}
