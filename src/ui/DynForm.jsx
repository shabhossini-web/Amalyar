import JDate from '../app/JDate.jsx';
import TimePick from './TimePick.jsx';
import { toEnDigits } from '../lib/identity.js';
import { Star } from './icons.jsx';

/**
 * رندرِ فرم از روی **تعریف**، نه JSX.
 *
 * ⚠️ این کامپوننت تنها جایی است که یک `FormField` به یک ورودیِ واقعی تبدیل
 * می‌شود. اگر روزی نوعِ تازه‌ای اضافه شد، **دو جا** باید همزمان عوض شود: این
 * فایل و `FIELD_TYPES` در `forms.service.ts`. نوعی که فقط یک طرف بشناسد،
 * فرمی می‌سازد که در مرورگر درست به‌نظر می‌رسد و روی سرور بی‌صدا رد می‌شود —
 * یا برعکس، فیلدی که کاربر ساخته و هیچ‌جا دیده نمی‌شود. نگهبانِ CI هم‌خوانیِ
 * این دو فهرست را می‌سنجد.
 *
 * ⚠️ **ستاره از `required`ِ تعریف می‌آید، نه از متنِ برچسب.** الگوی قدیمیِ
 * `Definitions.jsx` اجباری‌بودنِ selectها را از `label.includes('*')` استنتاج
 * می‌کرد. آن‌جا جواب می‌داد چون برچسب‌ها ثابت بودند؛ این‌جا برچسب را کاربر
 * می‌نویسد و یک ستاره‌ی تصادفی داخلِ برچسب، فیلد را ناخواسته اجباری می‌کرد.
 *
 * ⚠️ کامپوننت **کنترل‌شده** است و هیچ state خودش ندارد: مقدارها و خطاها از
 * والد می‌آیند. فرمی که مقدارش را خودش نگه دارد، با هر بارگذاریِ دوباره‌ی
 * والد مقدارِ کاربر را می‌بازد.
 */
export default function DynForm({
  fields = [],
  values = {},
  errors = {},
  onChange,
  disabled,
  /**
   * منبعِ گزینه‌های فیلدهای هسته‌ای که به موجودیتِ دیگری اشاره می‌کنند
   * (`surgeonId` → فهرستِ جراحان). شکل: `{ surgeonId: [{v,l}], ... }`.
   *
   * ⚠️ از بیرون می‌آید و در خودِ تعریف نمی‌نشیند: فهرستِ جراحان داده‌ی زنده است
   * و ذخیره‌اش داخلِ `FormField.options` یعنی فهرستی که با افزودنِ جراحِ تازه
   * کهنه می‌شود.
   */
  lookups = {},
}) {
  const set = (key, v) => onChange({ ...values, [key]: v });

  return (
    <div className="pf dyn">
      {fields.filter((f) => f.active !== false).map((f) => (
        <label key={f.key} className={`pf-field${errors[f.key] ? ' bad' : ''}`}>
          <span>
            {f.label}
            {f.required && <i className="dyn-star" aria-label="اجباری"> *</i>}
          </span>

          <Input field={f} value={values[f.key]} set={(v) => set(f.key, v)} disabled={disabled} lookups={lookups} />

          {errors[f.key]
            ? <em className="pf-err">{errors[f.key]}</em>
            : f.hint ? <em className="pf-hint">{f.hint}</em> : null}
        </label>
      ))}
    </div>
  );
}

function Input({ field: f, value, set, disabled, lookups }) {
  const v = value ?? '';
  const common = { disabled, placeholder: f.placeholder || undefined };

  switch (f.type) {
    case 'textarea':
      return <textarea rows={3} dir="auto" value={v} onChange={(e) => set(e.target.value)} {...common} />;

    /* ⚠️ عدد و مبلغ هر دو `inputMode="numeric"` و `toEnDigits` می‌گیرند: کاربرِ
       فارسی با کیبوردِ فارسی «۱۲۰» می‌زند و بدونِ نرمال‌سازی، سرور رشته‌ای
       می‌گیرد که `Number()` رویش `NaN` می‌دهد. */
    case 'number':
    case 'money':
      return (
        <input
          type="text" inputMode="numeric" dir="ltr"
          value={v}
          onChange={(e) => set(toEnDigits(e.target.value).replace(/[^0-9-]/g, ''))}
          {...common}
        />
      );

    case 'phone':
      return (
        <input
          type="tel" inputMode="numeric" dir="ltr" placeholder={f.placeholder || '09…'}
          value={v} onChange={(e) => set(toEnDigits(e.target.value))} disabled={disabled}
        />
      );

    case 'date':
      return <JDate value={v} onChange={set} disabled={disabled} />;

    case 'time':
      return <TimePick value={v} onChange={set} onCommit={set} disabled={disabled} className="dyn-time" />;

    case 'bool':
      /* ⚠️ چک‌باکسِ ساده و نه سه‌حالته: «تیک نخورده» یعنی «نه»، نه «نمی‌دانم».
         اگر فیلد اجباری باشد، سرور مقدارِ `false` را **پر** می‌شمارد — «نه»
         یک جوابِ واقعی است. */
      return (
        <span className="dyn-bool">
          <input type="checkbox" checked={v === true || v === 'true'} onChange={(e) => set(e.target.checked)} disabled={disabled} />
          <i>{v === true || v === 'true' ? 'بله' : 'خیر'}</i>
        </span>
      );

    case 'rating':
      return <Rating value={Number(v) || 0} set={set} disabled={disabled} />;

    case 'multiselect': {
      const opts = optionsOf(f, lookups);
      const arr = Array.isArray(v) ? v : v ? String(v).split(',') : [];
      return (
        <span className="dyn-multi">
          {opts.map((o) => {
            const on = arr.includes(o.v);
            return (
              <button
                key={o.v} type="button" disabled={disabled}
                className={`dyn-pill${on ? ' on' : ''}`}
                aria-pressed={on}
                onClick={() => set(on ? arr.filter((x) => x !== o.v) : [...arr, o.v])}
              >
                {o.l}
              </button>
            );
          })}
        </span>
      );
    }

    case 'select': {
      const opts = optionsOf(f, lookups);
      return (
        <select value={v} onChange={(e) => set(e.target.value)} disabled={disabled}>
          <option value="">— انتخاب کنید —</option>
          {opts.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
      );
    }

    default:
      return <input type="text" dir="auto" value={v} onChange={(e) => set(e.target.value)} {...common} />;
  }
}

/**
 * گزینه‌ها: اول از داده‌ی زنده (`lookups`)، بعد از خودِ تعریف.
 *
 * ⚠️ ترتیب مهم است. فیلدِ هسته‌ای مثل `surgeonId` در تعریف `options` خالی دارد
 * و فهرستش باید زنده بیاید؛ فیلدِ دلخواهِ ساخته‌ی کاربر برعکس. اگر ترتیب برعکس
 * بود، آرایه‌ی خالیِ تعریف فهرستِ زنده را می‌پوشاند و انتخابگر خالی می‌ماند.
 */
function optionsOf(f, lookups) {
  const live = lookups?.[f.key];
  if (Array.isArray(live) && live.length) return live;
  return Array.isArray(f.options) ? f.options : [];
}

/** امتیازِ ۱ تا ۵ — برای نظرسنجی. */
function Rating({ value, set, disabled }) {
  return (
    <span className="dyn-rate" role="radiogroup">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n} type="button" disabled={disabled}
          className={`dyn-star-btn${n <= value ? ' on' : ''}`}
          role="radio" aria-checked={n === value} aria-label={`${n} از ۵`}
          /* زدنِ دوباره‌ی همان امتیاز پاکش می‌کند — تنها راهِ «اشتباه زدم». */
          onClick={() => set(n === value ? 0 : n)}
        >
          {/* ⚠️ SVG و نه نویسه‌ی `★`: نویسه روی اندروید و iOS با فونتِ متفاوت
              رندر می‌شود و گاهی به‌شکلِ ایموجیِ رنگی درمی‌آید که با رنگِ تمِ
              برنامه نمی‌خواند. نگهبانِ CI همین را می‌گیرد. */}
          <Star width="24" height="24" />
        </button>
      ))}
    </span>
  );
}

/**
 * اعتبارسنجیِ کلاینت — **همان قاعده‌ی سرور**، فقط زودتر.
 *
 * ⚠️ این جایگزینِ اعتبارسنجیِ سرور نیست و نباید باشد: کلاینت را می‌شود دور زد.
 * وجودش فقط برای این است که کاربر خطا را کنارِ فیلد ببیند نه به‌شکلِ یک toastِ
 * کلی بعد از رفت‌وبرگشت. هر دو از یک منبع می‌خوانند (`field.required`) پس
 * نمی‌توانند اختلاف پیدا کنند.
 */
export function dynErrors(fields, values) {
  const e = {};
  for (const f of fields ?? []) {
    if (f.active === false || !f.required) continue;
    const v = values?.[f.key];
    const empty =
      v === undefined || v === null ||
      (typeof v === 'string' && v.trim() === '') ||
      (Array.isArray(v) && v.length === 0) ||
      (f.type === 'rating' && !Number(v));
    if (empty) e[f.key] = `«${f.label}» را کامل کنید`;
  }
  return e;
}
