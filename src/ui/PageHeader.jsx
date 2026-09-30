import { Children } from 'react';
import { Link } from 'react-router-dom';
import { useTerms } from '../app/config.jsx';
import { toolOf, usePageTitle } from '../app/tools.jsx';
import { Back } from './icons.jsx';
import './page-header.css';

/**
 * سربرگِ مشترکِ همهٔ صفحه‌های `/app` — بازگشت، عنوان با آیکونِ کاشی، زیرعنوان و جای اکشن‌ها.
 *
 * ⚠️ بازبینیِ UX (۱۴۰۵/۰۷، یافتهٔ shell-15): هر صفحه سربرگِ خودش را داشت — پنج جور دکمهٔ
 * بازگشت (قرصِ ۴۰ پیکسلی، متنِ ۲۳ پیکسلی، لینکِ بی‌آیکونِ ته سربرگ، هیچ)، هفت اندازهٔ عنوان
 * (۱۶ تا ۲۸) و ۱۷ کلاسِ جدا. برچسبِ «سامانه» هم نمی‌گفت به کجا برمی‌گردد، و در دو صفحه لینکِ
 * بازگشت کلِ عرضِ ردیف را می‌گرفت — لمسِ جای خالی کاربر را بیرون می‌برد. سربرگِ تازه فقط از
 * همین‌جا ساخته می‌شود؛ صفحه‌ها فقط **داده** می‌دهند.
 *
 * - `tool`: کلیدِ کاشی در `tools.jsx` — نام (با واژهٔ حوزه، قانونِ ۲۴) و آیکون از همان‌جا.
 *   نامِ کاشی = عنوانِ صفحه؛ آیکونِ سربرگ هم همان آیکونِ کاشی است، نه یکی از جای دیگر.
 * - `title` / `icon`: برای صفحه‌ای که کاشی نیست (پرونده، پروفایل، کارهای من) یا عنوانش به
 *   نقشِ کاربر بسته است («دفترِ کار» / «دفترِ کارِ کارشناسان»). `icon={null}` یعنی بی‌آیکون.
 * - `docTitle`: عنوانِ زبانه اگر با عنوانِ صفحه فرق دارد؛ شکلش همیشه «نامِ صفحه — نامِ مطب/شرکت».
 * - `sub`: زیرعنوانِ یک‌خطی (یک `<p>`)؛ تکه‌های درونش می‌توانند `span` باشند.
 * - `back`: پیش‌فرض «امروز» (`/app` — خانهٔ سامانه). زیرصفحه `{ to, label }` می‌دهد (پرونده →
 *   «بیماران»)، نمای درونِ صفحه `{ onClick, label }` (اتاقِ عمل → «فهرستِ روز»)، و `false` یعنی بی‌بازگشت.
 * - عرض: سربرگ هم‌عرضِ محتوای صفحه است و آن را از `--page-w`ِ ریشهٔ صفحه می‌خواند — یکی از دو عرضِ
 *   استاندارد: `--maxw` (فهرست/جدول، پیش‌فرض) یا `--maxw-form` (فرم و خواندن). propی برایش نیست تا
 *   سربرگ و محتوا دو منبعِ جدا برای یک عدد نداشته باشند.
 * - `className`: قلابِ صفحه (آزمون‌ها و قاعده‌های اکشن‌های همان صفحه) — ظاهرِ خودِ سربرگ از
 *   این‌جا نیست و نباید باشد.
 * - `children`: اکشن‌ها؛ در RTL انتهای ردیف (چپ) می‌نشینند و روی گوشی ردیفِ خودشان را دارند.
 */
export default function PageHeader({ tool, title, icon, docTitle, sub, back, className = '', children }) {
  const t = useTerms();
  const x = tool ? toolOf(tool, t) : null;
  const label = title ?? x?.label ?? '';
  const Icon = icon === undefined ? x?.icon : icon;
  usePageTitle(docTitle ?? (typeof label === 'string' ? label : ''));

  const b = back === undefined ? { to: '/app', label: 'امروز' } : back;
  const backInner = <><Back width="16" height="16" aria-hidden="true" /><span>{b?.label}</span></>;
  const aria = b ? `بازگشت به ${b.label}` : undefined;

  return (
    <header className={`ph${className ? ` ${className}` : ''}`}>
      {b && (b.onClick
        ? <button type="button" className="ph-back" onClick={b.onClick} aria-label={aria}>{backInner}</button>
        : <Link to={b.to} className="ph-back" aria-label={aria}>{backInner}</Link>)}
      <div className="ph-head">
        <h1 className="ph-title">
          {Icon && <span className="ph-ic" aria-hidden="true"><Icon width="19" height="19" /></span>}
          <span className="ph-name">{label}</span>
        </h1>
        {sub && <p className="ph-sub">{sub}</p>}
      </div>
      {/* `{cond && …}`ِ خالی ردیفِ خالیِ ۴۰ پیکسلی نسازد (روی گوشی ردیفِ خودش را دارد). */}
      {Children.toArray(children).length > 0 && <div className="ph-actions">{children}</div>}
    </header>
  );
}
