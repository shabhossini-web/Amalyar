import VoiceNote, { VoiceClip } from './VoiceNote.jsx';
import AssistedTextarea from './AssistedTextarea.jsx';
import { fieldRoles } from '../lib/job-roles.js';
import { useRef, useState } from 'react';
import JDate from '../app/JDate.jsx';
import TimePick from './TimePick.jsx';
import Pick from './Pick.jsx';
import './dynform.css';
import { toEnDigits } from '../lib/identity.js';
import { shrinkImage } from '../lib/image-shrink.js';
import { Bank, Camera, Check, Copy, LinkIcon, Mic, Star, Trash } from './icons.jsx';

/** مدتِ صدا — «۱:۰۵» با ارقامِ فارسی. */
const faSec = (sec) => {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
};

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
  assistance = false,
  fields = [],
  values = {},
  errors = {},
  onChange,
  disabled,
  /**
   * نقشِ شغلیِ کاربرِ جاری — «هر کس قسمتِ خودش را پر کند».
   *
   * ⚠️ قفلِ این‌جا فقط **نمایشِ** قاعده است؛ اجرای واقعی سمتِ سرور است
   * (`assertRoleOwnership`). فیلدی که `role` دارد برچسبِ بخش می‌گیرد، و اگر
   * نقشِ کاربر با آن فرق کند غیرفعال می‌شود. کاربرِ بی‌نقش همه را می‌نویسد.
   */
  myRole = null,
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
  /** حذفِ یک عکسِ آپلودشده سمتِ سرور (کادرهای چندعکسی). */
  onRemove,
  /**
   * شماره‌های باکسِ `payment` — `{ bank, holder, accountNumber, cardNumber, iban }`.
   *
   * ⚠️ در خودِ تعریفِ فرم ذخیره **نمی‌شوند**: هنگامِ ساختِ لینک، حسابداری یک
   * حساب انتخاب می‌کند و شماره‌ها از `IntakeLink.bankAccountId` خوانده
   * می‌شوند. اگر در فرم می‌نشستند، عوض‌کردنِ حساب فرم‌های قدیمی را بازنویسی
   * می‌کرد و فیش‌ها به حسابِ بسته واریز می‌شد.
   */
  payment = null,
  /**
   * آپلودکنندهٔ **توضیحِ صوتیِ** یک ردیفِ باکسِ لینک (بستهٔ ۶د):
   * `(file, field) => Promise<{id, name}>`. همان قاعدهٔ `onUpload`: مسیرِ ذخیره
   * در داشبورد و فرمِ عمومی فرق دارد، پس خودِ فرم آدرس نمی‌داند. نبودنش یعنی
   * این‌جا ضبطِ صدا در دسترس نیست (دکمه‌ای هم نشان داده نمی‌شود).
   */
  onVoice,
  /** پخشِ صدای ثبت‌شده — `(ref) => Promise<blobUrl>`؛ فقط جایی که فایل خواندنی است. */
  voiceUrl,
}) {
  const set = (key, v) => onChange({ ...values, [key]: v });
  /* «رزرو بدون تاریخ» (مالک، ۱۴۰۵/۰۷/۰۱): وقتی بیمار «بله» زده، کادرِ تاریخِ عمل
     کنار می‌رود و ستاره‌اش هم — همان شرطِ `validateFields` سمتِ سرور. بدونِ
     این، ستاره روی کادرِ غیرفعال می‌ماند و بیمار فکر می‌کرد فرم ناقص است. */
  const undated = values.opDateOpen === true || values.opDateOpen === 'true';
  const setOpen = (key, v) => onChange({ ...values, [key]: v, ...(key === 'opDateOpen' && (v === true || v === 'true') ? { opDate: '' } : {}) });
  /* «یا تاریخِ عمل، یا رزرو بدون تاریخ» (مالک، ۱۴۰۵/۰۷/۰۴): وقتی هر دو کادر در همین صفحه‌اند،
     یک کنترلِ واحد می‌شوند — دو گزینه و فقط محتوای گزینهٔ انتخاب‌شده. تا دیروز کادرِ تاریخ و
     پرسشِ «رزرو بدون تاریخ» هم‌زمان روی صفحه بودند و بیمار نمی‌فهمید کدام را باید پر کند. */
  const active = fields.filter((f) => f.active !== false);
  const undatedField = active.find((f) => f.key === 'opDateOpen');
  const paired = !!undatedField && active.some((f) => f.key === 'opDate');

  return (
    <div className="pf dyn">
      {active.map((f) => {
        const locked = !!(fieldRoles(f).length && myRole && !fieldRoles(f).includes(myRole));
        if (paired && f.key === 'opDateOpen') return null;
        if (paired && f.key === 'opDate') {
          const off = disabled || locked;
          return (
            <div key={f.key} data-ftype="date" role="group" aria-labelledby="dyn-when-label"
                 className={`pf-field dyn-when${errors[f.key] && !undated ? ' bad' : ''}`}>
              <span id="dyn-when-label">
                {f.label}
                {f.required && !undated && <i className="dyn-star" aria-label="اجباری"> *</i>}
              </span>
              <span className="dyn-multi dyn-when-pick">
                <button type="button" className={`dyn-pill${!undated ? ' on' : ''}`} aria-pressed={!undated}
                        disabled={off} onClick={() => setOpen('opDateOpen', false)}>
                  تاریخ مشخص است
                </button>
                <button type="button" className={`dyn-pill${undated ? ' on' : ''}`} aria-pressed={undated}
                        disabled={off} onClick={() => setOpen('opDateOpen', true)}>
                  {undatedField.label}
                </button>
              </span>
              {undated ? (
                <em className="pf-hint">تاریخِ عمل را بعداً شرکت با شما هماهنگ می‌کند.</em>
              ) : (
                <label className="dyn-when-date">
                  <span className="dyn-sr">{f.label}</span>
                  <Input
                    assistance={assistance} field={f} value={values[f.key]} set={(v) => setOpen(f.key, v)}
                    disabled={off} lookups={lookups}
                  />
                </label>
              )}
              {errors[f.key] && !undated
                ? <em className="pf-err">{errors[f.key]}</em>
                : !undated && f.hint ? <em className="pf-hint">{f.hint}</em> : null}
            </div>
          );
        }
        const parked = undated && f.key === 'opDate';
        return (
        <label key={f.key} data-ftype={f.type} className={`pf-field${errors[f.key] ? ' bad' : ''}${locked ? ' dyn-locked' : ''}`}>
          <span>
            {f.label}
            {f.required && !parked && <i className="dyn-star" aria-label="اجباری"> *</i>}
            {f.role && (
              <i className={`dyn-role${locked ? ' off' : ''}`}>
                بخشِ {f.roleLabel ?? f.role}{locked ? ' — فقط‌خواندنی' : ''}
              </i>
            )}
          </span>

          <Input
            assistance={assistance}
            field={f}
            value={parked ? '' : values[f.key]}
            set={(v) => setOpen(f.key, v)}
            disabled={disabled || locked || parked}
            lookups={lookups}
            onUpload={onUpload}
            onRemove={onRemove}
            payment={payment}
            onVoice={onVoice}
            voiceUrl={voiceUrl}
          />

          {errors[f.key] && !parked
            ? <em className="pf-err">{errors[f.key]}</em>
            : parked ? <em className="pf-hint">رزرو بدون تاریخ — تاریخ را بعداً شرکت هماهنگ می‌کند.</em>
              : f.hint ? <em className="pf-hint">{f.hint}</em> : null}
        </label>
        );
      })}
    </div>
  );
}

function Input({ assistance, field: f, value, set, disabled, lookups, onUpload, onRemove, payment, onVoice, voiceUrl }) {
  const v = value ?? '';
  const common = { disabled, placeholder: f.placeholder || undefined };

  switch (f.type) {
    case 'textarea':
      if (assistance) return <AssistedTextarea purpose={f.label} rows={3} dir="auto" value={v} onChange={(e) => set(e.target.value)} {...common} />;
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

    case 'bool': {
      /* ⚠️ دو پیلِ صریحِ «بله/خیر»، نه چک‌باکس: چک‌باکسِ خالی با برچسبِ «خیر»
         کنارش دوپهلو بود (اسکرین‌شاتِ کاربر — تیک بزنم یعنی بله یا خیر؟).
         این‌جا بیمار خودش یکی را می‌زند؛ `false` جوابِ واقعی است و سرور
         پرش می‌شمارد. همان زبانِ پیلِ multiselect. */
      const yes = v === true || v === 'true';
      const no = v === false || v === 'false';
      return (
        <span className="dyn-multi dyn-yesno">
          <button type="button" className={`dyn-pill${yes ? ' on' : ''}`} disabled={disabled} onClick={() => set(true)}>بله</button>
          <button type="button" className={`dyn-pill${no ? ' on' : ''}`} disabled={disabled} onClick={() => set(false)}>خیر</button>
        </span>
      );
    }

    case 'rating':
      return <Rating value={Number(v) || 0} set={set} disabled={disabled} />;

    case 'image':
      return <ImageBox field={f} value={value} set={set} disabled={disabled} onUpload={onUpload} onRemove={onRemove} />;

    case 'links':
      return <LinksBox field={f} value={value} set={set} disabled={disabled} onVoice={onVoice} voiceUrl={voiceUrl} />;

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
      /* ⚠️ Pick به‌جای selectِ بومی — پاپ‌آپِ بومی روی ویندوز کند و بدرنگ باز
         می‌شد؛ توضیحِ کامل در `ui/Pick.jsx`. مقدارِ خالی همان '' می‌ماند تا
         اعتبارسنجی و ذخیره دست نخورند. */
      return (
        <Pick
          label={f.label}
          value={v || null}
          onChange={(id) => set(id ?? '')}
          options={opts.map((o) => ({ id: o.v, name: o.l }))}
          placeholder="— انتخاب کنید —"
          disabled={disabled}
        />
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
          {/* ⚠️ SVG و نه نویسهٔ ستاره (U+2605): نویسه روی اندروید و iOS با فونتِ متفاوت
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
/** سقفِ عکسِ کادرِ فرم — همان سقفِ `FileInterceptor`ِ مسیرِ عکسِ فرمِ بیمار (`intake.controller.ts`). */
const IMAGE_MAX_MB = 8;
const TOO_BIG = 'حجمِ عکس زیاد است (بیش از ۸ مگابایت)؛ عکس را دوباره بگیرید یا کوچک‌تر بفرستید';

function ImageBox({ field: f, value, set, disabled, onUpload, onRemove }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  /* ⚠️ مقدار از #۶۶ **آرایه** است. رکوردهای قدیمی شیءِ تکی (یا رشتهٔ URL)
     دارند و همین‌جا به آرایهٔ یک‌عضوی خوانده می‌شوند — فرم‌های پرشدهٔ قبلی
     نباید خالی دیده شوند. */
  const list = Array.isArray(value)
    ? value.filter(Boolean)
    : value && typeof value === 'object' ? [value]
      : value ? [{ url: String(value) }] : [];
  const off = disabled || busy || !onUpload;
  const max = 10;

  const pick = async (e) => {
    const files = Array.from(e.target.files ?? []);
    /* ⚠️ ورودی همیشه خالی می‌شود، حتی وقتی آپلود شکست می‌خورد: بدونِ این،
       انتخابِ **دوباره‌ی همان فایل** رویدادی نمی‌سازد (مقدار عوض نشده) و
       کاربر فکر می‌کند دکمه خراب است. */
    e.target.value = '';
    if (!files.length || !onUpload) return;
    setErr('');
    setBusy(true);
    /* ترتیبی، نه موازی — و خطای یک فایل بقیه را زمین نمی‌زند. */
    const added = [];
    for (const raw of files) {
      if (list.length + added.length >= max) { setErr(`حداکثر ${max} فایل`); break; }
      /* ⚠️ اول کوچک، بعد سقف، بعد ارسال (بازبینیِ UX، بندِ ۹۹): عکسِ ۱۲ مگابایتیِ دوربین با ۱۶۰۰ پیکسل
         زیرِ نیم مگابایت می‌شود و روی اینترنتِ کندِ بیمار چند ثانیه می‌رود نه چند دقیقه؛ فایلی که
         کوچک نشد و هنوز از سقف بزرگ‌تر است اصلاً فرستاده نمی‌شود. */
      const file = await shrinkImage(raw);
      if (file.size > IMAGE_MAX_MB * 1024 * 1024) { setErr(TOO_BIG); continue; }
      try {
        const r = await onUpload(file, f);
        if (r?.id || r?.url) added.push({ id: r.id, url: r.url, name: r.name ?? raw.name });
      } catch (ex) {
        setErr(ex?.status === 413 ? TOO_BIG : ex?.message || 'آپلود انجام نشد');
      }
    }
    if (added.length) set([...list, ...added]);
    setBusy(false);
  };

  const drop = async (i) => {
    const gone = list[i];
    /* حذف سمتِ سرور هم انجام شود (اگر مسیرش را والد داده) وگرنه ارجاعِ
       یتیم در فرم می‌ماند و بعداً «عکس هست ولی نیست» می‌شود. */
    if (gone?.id && onRemove) {
      try { await onRemove(gone, f); } catch (ex) { setErr(ex?.message || 'حذف نشد'); return; }
    }
    set(list.filter((_, j) => j !== i));
  };

  return (
    <span className="dyn-img">
      {/* ⚠️ ورودیِ فایل عمداً **اولین** المانِ قابلِ برچسب‌خوردن است. کلِ فیلد
          داخلِ یک `<label>` است، و مرورگر کلیکِ روی برچسب را به اولین کنترلِ
          داخلش می‌فرستد؛ اگر دکمهٔ سطلِ زباله اول می‌آمد، کلیک روی **متنِ
          عنوانِ فیلد** عکسِ پیوست‌شده را پاک می‌کرد.
          ⚠️ `accept` روی اندروید دوربین را هم پیشنهاد می‌دهد و روی سافاری
          «انتخاب از کتابخانه» را — همان چیزی که بیمار لازم دارد. */}
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={pick} disabled={off} />

      {list.length > 0 && (
        <span className="dyn-img-list">
          {list.map((ref, i) => (
            <span className="dyn-img-has" key={ref.id ?? ref.url ?? i}>
              {ref.url
                ? <img src={ref.url} alt={ref.name || f.label} />
                : <Camera width="20" height="20" />}
              <b>{ref.name || `عکسِ ${i + 1}`}</b>
              <button type="button" onClick={() => drop(i)} disabled={disabled || busy} aria-label="حذفِ عکس">
                <Trash width="14" height="14" />
              </button>
            </span>
          ))}
        </span>
      )}

      {onUpload && list.length < max && (
        <button type="button" className="dyn-img-pick" onClick={() => input.current?.click()} disabled={off}>
          <Camera width="16" height="16" />
          {busy ? 'در حال آپلود…' : list.length ? 'افزودنِ عکسِ دیگر' : 'انتخابِ عکس'}
        </button>
      )}
      {onUpload && list.length > 0 && (
        <em className="dyn-note">چند عکس با هم یا یکی‌یکی — همه در همین کادر می‌مانند.</em>
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
 * باکسِ لینک — فهرستِ لینک‌های MRI/CT/آزمایش با نامِ کاربری/رمزِ اختیاریِ پورتال.
 *
 * مقدار: `[{ url, title, user, pass, kind }]` — همان شکلی که سرور
 * (`normalizeLinks`) ذخیره می‌کند و هنگامِ ثبتِ مراجعه هر ردیفش **مدرکِ لینکیِ**
 * پرونده می‌شود (`link-documents.ts`). `kind` دستهٔ همان لینک در تبِ مدارک
 * است و پیش‌فرضش از دستهٔ خودِ فیلد (`docCategory`) می‌آید.
 *
 * ⚠️ چرا لینک متنِ بلند نیست: مطبِ واقعی «لینکِ تصاویر و آزمایش‌ها» را با یک
 * textarea ساخته بود — لینکِ داخلِ متن نه کلیک‌شدنی است، نه رمزِ پورتال جایی
 * دارد، نه به مدارکِ پرونده می‌رسد.
 *
 * کنترل‌شده مثلِ بقیهٔ DynForm: هیچ stateای این‌جا نیست. ردیفِ بی‌نشانی را
 * سرور بی‌صدا حذف می‌کند، پس «افزودنِ لینک» و بعد پشیمان‌شدن خطا نمی‌سازد.
 */
const LINK_KINDS = [['imaging', 'تصویربرداری'], ['lab', 'آزمایش'], ['other', 'سایر']];
const MAX_LINKS = 10;
function LinksBox({ field: f, value, set, disabled, onVoice, voiceUrl }) {
  const list = Array.isArray(value) ? value
    : value && typeof value === 'object' ? [value]
      : value ? [{ url: String(value) }] : [];
  const defKind = LINK_KINDS.some(([k]) => k === f.docCategory) ? f.docCategory : 'other';
  const patch = (i, p) => set(list.map((it, j) => (j === i ? { ...it, ...p } : it)));
  const add = () => set([...list, { url: '', title: '', user: '', pass: '', kind: defKind }]);
  const drop = (i) => set(list.filter((_, j) => j !== i));

  return (
    <span className="dyn-links">
      {list.map((it, i) => {
        const kind = LINK_KINDS.some(([k]) => k === it.kind) ? it.kind : defKind;
        return (
          <span className="dyn-link" key={i}>
            <span className="dyn-link-row">
              {/* ⚠️ `type="url"` فقط کیبوردِ نشانی را روی موبایل می‌آورد؛ سنجشِ واقعی
                  سمتِ سرور است (http/https). `dir="ltr"` چون نشانی لاتین است. */}
              <input
                type="url" inputMode="url" dir="ltr" autoComplete="off"
                value={it.url ?? ''} placeholder="https://…" disabled={disabled}
                onChange={(e) => patch(i, { url: e.target.value })} aria-label={`لینکِ ${i + 1}`}
              />
              <button type="button" className="dyn-link-del" onClick={() => drop(i)} disabled={disabled} aria-label="حذفِ لینک">
                <Trash width="14" height="14" />
              </button>
            </span>
            <input
              type="text" dir="auto" value={it.title ?? ''} placeholder="عنوان — مثلاً MRI کمر (اختیاری)"
              disabled={disabled} onChange={(e) => patch(i, { title: e.target.value })} aria-label="عنوانِ لینک"
            />
            <span className="dyn-link-kinds" role="radiogroup" aria-label="نوعِ مدرک">
              {LINK_KINDS.map(([k, l]) => (
                <button
                  key={k} type="button" role="radio" aria-checked={kind === k} disabled={disabled}
                  className={`dyn-pill${kind === k ? ' on' : ''}`} onClick={() => patch(i, { kind: k })}
                >
                  {l}
                </button>
              ))}
            </span>
            {/* ورودِ پورتال — متنِ ساده و نه password: همکارِ بعدی باید بتواند بخواندش. */}
            <span className="dyn-link-cred">
              <input
                type="text" dir="ltr" autoComplete="off" value={it.user ?? ''} placeholder="نامِ کاربری (اگر لازم است)"
                disabled={disabled} onChange={(e) => patch(i, { user: e.target.value })} aria-label="نامِ کاربریِ لینک"
              />
              <input
                type="text" dir="ltr" autoComplete="off" value={it.pass ?? ''} placeholder="رمز"
                disabled={disabled} onChange={(e) => patch(i, { pass: e.target.value })} aria-label="رمزِ لینک"
              />
            </span>
            {/* ── توضیحِ صوتیِ همین لینک (بستهٔ ۶د) ──
                ⚠️ تا نشانی نیامده ضبط بسته است: ردیفِ بی‌نشانی را سرور دور
                می‌ریزد و صدای آپلودشده‌اش بی‌صاحب در پرونده می‌ماند. */}
            {it.voice?.id ? (
              voiceUrl ? (
                <VoiceClip
                  load={() => voiceUrl(it.voice)}
                  name={`توضیحِ صوتی${it.voice.seconds ? ` · ${faSec(it.voice.seconds)}` : ''}`}
                  disabled={disabled}
                  onDelete={() => patch(i, { voice: null })}
                />
              ) : (
                <span className="dyn-voice-done">
                  <Mic size={14} /> توضیحِ صوتی ثبت شد
                  <button type="button" onClick={() => patch(i, { voice: null })} disabled={disabled} aria-label="برداشتنِ صدا">
                    <Trash width="13" height="13" />
                  </button>
                </span>
              )
            ) : onVoice ? (
              (it.url ?? '').trim()
                ? (
                  <VoiceNote
                    disabled={disabled}
                    onSave={async (file, seconds) => {
                      const r = await onVoice(file, f);
                      if (!r?.id) throw new Error('صدا ثبت نشد');
                      patch(i, { voice: { id: r.id, name: r.name ?? null, seconds: Math.round(seconds) } });
                    }}
                  />
                )
                : <em className="dyn-note">برای افزودنِ توضیحِ صوتی، اول نشانیِ لینک را بگذارید.</em>
            ) : null}
          </span>
        );
      })}
      {list.length < MAX_LINKS && (
        <button type="button" className="dyn-img-pick" onClick={add} disabled={disabled}>
          <LinkIcon width="16" height="16" />
          {list.length ? 'افزودنِ لینکِ دیگر' : 'افزودنِ لینک'}
        </button>
      )}
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
export function dynErrors(fields, values, myRole = null) {
  const e = {};
  for (const f of fields ?? []) {
    if (f.active === false) continue;
    /* باکسِ لینک: نشانیِ بدونِ http/https حتی وقتی فیلد اختیاری است خطاست —
       همان قاعدهٔ `normalizeLinks`ِ سرور؛ ردیفِ خالی خطا نیست (سرور حذفش می‌کند). */
    if (f.type === 'links' && Array.isArray(values?.[f.key])) {
      const bad = values[f.key].find((x) => typeof x?.url === 'string' && x.url.trim() && !/^https?:\/\/\S+$/i.test(x.url.trim()));
      if (bad) { e[f.key] = `«${f.label}»: نشانی باید با http یا https شروع شود`; continue; }
    }
    if (!f.required) continue;
    /* «رزرو بدون تاریخ»: تاریخِ خالیِ اعلام‌شده خطا نیست — همان قاعدهٔ `validateFields`ِ سرور.
       ⚠️ تا ۱۴۰۵/۰۷/۰۴ این‌جا نبود و خطایش هم زیرِ کادرِ کنارگذاشته پنهان بود: بیمارِ «بله» زده
       «ثبت» را می‌زد و هیچ اتفاقی نمی‌افتاد (سنجهٔ `intake-service-ui` پیدایش کرد). */
    if (f.key === 'opDate' && (values?.opDateOpen === true || values?.opDateOpen === 'true')) continue;
    /* فیلدِ اجباریِ بخشِ دیگر نباید ذخیرهٔ این نقش را قفل کند: منشی که فرم
       را می‌بندد مسئولِ «شرحِ معاینه»ی پزشک نیست. سرور هم همین‌طور رفتار
       می‌کند (assertRoleOwnership فقط تغییر را می‌سنجد، نه خالی‌بودن را). */
    if (fieldRoles(f).length && myRole && !fieldRoles(f).includes(myRole)) continue;
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
      (f.type === 'image' && !(typeof v === 'string' ? v.trim()
        : Array.isArray(v) ? v.some((x) => x?.id || x?.url)
          : v?.id || v?.url)) ||
      /* لینک: دستِ‌کم یک ردیف با نشانی. */
      (f.type === 'links' && !(typeof v === 'string' ? v.trim()
        : Array.isArray(v) ? v.some((x) => typeof x?.url === 'string' && x.url.trim())
          : typeof v?.url === 'string' && v.url.trim()));
    if (empty) e[f.key] = `«${f.label}» را کامل کنید`;
  }
  return e;
}
