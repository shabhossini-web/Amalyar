import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Mark from '../components/Mark.jsx';
import { useAuth } from './auth.jsx';
import { api } from '../lib/api.js';
import './login.css';

export default function Login() {
  const { user, loading, login, register } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState('login'); // login | setup
  const [checking, setChecking] = useState(true);
  const [identifier, setIdentifier] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = 'عمل‌یار — ورود';
  }, []);

  // اگر قبلاً وارد شده، مستقیم به سامانه
  useEffect(() => {
    if (!loading && user) navigate('/app', { replace: true });
  }, [loading, user, navigate]);

  // آیا دیتابیس خالی است؟ → حالتِ «ساختِ اولین مدیر»
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await api('/auth/setup-status', { auth: false });
        if (alive && s?.needsSetup) setMode('setup');
      } catch {
        /* اگر نشد، همان حالتِ ورود */
      } finally {
        if (alive) setChecking(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      if (mode === 'setup') {
        const id = identifier.trim();
        const isPhone = /^0\d{10}$/.test(id);
        await register({
          [isPhone ? 'phone' : 'username']: id,
          password,
          displayName: displayName.trim() || undefined,
        });
      } else {
        await login(identifier.trim(), password);
      }
      navigate('/app', { replace: true });
    } catch (e2) {
      setErr(e2.message || 'خطایی رخ داد');
    } finally {
      setBusy(false);
    }
  };

  const setup = mode === 'setup';

  return (
    <div className="lg">
      <div className="lg-bg" aria-hidden="true" />
      <div className="lg-orbs" aria-hidden="true"><span className="orb o1" /><span className="orb o2" /></div>

      <form className="glass lg-card" onSubmit={submit}>
        <span className="glass-glow" aria-hidden="true" />
        <header className="lg-brand">
          <Mark className="lg-mark" gradient aria-hidden="true" />
          <div className="lg-word">عمل<span className="grad-text">‌یار</span></div>
        </header>

        <h1 className="lg-title">{setup ? 'ساختِ اولین مدیر' : 'ورود به سامانه'}</h1>
        <p className="lg-sub">
          {setup ? 'این نخستین حساب است و مدیرِ کل می‌شود.' : 'با نام کاربری یا شمارهٔ موبایل وارد شوید.'}
        </p>

        {err && <div className="lg-err" role="alert">{err}</div>}

        {setup && (
          <label className="lg-field">
            <span>نام نمایشی</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="مثلاً شهاب"
              autoComplete="name"
            />
          </label>
        )}

        <label className="lg-field">
          <span>نام کاربری یا شمارهٔ موبایل</span>
          <input
            type="text"
            inputMode="text"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="username یا 09..."
            autoComplete="username"
            required
          />
        </label>

        <label className="lg-field">
          <span>رمز عبور</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="رمز عبور"
            autoComplete={setup ? 'new-password' : 'current-password'}
            required
          />
        </label>

        <button className="lg-btn" type="submit" disabled={busy || checking}>
          {busy ? '…' : setup ? 'ساخت و ورود' : 'ورود'}
        </button>

        <a className="lg-back" href="/">بازگشت به سایت</a>
      </form>
    </div>
  );
}
