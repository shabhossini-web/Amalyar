import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Mark from '../components/Mark.jsx';
import SelfieCapture from './SelfieCapture.jsx';
import { useAuth } from './auth.jsx';
import { api } from '../lib/api.js';
import './login.css';

const toEnDigits = (s) =>
  (s || '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

export default function Login() {
  const { user, loading, login, requestOtp, verifySignup } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState('login'); // login | signup
  const [firstAdmin, setFirstAdmin] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // login
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  // signup
  const [step, setStep] = useState('phone'); // phone | form | done
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [selfie, setSelfie] = useState('');

  useEffect(() => {
    document.title = 'عمل‌یار — ورود';
  }, []);

  useEffect(() => {
    if (!loading && user) navigate('/app', { replace: true });
  }, [loading, user, navigate]);

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
      await login(identifier.trim(), password);
      navigate('/app', { replace: true });
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
      setStep('form');
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const doSignup = async (e) => {
    e.preventDefault();
    setErr('');
    if (!selfie) {
      setErr('گرفتنِ عکس سلفی الزامی است.');
      return;
    }
    setBusy(true);
    try {
      const r = await verifySignup({
        phone,
        code: toEnDigits(code).trim(),
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
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="رمز عبور" autoComplete="current-password" required />)}
            <button className="lg-btn" type="submit" disabled={busy}>{busy ? '…' : 'ورود'}</button>
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

        {/* ── ثبت‌نام: مرحلهٔ فرم + سلفی ── */}
        {tab === 'signup' && step === 'form' && (
          <form onSubmit={doSignup} className="lg-form">
            {devCode && <div className="lg-devcode">پیامک هنوز وصل نیست — کدِ تست: <b>{devCode}</b></div>}
            {field('کدِ تأیید (پیامک‌شده به ' + phone + ')',
              <input type="text" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)}
                placeholder="کد ۶ رقمی" required />)}
            <div className="lg-row2">
              {field('نام', <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />)}
              {field('نام خانوادگی', <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} required />)}
            </div>
            {field('نام کاربری',
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                placeholder="لاتین/عدد" autoComplete="username" required />)}
            {field('رمز عبور',
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="حداقل ۶ کاراکتر" autoComplete="new-password" required />)}
            <div className="lg-field">
              <span>عکس سلفی</span>
              <SelfieCapture value={selfie} onCapture={setSelfie} />
            </div>
            <button className="lg-btn" type="submit" disabled={busy}>{busy ? '…' : 'ثبت‌نام'}</button>
            <button type="button" className="lg-link" onClick={() => { setStep('phone'); setErr(''); }}>← اصلاحِ شماره</button>
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

        {step !== 'done' && <a className="lg-back" href="/">بازگشت به سایت</a>}
      </div>
    </div>
  );
}
