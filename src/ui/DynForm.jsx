import { useRef, useState } from 'react';
import JDate from '../app/JDate.jsx';
import TimePick from './TimePick.jsx';
import { toEnDigits } from '../lib/identity.js';
import { Bank, Camera, Check, Copy, Star, Trash } from './icons.jsx';

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
  /**
   * آپلودکنندهٔ فیلدِ `image`: `(file, field) => Promise<{id?, url?, name?}>`.
   *
   * ⚠️ خودِ `DynForm` آپلود نمی‌کند و نباید بکند: مسیرِ ذخیرهٔ فایل در
   * داشبورد (`/patients/:id/documents`) و در فرمِ عمومیِ بیمار
   * (`/public/intake/form/:token/…`) دو چیزِ کاملاً متفاوت با دو مجوزِ متفاوت
   * است. کامپوننتی که آدرس را بداند، یکی از این دو را می‌شکند.
   *
   * نبودنش یعنی «این‌جا آپلود در دسترس نیست» و کادر با توضیح غیرفعال می‌شود —
   * نه یک دکمهٔ مرده که کلیک می‌خورد و هیچ اتفاقی نمی‌افتد.
   */
  onUpload,
  /**
   * شماره‌های باکسِ `payment` — `{ bank, holder, accountNumber, cardNumber, iban }`.
   *
   * ⚠️ در خودِ تعریفِ فرم ذخیره **نمی‌شوند**: هنگامِ ساختِ لینک، حسابداری یک
   * حساب انتخاب می‌کند و شماره‌ها از `IntakeLink.bankAccountId` خوانده
   * می‌شوند. اگر در فرم می‌نشستند، عوض‌کردنِ حساب فرم‌های قدیمی را بازنویسی
   * می‌کرد و فیش‌ها به حسابِ بسته واریز می‌شد.
   */
  payment = null,
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

          <Input
            field={f}
            value={values[f.key]}
            set={(v) => set(f.key, v)}
            disabled={disabled}
            lookups={lookups}
            onUpload={onUpload}
            payment={payment}
          />

          {errors[f.key]
            ? <em className="pf-err">{errors[f.key]}</em>
            : f.hint ? <em className="pf-hint">{f.hint}</em> : null}
        </label>
      ))}
    </div>
  );
}

function Input({ field: f, value, set, disabled, lookups, onUpload, payment }) {
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

    case 'image':
      return <ImageBox field={f} value={value} set={set} disabled={disabled} onUpload={onUpload} />;

    case 'payment':
      return <PaymentBox info={payment} />;

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
 * باکسِ عکس — یک **ارجاع** ذخیره می‌کند (`{ id, url, name }`)، نه بایت‌ها.
 *
 * ⚠️ عمداً `data:` URL نمی‌سازد. یک عکسِ موبایل به‌شکلِ base64 چند مگابایت
 * می‌شود و مستقیم داخلِ `Visit.extra` (یک ستونِ JSON) می‌نشیند: هر بار خواندنِ
 * فهرستِ مراجعات همان چند مگابایت را هم می‌کشد. فایل جای خودش می‌رود و
 * فرم فقط نشانی‌اش را نگه می‌دارد.
 */
function ImageBox({ field: f, value, set, disabled, onUpload }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const ref = value && typeof value === 'object' ? value : value ? { url: String(value) } : null;
  const off = disabled || busy || !onUpload;

  const pick = async (e) => {
    const file = e.target.files?.[0];
    /* ⚠️ ورودی همیشه خالی می‌شود، حتی وقتی آپلود شکست می‌خورد: بدونِ این،
       انتخابِ **دوباره‌ی همان فایل** رویدادی نمی‌سازد (مقدار عوض نشده) و
       کاربر فکر می‌کند دکمه خراب است. */
    e.target.value = '';
    if (!file || !onUpload) return;
    setErr('');
    setBusy(true);
    try {
      const r = await onUpload(file, f);
      set(r?.id || r?.url ? { id: r.id, url: r.url, name: r.name ?? file.name } : null);
    } catch (ex) {
      setErr(ex?.message || 'آپلود انجام نشد');
    } finally { setBusy(false); }
  };

  return (
    <span className="dyn-img">
      {/* ⚠️ ورودیِ فایل عمداً **اولین** المانِ قابلِ برچسب‌خوردن است. کلِ فیلد
          داخلِ یک `<label>` است، و مرورگر کلیکِ روی برچسب را به اولین کنترلِ
          داخلش می‌فرستد؛ اگر دکمهٔ سطلِ زباله اول می‌آمد، کلیک روی **متنِ
          عنوانِ فیلد** عکسِ پیوست‌شده را پاک می‌کرد.
          ⚠️ `accept` روی اندروید دوربین را هم پیشنهاد می‌دهد و روی سافاری
          «انتخاب از کتابخانه» را — همان چیزی که بیمار لازم دارد. */}
      <input ref={input} type="file" accept="image/*" hidden onChange={pick} disabled={off} />

      {ref && (
        <span className="dyn-img-has">
          {ref.url
            ? <img src={ref.url} alt={ref.name || f.label} />
            : <Camera width="20" height="20" />}
          <b>{ref.name || 'پیوست شد'}</b>
          <button type="button" onClick={() => set(null)} disabled={disabled || busy} aria-label="حذفِ عکس">
            <Trash width="14" height="14" />
          </button>
        </span>
      )}

      {!ref && (
        <button type="button" className="dyn-img-pick" onClick={() => input.current?.click()} disabled={off}>
          <Camera width="16" height="16" />
          {busy ? 'در حال آپلود…' : 'انتخابِ عکس'}
        </button>
      )}

      {!onUpload && <em className="dyn-note">این کادر در فرمِ بیمار پر می‌شود.</em>}
      {err && <em className="pf-err">{err}</em>}
    </span>
  );
}

/**
 * باکسِ پرداخت — شماره‌های حسابِ **لینک**، نه شماره‌های ذخیره‌شده در فرم.
 *
 * ⚠️ فقط نمایش است. فیش و کدِ تخفیف endpointهای خودشان را دارند
 * (`/form/:token/receipt` و `/form/:token/discount`) و صفحهٔ فرمِ عمومی
 * صداشان می‌زند؛ بردنشان داخلِ این کامپوننت یعنی داشبورد هم باید توکن داشته
 * باشد، که ندارد.
 */
function PaymentBox({ info }) {
  const [copied, setCopied] = useState('');
  if (!info) return <em className="dyn-note">شمارهٔ حساب هنگامِ ساختِ لینک انتخاب می‌شود.</em>;

  const rows = [
    ['شمارهٔ حساب', info.accountNumber],
    ['شمارهٔ کارت', info.cardNumber],
    ['شبا', info.iban && `IR${String(info.iban).replace(/^IR/i, '')}`],
  ].filter(([, v]) => v);

  const copy = async (label, text) => {
    try {
      await navigator.clipboard.writeText(toEnDigits(String(text)).replace(/\s/g, ''));
      setCopied(label);
      setTimeout(() => setCopied(''), 1600);
    } catch { /* کلیپ‌بورد بدونِ HTTPS یا با ردِ کاربر کار نمی‌کند — عدد خوانا هست. */ }
  };

  return (
    <span className="dyn-pay">
      <b className="dyn-pay-head">
        <Bank width="15" height="15" />
        {info.bank || 'حسابِ واریز'}
        {info.holder && <i>به نامِ {info.holder}</i>}
      </b>
      {rows.map(([label, val]) => (
        <span key={label} className="dyn-pay-row">
          <i>{label}</i>
          {/* ⚠️ `dir="ltr"` روی خودِ عدد: شمارهٔ کارت داخلِ یک بندِ راست‌به‌چپ
              تکه‌تکه و وارونه دیده می‌شود. */}
          <code dir="ltr">{val}</code>
          <button type="button" onClick={() => copy(label, val)} aria-label={`کپیِ ${label}`}>
            {copied === label ? <Check width="13" height="13" /> : <Copy width="13" height="13" />}
          </button>
        </span>
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
    /* ⚠️ باکسِ پرداخت مقدار ندارد — شماره‌ها از لینک می‌آیند و فیش endpointِ
       خودش را دارد. `VALUELESS_TYPES` سمتِ سرور همین است؛ اگر این دو از هم
       جدا می‌شدند، یکی خطا می‌داد و دیگری نه. */
    if (f.type === 'payment') continue;
    const v = values?.[f.key];
    const empty =
      v === undefined || v === null ||
      (typeof v === 'string' && v.trim() === '') ||
      (Array.isArray(v) && v.length === 0) ||
      (f.type === 'rating' && !Number(v)) ||
      /* عکس یک ارجاع است (`{id,url,name}`) نه رشته — آبجکتِ خالی «پر» نیست. */
      (f.type === 'image' && !(typeof v === 'string' ? v.trim() : v?.id || v?.url));
    if (empty) e[f.key] = `«${f.label}» را کامل کنید`;
  }
  return e;
}
