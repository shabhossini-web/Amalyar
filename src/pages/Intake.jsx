import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, apiUpload } from '../lib/api.js';
import { isoToJStr, jStrToIso, toEnDigits } from '../lib/jalali.js';
import JDate from '../app/JDate.jsx';
import Mark from '../components/Mark.jsx';
import './intake.css';
import { Alert, Box, CheckCircle, Clock, Upload } from '../ui/icons.jsx';

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
  const [f, setF] = useState({ firstName: '', lastName: '', nationalId: '', phone: '', birthDate: '', address: '' });
  /* ⚠️ دو عددِ کپچا یک‌بار ساخته می‌شوند و در رندرِ بعدی عوض نمی‌شوند — با
     `useMemo` و نه در بدنهٔ تابع، وگرنه هر تایپِ کاربر عددها را عوض می‌کرد و
     پاسخِ درست هم غلط می‌شد. */
  const cap = useMemo(() => ({ a: 2 + Math.floor(Math.random() * 7), b: 1 + Math.floor(Math.random() * 6) }), []);
  const [answer, setAnswer] = useState('');

  useEffect(() => { document.title = 'ثبت‌نام'; }, []);
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
    } catch (e) { setErr(e.message); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const saveFill = async () => {
    setErr(''); setBusy(true);
    /* ⚠️ تاریخ **شمسی فقط در مرورگر** زندگی می‌کند؛ روی سیم همیشه ISO می‌رود.
       تا دیروز `f` خام فرستاده می‌شد، یعنی «۱۴۰۵/۰۵/۱۴» به سرور می‌رسید و
       سرور آن را سالِ ۱۴۰۵ **میلادی** می‌فهمید — و مراجعه بی‌سروصدا شش قرن
       عقب ثبت می‌شد. هیچ خطایی نمی‌داد؛ فقط از تقویم و گزارش‌ها غیب می‌شد. */
    const body = { ...f, opDate: f.opDate.trim() ? jStrToIso(f.opDate) : '' };
    try { setD(await api(`/public/intake/form/${token}/fill`, { auth: false, method: 'POST', body })); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const applyCode = async () => {
    setErr(''); setBusy(true);
    try { setD(await api(`/public/intake/form/${token}/discount`, { auth: false, method: 'POST', body: { code: code.trim() } })); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const sendReceipt = async (file) => {
    if (!file) return;
    setErr(''); setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      setD(await apiUpload(`/public/intake/form/${token}/receipt`, fd));
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
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
          <CheckCircle width="16" height="16" /> ثبت‌نامِ شما تأیید شد. برای هماهنگیِ نهایی با شما تماس می‌گیریم.
        </p>
      )}
      {rejected && <p className="ik-bad"><Alert width="16" height="16" /> {d.reviewNote || 'این ثبت‌نام تأیید نشد.'}</p>}
      {expired && <p className="ik-bad"><Clock width="16" height="16" /> مهلتِ این فرم تمام شده — دوباره از لینکِ ثبت‌نام شروع کنید.</p>}

      {(d.status === 'pending_fill' || d.status === 'pending_payment') && (
        <>
          <div className="ik-grid">
            <Field label="نوعِ عمل" value={f.procedure} onChange={set('procedure')} disabled={busy} />
            <Field label="نامِ جراح" value={f.surgeonName} onChange={set('surgeonName')} disabled={busy} />
            <Field label="بیمارستان" value={f.hospitalName} onChange={set('hospitalName')} disabled={busy} />
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
                  {a.iban && <CopyRow label="شبا" value={a.iban} />}
                </div>
              ))}
            </div>
          ) : (
            <p className="ik-warn">
              <Alert width="15" height="15" /> شمارهٔ حسابی تنظیم نشده — پیش از واریز با ما تماس بگیرید.
            </p>
          )}
          <input ref={fileRef} type="file" hidden accept="image/*,application/pdf"
                 onChange={(e) => { sendReceipt(e.target.files?.[0]); e.target.value = ''; }} />
          <button type="button" className="ik-go" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Upload width="16" height="16" /> {busy ? 'در حال ارسال…' : 'آپلودِ فیشِ واریزی'}
          </button>
        </div>
      )}

      {d.status === 'pending_approval' && (
        <p className="ik-note">
          <Clock width="15" height="15" /> فیشِ شما دریافت شد و در حالِ بررسی است. نتیجه از همین صفحه قابلِ پیگیری است.
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
