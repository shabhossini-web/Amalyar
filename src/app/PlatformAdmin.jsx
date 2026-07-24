import { useEffect, useMemo, useState } from 'react';

const API = typeof window === 'undefined' ? '/api/platform' : `${window.location.origin}/api/platform`;

function csrfCookie() {
  if (typeof document === 'undefined') return '';
  const row = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('amalyar_platform_csrf='));
  return row ? decodeURIComponent(row.slice(row.indexOf('=') + 1)) : '';
}

async function platformApi(path, { method = 'GET', body, csrf = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrf) headers['X-CSRF-Token'] = csrfCookie();

  const response = await fetch(`${API}${path}`, {
    method,
    credentials: 'include',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!response.ok) {
    const raw = data && typeof data === 'object' ? data.message : null;
    const message = Array.isArray(raw) ? raw.join('، ') : raw || `خطای سرور (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

const STATUS = {
  queued: ['در صف', 'wait'],
  running: ['در حال ساخت', 'run'],
  succeeded: ['آماده', 'ok'],
  failed: ['ناموفق', 'fail'],
};

const faDate = (value) => value ? new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';

export default function PlatformAdmin() {
  const [phase, setPhase] = useState('loading');
  const [authOptions, setAuthOptions] = useState([]);
  const [phoneRef, setPhoneRef] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [snapshot, setSnapshot] = useState({ tenants: [], jobs: [] });
  const [form, setForm] = useState({ name: '', slug: '', hostname: '' });
  const [hostnameEdited, setHostnameEdited] = useState(false);

  const activeJobs = useMemo(
    () => snapshot.jobs.some((job) => job.status === 'queued' || job.status === 'running'),
    [snapshot.jobs],
  );

  const load = async () => {
    const data = await platformApi('/snapshot');
    setSnapshot(data);
  };

  useEffect(() => {
    document.title = 'عمل‌یار — مدیریت پلتفرم';
    platformApi('/auth/me')
      .then(async () => { setPhase('dashboard'); await load(); })
      .catch(async (sessionError) => {
        try {
          const data = await platformApi('/auth/options');
          const options = Array.isArray(data?.options) ? data.options : [];
          setAuthOptions(options);
          setPhoneRef(options.length > 0 ? options[0].ref : '');
          setPhase('login');
          if (options.length === 0) setNotice('هیچ مدیر مجازی در سرور ثبت نشده است.');
        } catch (optionsError) {
          setPhase('login');
          if (sessionError.status === 404 || optionsError.status === 404) {
            setNotice('پنل مدیریت هنوز در سرور فعال نشده است.');
          } else {
            setNotice(optionsError.message);
          }
        }
      });
  }, []);

  useEffect(() => {
    if (phase !== 'dashboard' || !activeJobs) return undefined;
    const timer = setInterval(() => load().catch(() => undefined), 4000);
    return () => clearInterval(timer);
  }, [phase, activeJobs]);

  useEffect(() => {
    if (
      phase !== 'verify'
      || typeof window === 'undefined'
      || !('OTPCredential' in window)
      || !navigator.credentials
    ) return undefined;

    const controller = new AbortController();
    navigator.credentials.get({
      otp: { transport: ['sms'] },
      signal: controller.signal,
    }).then((credential) => {
      const nextCode = credential?.code?.replace(/\D/g, '').slice(0, 6);
      if (nextCode) setCode(nextCode);
    }).catch(() => undefined);

    return () => controller.abort();
  }, [phase]);

  const requestOtp = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice('');
    try {
      await platformApi('/auth/request-otp', { method: 'POST', body: { phoneRef } });
      setPhase('verify');
      setNotice('اگر این شماره مجاز باشد، کد تا چند لحظه دیگر ارسال می‌شود.');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice('');
    try {
      await platformApi('/auth/verify', { method: 'POST', body: { phoneRef, code } });
      setCode('');
      setPhase('dashboard');
      await load();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    try {
      await platformApi('/auth/logout', { method: 'POST', csrf: true });
    } catch {
      // پاک‌شدن session سمت سرور هدف است؛ در هر حالت UI به ورود برمی‌گردد.
    } finally {
      setSnapshot({ tenants: [], jobs: [] });
      setPhase('login');
      setBusy(false);
    }
  };

  const changeSlug = (value) => {
    const slug = value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    setForm((current) => ({
      ...current,
      slug,
      hostname: hostnameEdited ? current.hostname : (slug ? `${slug}.amalyar.com` : ''),
    }));
  };

  const createJob = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice('');
    try {
      const job = await platformApi('/provisioning-jobs', {
        method: 'POST',
        csrf: true,
        body: {
          name: form.name.trim(),
          slug: form.slug.trim(),
          hostname: form.hostname.trim().toLowerCase(),
        },
      });
      setForm({ name: '', slug: '', hostname: '' });
      setHostnameEdited(false);
      setNotice(`درخواست ${job.slug} وارد صف شد.`);
      await load();
    } catch (error) {
      if (error.status === 401) setPhase('login');
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };

  const retry = async (id) => {
    setBusy(true);
    setNotice('');
    try {
      await platformApi(`/provisioning-jobs/${id}/retry`, { method: 'POST', csrf: true });
      setNotice('درخواست دوباره وارد صف شد.');
      await load();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="pa" dir="rtl">
      <style>{styles}</style>
      <div className="pa-glow pa-g1" aria-hidden="true" />
      <div className="pa-glow pa-g2" aria-hidden="true" />

      {phase === 'loading' && <section className="pa-card pa-auth"><div className="pa-loader" />در حال بررسی نشست امن…</section>}

      {(phase === 'login' || phase === 'verify') && (
        <section className="pa-card pa-auth">
          <div className="pa-mark">ع</div>
          <p className="pa-kicker">AMALYAR PLATFORM</p>
          <h1>مدیریت پلتفرم</h1>
          <p className="pa-sub">این بخش از حساب‌های شرکت‌ها کاملاً جداست و فقط برای مدیران مجاز پلتفرم فعال می‌شود.</p>

          {phase === 'login' ? (
            <form onSubmit={requestOtp}>
              <label>مدیر ثبت‌شده در سرور</label>
              {authOptions.length > 1 ? (
                <select value={phoneRef} onChange={(event) => setPhoneRef(event.target.value)} required>
                  {authOptions.map((option) => <option key={option.ref} value={option.ref}>{option.label}</option>)}
                </select>
              ) : (
                <div className="pa-identity">شماره مجاز از تنظیم امن سرور انتخاب می‌شود.</div>
              )}
              <button disabled={busy || !phoneRef}>{busy ? 'در حال ارسال…' : 'ارسال کد ورود'}</button>
            </form>
          ) : (
            <form onSubmit={verifyOtp}>
              <label>کد شش‌رقمی</label>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                dir="ltr"
                placeholder="••••••"
                pattern="[0-9]{6}"
                required
                autoFocus
              />
              <button disabled={busy || code.length !== 6}>{busy ? 'در حال ورود…' : 'ورود امن'}</button>
              <button className="pa-link" type="button" onClick={() => { setPhase('login'); setCode(''); setNotice(''); }}>ارسال دوباره کد</button>
            </form>
          )}
          {notice && <div className="pa-notice">{notice}</div>}
          <div className="pa-security">کوکی HttpOnly · نشست ۳۰ دقیقه‌ای · محافظت CSRF · ثبت رویداد امنیتی</div>
        </section>
      )}

      {phase === 'dashboard' && (
        <div className="pa-shell">
          <header className="pa-head">
            <div>
              <p className="pa-kicker">AMALYAR CONTROL PLANE</p>
              <h1>شرکت‌ها و provisioning</h1>
            </div>
            <button className="pa-logout" onClick={logout} disabled={busy}>خروج امن</button>
          </header>

          {notice && <div className="pa-notice pa-wide">{notice}</div>}

          <section className="pa-grid">
            <form className="pa-card pa-create" onSubmit={createJob}>
              <div className="pa-section-title">
                <span>۱</span>
                <div><h2>شرکت جدید</h2><p>ساخت دیتابیس و migration توسط Worker جدا انجام می‌شود.</p></div>
              </div>
              <label>نام شرکت</label>
              <input value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} minLength={2} maxLength={120} required placeholder="مثلاً مرکز جراحی نمونه" />
              <label>شناسه انگلیسی</label>
              <input value={form.slug} onChange={(e) => changeSlug(e.target.value)} dir="ltr" minLength={3} maxLength={40} pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]" required placeholder="sample-center" />
              <label>دامنه</label>
              <input
                value={form.hostname}
                onChange={(e) => { setHostnameEdited(true); setForm((s) => ({ ...s, hostname: e.target.value.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') })); }}
                dir="ltr"
                required
                placeholder="sample-center.amalyar.com"
              />
              <button disabled={busy}>{busy ? 'در حال ثبت…' : 'ساخت امن شرکت'}</button>
              <p className="pa-hint">رمز دیتابیس در UI یا API نمایش داده نمی‌شود.</p>
            </form>

            <section className="pa-card">
              <div className="pa-section-title">
                <span>{snapshot.tenants.length}</span>
                <div><h2>شرکت‌های فعال</h2><p>هر شرکت دیتابیس و نقش PostgreSQL مستقل دارد.</p></div>
              </div>
              <div className="pa-list">
                {snapshot.tenants.length === 0 && <div className="pa-empty">هنوز شرکتی ساخته نشده است.</div>}
                {snapshot.tenants.map((tenant) => (
                  <article key={tenant.id} className="pa-row">
                    <div><b>{tenant.name}</b><small dir="ltr">{tenant.hostname || tenant.slug}</small></div>
                    <span className={tenant.status === 'active' ? 'pa-badge ok' : 'pa-badge'}>{tenant.status === 'active' ? 'فعال' : tenant.status}</span>
                  </article>
                ))}
              </div>
            </section>
          </section>

          <section className="pa-card pa-jobs">
            <div className="pa-section-title">
              <span>{snapshot.jobs.length}</span>
              <div><h2>صف عملیات</h2><p>وضعیت بدون نمایش هیچ secret یا URL اتصال به‌روزرسانی می‌شود.</p></div>
              <button className="pa-refresh" type="button" onClick={() => load().catch((e) => setNotice(e.message))}>به‌روزرسانی</button>
            </div>
            <div className="pa-job-grid">
              {snapshot.jobs.length === 0 && <div className="pa-empty">درخواستی در صف نیست.</div>}
              {snapshot.jobs.map((job) => {
                const status = STATUS[job.status] || [job.status, ''];
                return (
                  <article key={job.id} className="pa-job">
                    <div className="pa-job-top"><b>{job.name}</b><span className={`pa-badge ${status[1]}`}>{status[0]}</span></div>
                    <code dir="ltr">{job.slug}</code>
                    <small dir="ltr">{job.hostname}</small>
                    <div className="pa-job-foot">
                      <span>{faDate(job.updatedAt)}</span>
                      {job.status === 'failed' && <button type="button" disabled={busy} onClick={() => retry(job.id)}>تلاش مجدد</button>}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

const styles = `
.pa{min-height:100vh;background:#07051a;color:#f4f1ff;font-family:Vazirmatn,system-ui,sans-serif;padding:24px;position:relative;overflow:hidden}
.pa *{box-sizing:border-box}.pa-glow{position:fixed;border-radius:50%;filter:blur(110px);pointer-events:none;opacity:.28}.pa-g1{width:480px;height:480px;background:#7c3aed;top:-220px;right:-160px}.pa-g2{width:420px;height:420px;background:#00d4ff;bottom:-240px;left:-180px;opacity:.12}
.pa-shell{width:min(1120px,100%);margin:auto;position:relative}.pa-card{background:rgba(18,13,49,.86);border:1px solid rgba(139,92,246,.28);border-radius:24px;box-shadow:0 24px 80px rgba(0,0,0,.38);backdrop-filter:blur(18px)}
.pa-auth{width:min(460px,100%);margin:7vh auto;padding:34px;text-align:center;position:relative}.pa-mark{width:62px;height:62px;margin:0 auto 12px;border-radius:18px;display:grid;place-items:center;font-size:34px;font-weight:900;background:linear-gradient(135deg,#a855f7,#5b21b6);box-shadow:0 0 40px rgba(168,85,247,.35)}
.pa-kicker{color:#22d3ee;font-size:11px;letter-spacing:2px;font-weight:800}.pa h1{font-size:clamp(25px,5vw,38px);margin:7px 0}.pa-sub{color:#aaa3ca;font-size:14px;line-height:2;margin:0 auto 24px;max-width:370px}
.pa form{display:grid;gap:10px;text-align:right}.pa label{font-size:12px;color:#c7c2df;margin-top:5px}.pa input,.pa select{width:100%;height:52px;border-radius:13px;border:1px solid rgba(139,92,246,.3);background:rgba(3,2,18,.62);color:#fff;padding:0 15px;font:inherit;outline:none}.pa input:focus,.pa select:focus{border-color:#a855f7;box-shadow:0 0 0 3px rgba(168,85,247,.12)}.pa-identity{min-height:52px;display:flex;align-items:center;border-radius:13px;border:1px solid rgba(139,92,246,.2);background:rgba(139,92,246,.07);color:#aaa4c6;padding:12px 15px;font-size:12px;line-height:1.8}
.pa button{font:inherit;border:0;cursor:pointer}.pa form>button:not(.pa-link){height:52px;border-radius:13px;background:linear-gradient(135deg,#a855f7,#6d28d9);color:#fff;font-weight:900;margin-top:10px}.pa button:disabled{opacity:.5;cursor:not-allowed}.pa-link{color:#a9a2cb;background:transparent;padding:10px}
.pa-notice{margin-top:16px;padding:12px 15px;border-radius:12px;background:rgba(34,211,238,.08);border:1px solid rgba(34,211,238,.22);color:#c8f7ff;font-size:13px;line-height:1.8}.pa-security{margin-top:22px;color:#6f6991;font-size:10px;line-height:1.8}
.pa-loader{width:28px;height:28px;margin:0 auto 15px;border:3px solid rgba(168,85,247,.2);border-top-color:#a855f7;border-radius:50%;animation:paSpin .8s linear infinite}@keyframes paSpin{to{transform:rotate(360deg)}}
.pa-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:16px 0 24px}.pa-head h1{margin:2px 0}.pa-logout,.pa-refresh{color:#ddd7f5;background:rgba(255,255,255,.05);border:1px solid rgba(139,92,246,.24)!important;border-radius:12px;padding:10px 15px}.pa-wide{margin:0 0 18px}
.pa-grid{display:grid;grid-template-columns:minmax(300px,.8fr) minmax(340px,1.2fr);gap:18px}.pa-create,.pa-grid>.pa-card,.pa-jobs{padding:24px}.pa-section-title{display:flex;align-items:center;gap:12px;margin-bottom:18px}.pa-section-title>span{min-width:42px;height:42px;border-radius:12px;display:grid;place-items:center;background:rgba(168,85,247,.13);color:#c084fc;font-weight:900}.pa-section-title h2{font-size:18px;margin:0}.pa-section-title p{font-size:11px;color:#8982aa;margin:3px 0 0}.pa-section-title .pa-refresh{margin-right:auto}
.pa-hint{font-size:10px;color:#77708f;text-align:center}.pa-list{display:grid;gap:10px;max-height:430px;overflow:auto}.pa-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px;border-radius:14px;background:rgba(255,255,255,.025);border:1px solid rgba(139,92,246,.12)}.pa-row b,.pa-row small{display:block}.pa-row small{color:#817aa2;font-size:10px;margin-top:4px}
.pa-badge{font-size:10px;padding:5px 10px;border-radius:99px;background:rgba(251,191,36,.1);color:#fbbf24;border:1px solid rgba(251,191,36,.22);white-space:nowrap}.pa-badge.ok{background:rgba(52,211,153,.1);color:#34d399;border-color:rgba(52,211,153,.22)}.pa-badge.run{color:#22d3ee;background:rgba(34,211,238,.1);border-color:rgba(34,211,238,.22)}.pa-badge.fail{color:#fb7185;background:rgba(251,113,133,.1);border-color:rgba(251,113,133,.22)}
.pa-jobs{margin-top:18px}.pa-job-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.pa-job{padding:15px;border-radius:15px;border:1px solid rgba(139,92,246,.14);background:rgba(255,255,255,.02)}.pa-job-top{display:flex;justify-content:space-between;gap:8px}.pa-job code,.pa-job small{display:block;color:#8f88af;font-size:10px;margin-top:8px;overflow:hidden;text-overflow:ellipsis}.pa-job-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:13px;font-size:9px;color:#6f688d}.pa-job-foot button{color:#fda4af;background:rgba(251,113,133,.08);border-radius:8px;padding:6px 8px}.pa-empty{padding:24px;text-align:center;color:#817aa2;font-size:13px}
@media(max-width:760px){.pa{padding:14px}.pa-grid{grid-template-columns:1fr}.pa-job-grid{grid-template-columns:1fr}.pa-auth{margin:2vh auto;padding:26px 20px}.pa-head{align-items:flex-start}.pa-head h1{font-size:24px}.pa-create,.pa-grid>.pa-card,.pa-jobs{padding:18px}.pa-section-title{align-items:flex-start}}
`;
