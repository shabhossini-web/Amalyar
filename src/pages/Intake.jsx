import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import FileDrop from '../ui/FileDrop.jsx';
import { api, apiUpload } from '../lib/api.js';
import { faDate, isoToJStr, jStrToIso, toEnDigits, ymdToJStr } from '../lib/jalali.js';
import { isValidNationalId } from '../lib/identity.js';
import JDate from '../app/JDate.jsx';
import './intake.css';
import { Alert, Bank, Box, Calendar, Caret, CheckCircle, Clock, Info, Lock, Money, Pencil, Refresh, Upload } from '../ui/icons.jsx';
import { PATIENT } from '../lib/terms.js';
import DynForm, { dynErrors } from '../ui/DynForm.jsx';
import HospitalLookup from '../ui/HospitalLookup.jsx';
import BookingPick from './BookingPick.jsx';
import { BrandMark, CallLink, PublicError, PublicFoot, RetryButton, faPhone, loadErrorText, telHref, useFallbackFace } from './PublicBits.jsx';
import { adoptFace } from '../lib/public-face.js';

const faNum = (n) => Number(n ?? 0).toLocaleString('fa-IR');
/**
 * مقدارِ ذخیره‌شدهٔ کادرِ «تاریخ» ← شمسیِ کادرِ `JDate`.
 *
 * هشدار: سرور تاریخِ کلیدهای مراجعه (`opDate`…) را هنگامِ ثبت به ISO برمی‌گرداند؛ بیمارِ برگشته تا
 * دیروز «۲۰۲۶-۱۰-۰۳» را در کادر می‌دید با خطای «تاریخ باید به شکل ۱۴۰۵/۰۵/۰۷ باشد» — یعنی
 * نمی‌توانست بی‌تایپِ دوباره ثبت کند. مقدارِ از قبل شمسی (پیش‌نویس) دست نمی‌خورد.
 */
const jBack = (v) => {
  if (typeof v !== 'string') return v;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return ymdToJStr(v) || v;
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return isoToJStr(v) || v;
  return v;
};
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
  const navigate = useNavigate();
  const [link, setLink] = useState(null);
  const [err, setErr] = useState('');
  /* خطای بارگذاریِ خودِ لینک (status + message) — صفحهٔ خطا از status می‌گوید چه شد و چه کنید (بندِ ۱۱۰). */
  const [loadErr, setLoadErr] = useState(null);
  /* کدِ خطای آخر — ۴۰۹ (برخوردِ کدِ ملی) را بیمار به‌تنهایی حل نمی‌کند و کنارش دکمهٔ تماس می‌آید. */
  const [errStatus, setErrStatus] = useState(0);
  /* خطای هر کادر، زیرِ خودِ همان کادر (بازبینیِ UX، بندِ ۱۰۵): تا دیروز یک پیامِ ته فرم بود و خطاها
     یکی‌یکی می‌آمدند — چهار بار «ادامه» برای چهار اشتباه. */
  const [fErr, setFErr] = useState({});
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ firstName: '', lastName: '', nationalId: '', phone: '', birthDate: '', address: '', referralSourceId: '', referralNote: '' });
  /* ⚠️ کانال‌ها از یک endpointِ **عمومی** می‌آیند که فقط نام و شناسه می‌دهد —
     نه تعدادِ بیمارِ هر کانال، که دادهٔ تجاریِ شرکت است و روی صفحهٔ بی‌احراز
     جایی ندارد. */
  const [sources, setSources] = useState([]);
  /* «قبلاً ثبت‌نام کرده‌اید؟» — ادامه با موبایل + کد به‌جای پرکردنِ دوبارهٔ فرم (بازبینیِ UX، بندِ ۱۰۳). */
  const [resume, setResume] = useState(false);
  /* «کدِ ملیِ ایرانی ندارم» (بازبینیِ UX، بندِ ۱۰۹) — راهِ تلفنیِ بیمارِ اتباع؛ با خطای کدِ ملی خودش باز می‌شود. */
  const [noNid, setNoNid] = useState(false);
  /* پرسشِ امنیتی را **سرور** می‌سازد: تصویرِ دو عدد + نشانی که پاسخ را رمزشده در خود دارد
     (`server/src/patients/intake-captcha.ts`). مرورگر پاسخ را نمی‌داند — تا دیروز خودش دو عدد را
     انتخاب می‌کرد و هر اسکریپتی با `1 + 1 = 2` ثبت‌نام می‌ساخت. هر نشان یک‌بار سنجیده می‌شود. */
  const [cap, setCap] = useState(null);
  const [capErr, setCapErr] = useState('');
  const [answer, setAnswer] = useState('');
  /* لحظهٔ رسیدنِ پرسش به **ساعتِ همین مرورگر** — سنِ پرسش از این سنجیده می‌شود نه از `expiresAt`ِ
     سرور، که با ساعتِ غلطِ گوشی هر پرسشی را «کهنه» نشان می‌داد. */
  const capAt = useRef(0);
  const loadCap = useCallback(() => {
    setCapErr(''); setAnswer('');
    return api(`/public/intake/link/${token}/captcha`, { auth: false })
      .then((c) => { capAt.current = Date.now(); setCap(c); })
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
      .then((l) => { if (live) { adoptFace(l); setLink(l); loadCap(); } })
      .catch((e) => { if (live) setLoadErr(e); });
    return () => { live = false; };
  }, [token, loadCap]);

  /* لینک باز نشد ← هویت و تمِ مطب از مسیرِ عمومیِ جدا، تا صفحهٔ خطا هم نام و تلفن داشته باشد. */
  const fallback = useFallbackFace(!!loadErr && !link);

  const set = (k) => (e) => { setF((s) => ({ ...s, [k]: e.target.value })); setFErr((x) => (x[k] ? { ...x, [k]: '' } : x)); };

  /** همهٔ کادرها یک‌جا، پیش از ارسال — همان قاعده‌های سرور (رقمِ کنترلِ کدِ ملی، «۰۹» و ۱۱ رقم). */
  const validate = () => {
    const e = {};
    if (f.firstName.trim().length < 2) e.firstName = 'نام را کامل بنویسید';
    if (f.lastName.trim().length < 2) e.lastName = 'نامِ خانوادگی را کامل بنویسید';
    const nid = toEnDigits(f.nationalId).replace(/[^0-9]/g, '');
    if (!nid) e.nationalId = 'کدِ ملی را بنویسید';
    else if (!isValidNationalId(nid)) e.nationalId = 'این کدِ ملی درست نیست — ۱۰ رقمِ روی کارت را دوباره نگاه کنید';
    const ph = toEnDigits(f.phone).replace(/[^0-9]/g, '');
    if (!ph) e.phone = 'شمارهٔ موبایل را بنویسید';
    else if (!/^09\d{9}$/.test(ph)) e.phone = 'شمارهٔ موبایل ۱۱ رقم است و با ۰۹ شروع می‌شود';
    if (!toEnDigits(answer).trim()) e.captcha = 'حاصلِ جمعِ دو عددِ تصویر را بنویسید';
    return e;
  };
  /* ترتیبِ فوکوس = ترتیبِ کادرها روی صفحه. */
  const FIELD_IDS = { firstName: 'ik-first', lastName: 'ik-last', nationalId: 'ik-nid', phone: 'ik-phone', captcha: 'ik-cap-answer' };
  const showErrors = (e) => {
    setFErr(e);
    const keys = Object.keys(FIELD_IDS).filter((k) => e[k]);
    if (!keys.length) return false;
    setErr(keys.length === 1 ? 'یک کادر را اصلاح کنید.' : `${faNum(keys.length)} کادر را اصلاح کنید.`);
    setErrStatus(0);
    requestAnimationFrame(() => document.getElementById(FIELD_IDS[keys[0]])?.focus());
    return true;
  };

  const submit = async () => {
    if (showErrors(validate())) return;
    /* هر پرسش ۱۰ دقیقه اعتبار دارد و بیمارِ مسن ممکن است بیشتر طول بکشد: پرسشِ نزدیک به انقضا پیش از
       ارسال تازه می‌شود، نه اینکه سرور ردش کند و بیمار یک رفت‌وبرگشتِ دیگر بخورد. */
    if (cap && Date.now() - capAt.current > 9.5 * 60_000) {
      setErr('پرسشِ امنیتی تازه شد (هر پرسش تا ۱۰ دقیقه اعتبار دارد) — پاسخِ پرسشِ تازه را بنویسید.');
      setErrStatus(0);
      loadCap();
      return;
    }
    setErr(''); setErrStatus(0); setBusy(true);
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
      // هشدار: `navigate` نه `location.replace`: بارگذاریِ کاملِ اپ روی گوشیِ کند یعنی چند
      // ثانیه صفحهٔ سفید و دانلودِ دوبارهٔ همهٔ چانک‌ها برای رفتن به صفحهٔ بعدیِ همین اپ.
      /* شمارهٔ پوشیده‌ای که لینکِ ادامه به آن پیامک شد — صفحهٔ فرم همان را می‌گوید. */
      navigate(`/f/${r.token}`, { replace: true, state: { smsTo: r.linkSmsTo ?? null } });
    } catch (e) {
      setErr(e.message); setErrStatus(e.status ?? 0); setBusy(false);
      /* پیامِ سرورِ مربوط به یک کادر زیرِ همان کادر هم می‌نشیند. */
      if (e.status === 400 && /کدِ ملی/.test(e.message)) setFErr((x) => ({ ...x, nationalId: e.message }));
      else if (e.status === 400 && /موبایل/.test(e.message)) setFErr((x) => ({ ...x, phone: e.message }));
      else if (e.status === 422) setFErr((x) => ({ ...x, captcha: e.message }));
      /* هشدار: هر خطایی **پس از** سنجشِ پرسش یعنی نشان مصرف شده (بازبینیِ UX، بندِ ۹۸): ۴۲۲ (پاسخِ غلط یا
         کهنه)، ۴۰۹ (کدِ ملی با نامِ خانوادگیِ دیگر)، خطای سرور یا قطعِ اتصال. تا دیروز فقط روی ۴۲۲
         پرسشِ تازه می‌آمد و تلاشِ بعد از ۴۰۹ با «منقضی شده» رد می‌شد — سه رفت‌وبرگشت. فقط ۴۰۰
         (سنجشِ نام/کدِ ملی/موبایل، پیش از پرسش) نشان را نمی‌سوزاند و پاسخ سرِ جایش می‌ماند. */
      if (e.status !== 400) loadCap();
    }
  };

  /* کیبوردِ گوشی (بازبینیِ UX، بندِ ۱۱۶): کادرها داخلِ <form>اند تا «برو»ِ کیبورد کار کند، ولی Enter در هر کادری
     جز پاسخِ پرسش به کادرِ **بعدی** می‌رود — بی‌این، «بعدی»ِ آیفون در کادرِ «نام» کلِ فرم را با خطای کادرهای
     خالیِ بعدی می‌فرستاد. فقط پاسخِ پرسش (enterKeyHint=go) می‌فرستد. */
  const onFormKey = (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT' || e.target.id === 'ik-cap-answer') return;
    e.preventDefault();
    const list = [...e.currentTarget.querySelectorAll('input:not([type=hidden]):not(:disabled)')];
    list[list.indexOf(e.target) + 1]?.focus();
  };
  const onFormSubmit = (e) => { e.preventDefault(); if (!busy && cap) submit(); };

  if (loadErr && !link) return <LoadError brand={fallback?.brand} err={loadErr} />;

  return (
    <Shell brand={link?.brand} title={link?.title}>
      {resume ? <Resume token={token} onBack={() => setResume(false)} /> : (<>
      {link && <Ahead link={link} />}
      <button type="button" className="ik-resume-toggle" onClick={() => setResume(true)}>
        قبلاً ثبت‌نام کرده‌اید؟ <b>ادامه با شمارهٔ موبایل</b>
      </button>
      {/* noValidate: سنجش مالِ `validate()` است (پیام زیرِ هر کادر، فارسی) نه حبابِ انگلیسیِ مرورگر. */}
      <form className="ik-reg" onSubmit={onFormSubmit} onKeyDown={onFormKey} noValidate>
      {/* autocomplete + name: پرکنندهٔ خودکارِ اندروید/آیفون نام و موبایل را پر می‌کند (بندِ ۱۱۶). تاریخِ تولد
          عمداً `bday` ندارد: پرکننده تاریخِ میلادی می‌گذارد و این کادر شمسی است. */}
      <div className="ik-grid">
        <Field id="ik-first" name="firstName" autoComplete="given-name" enterKeyHint="next" label="نام *" value={f.firstName} onChange={set('firstName')} disabled={busy} error={fErr.firstName} />
        <Field id="ik-last" name="lastName" autoComplete="family-name" enterKeyHint="next" label="نامِ خانوادگی *" value={f.lastName} onChange={set('lastName')} disabled={busy} error={fErr.lastName} />
        <Field id="ik-nid" name="nationalId" autoComplete="off" enterKeyHint="next" label="کدِ ملی *" value={f.nationalId} onChange={set('nationalId')} disabled={busy} dir="ltr" inputMode="numeric" error={fErr.nationalId}
               after={<NoNationalId brand={link?.brand} open={noNid || !!fErr.nationalId} onOpen={() => setNoNid(true)} />} />
        <Field id="ik-phone" name="phone" type="tel" autoComplete="tel" enterKeyHint="next" label="شمارهٔ موبایل *" value={f.phone} onChange={set('phone')} disabled={busy} dir="ltr" inputMode="numeric" placeholder="مثلاً ۰۹۱۲۳۴۵۶۷۸۹" error={fErr.phone} />
        {/* JDate خودش برچسب دارد؛ پیچیدنش در label یعنی دو برچسب. */}
        {/* نمونه‌ای که شبیهِ تاریخِ تولد است — پیش‌فرضِ «۱۴۰۵/۰۱/۰۱» یعنی امسال (بازبینیِ UX، بندِ ۱۱۳). */}
        <JDate className="ik-field" mode="birth" label="تاریخِ تولد" value={f.birthDate} placeholder="مثلاً ۱۳۶۵/۰۴/۲۰"
               onChange={(v) => setF((s) => ({ ...s, birthDate: v }))} disabled={busy} />
        <Field name="address" autoComplete="street-address" enterKeyHint="next" label="نشانی" value={f.address} onChange={set('address')} disabled={busy} />

        {/* ⚠️ «چطور با ما آشنا شدید» همین‌جا پرسیده می‌شود و نه در نظرسنجیِ
            بعدی: بیمار الان یادش هست چطور پیدایمان کرده. پرسیدنش هفته‌ها بعد
            جوابِ حدسی می‌گیرد — و این همان عددی است که تصمیمِ تبلیغات را
            می‌سازد. */}
        {sources.length > 0 && (
          <label className="ik-field">
            <span>چطور با ما آشنا شدید؟</span>
            <span className="ik-select">
              <select
                value={f.referralSourceId}
                disabled={busy}
                onChange={(e) => setF((s2) => ({ ...s2, referralSourceId: e.target.value, referralNote: '' }))}
              >
                <option value="">— انتخاب کنید —</option>
                {sources.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <Caret className="ik-select-ic" width="17" height="17" aria-hidden="true" />
            </span>
          </label>
        )}
        {/* نامِ معرف فقط برای کانال‌هایی که معرف دارند — پرسیدنش از کسی که
            «اینستاگرام» زده، سؤالِ بی‌جواب است. */}
        {sources.find((o) => String(o.id) === String(f.referralSourceId))?.asksWho && (
          <Field name="referralNote" autoComplete="off" enterKeyHint="next" label="نامِ معرف" value={f.referralNote} onChange={set('referralNote')} disabled={busy} />
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
          <input id="ik-cap-answer" name="captcha" dir="ltr" inputMode="numeric" autoComplete="off" enterKeyHint="go" aria-labelledby="ik-cap-q" value={answer}
                 aria-invalid={fErr.captcha ? true : undefined} aria-describedby={fErr.captcha ? 'ik-cap-answer-err' : undefined}
                 onChange={(e) => { setAnswer(e.target.value); setFErr((x) => (x.captcha ? { ...x, captcha: '' } : x)); }} disabled={busy || !cap} />
        </div>
        {fErr.captcha && <em id="ik-cap-answer-err" className="ik-ferr">{fErr.captcha}</em>}
        {/* پرسشِ تصویری برای بیمارِ کم‌بینا یا صفحه‌خوان راهِ دیگری ندارد (بندِ ۱۱۶) — دست‌کم «پرسشِ دیگر» و تماس. */}
        <small className="ik-cap-help">
          اگر عددها را نمی‌توانید بخوانید، «پرسشِ دیگر» را بزنید
          {link?.brand?.phone
            ? <> یا با <a href={telHref(link.brand.phone)}><bdi dir="ltr">{faPhone(link.brand.phone)}</bdi></a> تماس بگیرید؛ ثبت‌نام را تلفنی هم انجام می‌دهیم.</>
            : '.'}
        </small>
      </div>

      {err && <p className="ik-bad" role="alert"><Alert width="15" height="15" /> <span>{err}</span></p>}
      {err && errStatus === 409 && (
        <CallLink phone={link?.brand?.phone} label={link?.brand?.name ? `تماس با ${link.brand.name}` : 'تماس'} className="ik-err-call" />
      )}
      <button type="submit" className="ik-go" disabled={busy || !cap}>
        {busy ? 'در حال ثبت…' : 'ادامه'}
      </button>
      </form>
      </>)}
    </Shell>
  );
}

/**
 * **ادامهٔ ثبت‌نامِ قبلی با موبایل + کد** (بازبینیِ UX، بندِ ۱۰۳) — روی همان لینکِ ثبت‌نام.
 *
 * بیمارِ مرورگرِ داخلیِ اینستاگرام که برای واریز به اپِ بانک رفته و برگشته، یا پیامکِ لینکش را پاک
 * کرده، تا دیروز فقط با پرکردنِ دوبارهٔ همهٔ فیلدها + کپچا برمی‌گشت. پاسخِ «ارسالِ کد» همیشه یکی است
 * (سرور وجودِ ثبت‌نام را لو نمی‌دهد)؛ کدِ درست مستقیم به `/f/…` می‌برد.
 */
function Resume({ token, onBack }) {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState('phone');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [dev, setDev] = useState('');
  const digits = (v) => toEnDigits(v).replace(/[^0-9]/g, '');

  /* WebOTP — اندروید کدِ پیامک را خودش پر می‌کند (همان الگوی صفحهٔ ورود). */
  useEffect(() => {
    if (step !== 'code' || !('OTPCredential' in window)) return undefined;
    const ac = new AbortController();
    navigator.credentials.get({ otp: { transport: ['sms'] }, signal: ac.signal })
      .then((o) => { if (o?.code) setCode(o.code); })
      .catch(() => {});
    return () => ac.abort();
  }, [step]);

  const send = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const r = await api(`/public/intake/link/${token}/resume/request`, { method: 'POST', body: { phone: digits(phone) } });
      setDev(r?.devCode ?? '');
      setCode(r?.devCode ?? '');
      setStep('code');
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const verify = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const r = await api(`/public/intake/link/${token}/resume/verify`, { method: 'POST', body: { phone: digits(phone), code: digits(code) } });
      navigate(`/f/${r.token}`, { replace: true });
    } catch (x) { setErr(x.message); setBusy(false); }
  };

  return (
    <section className="ik-resume" aria-labelledby="ik-resume-h">
      <h2 id="ik-resume-h">ادامهٔ ثبت‌نامِ قبلی</h2>
      {step === 'phone' ? (
        <form className="ik-resume-form" onSubmit={send}>
          <p className="ik-hint">شماره‌ای را که با آن ثبت‌نام کرده‌اید بنویسید؛ یک کدِ ۶رقمی برایتان پیامک می‌شود.</p>
          <Field label="شمارهٔ موبایل" type="tel" dir="ltr" inputMode="numeric" autoComplete="tel" enterKeyHint="send"
                 placeholder="مثلاً ۰۹۱۲۳۴۵۶۷۸۹" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} required />
          <button type="submit" className="ik-go" disabled={busy || digits(phone).length < 11}>{busy ? 'در حال ارسال…' : 'ارسالِ کد'}</button>
        </form>
      ) : (
        <form className="ik-resume-form" onSubmit={verify}>
          <p className="ik-note" role="status">
            <span>اگر ثبت‌نامِ بازی با شمارهٔ <bdi dir="ltr">{faDigits(digits(phone))}</bdi> باشد، کد تا یکی‌دو دقیقه پیامک می‌شود.</span>
          </p>
          {dev && <p className="ik-note"><span>پیامک هنوز وصل نیست — کدِ آزمون: <b dir="ltr">{faDigits(dev)}</b></span></p>}
          <Field label="کدِ ۶رقمی" dir="ltr" inputMode="numeric" autoComplete="one-time-code" enterKeyHint="go" maxLength={6}
                 value={code} onChange={(e) => setCode(e.target.value)} disabled={busy} required />
          <button type="submit" className="ik-go" disabled={busy || digits(code).length < 6}>{busy ? 'در حال بررسی…' : 'ادامهٔ فرم'}</button>
          <button type="button" className="ik-linkbtn" disabled={busy} onClick={() => { setStep('phone'); setCode(''); setErr(''); }}>
            اصلاحِ شماره یا گرفتنِ کدِ تازه
          </button>
        </form>
      )}
      {err && <p className="ik-bad" role="alert"><Alert width="15" height="15" /> {err}</p>}
      <button type="button" className="ik-linkbtn" onClick={onBack}>نه، ثبت‌نامِ تازه</button>
    </section>
  );
}

/* ── گامِ ۲: اطلاعاتِ مراجعه + فیش ──────────────────────────────── */

/**
 * ردیف‌های کارتِ خلاصهٔ مرحلهٔ واریز — «برچسب: مقدار» از پاسخ‌های همین فرم (حداکثر شش ردیف).
 * فقط نوع‌هایی که یک خطِ متن‌اند؛ عکس، پیوند و کادرِ پرداخت در خلاصه جا ندارند.
 */
const SUMMARY_TYPES = new Set(['text', 'textarea', 'number', 'money', 'phone', 'date', 'time', 'select', 'multiselect', undefined]);
function summaryOf(d, vals, f) {
  const fields = d.form?.fields ?? [];
  if (!fields.length) {
    return [['نوعِ عمل', f.procedure], ['نامِ جراح', f.surgeonName], ['بیمارستان', f.hospitalName], ['تاریخِ عمل', f.opDate]]
      .filter(([, v]) => v);
  }
  const label = (fl, x) => (fl.options ?? []).find((o) => o?.v === x)?.l ?? String(x);
  const rows = [];
  for (const fl of fields) {
    if (fl.active === false || !SUMMARY_TYPES.has(fl.type)) continue;
    const v = vals[fl.key] ?? d.data?.[fl.key];
    if (v == null || v === '' || (Array.isArray(v) && !v.length) || typeof v === 'object' && !Array.isArray(v)) continue;
    let text = Array.isArray(v) ? v.map((x) => label(fl, x)).join('، ') : fl.type === 'select' ? label(fl, v) : String(v);
    if (fl.type === 'money' || fl.type === 'number') text = faNum(toEnDigits(String(v)).replace(/[^0-9]/g, ''));
    if (text.length > 60) text = `${text.slice(0, 58)}…`;
    rows.push([fl.label, text]);
    if (rows.length >= 6) break;
  }
  return rows;
}

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
  const makesVisit = d.makesVisit !== false;
  const hasPaymentBox = !!d.form?.fields?.some((x) => x.type === 'payment');
  const needsReceipt = (d.payable ?? d.amount ?? 0) > 0 || hasPaymentBox
    || d.status === 'pending_payment' || receiptsOf(d).length > 0;
  const needsReview = makesVisit || needsReceipt || d.status === 'pending_approval';
  /* بیماری که از صفحهٔ ثبت‌نام آمده «مشخصات» را پشتِ سر گذاشته — همان شماره‌هایی که آن صفحه گفت. */
  return [...(d.registered ? [REGISTER_STEP] : []), ...flowSteps({ makesVisit, needsReceipt, needsReview })];
}

/** مرحلهٔ صفحهٔ ثبت‌نام — اولِ «چه پیش رو دارید» و، برای بیمارِ همان صفحه، اولِ مرحله‌نمای فرم. */
const REGISTER_STEP = { key: 'register', label: 'مشخصات' };

/** مرحله‌های بعد از ثبت‌نام از سه واقعیتِ مسیر — مشترکِ مرحله‌نمای فرم و «چه پیش رو دارید». */
function flowSteps({ makesVisit, needsReceipt, needsReview }) {
  const S = PATIENT.intake.step;
  const steps = [{ key: 'pending_fill', label: makesVisit ? S.fill : S.answer }];
  if (needsReceipt) steps.push({ key: 'pending_payment', label: S.receipt });
  steps.push(needsReview ? { key: 'pending_approval', label: S.review } : { key: 'approved', label: S.saved });
  return steps;
}

/** «۴۰ میلیون تومان» برای مبلغِ رُند — بیمار هشت رقم را نمی‌شمارد؛ مبلغِ غیرِرُند کامل نوشته می‌شود. */
const feeFa = (n) => (n >= 1_000_000 && n % 100_000 === 0 ? `${faNum(n / 1_000_000)} میلیون تومان` : `${faNum(n)} تومان`);

/**
 * «چه پیش رو دارید» بالای صفحهٔ ثبت‌نام (بازبینیِ UX، بندِ ۱۰۷): مرحله‌ها، مبلغ با برچسب و زمانِ پرداخت،
 * و اینکه کدِ ملی و تاریخِ تولد برای چیست و نزدِ کیست. تا دیروز اولین چیزِ صفحهٔ شرکت چیپِ بی‌برچسبِ
 * «۴۰٬۰۰۰٬۰۰۰ تومان» بود و مرحله‌نما فقط از صفحهٔ دوم پیدا می‌شد.
 */
function Ahead({ link }) {
  const flow = link.flow;
  const steps = flow
    ? [REGISTER_STEP, ...flowSteps({ makesVisit: flow.makesVisit, needsReceipt: flow.payment, needsReview: flow.review })]
    : [REGISTER_STEP];
  const who = link.brand?.name;
  return (
    <section className="ik-ahead" aria-labelledby="ik-ahead-t">
      <b id="ik-ahead-t">چه پیش رو دارید</b>
      {steps.length > 1 && (
        <ol>
          {steps.map((s, i) => (
            <li key={s.key} className={i === 0 ? 'now' : undefined} aria-current={i === 0 ? 'step' : undefined}>
              <i>{faNum(i + 1)}</i>{s.label}
            </li>
          ))}
        </ol>
      )}
      {flow?.booking && <p><Calendar width="16" height="16" /> <span>روزِ نوبت را در مرحلهٔ بعد خودتان انتخاب می‌کنید.</span></p>}
      {link.amount > 0 && (
        <p className="ik-fee">
          <Money width="16" height="16" />
          <span>هزینهٔ خدمت: <b>{feeFa(link.amount)}</b> — پس از تکمیلِ فرم پرداخت می‌شود.</span>
        </p>
      )}
      <p>
        <Lock width="16" height="16" />
        <span>کدِ ملی و تاریخِ تولد فقط برای تشکیلِ پرونده است؛ اطلاعاتِ شما نزدِ {who || 'مطب'} می‌ماند.</span>
      </p>
    </section>
  );
}

function Form() {
  const { token } = useParams();
  /* شمارهٔ پوشیده‌ای که ثبت‌نام همین حالا لینکِ این فرم را به آن پیامک کرد (`state` از `Register`). */
  const smsTo = useLocation().state?.smsTo ?? null;
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  /* خطای بارگذاریِ فرم (status + message) — فقط وقتی هنوز چیزی نیامده صفحهٔ خطا می‌شود. */
  const [loadErr, setLoadErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ procedure: '', surgeonName: '', hospitalName: '', opDate: '', notes: '' });
  /* پاسخِ فیلدهای **دلخواهِ** فرمِ ساخته‌شده — جدا از `f` که فیلدهای ثابت است. */
  const [vals, setVals] = useState({});
  const [vErr, setVErr] = useState({});
  const [page, setPage] = useState(1);
  const [code, setCode] = useState('');
  /* خطای کدِ تخفیف **زیرِ همان کادر**، جدا از خطای سراسریِ ته کارت (بازبینیِ UX، بندِ ۱۰۴): تا دیروز
     ۷۰۰ پیکسل پایین‌تر می‌نشست و تا اقدامِ بعدی هم می‌ماند. */
  const [codeErr, setCodeErr] = useState('');
  /* مرحلهٔ واریز: فرمِ پرشده به یک کارتِ خلاصه تا می‌شود؛ «ویرایش» بازش می‌کند. */
  const [editing, setEditing] = useState(false);
  const payRef = useRef(null);
  /* «روزِ نوبت را انتخاب کنید» روی خودِ تقویم، نه زیرِ دکمهٔ ذخیره که ۸۰۰ پیکسل پایین‌تر است (بندِ ۱۰۵). */
  const [bookErr, setBookErr] = useState('');
  const bookRef = useRef(null);
  const smoothScroll = () => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const showBookErr = (msg) => {
    setBookErr(msg);
    requestAnimationFrame(() => bookRef.current?.scrollIntoView({ behavior: smoothScroll() ? 'smooth' : 'auto', block: 'start' }));
  };
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
      adoptFace(r);
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
            if (r.data?.[fl.key] === undefined || next[fl.key] !== undefined) continue;
            next[fl.key] = fl.type === 'date' ? jBack(r.data[fl.key]) : r.data[fl.key];
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
      setLoadErr(null);
    } catch (e) { setErr(e.message); setLoadErr(e); }
  }, [token]);
  useEffect(() => { load(); }, [load]);
  const fallback = useFallbackFace(!!loadErr && !d);

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
    /* نوبت لازم است و هنوز روزی زده نشده ← همان‌جا بگو، بی‌رفت‌وبرگشت (قاعدهٔ `fill()` سرور؛ «رزرو بدون
       تاریخ» استثناست). */
    const undated = vals.opDateOpen === true || vals.opDateOpen === 'true';
    if (d.booking?.required && !d.booking.appointment && !undated) { showBookErr('روزِ نوبت را از تقویمِ بالا انتخاب کنید.'); return; }
    setErr(''); setBookErr(''); setBusy(true);
    /* ثبت همهٔ پاسخ‌ها را می‌برد؛ ذخیرهٔ خودکارِ در صف دیگر فقط یک نوشتنِ اضافه بود که
       با همین ثبت هم‌زمان می‌رسید. */
    clearTimeout(draftTimer.current);
    /* ⚠️ تاریخ **شمسی فقط در مرورگر** زندگی می‌کند؛ روی سیم همیشه ISO می‌رود.
       تا دیروز `f` خام فرستاده می‌شد، یعنی «۱۴۰۵/۰۵/۱۴» به سرور می‌رسید و
       سرور آن را سالِ ۱۴۰۵ **میلادی** می‌فهمید — و مراجعه بی‌سروصدا شش قرن
       عقب ثبت می‌شد. هیچ خطایی نمی‌داد؛ فقط از تقویم و گزارش‌ها غیب می‌شد. */
    const body = { ...f, opDate: f.opDate.trim() ? jStrToIso(f.opDate) : '', values: vals, hospitalId: vals.hospitalId, rev: nextRev() };
    try {
      const next = await api(`/public/intake/form/${token}/fill`, { auth: false, method: 'POST', body });
      setD(next);
      setEditing(false);
      /* هشدار: بعد از «ثبت و مرحلهٔ بعد» صفحه همان‌جا می‌ماند و بخشِ واریز ته صفحه اضافه می‌شد — بیمار
         نمی‌فهمید ثبت شد یا نه و ممکن بود دوباره «ثبت» بزند (بازبینیِ UX، بندِ ۱۰۴). */
      if (next?.status === 'pending_payment') {
        const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        requestAnimationFrame(() => payRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' }));
      }
    }
    catch (e) {
      if (/روزِ نوبت/.test(e.message)) showBookErr(e.message);
      else setErr(e.message);
    } finally { setBusy(false); }
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
      /* و به خودِ اولین کادرِ غلط برو — صفحهٔ بلند یعنی خطا زیرِ تا بود. */
      requestAnimationFrame(() => document.querySelector('.ik-card .pf-err')?.closest('label, .pf-field, .dyn-field')
        ?.scrollIntoView({ behavior: smoothScroll() ? 'smooth' : 'auto', block: 'center' }));
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
    setErr(''); setCodeErr(''); setBusy(true);
    try { setD(await api(`/public/intake/form/${token}/discount`, { auth: false, method: 'POST', body: { code: code.trim() } })); }
    catch (e) { setCodeErr(e.message); } finally { setBusy(false); }
  };

  /* ⚠️ خطا **پرتاب** می‌شود تا همان فایل در فهرستِ کادر قرمز شود؛ پیامِ
     سراسری معلوم نمی‌کرد کدام فیش نرفته. */
  const sendReceipt = async (file) => {
    /* پیش از ارسال: پاسخی که وضعیت را «در انتظارِ بررسی» می‌کند نباید کادر را زیرِ پای صفِ
       آپلودِ چندفایلی بردارد. */
    setAddingReceipts(true);
    setCodeErr('');
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

  if (loadErr && !d) return <LoadError brand={fallback?.brand} err={loadErr} />;
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
  const submitLabel = editing ? 'ذخیرهٔ تغییرات' : paidNext ? T.submit.paid : makesVisit ? T.submit.visit : T.submit.record;
  /* انصرافِ ویرایش: پاسخ‌های ذخیره‌شده برمی‌گردند — خلاصه نباید تغییرِ ثبت‌نشده را «ثبت شد» نشان دهد. */
  const cancelEdit = () => { setEditing(false); setVals({}); load(); };

  return (
    <Shell brand={d.brand} title={`${d.data?.firstName ?? ''} ${d.data?.lastName ?? ''}`.trim()} amount={rejected || expired ? 0 : d.amount}
           footCall={!(d.status === 'pending_approval' && !payOpen) && !rejected && !expired}>
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

      {/* لینکِ ادامه و مهلتِ فرم (بازبینیِ UX، بندِ ۱۰۳): بیمار باید بداند اگر این صفحه بسته شد از کجا
          برگردد و تا کِی وقت دارد. */}
      {(d.status === 'pending_fill' || d.status === 'pending_payment') && smsTo && (
        <p className="ik-note ik-sms-note" role="status">
          <Info width="15" height="15" />
          {/* هشدار: یک span: `.ik-note` فلکس است و متن + bdi بی‌این سه ستونِ جدا می‌شدند. */}
          <span>لینکِ ادامهٔ همین فرم به <bdi dir="ltr">{faDigits(smsTo)}</bdi> پیامک شد؛ اگر این صفحه بسته شد، از همان پیامک برگردید.</span>
        </p>
      )}
      {(d.status === 'pending_fill' || d.status === 'pending_payment') && d.expiresFa && (
        <p className="ik-deadline">
          <Clock width="14" height="14" aria-hidden="true" />
          {paidNext ? `مهلتِ تکمیل و بارگذاریِ فیش: تا ${d.expiresFa}` : `این فرم تا ${d.expiresFa} باز است`}
        </p>
      )}

      {/* برگشت برای اصلاح (مالک، ۱۴۰۵/۰۷/۰۱): بیمار باید بداند **کدام بخش** و **چرا** — نه فقط
          یک یادداشت. مرحله و راهنما از سرور (`intake-return.ts`) می‌آیند. */}
      {d.returned ? (
        <div className="ik-returned" role="status">
          <b><Alert width="15" height="15" /> برای اصلاح برگشت خورد — {d.returned.stageLabel}</b>
          <p>{d.returned.note}</p>
          <small>{d.returned.hint}</small>
        </div>
      ) : d.reviewNote && !done && !rejected && (
        <p className="ik-warn"><Alert width="15" height="15" /> {d.reviewNote}</p>
      )}

      {done && (
        <p className="ik-good">
          {/* پرچمِ «مراجعه می‌سازد» از سرور می‌آید؛ متن از واژه‌نامهٔ بیمار. */}
          <CheckCircle width="16" height="16" /> {makesVisit ? T.approved.visit : T.approved.record}
        </p>
      )}
      {/* ردشده و منقضی بن‌بست نیستند (بازبینیِ UX، بندِ ۱۱۰): چه شد + چرا + چه کنید — «ثبتِ درخواستِ
          تازه» / «شروعِ دوباره» روی همان لینکِ ثبت‌نام (اگر هنوز فعال است) و تماس با مطب. */}
      {rejected && (
        <PublicError brand={d.brand} title={T.rejected.title} reason={d.reviewNote ? T.rejected.because(d.reviewNote) : T.rejected.noNote}>
          {d.restartToken && <Link className="pb-act" to={`/r/${d.restartToken}`}><Refresh width="16" height="16" aria-hidden="true" /> {T.rejected.again}</Link>}
        </PublicError>
      )}
      {expired && (
        <PublicError brand={d.brand} tone="warn" icon={<Clock width="22" height="22" />} title={T.expired.title}
                     reason={T.expired.reason(d.expiresFa, !!d.restartToken)}>
          {d.restartToken && <Link className="pb-act" to={`/r/${d.restartToken}`}><Refresh width="16" height="16" aria-hidden="true" /> {T.expired.again}</Link>}
        </PublicError>
      )}

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
        <div ref={bookRef} className="ik-book-anchor">
          <BookingPick token={token} booking={d.booking} disabled={busy} error={bookErr}
                       onBooked={(next) => { setBookErr(''); setD(next); }} />
        </div>
      )}

      {/* ── مرحلهٔ واریز: فرمِ پرشده یک کارتِ خلاصه است، نه همان فرم و همان دکمهٔ «ثبت» (بندِ ۱۰۴) ── */}
      {d.status === 'pending_payment' && !editing && (
        <section className="ik-sum" aria-labelledby="ik-sum-h">
          <div className="ik-sum-head">
            <b id="ik-sum-h"><CheckCircle width="16" height="16" aria-hidden="true" /> اطلاعاتِ مراجعه ثبت شد</b>
            <button type="button" className="ik-sum-edit" onClick={() => setEditing(true)} disabled={busy}>
              <Pencil width="15" height="15" aria-hidden="true" /> ویرایش
            </button>
          </div>
          {summaryOf(d, vals, f).length > 0 && (
            <dl>
              {summaryOf(d, vals, f).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
            </dl>
          )}
        </section>
      )}

      {(d.status === 'pending_fill' || (d.status === 'pending_payment' && editing)) && (
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
                /* دکمهٔ اصلیِ صفحه — نه شبح (بازبینیِ UX، بندِ ۱۱۵): «ادامه» و «بعدی» حلقهٔ نئونی داشتند و
                   مهم‌ترین دکمه، «ثبت»، کم‌رنگ‌ترینِ صفحه بود. */
                <button type="button" className="ik-go" disabled={busy} onClick={saveForm}>
                  {busy ? 'در حال ذخیره…' : submitLabel}
                </button>
              )}
            </div>
            {editing && <button type="button" className="ik-linkbtn" onClick={cancelEdit} disabled={busy}>انصراف — بدونِ تغییر</button>}
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
            <button type="button" className="ik-go" disabled={busy} onClick={saveFill}>
              {busy ? 'در حال ذخیره…' : submitLabel}
            </button>
            {editing && <button type="button" className="ik-linkbtn" onClick={cancelEdit} disabled={busy}>انصراف — بدونِ تغییر</button>}
          </>
        )
      )}

      {payOpen && (
        <div className="ik-pay" ref={payRef}>
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
            <>
              <div className="ik-code">
                <input value={code} onChange={(e) => { setCode(e.target.value); setCodeErr(''); }} disabled={busy}
                       placeholder="کدِ تخفیف (اختیاری)" aria-invalid={codeErr ? true : undefined}
                       aria-describedby={codeErr ? 'ik-code-err' : undefined} />
                <button type="button" disabled={busy || code.trim().length < 3} onClick={applyCode}>اعمال</button>
              </div>
              {codeErr && <p id="ik-code-err" className="ik-bad ik-code-err" role="alert"><Alert width="15" height="15" /> <span>{codeErr}</span></p>}
            </>
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

      {/* ── کارتِ پایانی (بازبینیِ UX، بندِ ۱۰۲) ──
          تا دیروز فقط یک جملهٔ «بررسی می‌کند» بود و بزرگ‌ترین دکمهٔ صفحه «افزودنِ فیشِ دیگر» — بیمار
          گمان می‌کرد کارش ناقص مانده؛ نوبتی را هم که همین حالا گرفته بود دیگر نمی‌دید. */}
      {d.status === 'pending_approval' && !payOpen && (
        <section className="ik-final" aria-labelledby="ik-final-h">
          <span className="ik-final-ic" aria-hidden="true"><CheckCircle width="30" height="30" /></span>
          <h2 id="ik-final-h">{T.final.title}</h2>
          <p className="ik-note">
            {/* ⚠️ فرمِ رایگان فیش ندارد — «فیشِ شما دریافت شد» برای آن دروغ است
                و بیمار را دنبالِ فیشی می‌فرستد که هرگز نفرستاده. */}
            <Clock width="15" height="15" /> {receipts.length ? T.review.withReceipt : T.review.noReceipt}
          </p>
          {d.booking?.appointment && (
            <div className="ik-final-appt">
              <Calendar width="20" height="20" aria-hidden="true" />
              <div>
                <span>نوبتِ شما</span>
                <b>
                  {d.booking.appointment.whenFa ?? faDate(d.booking.appointment.date)}
                  {d.booking.appointment.timeFa && <>، ساعتِ <bdi dir="ltr">{d.booking.appointment.timeFa}</bdi></>}
                </b>
                {d.booking.appointment.topicName && <small>{d.booking.appointment.topicName}</small>}
                <em>{d.booking.appointment.status === 'confirmed' ? T.final.confirmed : T.final.held(d.brand?.name)}</em>
              </div>
            </div>
          )}
          <p className="ik-final-when">{T.final.when}</p>
          {d.brand?.phone && <p className="ik-final-q">سؤالی دارید؟</p>}
          <CallLink phone={d.brand?.phone} label={d.brand?.name ? `تماس با ${d.brand.name}` : 'تماس'} />
          {/* قسطِ دوم یا عکسِ خواناتر — تا کسی بررسی نکرده، راهِ برگشت به کادرِ فیش باز است؛ ولی
              کنشِ فرعی است، نه دکمهٔ اصلیِ صفحه. */}
          {receipts.length > 0 && (
            <button type="button" className="ik-linkbtn" onClick={() => setAddingReceipts(true)}>{T.receiptsMore}</button>
          )}
        </section>
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

/**
 * **بیمارِ بی‌کدِ ملیِ ایرانی** (اتباع: کدِ فراگیر یا گذرنامه — بازبینیِ UX، بندِ ۱۰۹). تا دیروز فقط «کدِ ملی
 * معتبر نیست» می‌دید که القا می‌کرد اشتباه تایپ کرده، و هیچ راهی جلویش نبود. ثبت‌نامِ آنلاین با کدِ دیگر
 * ستونِ تازه‌ای در پرونده می‌خواهد (`Patient.nationalId` یکتا و در پنلِ کارکنان هم سنجیده می‌شود)؛ تا آن
 * روز راهِ درست تلفن است — کارکنان دستی ثبتش می‌کنند.
 */
function NoNationalId({ brand, open, onOpen }) {
  if (!open) {
    return <button type="button" className="ik-nonid-btn" onClick={onOpen}>کدِ ملیِ ایرانی ندارم</button>;
  }
  return (
    <div className="ik-nonid">
      <p>اگر کدِ ملیِ ایرانی ندارید (کدِ فراگیرِ اتباع یا گذرنامه)، ثبت‌نامتان را تلفنی انجام می‌دهیم{brand?.phone ? ':' : ' — با ما تماس بگیرید.'}</p>
      <CallLink phone={brand?.phone} label={brand?.name ? `تماس با ${brand.name}` : 'تماس'} />
    </div>
  );
}

/**
 * لینک یا فرم **باز نشد** — همان پوستهٔ صفحه با الگوی «چه شد + چرا + چه کنید» (بازبینیِ UX، بندِ ۱۱۰):
 * ۴۰۴ «شاید ناقص کپی شده؛ لینکِ کاملِ پیامک را دوباره لمس کنید»، ۴۰۳ «دیگر فعال نیست»، اتصال با
 * «تلاشِ دوباره» روی همین نشانی — و همیشه تماس با مطب.
 */
function LoadError({ brand, err }) {
  const t = loadErrorText(err, 'لینک');
  return (
    <Shell brand={brand} footCall={false}>
      <PublicError brand={brand} title={t.title} reason={t.reason}>{t.retry && <RetryButton />}</PublicError>
    </Shell>
  );
}

/* ── پوسته ─────────────────────────────────────────────────────── */
/**
 * سربرگ = **هویتِ مطب/شرکت**، نه نامِ نرم‌افزار (بازبینیِ UX، بندِ ۹۲).
 *
 * هشدار: تا دیروز بالای فرم «عمل‌یار» بود (`data-brand-name` که هیچ کدی پرش نمی‌کرد): بیمار از
 * لینکِ «مطب دکتر رحیمی» می‌آمد، نامِ دیگری می‌دید که کدِ ملی و ۴۰ میلیون می‌خواهد، و ته صفحه
 * «به شرکت نوروپایش واریز کنید» — برای بیمارِ نگران یعنی کلاه‌برداری. حالا نام و تلفن از
 * پاسخِ خودِ صفحه می‌آید و «عمل‌یار» فقط کوچک در پاورقی است. نامِ نیامده (پاسخِ قدیمی)
 * «ثبت‌نام» می‌شود، هرگز «عمل‌یار».
 */
function Shell({ brand, title, amount, children, footCall = true }) {
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
          {/* با برچسب (بازبینیِ UX، بندِ ۱۰۷): چیپِ تنهای «۴۰٬۰۰۰٬۰۰۰ تومان» نمی‌گفت این چه مبلغی است. */}
          {amount > 0 && <span className="ik-amount">هزینه: {feeFa(amount)}</span>}
        </header>
        {children}
        <PublicFoot brand={brand} call={footCall} />
      </main>
    </div>
  );
}

function Field({ label, dir = 'rtl', inputMode, placeholder, error, id, after = null, ...rest }) {
  /* خطای هر کادر زیرِ خودش، با قابِ قرمز و aria-invalid (بازبینیِ UX، بندِ ۱۰۵). هشدار: خطا **بیرونِ**
     `<label>` است: داخلش جزوِ نامِ دسترس‌پذیرِ کادر خوانده می‌شد و صفحه‌خوان آن را دو بار می‌گفت. */
  /* هشدار: پوستهٔ `div` همیشه هست، نه فقط وقتِ خطا: عوض‌شدنِ ریشه کادر را از نو می‌ساخت و با پاک‌شدنِ خطا
     حینِ تایپ، فوکوس می‌پرید. */
  return (
    <div className="ik-fieldwrap">
      <label className={`ik-field${error ? ' bad' : ''}`}>
        <span>{label}</span>
        <input type="text" id={id} dir={dir} inputMode={inputMode} placeholder={placeholder}
               aria-invalid={error ? true : undefined} aria-describedby={error && id ? `${id}-err` : undefined} {...rest} />
      </label>
      {error && <em id={id ? `${id}-err` : undefined} className="ik-ferr">{error}</em>}
      {after}
    </div>
  );
}
