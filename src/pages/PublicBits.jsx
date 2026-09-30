import { useEffect, useState } from 'react';
import { Alert, Hospital, Phone, Refresh } from '../ui/icons.jsx';
import { fetchFace } from '../lib/public-face.js';
import './public-bits.css';

/**
 * تکه‌های مشترکِ صفحه‌های **بی‌احرازِ بیمار** (`/r` `/f` `/p` `/v`) — هویتِ مطب، دکمهٔ تماس
 * و الگوی واحدِ صفحهٔ خطا.
 *
 * هشدار: چرا یک فایل: تا دیروز هر صفحه تکهٔ خودش را داشت و نتیجه‌اش سه رفتارِ متفاوت بود —
 * پرتال تلفن را متنِ ۲۴ پیکسلی نشان می‌داد، فرم اصلاً تلفن نداشت، و صفحه‌های خطا فقط یک
 * خطِ صورتی بودند (بازبینیِ UX، بندهای ۹۲ و ۱۱۰).
 */

const faDigits = (t) => String(t ?? '').replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/** شمارهٔ قابلِ‌شماره‌گیری — فقط رقم و `+`؛ خط‌تیره و فاصله در `tel:` بی‌معنا‌اند. */
export const telHref = (phone) => `tel:${String(phone ?? '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[^0-9+]/g, '')}`;

/** «۰۲۱-۸۸۷۷۶۶۵۵» — نمایشِ فارسی، همان جداکنندهٔ خودِ تنظیمات. */
export const faPhone = (phone) => faDigits(phone);

/**
 * حرفِ نشانِ مطب — از واژهٔ **معنادارِ** نام، نه پیشوندِ عام: «مطب دکتر رحیمی» ← «ر».
 * نبودِ لوگو یعنی همین نشان؛ نه نشانِ عمل‌یار که نامِ نرم‌افزار است نه مطب.
 */
const GENERIC = /^(مطب|کلینیک|درمانگاه|مرکز|شرکت|دکتر|دانش‌بنیان|تخصصی|فوق‌تخصصی|جراحی|بیمارستان)$/;
export function initialOf(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  const word = words.find((w) => !GENERIC.test(w)) ?? words[0];
  return word ? word.charAt(0) : null;
}

/** لوگوی مطب، یا حرفِ نشان روی رنگِ برند. */
export function BrandMark({ brand, className = '' }) {
  if (brand?.logo) return <img className={`pb-logo ${className}`} src={brand.logo} alt="" />;
  const letter = initialOf(brand?.name);
  return (
    <span className={`pb-logo ${className}`} aria-hidden="true">
      {letter ?? <Hospital width="19" height="19" />}
    </span>
  );
}

/** دکمهٔ تماس — لمس‌شدنی (کفِ ۴۴ پیکسل)، با شمارهٔ فارسی و `tel:`ِ لاتین. */
export function CallLink({ phone, label = 'تماس', className = '' }) {
  if (!phone) return null;
  return (
    <a className={`pb-call ${className}`} href={telHref(phone)}>
      <Phone width="17" height="17" aria-hidden="true" />
      <span>{label}</span>
      <bdi dir="ltr">{faPhone(phone)}</bdi>
    </a>
  );
}

/**
 * پاورقیِ صفحهٔ بیمار: تماس با مطب، نشانی، و نامِ نرم‌افزار **کوچک** — «عمل‌یار» هویتِ
 * صفحه نیست، فقط سازندهٔ آن است.
 */
export function PublicFoot({ brand, call = true }) {
  return (
    <footer className="pb-foot">
      {/* `call={false}`: خودِ صفحه دکمهٔ تماس را جای برجسته‌تری گذاشته (کارتِ پایانی) — دوبار نه. */}
      {call && <CallLink phone={brand?.phone} label={brand?.name ? `تماس با ${brand.name}` : 'تماس'} />}
      {brand?.address && <small className="pb-addr">{brand.address}</small>}
      <small className="pb-powered">با پشتیبانیِ عمل‌یار</small>
    </footer>
  );
}

/**
 * هویتِ مطب برای صفحه‌ای که **دادهٔ خودش نیامد** (لینکِ خراب، اتصالِ قطع). از
 * `/public/intake/brand` — بی‌احراز، و شکستش فقط یعنی صفحهٔ خطا بی‌تلفن می‌ماند.
 */
export function useFallbackFace(active) {
  const [face, setFace] = useState(null);
  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    fetchFace().then((f) => { if (live && f) setFace(f); });
    return () => { live = false; };
  }, [active]);
  return face;
}

/**
 * **صفحهٔ خطای بیمار — یک الگو: چه شد + چرا + چه کنید.** (بازبینیِ UX، بندِ ۱۱۰)
 *
 * لینکِ پیامکی که ناقص کپی شده، منقضی یا ردشده، تا دیروز یک خطِ صورتی وسطِ صفحهٔ
 * سیاه بود — بی‌نامِ مطب، بی‌تلفن، بی‌راهِ بعدی. حالا همیشه دستِ‌کم «تماس» هست.
 */
export function PublicError({ brand, title, reason, children, tone = 'bad', icon = null }) {
  return (
    <section className={`pb-err ${tone}`} role="alert">
      <span className="pb-err-ic" aria-hidden="true">{icon ?? <Alert width="22" height="22" />}</span>
      <h2>{title}</h2>
      {reason && <p>{reason}</p>}
      <div className="pb-err-acts">
        {children}
        <CallLink phone={brand?.phone} label={brand?.name ? `تماس با ${brand.name}` : 'تماس با ما'} />
      </div>
    </section>
  );
}

/** «تلاشِ دوباره» روی **همان نشانی** — بیمار حسابی ندارد که به صفحهٔ ورود برود. */
export function RetryButton({ label = 'تلاشِ دوباره' }) {
  return (
    <button type="button" className="pb-act" onClick={() => window.location.reload()}>
      <Refresh width="16" height="16" aria-hidden="true" /> {label}
    </button>
  );
}

/**
 * خطای **بارگذاریِ** دادهٔ صفحه ← متنِ الگوی بالا. ۴۰۴ یعنی لینکِ ناقص/کهنه، ۴۰۳ لینکِ
 * خاموش‌شده، صفر یعنی اینترنت؛ بقیه همان پیامِ سرور.
 */
export function loadErrorText(e, what = 'لینک') {
  if (e?.status === 404) {
    return {
      title: `این ${what} باز نشد`,
      reason: 'شاید لینک ناقص کپی شده یا قدیمی است. لینکِ کاملِ پیامک را دوباره لمس کنید؛ اگر باز هم باز نشد تماس بگیرید.',
      retry: false,
    };
  }
  if (e?.status === 403) {
    return { title: `این ${what} دیگر فعال نیست`, reason: 'برای ثبت‌نام یا گرفتنِ نوبت تماس بگیرید.', retry: false };
  }
  if (!e?.status) {
    return { title: 'اتصال برقرار نشد', reason: 'اینترنت ضعیف یا قطع است. اتصال را بررسی کنید و دوباره تلاش کنید.', retry: true };
  }
  return { title: 'صفحه باز نشد', reason: e?.message || 'خطای سرور — کمی بعد دوباره تلاش کنید.', retry: true };
}
