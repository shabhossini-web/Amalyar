import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import FileDrop from '../ui/FileDrop.jsx';
import { api, apiUpload } from '../lib/api.js';
import { isoToJStr, jStrToIso, toEnDigits } from '../lib/jalali.js';
import JDate from '../app/JDate.jsx';
import Mark from '../components/Mark.jsx';
import './intake.css';
import { Alert, Box, CheckCircle, Clock, Upload } from '../ui/icons.jsx';
import DynForm, { dynErrors } from '../ui/DynForm.jsx';
import HospitalLookup from '../ui/HospitalLookup.jsx';
import BookingPick from './BookingPick.jsx';

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
  /* ⚠️ دو عددِ کپچا یک‌بار ساخته می‌شوند و در رندرِ بعدی عوض نمی‌شوند — با
     `useMemo` و نه در بدنهٔ تابع، وگرنه هر تایپِ کاربر عددها را عوض می‌کرد و
     پاسخِ درست هم غلط می‌شد. */
  const cap = useMemo(() => ({ a: 2 + Math.floor(Math.random() * 7), b: 1 + Math.floor(Math.random() * 6) }), []);
  const [answer, setAnswer] = useState('');

  useEffect(() => { document.title = 'ثبت‌نام'; }, []);
  useEffect(() => {
    /* خطا بلعیده می‌شود: نبودِ فهرستِ کانال‌ها نباید جلوی ثبت‌نام را بگیرد —
       این یک پرسشِ اختیاری است، نه شرطِ پذیرش. */
    api('/public/referral-sources', { auth: false }).then(setSources).catch(() => {});
  }, []);
  useEffect(() => {
    api(`/public/intake/link/${token}`, { auth: false })
      .then(setLink)
      .catch((e) => setErr(e.message));
  }, [token]);

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
          captchaA: cap.a, captchaB: cap.b, captchaAnswer: Number(toEnDigits(answer)) || 0,
        },
      });
      // از این‌جا به بعد، نشانیِ خودِ بیمار است — با replace تا دکمهٔ برگشت
      // بیمار را به فرمِ خالیِ ثبت‌نام برنگرداند.
      window.location.replace(`/f/${r.token}`);
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  if (err && !link) return <Shell><p className="ik-bad"><Alert width="16" height="16" /> {err}</p></Shell>;

  return (
    <Shell title={link?.title} amount={link?.amount}>
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
        <span>برای اطمینان از اینکه ربات نیستید: <b dir="ltr">{faNum(cap.a)} + {faNum(cap.b)} = ?</b></span>
        <input dir="ltr" inputMode="numeric" value={answer} onChange={(e) => setAnswer(e.target.value)} disabled={busy} />
      </div>

      {err && <p className="ik-bad"><Alert width="15" height="15" /> {err}</p>}
      <button type="button" className="ik-go" disabled={busy} onClick={submit}>
        {busy ? 'در حال ثبت…' : 'ادامه'}
      </button>
    </Shell>
  );
}

/* ── گامِ ۲: اطلاعاتِ عمل + فیش ─────────────────────────────────── */
const STEPS = [
  { key: 'pending_fill', label: 'اطلاعاتِ عمل' },
  { key: 'pending_payment', label: 'فیشِ واریزی' },
  { key: 'pending_approval', label: 'بررسیِ ما' },
];

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
  const fileRef = useRef(null);

  useEffect(() => { document.title = 'فرمِ مراجعه'; }, []);
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
    } catch (e) { setErr(e.message); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

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
    /* ⚠️ تاریخ **شمسی فقط در مرورگر** زندگی می‌کند؛ روی سیم همیشه ISO می‌رود.
       تا دیروز `f` خام فرستاده می‌شد، یعنی «۱۴۰۵/۰۵/۱۴» به سرور می‌رسید و
       سرور آن را سالِ ۱۴۰۵ **میلادی** می‌فهمید — و مراجعه بی‌سروصدا شش قرن
       عقب ثبت می‌شد. هیچ خطایی نمی‌داد؛ فقط از تقویم و گزارش‌ها غیب می‌شد. */
    const body = { ...f, opDate: f.opDate.trim() ? jStrToIso(f.opDate) : '', values: vals, hospitalId: vals.hospitalId };
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
    setPage((p) => p + 1);
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
    const fd = new FormData();
    fd.append('file', file);
    setD(await apiUpload(`/public/intake/form/${token}/receipt`, fd));
  };
  const removeReceipt = async (docId) => {
    setErr('');
    try { setD(await api(`/public/intake/form/${token}/receipt/${docId}`, { auth: false, method: 'DELETE' })); }
    catch (e) { setErr(e.message); }
  };

  if (err && !d) return <Shell><p className="ik-bad"><Alert width="16" height="16" /> {err}</p></Shell>;
  if (!d) return <Shell><p className="ik-note">در حال بارگذاری…</p></Shell>;

  const stepIdx = STEPS.findIndex((s) => s.key === d.status);
  const done = d.status === 'approved';
  const rejected = d.status === 'rejected';
  const expired = d.status === 'expired';

  return (
    <Shell title={`${d.data?.firstName ?? ''} ${d.data?.lastName ?? ''}`.trim()} amount={d.amount}>
      {/* نوارِ مرحله — بیمار باید بداند کجای کار است و چه چیزی مانده. */}
      {!done && !rejected && !expired && (
        <ol className="ik-steps">
          {STEPS.map((s, i) => (
            <li key={s.key} className={i < stepIdx ? 'ok' : i === stepIdx ? 'now' : ''}>
              <i>{i < stepIdx ? <CheckCircle width="13" height="13" /> : faNum(i + 1)}</i>{s.label}
            </li>
          ))}
        </ol>
      )}

      {d.reviewNote && !done && (
        <p className="ik-warn"><Alert width="15" height="15" /> {d.reviewNote}</p>
      )}

      {done && (
        <p className="ik-good">
          {/* نظرسنجی/فرمِ زیرپرونده مراجعه نمی‌سازد و کسی تماس نمی‌گیرد —
              وعدهٔ تماسِ الکی بدتر از بی‌پیامی است. پرچم از سرور می‌آید. */}
          <CheckCircle width="16" height="16" /> {d.makesVisit === false
            ? 'پاسخِ شما ثبت شد — سپاس‌گزاریم.'
            : 'ثبت‌نامِ شما تأیید شد. برای هماهنگیِ نهایی با شما تماس می‌گیریم.'}
        </p>
      )}
      {rejected && <p className="ik-bad"><Alert width="16" height="16" /> {d.reviewNote || 'این ثبت‌نام تأیید نشد.'}</p>}
      {expired && <p className="ik-bad"><Clock width="16" height="16" /> مهلتِ این فرم تمام شده — دوباره از لینکِ ثبت‌نام شروع کنید.</p>}

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
            {d.form.pages > 1 && (
              <p className="ik-pages">صفحهٔ {faNum(page)} از {faNum(d.form.pages)}</p>
            )}
            {d.form.fields.some(x => x.key === 'hospitalName' && (x.page ?? 1) === page) && <HospitalLookup token={token} value={vals.hospitalName ?? ''} onChange={(name, id) => setVals(s => ({ ...s, hospitalName: name, hospitalId: id }))} disabled={busy} error={vErr.hospitalName} />}
            <DynForm
              fields={d.form.fields.filter((x) => (x.page ?? 1) === page && x.key !== 'hospitalName')}
              values={vals}
              errors={vErr}
              onChange={setVals}
              disabled={busy}
              payment={payInfo}
              onUpload={uploadImage}
              onRemove={removeImage}
            />
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
                  {busy ? 'در حال ذخیره…' : 'ذخیرهٔ اطلاعات'}
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
              {busy ? 'در حال ذخیره…' : 'ذخیرهٔ اطلاعات'}
            </button>
          </>
        )
      )}

      {d.status === 'pending_payment' && (
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
          {/* ⚠️ بدونِ شمارهٔ حساب، بیمار مبلغ را می‌دید ولی نمی‌دانست به کجا
              بریزد — و فیشی که آپلود می‌کرد به حسابِ ما نبود. */}
          {d.payTo?.length > 0 ? (
            <div className="ik-pay-to">
              <b>واریز به:</b>
              {d.payTo.map((a) => (
                <div key={a.id} className="ik-acc">
                  <span className="ik-acc-who">{[a.ownerName, a.bankName].filter(Boolean).join(' · ')}</span>
                  {a.cardNumber && <CopyRow label="شمارهٔ کارت" value={a.cardNumber} />}
                  {/* ⚠️ شمارهٔ حساب سومین شماره است، نه هم‌معنیِ کارت یا شبا:
                      بیمارِ شعبه‌رو فقط با همین می‌تواند واریز کند. */}
                  {a.accountNumber && <CopyRow label="شمارهٔ حساب" value={a.accountNumber} />}
                  {a.iban && <CopyRow label="شبا" value={a.iban} />}
                </div>
              ))}
            </div>
          ) : (
            <p className="ik-warn">
              <Alert width="15" height="15" /> شمارهٔ حسابی تنظیم نشده — پیش از واریز با ما تماس بگیرید.
            </p>
          )}
          {/* فیش هم چندتایی است: دو قسط، یا عکسِ ناخوانا که دوباره فرستاده
              می‌شود. کادر همان کادرِ مشترکِ سامانه است. */}
          <FileDrop
            accept="image/*,application/pdf"
            maxMb={8}
            disabled={busy}
            label="آپلودِ فیشِ واریزی"
            hint="عکس یا PDFِ فیش — تا ۸ مگابایت؛ چند فیش هم می‌شود گذاشت"
            onUpload={sendReceipt}
          />
          {(d.data?.receiptDocumentIds ?? (d.data?.receiptDocumentId ? [d.data.receiptDocumentId] : [])).length > 0 && (
            <div className="ik-receipts">
              {(d.data?.receiptDocumentIds ?? [d.data.receiptDocumentId]).map((id, i) => (
                <span className="ik-receipt-row" key={id}>
                  <b>فیشِ {i + 1}</b>
                  <button type="button" onClick={() => removeReceipt(id)}>حذف</button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {d.status === 'pending_approval' && (
        <p className="ik-note">
          {/* ⚠️ فرمِ رایگان فیش ندارد — «فیشِ شما دریافت شد» برای آن دروغ است
              و بیمار را دنبالِ فیشی می‌فرستد که هرگز نفرستاده. */}
          <Clock width="15" height="15" /> {d.data?.receiptDocumentId
            ? 'فیشِ شما دریافت شد و در حالِ بررسی است. نتیجه از همین صفحه قابلِ پیگیری است.'
            : 'اطلاعاتِ شما ثبت شد و در حالِ بررسی است. نتیجه از همین صفحه قابلِ پیگیری است.'}
        </p>
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
  const plain = String(value).replace(/[^0-9A-Za-z]/g, '');
  /* ⚠️ ارقامِ **نمایش** فارسی می‌شوند ولی آنچه کپی می‌شود لاتینِ بی‌فاصله
     می‌ماند: اپِ بانک نه فاصله می‌پذیرد نه رقمِ فارسی. */
  const grouped = /^\d+$/.test(plain) ? plain.replace(/(\d{4})(?=\d)/g, '$1 ') : plain;
  const pretty = grouped.replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
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

/* ── پوسته ─────────────────────────────────────────────────────── */
function Shell({ title, amount, children }) {
  return (
    <div className="ik">
      <div className="ik-bg" aria-hidden="true" />
      <main className="ik-card">
        <header className="ik-head">
          <Mark className="ik-mark" gradient aria-hidden="true" />
          <div>
            <b data-brand-name>عمل‌یار</b>
            {title && <small>{title}</small>}
          </div>
          {amount > 0 && <span className="ik-amount">{faNum(amount)} تومان</span>}
        </header>
        {children}
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
