import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Mark from '../components/Mark.jsx';
import SelfieCapture from './SelfieCapture.jsx';
import OtpInput from './OtpInput.jsx';
import PasswordInput from './PasswordInput.jsx';


import { useAuth } from './auth.jsx';
import { api } from '../lib/api.js';
import './login.css';
import { Back, Check, Clock, Fingerprint, Info } from '../ui/icons.jsx';
import Tabs from '../ui/Tabs.jsx';
import { hostKind } from '../lib/host-mode.js';

const toEnDigits = (s) =>
  (s || '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

export default function Login() {
  const { user, loading, login, requestOtp, verifyOtp, completeSignup, webauthnLogin } = useAuth();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const adding = sp.get('add') === '1'; // حالتِ «افزودن حساب» — حسابِ فعلی حفظ می‌شود

  const [tab, setTab] = useState('login'); // login | signup
  const [firstAdmin, setFirstAdmin] = useState(false);
  // این میزبان به هیچ شرکتی نگاشته نشده. با routingِ wildcard هر زیردامنه‌ای به
  // اینجا می‌رسد، پس باید صریح بگوییم شرکتی وجود ندارد — نه اینکه فرمِ ورودِ
  // ظاهراً سالم نشان دهیم که کاربر بی‌نتیجه در آن رمز بزند.
  const [tenantMissing, setTenantMissing] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // login
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const canBio = typeof window !== 'undefined' && 'PublicKeyCredential' in window;

  // signup
  const [step, setStep] = useState('phone'); // phone | code | form | done
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [otpStatus, setOtpStatus] = useState('idle'); // idle | busy | success | error
  const [devCode, setDevCode] = useState('');
  const [signupToken, setSignupToken] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [selfie, setSelfie] = useState('');

  /* بازیابیِ رمز (بازبینیِ UX، بندِ ۱۹): «رمز را فراموش کرده‌ام» ← کدِ پیامکی به موبایلِ **خودِ حساب** ← رمزِ تازه.
     تا دیروز کارکنی که رمزش را فراموش می‌کرد راهی جز سوپرادمین نداشت و مالک راهی جز پایگاه‌داده. پاسخِ سرور
     برای حسابِ موجود و ناموجود یکی است، پس صفحه هم هرگز نمی‌گوید «این حساب نیست». */
  const [forgot, setForgot] = useState(null); // null | ask | code
  const [fpCode, setFpCode] = useState('');
  const [fpPass, setFpPass] = useState('');
  const [fpDev, setFpDev] = useState('');
  /* پیامِ موفقیت روی فرمِ ورود (پس از رمزِ تازه). */
  const [notice, setNotice] = useState('');

  /* سایتِ معرفیِ همین شرکت — منتشر شده؟ (بی‌احراز؛ شکست یعنی «نیست»). هشدار: «بازگشت به سایت» فقط وقتی
     ریشهٔ دامنه جای دیگری جز همین صفحه است (بازبینیِ UX، بندِ ۱۱۱): روی دامنهٔ مطبی که سایتش منتشر
     نشده، `/` خودِ ورود است و پیوند کاربر را در یک دورِ بسته نگه می‌داشت. */
  const kind = hostKind();
  const [site, setSite] = useState(null);
  useEffect(() => {
    if (kind === 'platform') return undefined;
    let alive = true;
    api('/public/site', { quiet401: true }).then((s) => { if (alive) setSite(s); }).catch(() => {});
    return () => { alive = false; };
  }, [kind]);
  const backToSite = kind === 'marketing' || (kind === 'tenant' && !!site?.enabled);

  /* نامِ مطب/شرکت زیرِ نشانِ عمل‌یار (بندِ ۱۹) — کارکن باید مطمئن باشد واردِ سامانهٔ درست شده. از مسیرِ
     عمومیِ هویت (بی‌احراز)؛ فقط نام خوانده می‌شود، نه تم — صفحهٔ ورود عمداً همیشه تیره است. */
  const [tenantName, setTenantName] = useState('');
  const [tenantPhone, setTenantPhone] = useState('');
  useEffect(() => {
    if (kind === 'platform') return undefined;
    let alive = true;
    api('/public/intake/brand', { quiet401: true })
      .then((f) => {
        if (!alive || !f?.brand?.name) return;
        setTenantName(f.brand.name);
        setTenantPhone(f.brand.phone ?? '');
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [kind]);
  /* روی دامنهٔ مطب/شرکت این صفحه **مالِ کارکنان** است (بازبینیِ UX، بندِ ۱۰۸): بیمارِ دنبالِ نوبت که از ریشهٔ
     دامنه به این‌جا می‌رسید «ثبت‌نام» را می‌زد، موبایل و کد و سلفی می‌داد و آخرش «در انتظارِ تأییدِ مدیر» —
     یک درخواستِ حسابِ کارمندیِ بی‌جا. پس: عنوانِ «ورودِ کارکنانِ …»، تبِ «درخواستِ حسابِ کارمند» و راهِ بیمار.
     اولین حسابِ سامانه (راه‌اندازی) همان «ثبت‌نام» می‌ماند. */
  const staffHost = !!tenantName && !firstAdmin;
  useEffect(() => {
    document.title = tenantName ? `ورود — ${tenantName}` : 'عمل‌یار — ورود';
  }, [tenantName]);

  useEffect(() => {
    if (adding) return; // در حالتِ افزودن، کاربرِ واردشده نباید ریدایرکت شود
    if (!loading && user) navigate('/app', { replace: true });
  }, [loading, user, navigate, adding]);

  // WebOTP: وقتی پیامکِ کد می‌رسد، اندروید خودش کد را پر می‌کند
  useEffect(() => {
    if (step !== 'code' || !('OTPCredential' in window)) return;
    const ac = new AbortController();
    navigator.credentials
      .get({ otp: { transport: ['sms'] }, signal: ac.signal })
      .then((otp) => {
        if (otp?.code) setCode(otp.code);
      })
      .catch(() => {
        /* لغو یا عدمِ پشتیبانی */
      });
    return () => ac.abort();
  }, [step]);

  // WebOTP برای کدِ بازیابیِ رمز — همان رفتارِ کدِ ثبت‌نام
  useEffect(() => {
    if (forgot !== 'code' || !('OTPCredential' in window)) return undefined;
    const ac = new AbortController();
    navigator.credentials
      .get({ otp: { transport: ['sms'] }, signal: ac.signal })
      .then((otp) => { if (otp?.code) setFpCode(otp.code); })
      .catch(() => { /* لغو یا عدمِ پشتیبانی */ });
    return () => ac.abort();
  }, [forgot]);

  // اگر دیتابیس خالی است → تبِ ثبت‌نام و پیامِ «اولین حساب سوپرادمین می‌شود»
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await api('/auth/setup-status', { auth: false });
        if (alive && s?.needsSetup) {
          setFirstAdmin(true);
          setTab('signup');
        }
      } catch (e) {
        // ۴۰۴ فقط از میان‌افزارِ tenant می‌آید؛ یعنی دامنه به شرکتی وصل نیست.
        // خطای شبکه/سرور نباید صفحه را قفل کند، پس بقیهٔ خطاها نادیده می‌مانند.
        if (alive && e?.status === 404) setTenantMissing(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const doLogin = async (e) => {
    e.preventDefault();
    setErr('');
    setNotice('');
    setBusy(true);
    try {
      await login(identifier.trim(), password, remember);
      navigate('/app', { replace: true });
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const doBioLogin = async () => {
    setErr('');
    setBusy(true);
    try {
      await webauthnLogin();
      navigate('/app', { replace: true });
    } catch (e2) {
      // لغو توسط کاربر خطا نشان ندهد
      if (e2?.name !== 'NotAllowedError' && e2?.name !== 'AbortError') {
        setErr(e2.message || 'ورود با اثر انگشت ناموفق بود');
      }
    } finally {
      setBusy(false);
    }
  };

  const openForgot = () => {
    setErr(''); setNotice(''); setFpCode(''); setFpPass(''); setFpDev(''); setForgot('ask');
  };
  const closeForgot = () => { setErr(''); setForgot(null); };

  const sendResetCode = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const r = await api('/auth/password/request-otp', { method: 'POST', body: { identifier: toEnDigits(identifier).trim() } });
      setFpDev(r?.devCode ?? '');
      setFpCode(r?.devCode ?? '');
      setForgot('code');
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const doReset = async (e) => {
    e.preventDefault();
    const c = toEnDigits(fpCode).trim();
    if (c.length !== 6) { setErr('کدِ ۶رقمیِ پیامک را کامل بنویسید.'); return; }
    if (fpPass.length < 6) { setErr('رمزِ تازه دستِ‌کم ۶ نویسه باشد.'); return; }
    setErr('');
    setBusy(true);
    try {
      await api('/auth/password/reset', { method: 'POST', body: { identifier: toEnDigits(identifier).trim(), code: c, password: fpPass } });
      setForgot(null);
      setPassword('');
      setFpPass('');
      setFpCode('');
      setNotice('رمزِ تازه ذخیره شد؛ حالا با آن وارد شوید. نشست‌های قبلیِ این حساب بسته شدند.');
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const sendOtp = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const ph = toEnDigits(phone).trim();
      const r = await requestOtp(ph);
      setPhone(ph);
      if (r?.devCode) {
        setDevCode(r.devCode);
        setCode(r.devCode);
      }
      setStep('code');
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const verifyNow = async (c) => {
    if (busy) return;
    setErr('');
    setBusy(true);
    setOtpStatus('busy');
    try {
      const r = await verifyOtp(phone, toEnDigits(c ?? code).trim());
      setOtpStatus('success'); // باکس‌ها جمع می‌شوند → تیکِ سبز
      setTimeout(() => {
        setSignupToken(r.signupToken);
        setStep('form');
        setOtpStatus('idle');
        setBusy(false);
      }, 1050);
    } catch (e2) {
      setOtpStatus('error'); // باکس‌ها جمع می‌شوند → ضربدرِ قرمز
      setTimeout(() => {
        setOtpStatus('idle');
        setCode('');
        setErr(e2.message);
        setBusy(false);
      }, 1250);
    }
  };

  const doVerifyOtp = (e) => {
    e.preventDefault();
    verifyNow();
  };

  // کامل‌شدنِ ۶ رقم → تأییدِ خودکار (با مکثِ کوتاه تا انیمیشنِ تایپ دیده شود)
  useEffect(() => {
    if (step !== 'code' || otpStatus !== 'idle' || busy) return;
    if (toEnDigits(code).trim().length !== 6) return;
    const t = setTimeout(() => verifyNow(code), 380);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, step, otpStatus, busy]);

  const doSignup = async (e) => {
    e.preventDefault();
    setErr('');
    if (!selfie) {
      setErr('گرفتنِ عکس سلفی الزامی است.');
      return;
    }
    setBusy(true);
    try {
      const r = await completeSignup({
        signupToken,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        username: username.trim(),
        password,
        selfie,
      });
      if (r.pending) setStep('done');
      else navigate('/app', { replace: true }); // بوت‌استرپ: خودکار وارد شد
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const field = (label, node) => (
    <label className="lg-field">
      <span>{label}</span>
      {node}
    </label>
  );

  // دامنهٔ ناشناخته: نه فرمِ ورود، نه ثبت‌نام — فقط یک پیامِ روشن.
  if (tenantMissing) {
    return (
      <div className="lg theme-dark">
        <div className="lg-bg" aria-hidden="true" />
        <div className="lg-orbs" aria-hidden="true"><span className="orb o1" /><span className="orb o2" /></div>
        <div className="glass lg-card">
          <span className="glass-glow" aria-hidden="true" />
          <header className="lg-brand">
            <Mark className="lg-mark" gradient aria-hidden="true" />
            <div className="lg-word">عمل<span className="grad-text">‌یار</span></div>
          </header>
          <div className="lg-done">
            <div className="lg-done-ic" aria-hidden="true">
              <Info size={26} strokeWidth={2} />
            </div>
            <h2>شرکتی روی این نشانی نیست</h2>
            <p>
              نشانی <b dir="ltr">{typeof window === 'undefined' ? '' : window.location.hostname}</b> به هیچ شرکتی در عمل‌یار وصل نیست.
              اگر نشانی را دستی تایپ کرده‌اید، املای آن را بررسی کنید؛ در غیر این صورت با مدیر سامانه تماس بگیرید.
            </p>
            <a className="lg-btn" href="https://amalyar.com" style={{ display: 'block', textAlign: 'center', lineHeight: '52px', textDecoration: 'none' }}>رفتن به سایت عمل‌یار</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="lg theme-dark">
      <div className="lg-bg" aria-hidden="true" />
      <div className="lg-orbs" aria-hidden="true"><span className="orb o1" /><span className="orb o2" /></div>

      <div className="glass lg-card">
        <span className="glass-glow" aria-hidden="true" />
        <header className="lg-brand">
          <Mark className="lg-mark" gradient aria-hidden="true" />
          <div className="lg-word">عمل<span className="grad-text">‌یار</span></div>
          {tenantName && <p className="lg-tenant">ورودِ کارکنانِ {tenantName}</p>}
        </header>

        {adding && step !== 'done' && (
          <div className="lg-devcode">در حال افزودنِ حسابِ جدید — حسابِ فعلی حفظ می‌شود.</div>
        )}
        {firstAdmin && step !== 'done' && (
          <div className="lg-note-badge">این نخستین حساب است و مدیرِ کل (سوپرادمین) می‌شود.</div>
        )}

        {/* تب‌ها */}
        {step !== 'done' && !forgot && (
          <Tabs
            variant="inset"
            className="lg-tabs"
            label="ورود یا ثبت‌نام"
            value={tab}
            onChange={(k) => { setTab(k); setErr(''); setNotice(''); }}
            items={[{ key: 'login', label: 'ورود' }, { key: 'signup', label: staffHost ? 'درخواستِ حسابِ کارمند' : 'ثبت‌نام' }]}
          />
        )}

        {err && <div className="lg-err" role="alert">{err}</div>}
        {notice && <div className="lg-verified" role="status"><Check width="15" height="15" aria-hidden="true" /> {notice}</div>}

        {/* ── ورود ── */}
        {tab === 'login' && step !== 'done' && !forgot && (
          <form onSubmit={doLogin} className="lg-form">
            {field('نام کاربری یا موبایل',
              <input type="text" value={identifier} onChange={(e) => setIdentifier(e.target.value)}
                placeholder="نام کاربری یا ۰۹…" autoComplete="username" required />)}
            {field('رمز عبور',
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="رمز عبور" autoComplete="current-password" required />)}
            <button type="button" className="lg-link lg-forgot" onClick={openForgot} disabled={busy}>رمز را فراموش کرده‌ام</button>
            <label className="lg-remember">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span className="lg-check" aria-hidden="true" />
              مرا به خاطر بسپار
            </label>
            <button className="lg-btn" type="submit" disabled={busy}>{busy ? '…' : 'ورود'}</button>
            {canBio && (
              <>
                <div className="lg-divider"><span>یا</span></div>
                <button type="button" className="lg-bio" onClick={doBioLogin} disabled={busy}>
                  <Fingerprint width="21" height="21" />
                  ورود با اثر انگشت
                </button>
              </>
            )}
          </form>
        )}

        {/* ── بازیابیِ رمز: شناسه ← کد + رمزِ تازه ── */}
        {tab === 'login' && forgot === 'ask' && (
          <form onSubmit={sendResetCode} className="lg-form">
            <h2 className="lg-title">بازیابیِ رمز</h2>
            <p className="lg-fp-text">نام کاربری یا شمارهٔ موبایلِ حسابتان را بنویسید؛ یک کدِ ۶رقمی به موبایلِ همان حساب پیامک می‌شود.</p>
            {field('نام کاربری یا موبایل',
              <input type="text" value={identifier} onChange={(e) => setIdentifier(e.target.value)}
                placeholder="نام کاربری یا ۰۹…" autoComplete="username" enterKeyHint="send" required />)}
            <button className="lg-btn" type="submit" disabled={busy || !identifier.trim()}>{busy ? '…' : 'ارسالِ کد'}</button>
            {/* سوپرادمین کدِ پیامکی نمی‌گیرد (`resetTarget`، PF1) — بی این جمله منتظرِ پیامکی می‌ماند که نمی‌آید. */}
            <p className="lg-hint">رمزِ مدیرِ کل (سوپرادمین) با پیامک بازیابی نمی‌شود؛ از پشتیبانیِ عمل‌یار کمک بگیرید.</p>
            <button type="button" className="lg-link" onClick={closeForgot} disabled={busy}>
              <Back width="15" height="15" aria-hidden="true" /> بازگشت به ورود
            </button>
          </form>
        )}
        {tab === 'login' && forgot === 'code' && (
          <form onSubmit={doReset} className="lg-form">
            <h2 className="lg-title">رمزِ تازه</h2>
            <p className="lg-fp-text" role="status">
              اگر حسابی با «<bdi>{identifier.trim()}</bdi>» ثبت شده باشد، کدِ ۶رقمی به موبایلِ آن پیامک شد؛ تا ۵ دقیقه معتبر است.
            </p>
            {fpDev && <div className="lg-devcode">پیامک هنوز وصل نیست — کدِ تست: <b>{fpDev}</b></div>}
            <div className="lg-field">
              <span>کدِ تأیید</span>
              <OtpInput value={fpCode} onChange={setFpCode} status="idle" />
            </div>
            {field('رمزِ تازه',
              <PasswordInput value={fpPass} onChange={(e) => setFpPass(e.target.value)}
                placeholder="حداقل ۶ نویسه" autoComplete="new-password" required />)}
            <button className="lg-btn" type="submit" disabled={busy}>{busy ? '…' : 'ذخیرهٔ رمزِ تازه'}</button>
            <button type="button" className="lg-link" onClick={() => { setForgot('ask'); setFpCode(''); setErr(''); }} disabled={busy}>
              <Back width="15" height="15" aria-hidden="true" /> کد نرسید؟ ارسالِ دوباره
            </button>
            <button type="button" className="lg-link" onClick={closeForgot} disabled={busy}>بازگشت به ورود</button>
          </form>
        )}

        {/* ── ثبت‌نام: مرحلهٔ موبایل ── */}
        {tab === 'signup' && step === 'phone' && (
          <form onSubmit={sendOtp} className="lg-form">
            {field('شمارهٔ موبایل',
              <input type="tel" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)}
                placeholder="مثلاً ۰۹۱۲۳۴۵۶۷۸۹" autoComplete="tel" required />)}
            <button className="lg-btn" type="submit" disabled={busy}>{busy ? '…' : 'ارسالِ کدِ تأیید'}</button>
            <p className="lg-hint">کدِ تأیید با پیامک به موبایل شما ارسال می‌شود.</p>
          </form>
        )}

        {/* ── ثبت‌نام: مرحلهٔ تأییدِ کد ── */}
        {tab === 'signup' && step === 'code' && (
          <form onSubmit={doVerifyOtp} className="lg-form">
            {devCode && <div className="lg-devcode">پیامک هنوز وصل نیست — کدِ تست: <b>{devCode}</b></div>}
            <div className="lg-field">
              <span>کدِ تأیید (پیامک‌شده به {phone})</span>
              <OtpInput value={code} onChange={setCode} status={otpStatus} />
            </div>
            <button className="lg-btn" type="submit" disabled={busy || toEnDigits(code).length < 6}>
              {busy ? '…' : 'تأییدِ کد'}
            </button>
            <button type="button" className="lg-link" disabled={busy}
              onClick={() => { setStep('phone'); setCode(''); setErr(''); }}>
              <Back width="15" height="15" aria-hidden="true" /> اصلاحِ شماره / ارسالِ دوباره
            </button>
          </form>
        )}

        {/* ── ثبت‌نام: مرحلهٔ پروفایل + سلفی ── */}
        {tab === 'signup' && step === 'form' && (
          <form onSubmit={doSignup} className="lg-form">
            <div className="lg-verified">
              <Check width="15" height="15" aria-hidden="true" /> شمارهٔ <bdi dir="ltr">{phone}</bdi> تأیید شد
            </div>
            <div className="lg-row2">
              {field('نام', <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" required />)}
              {field('نام خانوادگی', <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" required />)}
            </div>
            {field('نام کاربری',
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                placeholder="لاتین/عدد" autoComplete="username" required />)}
            {field('رمز عبور',
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="حداقل ۶ کاراکتر" autoComplete="new-password" required />)}
            <div className="lg-field">
              <span>عکس سلفی</span>
              <SelfieCapture value={selfie} onCapture={setSelfie} />
            </div>
            <button className="lg-btn" type="submit" disabled={busy}>{busy ? '…' : 'ثبت‌نام'}</button>
          </form>
        )}

        {/* ── ثبت‌نام: پیامِ در انتظار تأیید ── */}
        {step === 'done' && (
          <div className="lg-done">
            <div className="lg-done-ic" aria-hidden="true">
              <Clock size={26} strokeWidth={2} />
            </div>
            <h2>ثبت‌نام انجام شد</h2>
            <p>حسابِ شما ساخته شد و <b>در انتظارِ تأییدِ مدیر</b> است. پس از تأیید و تعیینِ سطحِ دسترسی، می‌توانید وارد شوید.</p>
            <button className="lg-btn" onClick={() => { setStep('phone'); setTab('login'); }}>بازگشت به ورود</button>
          </div>
        )}

        {staffHost && !adding && step !== 'done' && !forgot && (
          <p className="lg-patient">
            <Info width="16" height="16" aria-hidden="true" />
            <span>
              بیمار هستید؟ این صفحه برای کارکنان است. برای نوبت
              {tenantPhone
                ? <> با <a href={`tel:${toEnDigits(tenantPhone).replace(/[^0-9+]/g, '')}`}><bdi dir="ltr">{tenantPhone.replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d])}</bdi></a> تماس بگیرید</>
                : ' با ما تماس بگیرید'}
              {' '}یا از لینکِ ثبت‌نامی که برایتان فرستاده شده استفاده کنید.
            </span>
          </p>
        )}

        {step !== 'done' && (
          adding
            ? <button type="button" className="lg-back" style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }} onClick={() => navigate('/app')}>انصراف و بازگشت به سامانه</button>
            : backToSite && <a className="lg-back" href="/">بازگشت به سایت</a>
        )}
      </div>
    </div>
  );
}
