import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Mark from '../components/Mark.jsx';
import SelfieCapture from './SelfieCapture.jsx';
import OtpInput from './OtpInput.jsx';
import PasswordInput from './PasswordInput.jsx';

const Finger = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />
    <path d="M14 13.12c0 2.38 0 6.38-1 8.88" />
    <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" />
    <path d="M2 12a10 10 0 0 1 18-6" />
    <path d="M2 16h.01" />
    <path d="M21.8 16c.2-2 .131-5.354 0-6" />
    <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" />
    <path d="M8.65 22c.21-.66.45-1.32.57-2" />
    <path d="M9 6.8a6 6 0 0 1 9 5.2v2" />
  </svg>
);
import { useAuth } from './auth.jsx';
import { api } from '../lib/api.js';
import './login.css';

const toEnDigits = (s) =>
  (s || '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

export default function Login() {
  const { user, loading, login, requestOtp, verifyOtp, completeSignup, webauthnLogin } = useAuth();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const adding = sp.get('add') === '1'; // حالتِ «افزودن حساب» — حسابِ فعلی حفظ می‌شود

  const [tab, setTab] = useState('login'); // login | signup
  const [firstAdmin, setFirstAdmin] = useState(false);
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

  useEffect(() => {
    document.title = 'عمل‌یار — ورود';
  }, []);

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
      } catch {
        /* بی‌خیال */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const doLogin = async (e) => {
    e.preventDefault();
    setErr('');
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

  return (
    <div className="lg">
      <div className="lg-bg" aria-hidden="true" />
      <div className="lg-orbs" aria-hidden="true"><span className="orb o1" /><span className="orb o2" /></div>

      <div className="glass lg-card">
        <span className="glass-glow" aria-hidden="true" />
        <header className="lg-brand">
          <Mark className="lg-mark" gradient aria-hidden="true" />
          <div className="lg-word">عمل<span className="grad-text">‌یار</span></div>
        </header>

        {adding && step !== 'done' && (
          <div className="lg-devcode">در حال افزودنِ حسابِ جدید — حسابِ فعلی حفظ می‌شود.</div>
        )}
        {firstAdmin && step !== 'done' && (
          <div className="lg-note-badge">این نخستین حساب است و مدیرِ کل (سوپرادمین) می‌شود.</div>
        )}

        {/* تب‌ها */}
        {step !== 'done' && (
          <div className="lg-tabs" role="tablist">
            <button className={tab === 'login' ? 'on' : ''} onClick={() => { setTab('login'); setErr(''); }} role="tab">ورود</button>
            <button className={tab === 'signup' ? 'on' : ''} onClick={() => { setTab('signup'); setErr(''); }} role="tab">ثبت‌نام</button>
          </div>
        )}

        {err && <div className="lg-err" role="alert">{err}</div>}

        {/* ── ورود ── */}
        {tab === 'login' && step !== 'done' && (
          <form onSubmit={doLogin} className="lg-form">
            {field('نام کاربری یا موبایل',
              <input type="text" value={identifier} onChange={(e) => setIdentifier(e.target.value)}
                placeholder="username یا 09..." autoComplete="username" required />)}
            {field('رمز عبور',
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="رمز عبور" autoComplete="current-password" required />)}
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
                  <Finger width="21" height="21" />
                  ورود با اثر انگشت
                </button>
              </>
            )}
          </form>
        )}

        {/* ── ثبت‌نام: مرحلهٔ موبایل ── */}
        {tab === 'signup' && step === 'phone' && (
          <form onSubmit={sendOtp} className="lg-form">
            {field('شمارهٔ موبایل',
              <input type="tel" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)}
                placeholder="09..." autoComplete="tel" required />)}
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
              onClick={() => { setStep('phone'); setCode(''); setErr(''); }}>← اصلاحِ شماره / ارسالِ دوباره</button>
          </form>
        )}

        {/* ── ثبت‌نام: مرحلهٔ پروفایل + سلفی ── */}
        {tab === 'signup' && step === 'form' && (
          <form onSubmit={doSignup} className="lg-form">
            <div className="lg-verified">شمارهٔ {phone} تأیید شد ✓</div>
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
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 7v5l3 2" /></svg>
            </div>
            <h2>ثبت‌نام انجام شد</h2>
            <p>حسابِ شما ساخته شد و <b>در انتظارِ تأییدِ مدیر</b> است. پس از تأیید و تعیینِ سطحِ دسترسی، می‌توانید وارد شوید.</p>
            <button className="lg-btn" onClick={() => { setStep('phone'); setTab('login'); }}>بازگشت به ورود</button>
          </div>
        )}

        {step !== 'done' && (
          adding
            ? <button type="button" className="lg-back" style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }} onClick={() => navigate('/app')}>انصراف و بازگشت به سامانه</button>
            : <a className="lg-back" href="/">بازگشت به سایت</a>
        )}
      </div>
    </div>
  );
}
