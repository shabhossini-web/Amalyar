import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import FileDrop from '../ui/FileDrop.jsx';
import { api, apiUpload } from '../lib/api.js';
import { isoToJStr, jStrToIso, toEnDigits } from '../lib/jalali.js';
import JDate from '../app/JDate.jsx';
import './intake.css';
import { Alert, Bank, Box, CheckCircle, Clock, Refresh, Upload } from '../ui/icons.jsx';
import { PATIENT } from '../lib/terms.js';
import DynForm, { dynErrors } from '../ui/DynForm.jsx';
import HospitalLookup from '../ui/HospitalLookup.jsx';
import BookingPick from './BookingPick.jsx';
import { BrandMark, CallLink, PublicFoot } from './PublicBits.jsx';

const faNum = (n) => Number(n ?? 0).toLocaleString('fa-IR');
/* ⚠️ مبلغ‌ها در کلِ عمل‌یار **تومان**اند (مثلِ `Charge.amount`). نسخهٔ اول
   این‌جا بر ۱۰ تقسیم می‌کرد چون قراردادِ ریالیِ سامانهٔ قبلی را آورده بودم —
   یعنی بیمار یک‌دهمِ مبلغ را می‌دید. */

/**
 * فرمِ ثبت‌نامِ بیمار — **عمومی، بدونِ ورود**.
 *
 * ⚠️ این صفحه پشتِ `Protected` نیست و نباید باشد: بیمار حسابِ کاربری ندارد و
 * هرگز نخواهد داشت. پس هیچ چیزی این‌جا نمایش داده نمی‌شود جز آنچه خودِ صاحبِ
 * همین فرم پر کرده — سرور هم همان را برمی‌گرداند.
 *
 * دو گام است و عمداً دو نشانیِ جدا دارد:
 *   `/r/:linkToken` لینکِ دائمیِ شرکت (در بیو و کانال)
 *   `/f/:formToken` فرمِ همین بیمار (در پیامک)
 * یکی‌کردنشان یعنی لینکِ بیو، توکنِ یک بیمار را حمل کند.
 */
export default function Intake({ step }) {
  return step === 'register' ? <Register /> : <Form />;
}

/* ── گامِ ۱: اطلاعاتِ پایه + کپچا ───────────────────────────────── */
function Register() {
  const { token } = useParams();
  const [link, setLink] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ firstName: '', lastName: '', nationalId: '', phone: '', birthDate: '', address: '', referralSourceId: '', referralNote: '' });
  /* ⚠️ کانال‌ها از یک endpointِ **عمومی** می‌آیند که فقط نام و شناسه می‌دهد —
     نه تعدادِ بیمارِ هر کانال، که دادهٔ تجاریِ شرکت است و روی صفحهٔ بی‌احراز
     جایی ندارد. */
  const [sources, setSources] = useState([]);
  /* پرسشِ امنیتی را **سرور** می‌سازد: تصویرِ دو عدد + نشانی که پاسخ را رمزشده در خود دارد
     (`server/src/patients/intake-captcha.ts`). مرورگر پاسخ را نمی‌داند — تا دیروز خودش دو عدد را
     انتخاب می‌کرد و هر اسکریپتی با `1 + 1 = 2` ثبت‌نام می‌ساخت. هر نشان یک‌بار سنجیده می‌شود. */
  const [cap, setCap] = useState(null);
  const [capErr, setCapErr] = useState('');
  const [answer, setAnswer] = useState('');
  const loadCap = useCallback(() => {
    setCapErr(''); setAnswer('');
    return api(`/public/intake/link/${token}/captcha`, { auth: false })
      .then(setCap)
      .catch((e) => { setCap(null); setCapErr(e.message); });
  }, [token]);

  /* عنوانِ زبانه با نامِ مطب — بیمار چند زبانه باز دارد و «ثبت‌نام» تنها معلوم نمی‌کرد کجاست. */
  useEffect(() => { document.title = link?.brand?.name ? `ثبت‌نام — ${link.brand.name}` : 'ثبت‌نام'; }, [link]);
  useEffect(() => {
    /* خطا بلعیده می‌شود: نبودِ فهرستِ کانال‌ها نباید جلوی ثبت‌نام را بگیرد —
       این یک پرسشِ اختیاری است، نه شرطِ پذیرش. */
    api('/public/referral-sources', { auth: false }).then(setSources).catch(() => {});
  }, []);
  useEffect(() => {
    /* `live`: پاسخِ اجرای کنارگذاشته (StrictMode، عوض‌شدنِ لینک) پرسشِ دوم نسازد — هر پرسش
       یک رسمِ تصویر روی سرور است و از سقفِ نرخِ همین نشانی کم می‌کند. */
    let live = true;
    api(`/public/intake/link/${token}`, { auth: false })
      .then((l) => { if (live) { setLink(l); loadCap(); } })
      .catch((e) => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [token, loadCap]);

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async () => {
    setErr(''); setBusy(true);
    try {
      const r = await api(`/public/intake/link/${token}/register`, {
        auth: false,
        method: 'POST',
        body: {
          ...f,
          nationalId: toEnDigits(f.nationalId),
          phone: toEnDigits(f.phone),
          // ⚠️ تاریخِ تولد هم مثلِ تاریخِ عمل: شمسی در مرورگر، ISO روی سیم.
          birthDate: f.birthDate.trim() ? jStrToIso(f.birthDate) : '',
          ...(f.referralSourceId ? { referralSourceId: Number(f.referralSourceId) } : {}),
          ...(f.referralNote.trim() ? { referralNote: f.referralNote.trim() } : {}),
          captchaToken: cap?.challenge ?? '', captchaAnswer: Number(toEnDigits(answer)) || 0,
        },
      });
      // از این‌جا به بعد، نشانیِ خودِ بیمار است — با replace تا دکمهٔ برگشت
      // بیمار را به فرمِ خالیِ ثبت‌نام برنگرداند.
      window.location.replace(`/f/${r.token}`);
    } catch (e) {
      setErr(e.message); setBusy(false);
      /* ۴۲۲ = نشان همین حالا مصرف شد (پاسخِ غلط یا منقضی) — پرسشِ تازه، نه ارسالِ دوباره. */
      if (e.status === 422) loadCap();
    }
  };

  if (err && !link) return <Shell><p className="ik-bad"><Alert width="16" height="16" /> {err}</p></Shell>;

  return (
    <Shell brand={link?.brand} title={link?.title} amount={link?.amount}>
      <div className="ik-grid">
        <Field label="نام *" value={f.firstName} onChange={set('firstName')} disabled={busy} />
        <Field label="نامِ خانوادگی *" value={f.lastName} onChange={set('lastName')} disabled={busy} />
        <Field label="کدِ ملی *" value={f.nationalId} onChange={set('nationalId')} disabled={busy} dir="ltr" inputMode="numeric" />
        <Field label="شمارهٔ موبایل *" value={f.phone} onChange={set('phone')} disabled={busy} dir="ltr" inputMode="numeric" placeholder="09xxxxxxxxx" />
        {/* JDate خودش برچسب دارد؛ پیچیدنش در label یعنی دو برچسب. */}
        <JDate className="ik-field" mode="birth" label="تاریخِ تولد" value={f.birthDate}
               onChange={(v) => setF((s) => ({ ...s, birthDate: v }))} disabled={busy} />
        <Field label="نشانی" value={f.address} onChange={set('address')} disabled={busy} />

        {/* ⚠️ «چطور با ما آشنا شدید» همین‌جا پرسیده می‌شود و نه در نظرسنجیِ
            بعدی: بیمار الان یادش هست چطور پیدایمان کرده. پرسیدنش هفته‌ها بعد
            جوابِ حدسی می‌گیرد — و این همان عددی است که تصمیمِ تبلیغات را
            می‌سازد. */}
        {sources.length > 0 && (
          <label className="ik-field">
            <span>چطور با ما آشنا شدید؟</span>
            <select
              value={f.referralSourceId}
              disabled={busy}
              onChange={(e) => setF((s2) => ({ ...s2, referralSourceId: e.target.value, referralNote: '' }))}
            >
              <option value="">— انتخاب کنید —</option>
              {sources.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
        )}
        {/* نامِ معرف فقط برای کانال‌هایی که معرف دارند — پرسیدنش از کسی که
            «اینستاگرام» زده، سؤالِ بی‌جواب است. */}
        {sources.find((o) => String(o.id) === String(f.referralSourceId))?.asksWho && (
          <Field label="نامِ معرف" value={f.referralNote} onChange={set('referralNote')} disabled={busy} />
        )}
      </div>

      <div className="ik-cap">
        <span id="ik-cap-q">برای اطمینان از اینکه ربات نیستید، حاصلِ جمعِ دو عددِ تصویر را بنویسید:</span>
        <div className="ik-cap-row">
          {cap
            ? <img className="ik-cap-img" src={cap.image} width="180" height="64" alt="پرسشِ امنیتی: جمعِ دو عدد" />
            : <span className="ik-cap-img ik-cap-empty" role={capErr ? 'alert' : undefined}>{capErr || 'در حالِ بارگذاری…'}</span>}
          <button type="button" className="ik-cap-new" onClick={loadCap} disabled={busy} aria-label="پرسشِ دیگر" title="پرسشِ دیگر">
            <Refresh width="17" height="17" />
          </button>
          <input dir="ltr" inputMode="numeric" aria-labelledby="ik-cap-q" value={answer}
                 onChange={(e) => setAnswer(e.target.value)} disabled={busy || !cap} />
        </div>
      </div>

      {err && <p className="ik-bad"><Alert width="15" height="15" /> {err}</p>}
      <button type="button" className="ik-go" disabled={busy || !cap} onClick={submit}>
        {busy ? 'در حال ثبت…' : 'ادامه'}
      </button>
    </Shell>
  );
}

/* ── گامِ ۲: اطلاعاتِ مراجعه + فیش ──────────────────────────────── */

/** شناسهٔ فیش‌های این ثبت‌نام — `receiptDocumentIds` (چندتایی) با سازگاریِ عقب‌روِ کلیدِ تکی. */
const receiptsOf = (d) => {
  const ids = d?.data?.receiptDocumentIds;
  if (Array.isArray(ids)) return ids.filter(Boolean);
  return d?.data?.receiptDocumentId ? [d.data.receiptDocumentId] : [];
};

/**
 * مرحله‌های نوارِ بالای فرم — از **وضعیتِ واقعیِ مسیر** که سرور می‌فرستد، نه یک
 * فهرستِ ثابت.
 *
 * ⚠️ تا دیروز سه مرحلهٔ ثابت بود («اطلاعاتِ عمل ← فیشِ واریزی ← بررسیِ ما») برای
 * هر فرمی: نظرسنجیِ رایگان هم «فیش» را نشان می‌داد و بعدش تیک می‌خورد — یعنی
 * بیمار فیشی را «انجام‌شده» می‌دید که هرگز نفرستاده بود (D10a).
 *
 * قاعدهٔ «فیش لازم است» همان قاعدهٔ `fill()` سرور است: مبلغِ قابلِ پرداخت صفر
 * نیست، یا فرم کادرِ پرداخت دارد (خطای پیکربندی که عمداً فیش می‌خواهد). وضعیتِ
 * خودِ ثبت‌نام هم شمرده می‌شود تا ثبت‌نامی که همین حالا در مرحلهٔ فیش است —
 * مثلاً تخفیف مبلغش را صفر کرده — مرحله‌اش گم نشود. فرمِ زیرپروندهٔ رایگان
 * صفِ بررسی هم ندارد (سرور مستقیم تأیید می‌کند)، پس مرحلهٔ آخرش «ثبت شد» است.
 */
function stepsFor(d) {
  const S = PATIENT.intake.step;
  const makesVisit = d.makesVisit !== false;
  const hasPaymentBox = !!d.form?.fields?.some((x) => x.type === 'payment');
  const needsReceipt = (d.payable ?? d.amount ?? 0) > 0 || hasPaymentBox
    || d.status === 'pending_payment' || receiptsOf(d).length > 0;
  const needsReview = makesVisit || needsReceipt || d.status === 'pending_approval';
  const steps = [{ key: 'pending_fill', label: makesVisit ? S.fill : S.answer }];
  if (needsReceipt) steps.push({ key: 'pending_payment', label: S.receipt });
  steps.push(needsReview ? { key: 'pending_approval', label: S.review } : { key: 'approved', label: S.saved });
  return steps;
}

function Form() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ procedure: '', surgeonName: '', hospitalName: '', opDate: '', notes: '' });
  /* پاسخِ فیلدهای **دلخواهِ** فرمِ ساخته‌شده — جدا از `f` که فیلدهای ثابت است. */
  const [vals, setVals] = useState({});
  const [vErr, setVErr] = useState({});
  const [page, setPage] = useState(1);
  const [code, setCode] = useState('');
  /* بیمار همین حالا فیش می‌گذارد — تا خودش «تمام شد» نزده، کادرِ فیش سرِ جایش می‌ماند.
     ⚠️ مالک (۱۴۰۵/۰۷/۰۵): «بعد از انتخابِ اولین عکسِ واریز فرم خودبه‌خود به مرحلهٔ بعد می‌رود و
     اجازهٔ چند عکس نمی‌دهد». سرور با اولین فیش ثبت‌نام را به صفِ بررسی می‌فرستد (درست است: کارکنان
     باید ببینندش) و این صفحه تا دیروز همان لحظه کادر را برمی‌داشت. */
  const [addingReceipts, setAddingReceipts] = useState(false);
  /* پیش‌نمایشِ فیش‌هایی که **در همین صفحه** رفته‌اند (شناسهٔ سند → نشانیِ blob) تا بیمار ببیند کدام
     عکس را برمی‌دارد؛ پس از تازه‌کردنِ صفحه نشانِ ساده جایش می‌نشیند (سرور نشانیِ عمومیِ فیش ندارد). */
  const [thumbs, setThumbs] = useState({});
  const thumbsRef = useRef(thumbs);
  thumbsRef.current = thumbs;
  useEffect(() => () => { Object.values(thumbsRef.current).forEach((u) => URL.revokeObjectURL(u)); }, []);
  const fileRef = useRef(null);
  /* W1.8 — پیش‌نویس. `idle` | `saving` | `saved` | `offline`.
     ⚠️ هیچ‌چیز در `localStorage` نمی‌نشیند (قرارداد §۶): این فرم دادهٔ پزشکیِ
     بیمار را دارد و مرورگرِ مشترک/عمومی همان‌جا لو می‌دهدش. تنها جای ذخیره
     خودِ سرور است. */
  const [draftState, setDraftState] = useState('idle');
  const draftTimer = useRef(null);
  const draftSeq = useRef(0);
  /* نسخهٔ هر ذخیره (پیش‌نویس یا ثبت) — عددِ صعودی. سرور پیش‌نویسِ دیررس را روی ذخیرهٔ
     تازه‌تر نمی‌نشاند (`SAVE_REV` در `intake.service.ts`)، حالا که برخورد را به‌جای رد
     کردن روی نسخهٔ تازه دوباره اجرا می‌کند. */
  const lastRev = useRef(0);
  const nextRev = () => { lastRev.current = Math.max(Date.now(), lastRev.current + 1); return lastRev.current; };

  useEffect(() => { document.title = d?.brand?.name ? `فرمِ مراجعه — ${d.brand.name}` : 'فرمِ مراجعه'; }, [d?.brand?.name]);
  const load = useCallback(async () => {
    try {
      const r = await api(`/public/intake/form/${token}`, { auth: false });
      setD(r);
      setF((s) => ({
        procedure: r.data?.procedure ?? s.procedure,
        surgeonName: r.data?.surgeonName ?? s.surgeonName,
        hospitalName: r.data?.hospitalName ?? s.hospitalName,
        /* ⚠️ برگشت هم باید تبدیل شود: سرور ISO می‌دهد و `JDate` شمسی
           می‌خواهد. بدونِ این، بیمار فرم را نیمه‌کاره رها می‌کرد و در
           بازگشت «۲۰۲۶-۰۸-۰۵» در فیلدِ تاریخ می‌دید. */
        opDate: r.data?.opDate ? isoToJStr(r.data.opDate) : s.opDate,
        notes: r.data?.patientNotes ?? s.notes,
      }));
      /* مقادیرِ فیلدهای دلخواه هم از `data` برمی‌گردند — بیمار فرم را نیمه‌کاره
         رها می‌کند و باید در بازگشت همان‌جا ادامه بدهد، نه از صفر. */
      if (r.form?.fields?.length) {
        setVals((s) => {
          const next = { ...s };
          for (const fl of r.form.fields) {
            if (r.data?.[fl.key] !== undefined && next[fl.key] === undefined) next[fl.key] = r.data[fl.key];
          }
          return next;
        });
      }
      /* W1.8: همان صفحه‌ای که بیمار رویش بود، نه صفحهٔ یک. `_page` را سرور
         نگه داشته (قرارداد §۶) — مقدارِ بیرون از بازه نادیده گرفته می‌شود تا
         دادهٔ خراب صفحهٔ خالی نسازد. */
      const savedPage = Number(r.data?._page);
      const pageCount = r.form?.pages ?? 1;
      if (Number.isInteger(savedPage) && savedPage >= 1 && savedPage <= pageCount) setPage(savedPage);
    } catch (e) { setErr(e.message); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  /**
   * ذخیرهٔ پیش‌نویس روی سرور — W1.8.
   *
   * ⚠️ «توکنِ ذخیره» لازم است چون دو ذخیره می‌توانند از هم سبقت بگیرند: پاسخِ
   * دیررسِ ذخیرهٔ قبلی نباید «ذخیره شد» را روی ذخیرهٔ در جریان بنشاند و بیمار
   * را مطمئن کند در حالی که آخرین تایپش هنوز نرفته.
   *
   * شکستِ ذخیره **هرگز** فرم را نمی‌شکند: بیمار به تایپ ادامه می‌دهد و ثبتِ
   * نهایی مسیرِ خودش را دارد؛ فقط نشانگر می‌گوید اتصال قطع است.
   */
  const saveDraft = useCallback(async (nextPage) => {
    const seq = ++draftSeq.current;
    setDraftState('saving');
    try {
      await api(`/public/intake/form/${token}/draft`, {
        method: 'POST', auth: false,
        body: { values: vals, rev: nextRev(), ...(nextPage ? { page: nextPage } : {}) },
      });
      if (seq === draftSeq.current) setDraftState('saved');
    } catch {
      if (seq === draftSeq.current) setDraftState('offline');
    }
  }, [token, vals]);

  /* روی blur، با مکثِ ۱٫۵ ثانیه (قرارداد §۶) — نه به‌ازای هر حرف. */
  const draftSoon = useCallback(() => {
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => saveDraft(), 1500);
  }, [saveDraft]);
  useEffect(() => () => clearTimeout(draftTimer.current), []);

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  /**
   * شماره‌هایی که باکسِ پرداختِ فرم نشان می‌دهد.
   *
   * ⚠️ **اولین** حسابِ `payTo` است، نه همه: وقتی لینک حساب دارد سرور دقیقاً
   * یکی برمی‌گرداند؛ وقتی ندارد فهرستِ سراسری می‌آید و باکس اولی را نشان
   * می‌دهد، در حالی که بخشِ «واریز به» پایین‌تر همه را فهرست می‌کند. دو فهرستِ
   * کامل در یک صفحه فقط شلوغی است.
   */
  const payInfo = d?.payTo?.length
    ? {
      bank: d.payTo[0].bankName,
      holder: d.payTo[0].ownerName,
      accountNumber: d.payTo[0].accountNumber,
      cardNumber: d.payTo[0].cardNumber,
      iban: d.payTo[0].iban,
    }
    : null;

  const saveFill = async () => {
    setErr(''); setBusy(true);
    /* ثبت همهٔ پاسخ‌ها را می‌برد؛ ذخیرهٔ خودکارِ در صف دیگر فقط یک نوشتنِ اضافه بود که
       با همین ثبت هم‌زمان می‌رسید. */
    clearTimeout(draftTimer.current);
    /* ⚠️ تاریخ **شمسی فقط در مرورگر** زندگی می‌کند؛ روی سیم همیشه ISO می‌رود.
       تا دیروز `f` خام فرستاده می‌شد، یعنی «۱۴۰۵/۰۵/۱۴» به سرور می‌رسید و
       سرور آن را سالِ ۱۴۰۵ **میلادی** می‌فهمید — و مراجعه بی‌سروصدا شش قرن
       عقب ثبت می‌شد. هیچ خطایی نمی‌داد؛ فقط از تقویم و گزارش‌ها غیب می‌شد. */
    const body = { ...f, opDate: f.opDate.trim() ? jStrToIso(f.opDate) : '', values: vals, hospitalId: vals.hospitalId, rev: nextRev() };
    try { setD(await api(`/public/intake/form/${token}/fill`, { auth: false, method: 'POST', body })); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  /**
   * ذخیره‌ی فرمِ ساخته‌شده.
   *
   * ⚠️ اعتبارسنجیِ کلاینت **قبل** از رفتن به صفحهٔ بعد اجرا می‌شود، ولی فقط
   * روی فیلدهای همان صفحه: خطای فیلدی که هنوز دیده نشده، کاربر را سردرگم
   * می‌کند. سرور در پایان همه را دوباره می‌سنجد — این‌جا فقط زودتر است.
   */
  const nextPage = () => {
    const here = (d.form?.fields ?? []).filter((x) => (x.page ?? 1) === page);
    const e = dynErrors(here, vals);
    setVErr(e);
    if (Object.keys(e).length) return;
    const next = page + 1;
    setPage(next);
    /* ذخیره **با** شمارهٔ صفحهٔ تازه: رفرشِ بعدی باید همان‌جا برگردد نه یک
       صفحه عقب‌تر. مکثِ blur لغو می‌شود تا دو ذخیرهٔ پشت‌سرهم نرود. */
    clearTimeout(draftTimer.current);
    saveDraft(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const saveForm = async () => {
    const e = dynErrors(d.form?.fields ?? [], vals);
    setVErr(e);
    if (Object.keys(e).length) {
      /* برو به اولین صفحه‌ای که خطا دارد، وگرنه کاربر یک پیامِ خطا می‌بیند
         بدونِ اینکه بداند کدام کادر را باید پر کند. */
      const bad = (d.form.fields ?? []).find((x) => e[x.key]);
      if (bad) setPage(bad.page ?? 1);
      return;
    }
    await saveFill();
  };

  /**
   * آپلودِ عکسِ یک باکسِ عکس.
   *
   * ⚠️ پاسخِ سرور کلِ نمای فرم است، پس `setD` می‌کنیم و مقدارِ فیلد را هم از
   * همان `data` برمی‌داریم — منبعِ حقیقت سرور است، نه چیزی که مرورگر حدس زد.
   */
  const uploadImage = async (file, field) => {
    const fd = new FormData();
    fd.append('file', file);
    const fresh = await apiUpload(`/public/intake/form/${token}/image/${encodeURIComponent(field.key)}`, fd);
    setD(fresh);
    /* از #۶۶ مقدارِ فیلد آرایه است؛ به کادر **همان موردِ تازه** برگردانده
       می‌شود (قراردادش یک ref است) ولی مقدارِ ذخیره‌شده همانی است که سرور
       گفته — منبعِ حقیقت سرور است، نه حدسِ مرورگر. */
    const ref = fresh?.data?.[field.key];
    const listNow = Array.isArray(ref) ? ref : ref ? [ref] : [];
    setVals((s) => ({ ...s, [field.key]: listNow }));
    return listNow[listNow.length - 1] ?? {};
  };

  /**
   * توضیحِ صوتیِ یک ردیفِ لینک (بستهٔ ۶د) — بیمار زیرِ لینکِ MRI می‌گوید
   * رادیولوژیست چه گفت. سرور فقط WAVِ همین ضبط‌کننده را می‌پذیرد و ارجاعش
   * داخلِ همان ردیفِ لینک می‌نشیند (ذخیرهٔ فرم، مثلِ بقیهٔ پاسخ‌ها).
   */
  const uploadVoice = async (file, field) => {
    const fd = new FormData();
    fd.append('file', file);
    return apiUpload(`/public/intake/form/${token}/voice/${encodeURIComponent(field.key)}`, fd);
  };

  /** برداشتنِ یک عکس از همان کادر — سمتِ سرور هم پاک شود. */
  const removeImage = async (ref, field) => {
    const fresh = await api(
      `/public/intake/form/${token}/image/${encodeURIComponent(field.key)}/${ref.id}`,
      { auth: false, method: 'DELETE' },
    );
    setD(fresh);
    const v = fresh?.data?.[field.key];
    setVals((s) => ({ ...s, [field.key]: Array.isArray(v) ? v : v ? [v] : [] }));
  };

  const applyCode = async () => {
    setErr(''); setBusy(true);
    try { setD(await api(`/public/intake/form/${token}/discount`, { auth: false, method: 'POST', body: { code: code.trim() } })); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  /* ⚠️ خطا **پرتاب** می‌شود تا همان فایل در فهرستِ کادر قرمز شود؛ پیامِ
     سراسری معلوم نمی‌کرد کدام فیش نرفته. */
  const sendReceipt = async (file) => {
    /* پیش از ارسال: پاسخی که وضعیت را «در انتظارِ بررسی» می‌کند نباید کادر را زیرِ پای صفِ
       آپلودِ چندفایلی بردارد. */
    setAddingReceipts(true);
    const fd = new FormData();
    fd.append('file', file);
    const next = await apiUpload(`/public/intake/form/${token}/receipt`, fd);
    /* سرور فیشِ تازه را ته فهرست می‌گذارد (`attachReceipt`). ⚠️ `at(-1)` نه: صفحهٔ بیمار روی
       گوشی‌های قدیمی (سافاریِ پیش از ۱۵٫۴) هم باز می‌شود. */
    const ids = receiptsOf(next);
    const id = ids[ids.length - 1];
    if (id && file.type.startsWith('image/')) setThumbs((t) => ({ ...t, [id]: URL.createObjectURL(file) }));
    setD(next);
  };
  const removeReceipt = async (docId) => {
    setErr('');
    try {
      setD(await api(`/public/intake/form/${token}/receipt/${docId}`, { auth: false, method: 'DELETE' }));
      setThumbs((t) => {
        if (!t[docId]) return t;
        URL.revokeObjectURL(t[docId]);
        const rest = { ...t };
        delete rest[docId];
        return rest;
      });
    }
    catch (e) { setErr(e.message); }
  };

  if (err && !d) return <Shell><p className="ik-bad"><Alert width="16" height="16" /> {err}</p></Shell>;
  if (!d) return <Shell><p className="ik-note">در حال بارگذاری…</p></Shell>;

  const done = d.status === 'approved';
  const rejected = d.status === 'rejected';
  const expired = d.status === 'expired';
  const makesVisit = d.makesVisit !== false;
  const receipts = receiptsOf(d);
  const steps = stepsFor(d);
  /* کادرِ فیش: مرحلهٔ پرداخت، یا بیماری که همین حالا فیش می‌گذارد (وضعیت دیگر «در انتظارِ بررسی»
     است ولی او هنوز «تمام شد» نزده). */
  const payOpen = d.status === 'pending_payment' || (d.status === 'pending_approval' && addingReceipts);
  /* «تأییدشده» یعنی همهٔ مرحله‌ها پشتِ سر است — نه یک مرحلهٔ جاریِ دیگر. */
  const stepIdx = done ? steps.length : steps.findIndex((s) => s.key === (payOpen ? 'pending_payment' : d.status));
  const T = PATIENT.intake;
  /* فرمی که مرحلهٔ واریز دارد «ثبت و مرحلهٔ بعد» می‌گوید (همان استپر تصمیم
     می‌گیرد، نه یک شرطِ دوم که بتواند از آن جدا بیفتد). */
  const paidNext = steps.some((x) => x.key === 'pending_payment');
  /* کادرِ بیمارستان جدا از `DynForm` کشیده می‌شود (جست‌وجو با پیشنهاد)، ولی برچسب، ستاره و
     روشن/خاموشش همان فیلدِ فرم‌ساز است. */
  const hospitalField = d.form?.fields?.find((x) => x.key === 'hospitalName' && x.active !== false && (x.page ?? 1) === page);
  const submitLabel = paidNext ? T.submit.paid : makesVisit ? T.submit.visit : T.submit.record;

  return (
    <Shell brand={d.brand} title={`${d.data?.firstName ?? ''} ${d.data?.lastName ?? ''}`.trim()} amount={d.amount}>
      {/* نوارِ مرحله — بیمار باید بداند کجای کار است و چه چیزی مانده؛ و در
          پایان، اینکه چیزی نمانده. مرحله‌ها از وضعیتِ همین فرم ساخته می‌شوند. */}
      {!rejected && !expired && (
        <ol className="ik-steps">
          {steps.map((s, i) => (
            <li key={s.key} className={i < stepIdx ? 'ok' : i === stepIdx ? 'now' : ''}>
              <i>{i < stepIdx ? <CheckCircle width="13" height="13" /> : faNum(i + 1)}</i>{s.label}
            </li>
          ))}
        </ol>
      )}

      {/* برگشت برای اصلاح (مالک، ۱۴۰۵/۰۷/۰۱): بیمار باید بداند **کدام بخش** و **چرا** — نه فقط
          یک یادداشت. مرحله و راهنما از سرور (`intake-return.ts`) می‌آیند. */}
      {d.returned ? (
        <div className="ik-returned" role="status">
          <b><Alert width="15" height="15" /> برای اصلاح برگشت خورد — {d.returned.stageLabel}</b>
          <p>{d.returned.note}</p>
          <small>{d.returned.hint}</small>
        </div>
      ) : d.reviewNote && !done && (
        <p className="ik-warn"><Alert width="15" height="15" /> {d.reviewNote}</p>
      )}

      {done && (
        <p className="ik-good">
          {/* پرچمِ «مراجعه می‌سازد» از سرور می‌آید؛ متن از واژه‌نامهٔ بیمار. */}
          <CheckCircle width="16" height="16" /> {makesVisit ? T.approved.visit : T.approved.record}
        </p>
      )}
      {rejected && <p className="ik-bad"><Alert width="16" height="16" /> {d.reviewNote || T.rejected}</p>}
      {expired && <p className="ik-bad"><Clock width="16" height="16" /> {T.expired}</p>}

      {/* ⚠️ **فرمِ ساخته‌شده جایگزینِ فیلدهای هاردکد می‌شود، نه اضافه بر آن.**
          اگر هر دو رندر می‌شدند، بیمار «نوعِ عمل» را دو بار می‌دید — یک بار
          هاردکد و یک بار همان فیلد در فرمِ ساخته‌شده.
          لینکِ بدونِ فرم (`d.form === null`) دقیقاً همان صفحهٔ امروز را
          می‌بیند — همهٔ لینک‌های موجود این‌طورند. */}
      {/* ⚠️ نوبت **قبل از** فرم می‌آید: روزِ نوبت چیزی است که بیمار برایش
          آمده، و گذاشتنش بعد از یک فرمِ بلند یعنی کسی که فرم را نیمه رها
          می‌کند اصلاً نوبتی نگرفته. نصبی که برنامهٔ کاری ندارد این بخش را
          اصلاً نمی‌بیند (`booking.required === false`). */}
      {(d.status === 'pending_fill' || d.status === 'pending_payment') && d.booking?.required && (
        <BookingPick token={token} booking={d.booking} disabled={busy} onBooked={setD} />
      )}

      {(d.status === 'pending_fill' || d.status === 'pending_payment') && (
        d.form?.fields?.length ? (
          <>
            {d.form.hint && <p className="ik-hint">{d.form.hint}</p>}
            <div className="ik-pagerow">
              {d.form.pages > 1 && (
                <p className="ik-pages">صفحهٔ {faNum(page)} از {faNum(d.form.pages)}</p>
              )}
              {/* W1.8 — بیمار باید **ببیند** که نوشته‌اش جایی رفته. بدونِ این،
                  ذخیرهٔ خودکار از نبودش قابلِ تشخیص نیست. */}
              {draftState !== 'idle' && (
                <span className={`ik-draft ${draftState}`} role="status" aria-live="polite">
                  {draftState === 'saving' ? 'در حالِ ذخیره…'
                    : draftState === 'saved' ? 'ذخیره شد'
                      : 'اتصال قطع است — تا وصل شدن این صفحه را نبندید'}
                </span>
              )}
            </div>
            {hospitalField && (
              <HospitalLookup
                token={token} label={hospitalField.label} required={!!hospitalField.required}
                value={vals.hospitalName ?? ''} disabled={busy} error={vErr.hospitalName}
                onChange={(name, id) => setVals((s) => ({ ...s, hospitalName: name, hospitalId: id }))}
              />
            )}
            {/* ذخیرهٔ خودکار روی blur. `onBlur` در ری‌اکت **حباب می‌کند**، پس
                این یک لایه کافی است و `DynForm`ِ مشترک دست نمی‌خورد. */}
            <div onBlur={draftSoon}>
            <DynForm
              fields={d.form.fields.filter((x) => (x.page ?? 1) === page && x.key !== 'hospitalName')}
              values={vals}
              errors={vErr}
              onChange={setVals}
              disabled={busy}
              payment={payInfo}
              onUpload={uploadImage}
              onRemove={removeImage}
              onVoice={uploadVoice}
            />
            </div>
            <div className="ik-nav">
              {page > 1 && (
                <button type="button" className="ik-go ghost" disabled={busy}
                        onClick={() => { setPage((p) => p - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                  قبلی
                </button>
              )}
              {page < (d.form.pages ?? 1) ? (
                <button type="button" className="ik-go" disabled={busy} onClick={nextPage}>بعدی</button>
              ) : (
                <button type="button" className="ik-go ghost" disabled={busy} onClick={saveForm}>
                  {busy ? 'در حال ذخیره…' : submitLabel}
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="ik-grid">
              <Field label="نوعِ عمل" value={f.procedure} onChange={set('procedure')} disabled={busy} />
              <Field label="نامِ جراح" value={f.surgeonName} onChange={set('surgeonName')} disabled={busy} />
              <HospitalLookup token={token} value={f.hospitalName} onChange={(name, id) => { setF(s => ({ ...s, hospitalName: name })); setVals(s => ({ ...s, hospitalId: id })); }} disabled={busy} />
              <JDate className="ik-field" label="تاریخِ عمل" value={f.opDate}
                     onChange={(v) => setF((s) => ({ ...s, opDate: v }))} disabled={busy} />
            </div>
            <label className="ik-field">
              <span>توضیح (اختیاری)</span>
              <textarea rows={2} value={f.notes} onChange={set('notes')} disabled={busy} />
            </label>
            <button type="button" className="ik-go ghost" disabled={busy} onClick={saveFill}>
              {busy ? 'در حال ذخیره…' : submitLabel}
            </button>
          </>
        )
      )}

      {payOpen && (
        <div className="ik-pay">
          {/* ⚠️ ترتیب: **اول چقدر، بعد به کجا.** نسخهٔ اول شماره‌حساب‌ها را
              بالای مبلغ می‌گذاشت و بیمار پیش از دانستنِ عدد با فهرستِ کارت
              روبه‌رو می‌شد؛ و مبلغ زیرِ فهرست، خارج از دیدِ صفحه می‌افتاد.
              کدِ تخفیف هم باید همان‌جا کنارِ مبلغ باشد، وگرنه بعد از دیدنِ
              کارت‌ها دیگر دنبالش نمی‌گردد. */}
          <p className="ik-note">
            <Box width="15" height="15" /> مبلغِ قابلِ پرداخت: <b>{faNum(d.payable ?? d.amount)} تومان</b>
            {d.discountAmount > 0 && (
              <em className="ik-off">({faNum(d.discountAmount)} تومان تخفیف با کدِ {d.discountCode})</em>
            )}
          </p>
          {/* ⚠️ فقط کد فرستاده می‌شود؛ مبلغ را سرور حساب می‌کند. */}
          {!d.discountCode && (
            <div className="ik-code">
              <input value={code} onChange={(e) => setCode(e.target.value)} disabled={busy} placeholder="کدِ تخفیف (اختیاری)" />
              <button type="button" disabled={busy || code.trim().length < 3} onClick={applyCode}>اعمال</button>
            </div>
          )}
          {/* توضیحِ شرکت دربارهٔ واریز — یک متن برای همهٔ لینک‌ها (تنظیمات → پذیرشِ آنلاین). */}
          {d.paymentNote && (
            <p className="ik-note ik-pay-note"><Bank width="15" height="15" /> {d.paymentNote}</p>
          )}
          {/* ⚠️ بدونِ شمارهٔ حساب، بیمار مبلغ را می‌دید ولی نمی‌دانست به کجا
              بریزد — و فیشی که آپلود می‌کرد به حسابِ ما نبود. */}
          {d.payTo?.length > 0 ? (
            <div className="ik-pay-to">
              <b>واریز به:</b>
              {d.payTo.map((a) => <BankCard key={a.id} acc={a} />)}
            </div>
          ) : (
            <div className="ik-warn ik-warn-call">
              <p><Alert width="15" height="15" /> شمارهٔ حسابی تنظیم نشده — پیش از واریز تماس بگیرید.</p>
              <CallLink phone={d.brand?.phone} label={d.brand?.name ? `تماس با ${d.brand.name}` : 'تماس'} />
            </div>
          )}
          {/* فیش هم چندتایی است: دو قسط، یا عکسِ ناخوانا که دوباره فرستاده
              می‌شود. کادر همان کادرِ مشترکِ سامانه است. */}
          <FileDrop
            accept="image/*,application/pdf"
            maxMb={8}
            disabled={busy}
            label="آپلودِ فیشِ واریزی"
            hint="عکس یا PDFِ فیش — تا ۸ مگابایت؛ چند فیش هم می‌شود گذاشت"
            keepDone={false}
            onUpload={sendReceipt}
          />
          {receipts.length > 0 && (
            <div className="ik-receipts">
              {/* فهرستِ **سروری**ِ فیش‌ها — تنها فهرست (کادرِ بالا فقط صف و خطا را نشان می‌دهد). */}
              {receipts.map((id, i) => (
                <span className="ik-receipt-row" key={id}>
                  {thumbs[id]
                    ? <img src={thumbs[id]} alt="" className="ik-receipt-thumb" />
                    : <span className="ik-receipt-thumb" aria-hidden="true"><Bank width="16" height="16" /></span>}
                  <b>فیشِ {faNum(i + 1)}</b>
                  <button type="button" onClick={() => removeReceipt(id)} aria-label={`حذفِ فیشِ ${faNum(i + 1)}`}>حذف</button>
                </span>
              ))}
            </div>
          )}
          {/* بیمار خودش می‌گوید کارش با فیش تمام شده — نه اولین آپلود به جای او. */}
          {receipts.length > 0 && d.status === 'pending_approval' && (
            <div className="ik-receipt-done">
              <p className="ik-note"><CheckCircle width="15" height="15" /> {T.receiptsIn(receipts.length)}</p>
              <button type="button" className="ik-go" onClick={() => setAddingReceipts(false)}>{T.receiptsDone}</button>
            </div>
          )}
        </div>
      )}

      {d.status === 'pending_approval' && !payOpen && (
        <>
          <p className="ik-note">
            {/* ⚠️ فرمِ رایگان فیش ندارد — «فیشِ شما دریافت شد» برای آن دروغ است
                و بیمار را دنبالِ فیشی می‌فرستد که هرگز نفرستاده. */}
            <Clock width="15" height="15" /> {receipts.length ? T.review.withReceipt : T.review.noReceipt}
          </p>
          {/* قسطِ دوم یا عکسِ خواناتر — تا کسی بررسی نکرده، راهِ برگشت به کادرِ فیش باز است. */}
          {receipts.length > 0 && (
            <button type="button" className="ik-go ghost" onClick={() => setAddingReceipts(true)}>{T.receiptsMore}</button>
          )}
        </>
      )}

      {err && <p className="ik-bad"><Alert width="15" height="15" /> {err}</p>}
    </Shell>
  );
}

/**
 * یک ردیفِ «شماره + کپی».
 *
 * ⚠️ دکمهٔ کپی تزئینی نیست: بیمار روی گوشی است و باید شمارهٔ کارت را در
 * اپِ بانکش بچسباند؛ تایپِ دستیِ ۱۶ رقم یعنی واریز به حسابِ اشتباه.
 * ارقام `dir="ltr"` و با فاصلهٔ چهارتایی نمایش داده می‌شوند ولی آنچه کپی
 * می‌شود **بدونِ فاصله** است، چون اپِ بانک فاصله را نمی‌پذیرد.
 */
function CopyRow({ label, value }) {
  const [done, setDone] = useState(false);
  const plain = plainOf(value);
  /* ⚠️ ارقامِ **نمایش** فارسی می‌شوند ولی آنچه کپی می‌شود لاتینِ بی‌فاصله
     می‌ماند: اپِ بانک نه فاصله می‌پذیرد نه رقمِ فارسی. */
  const pretty = faDigits(group4(plain));
  const copy = async () => {
    try { await navigator.clipboard.writeText(plain); setDone(true); setTimeout(() => setDone(false), 1600); }
    catch { /* مرورگرِ بدونِ clipboard: خودِ عدد روی صفحه هست */ }
  };
  return (
    <button type="button" className={`ik-copy${done ? ' ok' : ''}`} onClick={copy}>
      <span>{label}</span>
      <b dir="ltr">{pretty}</b>
      <i>{done ? 'کپی شد' : 'کپی'}</i>
    </button>
  );
}

/** فقط حروف و ارقامِ لاتین — همان چیزی که اپِ بانک می‌پذیرد. */
const plainOf = (v) => String(v ?? '').replace(/[^0-9A-Za-z]/g, '');
/**
 * گروه‌های چهارتایی برای **خواندن**: کارت و حساب اگر فقط رقم‌اند، شبا با `IR` و ۲۴
 * رقم — همان شکلی که بانک‌ها چاپش می‌کنند. شبا تا دیروز یک رشتهٔ ۲۶ نویسه‌ایِ
 * پیوسته بود و بیمار باید چشمی می‌شمرد.
 */
const group4 = (plain) => (/^\d+$/.test(plain) || /^IR\d{24}$/i.test(plain)
  ? plain.toUpperCase().replace(/(.{4})(?=.)/g, '$1 ')
  : plain);
const faDigits = (t) => String(t).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/**
 * کارتِ بانکیِ مقصد — همان شکلی که بیمار روی کارتِ خودش و در اپِ بانک می‌بیند.
 *
 * ⚠️ شکلِ کارت تزئین نیست: بیمار شماره را با آنچه در اپِ بانکش تایپ کرده مقایسه
 * می‌کند و ۱۶ رقمِ گروه‌بندی‌شده روی «کارت» خطای خواندن را کم می‌کند. ولی شکل را
 * نمی‌شود کپی کرد، پس خودِ کارت برای صفحه‌خوان پنهان است و **همان اطلاعات**
 * در ردیف‌های کپیِ زیرش هست — یک‌بار خوانده می‌شود، نه دو بار.
 *
 * ترتیبِ ردیف‌ها: کارت، شبا، حساب. ⚠️ شمارهٔ حساب سومین شماره است، نه هم‌معنیِ
 * کارت یا شبا: بیمارِ شعبه‌رو فقط با همین می‌تواند واریز کند.
 */
function BankCard({ acc }) {
  const card = plainOf(acc.cardNumber);
  return (
    <figure className="ik-bank">
      {card && (
        <div className="ik-bank-face" aria-hidden="true">
          <div className="ik-bank-top">
            <b>{acc.bankName || 'کارتِ بانکی'}</b>
            <span className="ik-bank-chip" />
          </div>
          <p className="ik-bank-num" dir="ltr">{faDigits(group4(card))}</p>
          {acc.ownerName && <span className="ik-bank-owner">{acc.ownerName}</span>}
        </div>
      )}
      <figcaption className="ik-acc">
        <span className="ik-acc-who">{[acc.ownerName, acc.bankName].filter(Boolean).join(' · ')}</span>
        {acc.cardNumber && <CopyRow label="شمارهٔ کارت" value={acc.cardNumber} />}
        {acc.iban && <CopyRow label="شبا" value={acc.iban} />}
        {acc.accountNumber && <CopyRow label="شمارهٔ حساب" value={acc.accountNumber} />}
      </figcaption>
    </figure>
  );
}

/* ── پوسته ─────────────────────────────────────────────────────── */
/**
 * سربرگ = **هویتِ مطب/شرکت**، نه نامِ نرم‌افزار (بازبینیِ UX، بندِ ۹۲).
 *
 * ⚠️ تا دیروز بالای فرم «عمل‌یار» بود (`data-brand-name` که هیچ کدی پرش نمی‌کرد): بیمار از
 * لینکِ «مطب دکتر رحیمی» می‌آمد، نامِ دیگری می‌دید که کدِ ملی و ۴۰ میلیون می‌خواهد، و ته صفحه
 * «به شرکت نوروپایش واریز کنید» — برای بیمارِ نگران یعنی کلاه‌برداری. حالا نام و تلفن از
 * پاسخِ خودِ صفحه می‌آید و «عمل‌یار» فقط کوچک در پاورقی است. نامِ نیامده (پاسخِ قدیمی)
 * «ثبت‌نام» می‌شود، هرگز «عمل‌یار».
 */
function Shell({ brand, title, amount, children }) {
  return (
    <div className="ik">
      <div className="ik-bg" aria-hidden="true" />
      <main className="ik-card">
        <header className="ik-head">
          <BrandMark brand={brand} />
          <div>
            <b>{brand?.name || 'ثبت‌نام'}</b>
            {title && <small>{title}</small>}
          </div>
          {amount > 0 && <span className="ik-amount">{faNum(amount)} تومان</span>}
        </header>
        {children}
        <PublicFoot brand={brand} />
      </main>
    </div>
  );
}

function Field({ label, dir = 'rtl', inputMode, placeholder, ...rest }) {
  return (
    <label className="ik-field">
      <span>{label}</span>
      <input type="text" dir={dir} inputMode={inputMode} placeholder={placeholder} {...rest} />
    </label>
  );
}
