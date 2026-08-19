import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import Mark from '../components/Mark.jsx';
import './platform.css';
import Overlay from '../ui/Overlay.jsx';

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
  // ⚠️ اگر API بالا نباشد، سرورِ استاتیک همان index.html را با ۲۰۰ برمی‌گرداند.
  // بدونِ این بررسی، رشتهٔ HTML به‌جای snapshot می‌نشست و صفحه با
  // «Cannot read properties of undefined» کاملاً سفید می‌شد — خطایی که هیچ
  // ربطی به علتِ واقعی نداشت.
  if (response.ok && typeof data === 'string') {
    const error = new Error('پاسخِ سرور معتبر نیست؛ به نظر می‌رسد API در دسترس نیست.');
    error.status = 502;
    throw error;
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

const DELETE_STATUS = {
  queued: ['در صف حذف', 'wait'],
  running: ['در حال حذف', 'run'],
  succeeded: ['حذف شد', 'ok'],
  failed: ['حذف ناموفق', 'fail'],
};

const TENANT_STATUS = {
  active: ['فعال', 'ok'],
  provisioning: ['در حال ساخت', 'run'],
  deleting: ['در حال حذف', 'fail'],
};

const faDate = (value) => value ? new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
const faNum = (value) => String(value ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const toEn = (value) => String(value ?? '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[^0-9]/g, '');

/** بخش‌های تعرفه‌ای — باید با SECTORS سمتِ سرور یکی بماند. */
const TARIFF_SECTORS = {
  private: 'خصوصی', public: 'دولتی', nonprofit: 'عمومی غیردولتی', charity: 'خیریه', military: 'نیروهای مسلح',
};

/**
 * دامنه‌های یک شرکت، با سازگاری با پاسخِ قدیمیِ سرور که فقط `hostname` داشت.
 * پنل و API جدا دیپلوی می‌شوند؛ اگر یکی زودتر بالا بیاید، فهرست نباید خالی شود.
 */
const domainsOf = (tenant) => (
  Array.isArray(tenant?.domains) && tenant.domains.length
    ? tenant.domains
    : (tenant?.hostname ? [{ hostname: tenant.hostname, primary: true }] : [])
);

/// یک ثابت، تا هیچ‌جا snapshot با آرایهٔ جاافتاده ست نشود (باگِ واقعیِ خروج).
const EMPTY_SNAPSHOT = { tenants: [], jobs: [], deletions: [] };

export default function PlatformAdmin() {
  const [phase, setPhase] = useState('loading');
  const [authOptions, setAuthOptions] = useState([]);
  const [phoneRef, setPhoneRef] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [form, setForm] = useState({ name: '', slug: '', hostname: '' });
  const [hostnameEdited, setHostnameEdited] = useState(false);

  // مودالِ حذف — دو مرحله: ارسالِ کد، سپس تایپِ شناسه + کد
  const [doomed, setDoomed] = useState(null); // شرکتِ در دستِ حذف
  const [delStep, setDelStep] = useState('confirm'); // confirm | code
  const [delSlug, setDelSlug] = useState('');
  const [delCode, setDelCode] = useState('');
  const [delError, setDelError] = useState('');

  const activeJobs = useMemo(
    () => [...snapshot.jobs, ...snapshot.deletions]
      .some((job) => job.status === 'queued' || job.status === 'running'),
    [snapshot.jobs, snapshot.deletions],
  );

  const stats = useMemo(() => {
    const all = [...snapshot.jobs, ...snapshot.deletions];
    return {
      active: snapshot.tenants.filter((t) => t.status === 'active').length,
      building: snapshot.tenants.filter((t) => t.status !== 'active').length,
      failed: all.filter((j) => j.status === 'failed').length,
      queued: all.filter((j) => j.status === 'queued' || j.status === 'running').length,
    };
  }, [snapshot]);

  /**
   * snapshot همیشه هر سه آرایه را دارد، حتی اگر سرور یکی را نفرستد.
   * کنسولِ مدیریت نباید با یک فیلدِ غایب کلاً از کار بیفتد.
   */
  const load = async () => {
    const data = await platformApi('/snapshot');
    setSnapshot({
      tenants: Array.isArray(data?.tenants) ? data.tenants : [],
      jobs: Array.isArray(data?.jobs) ? data.jobs : [],
      deletions: Array.isArray(data?.deletions) ? data.deletions : [],
    });
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

  // اتوفیلِ کدِ پیامک — هم برای ورود و هم برای تأییدِ حذف
  const awaitingCode = phase === 'verify' ? 'login' : delStep === 'code' && doomed ? 'delete' : null;
  useEffect(() => {
    if (
      !awaitingCode
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
      if (!nextCode) return;
      if (awaitingCode === 'login') setCode(nextCode);
      else setDelCode(nextCode);
    }).catch(() => undefined);

    return () => controller.abort();
  }, [awaitingCode]);

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
      setSnapshot(EMPTY_SNAPSHOT);
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

  const openDelete = (tenant) => {
    setDoomed(tenant);
    setDelStep('confirm');
    setDelSlug('');
    setDelCode('');
    setDelError('');
  };

  const closeDelete = () => {
    setDoomed(null);
    setDelError('');
  };

  /** مرحلهٔ ۱ — شناسه تأیید شد، کدِ یکبارمصرف برای همین شرکت ارسال شود. */
  const sendDeleteCode = async () => {
    if (busy || !doomed) return;
    if (delSlug.trim().toLowerCase() !== doomed.slug) {
      setDelError('شناسهٔ واردشده با شناسهٔ شرکت یکی نیست.');
      return;
    }
    setBusy(true);
    setDelError('');
    try {
      await platformApi(`/tenants/${doomed.id}/deletion-otp`, { method: 'POST', csrf: true });
      setDelStep('code');
    } catch (error) {
      setDelError(error.message);
    } finally {
      setBusy(false);
    }
  };

  /** مرحلهٔ ۲ — کد مصرف می‌شود و حذف وارد صفِ Worker می‌شود. */
  const confirmDelete = async () => {
    if (busy || !doomed) return;
    setBusy(true);
    setDelError('');
    try {
      await platformApi(`/tenants/${doomed.id}/delete`, {
        method: 'POST',
        csrf: true,
        body: { code: delCode, confirmSlug: delSlug.trim().toLowerCase() },
      });
      setNotice(`حذفِ «${doomed.name}» وارد صف شد؛ دیتابیس و نقشِ آن حذف می‌شود.`);
      closeDelete();
      await load();
    } catch (error) {
      setDelError(error.message);
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
      <div className="pa-glow pa-g1" aria-hidden="true" />
      <div className="pa-glow pa-g2" aria-hidden="true" />

      {phase === 'loading' && <section className="pa-card pa-auth"><div className="pa-loader" />در حال بررسی نشست امن…</section>}

      {(phase === 'login' || phase === 'verify') && (
        <section className="pa-card pa-auth">
          {/* نشانِ رسمیِ برند — همان کامپوننتی که لانچر استفاده می‌کند، نه یک حرفِ جایگزین. */}
          <div className="pa-mark"><Mark draw aria-hidden="true" /></div>
          <p className="pa-word">عمل‌یار</p>
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
            <Mark className="pa-head-mark" aria-hidden="true" />
            <div className="pa-head-text">
              <p className="pa-kicker">AMALYAR CONTROL PLANE</p>
              <h1>شرکت‌ها و ساختِ خودکار</h1>
            </div>
            {/* نبضِ زنده: تا وقتی کاری در صف است، اپراتور باید بدون شمردنِ کارت‌ها بفهمد. */}
            {activeJobs && <span className="pa-live"><i />در حال پردازش</span>}
            <button className="pa-logout" onClick={logout} disabled={busy}>خروج امن</button>
          </header>

          <div className="pa-stats">
            <div className="pa-stat">
              <b>{faNum(stats.active)}</b>
              <small>شرکتِ فعال</small>
            </div>
            <div className="pa-stat">
              <b>{faNum(stats.building)}</b>
              <small>در حال ساخت</small>
            </div>
            <div className={`pa-stat${stats.failed ? ' bad' : ''}`}>
              <b>{faNum(stats.failed)}</b>
              <small>ناموفق</small>
            </div>
            <div className="pa-stat">
              <b>{faNum(stats.queued)}</b>
              <small>در صف</small>
            </div>
          </div>

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
                {snapshot.tenants.map((tenant) => {
                  const status = TENANT_STATUS[tenant.status] || [tenant.status, ''];
                  const removing = tenant.status === 'deleting';
                  return (
                    <article key={tenant.id} className="pa-row">
                      <div className="pa-row-main">
                        <b>{tenant.name}</b>
                        {/* هر دامنه‌ای که به این شرکت می‌رسد — نه فقط primary.
                            دو نشانی زیرِ یک کارت یعنی هر دو **یک دیتابیس** را
                            می‌بینند؛ این تنها جایی است که آن را می‌شود فهمید. */}
                        {domainsOf(tenant).length ? (
                          <span className="pa-hosts">
                            {domainsOf(tenant).map((d) => (
                              <a
                                key={d.hostname}
                                className={`pa-host${d.primary ? ' on' : ''}`}
                                dir="ltr"
                                href={`https://${d.hostname}`}
                                target="_blank"
                                rel="noreferrer"
                                title={d.primary ? 'دامنهٔ اصلی' : 'دامنهٔ دیگرِ همین شرکت'}
                              >
                                {d.hostname}
                              </a>
                            ))}
                          </span>
                        ) : (
                          <small dir="ltr">{tenant.slug}</small>
                        )}
                        {tenant.shared && (
                          <small className="pa-shared">
                            {faNum(domainsOf(tenant).length)} نشانی به این شرکت می‌رسند — هر
                            {' '}
                            {faNum(domainsOf(tenant).length)} یک دیتابیس را می‌بینند.
                          </small>
                        )}
                        <small>ساخته‌شده {faDate(tenant.createdAt)}</small>
                      </div>
                      <div className="pa-row-side">
                        <span className={`pa-badge ${status[1]}`}>{status[0]}</span>
                        <button
                          type="button"
                          className="pa-danger"
                          disabled={busy || removing}
                          onClick={() => openDelete(tenant)}
                          title={removing ? 'حذف در جریان است' : 'حذف شرکت و دیتابیس آن'}
                        >
                          {removing ? 'در حال حذف…' : 'حذف'}
                        </button>
                      </div>
                    </article>
                  );
                })}
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

          <TariffsPanel busy={busy} onNotice={setNotice} />
          <CentralAiPanel busy={busy} onNotice={setNotice} />

          {snapshot.deletions.length > 0 && (
            <section className="pa-card pa-jobs">
              <div className="pa-section-title">
                <span>{snapshot.deletions.length}</span>
                <div><h2>صف حذف</h2><p>دیتابیس و نقشِ PostgreSQL شرکت توسط Worker حذف می‌شود.</p></div>
              </div>
              <div className="pa-job-grid">
                {snapshot.deletions.map((job) => {
                  const status = DELETE_STATUS[job.status] || [job.status, ''];
                  return (
                    <article key={job.id} className="pa-job">
                      <div className="pa-job-top"><b>{job.name}</b><span className={`pa-badge ${status[1]}`}>{status[0]}</span></div>
                      <code dir="ltr">{job.slug}</code>
                      {job.hostname && <small dir="ltr">{job.hostname}</small>}
                      <div className="pa-job-foot"><span>{faDate(job.updatedAt)}</span></div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}

      <AnimatePresence>
        {doomed && (
          <Overlay
            backdrop="pa-modal-bg"
            panel="pa-card pa-modal"
            as="section"
            onClose={closeDelete}
            closable={!busy}
            role="dialog" aria-modal="true"
          >
            <div className="pa-danger-mark" aria-hidden="true">!</div>
            <h2>حذف کامل شرکت</h2>
            <p className="pa-modal-sub">
              دیتابیس، نقشِ PostgreSQL و همهٔ دادهٔ <b>{doomed.name}</b> برای همیشه حذف می‌شود.
              <br />این کار <b>برگشت‌پذیر نیست</b>.
            </p>

            {delStep === 'confirm' ? (
              <>
                <label>برای تأیید، شناسهٔ شرکت را تایپ کنید</label>
                <div className="pa-echo" dir="ltr">{doomed.slug}</div>
                <input
                  value={delSlug}
                  onChange={(e) => setDelSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  dir="ltr"
                  autoFocus
                  placeholder={doomed.slug}
                />
                <div className="pa-modal-actions">
                  <button type="button" className="pa-ghost" onClick={closeDelete} disabled={busy}>انصراف</button>
                  <button
                    type="button"
                    className="pa-danger-btn"
                    onClick={sendDeleteCode}
                    disabled={busy || delSlug.trim().toLowerCase() !== doomed.slug}
                  >
                    {busy ? 'در حال ارسال…' : 'ارسال کد تأیید'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <label>کد شش‌رقمیِ پیامک‌شده</label>
                <input
                  value={delCode}
                  onChange={(e) => setDelCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  dir="ltr"
                  placeholder="••••••"
                  autoFocus
                />
                <p className="pa-hint">کدِ حذف جداست و فقط برای همین شرکت کار می‌کند.</p>
                <div className="pa-modal-actions">
                  <button type="button" className="pa-ghost" onClick={closeDelete} disabled={busy}>انصراف</button>
                  <button
                    type="button"
                    className="pa-danger-btn"
                    onClick={confirmDelete}
                    disabled={busy || delCode.length !== 6}
                  >
                    {busy ? 'در حال حذف…' : 'حذف قطعی'}
                  </button>
                </div>
              </>
            )}
            {delError && <div className="pa-modal-err">{delError}</div>}
          </Overlay>
        )}
      </AnimatePresence>
    </main>
  );
}

/**
 * تعرفه‌های سراسریِ سالانه — یک‌بار این‌جا وارد می‌شوند و **همهٔ** شرکت‌ها
 * همان را می‌خوانند. ضریبِ اختصاصی‌ای که شرکتی خودش در تنظیماتش گذاشته،
 * برای همان شرکت مقدم می‌ماند.
 */
function TariffsPanel({ busy: parentBusy, onNotice }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tf, setTf] = useState({ year: '', sector: 'private', professional: '', technical: '', anesthesia: '' });
  const set = (k) => (e) => setTf((s) => ({ ...s, [k]: e.target.value }));

  const load = () => platformApi('/tariffs').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const save = async (event) => {
    event.preventDefault();
    if (busy || parentBusy) return;
    const year = toEn(tf.year);
    if (!/^\d{4}$/.test(year)) { onNotice('سالِ تعرفه باید چهار رقم باشد (مثلاً ۱۴۰۵).'); return; }
    setBusy(true);
    try {
      await platformApi('/tariffs', {
        method: 'POST', csrf: true,
        body: {
          year, sector: tf.sector,
          professional: Number(toEn(tf.professional) || 0),
          technical: Number(toEn(tf.technical) || 0),
          anesthesia: Number(toEn(tf.anesthesia) || 0),
        },
      });
      setTf({ year: '', sector: 'private', professional: '', technical: '', anesthesia: '' });
      onNotice('ضریبِ سراسری ذخیره شد — همهٔ شرکت‌ها از همین می‌خوانند.');
      await load();
    } catch (error) {
      onNotice(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="pa-card pa-jobs pa-tariffs">
      <div className="pa-section-title">
        <span>{rows?.length ?? '…'}</span>
        <div>
          <h2>تعرفه‌های سراسری</h2>
          <p>ضریبِ ریالیِ کتابِ ارزش نسبی — سالی یک‌بار، برای همهٔ شرکت‌ها؛ ضریبِ اختصاصیِ خودِ شرکت (اگر گذاشته باشد) مقدم است.</p>
        </div>
      </div>

      <form className="pa-tariff-form" onSubmit={save}>
        <input value={tf.year} onChange={set('year')} dir="ltr" inputMode="numeric" placeholder="سال (۱۴۰۵)" required />
        <select value={tf.sector} onChange={set('sector')}>
          {Object.entries(TARIFF_SECTORS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input value={tf.professional} onChange={set('professional')} dir="ltr" inputMode="numeric" placeholder="حرفه‌ای (تومان)" required />
        <input value={tf.technical} onChange={set('technical')} dir="ltr" inputMode="numeric" placeholder="فنی (تومان)" required />
        <input value={tf.anesthesia} onChange={set('anesthesia')} dir="ltr" inputMode="numeric" placeholder="بیهوشی (تومان)" required />
        <button disabled={busy || parentBusy}>{busy ? 'در حال ذخیره…' : 'ذخیره'}</button>
      </form>

      <div className="pa-job-grid">
        {rows !== null && rows.length === 0 && <div className="pa-empty">هنوز تعرفه‌ای ثبت نشده است.</div>}
        {(rows ?? []).map((t) => (
          <article key={t.id} className="pa-job">
            <div className="pa-job-top"><b>{faNum(t.year)} — {t.sectorLabel}</b></div>
            <small>
              حرفه‌ای {faNum(Number(t.professional).toLocaleString('en-US'))}
              {' · '}فنی {faNum(Number(t.technical).toLocaleString('en-US'))}
              {' · '}بیهوشی {faNum(Number(t.anesthesia).toLocaleString('en-US'))}
            </small>
            <div className="pa-job-foot">
              <span>{faDate(t.updatedAt)}</span>
              <button type="button" disabled={busy} onClick={() => setTf({
                year: t.year, sector: t.sector,
                professional: String(t.professional), technical: String(t.technical), anesthesia: String(t.anesthesia),
              })}>ویرایش</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}


/** پیش‌تنظیمِ ارائه‌دهنده‌ها — فقط UX؛ حقیقتِ اجرا همان baseUrl است. */
const AI_PROVIDERS = {
  avalai: { label: 'AvalAI (اول‌ای‌آی)', baseUrl: 'https://api.avalai.ir/v1' },
  gapgpt: { label: 'GapGPT (گپ‌جی‌پی‌تی)', baseUrl: 'https://api.gapgpt.app/v1' },
  custom: { label: 'سفارشی', baseUrl: '' },
};

/**
 * هوشِ مصنوعیِ مرکزی («مادر») — همهٔ شرکت‌ها به‌صورتِ پیش‌فرض اعتبار و
 * مدلِ هر قابلیت را از همین می‌خوانند؛ تنظیمِ خودِ شرکت مقدم است. کلید
 * هرگز برنمی‌گردد (فقط «ثبت شده» دیده می‌شود) و خالی‌گذاشتنش یعنی «دست نزن».
 */
function CentralAiPanel({ busy: parentBusy, onNotice }) {
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    provider: 'avalai', baseUrl: AI_PROVIDERS.avalai.baseUrl, apiKey: '',
    modelChat: '', modelVision: '', modelStt: '', modelTts: '', modelImage: '', enabled: true,
  });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const load = () => platformApi('/ai').then((r) => {
    setCfg(r);
    setF((s) => ({
      ...s,
      provider: r.provider || 'avalai',
      baseUrl: r.baseUrl || AI_PROVIDERS[r.provider]?.baseUrl || '',
      modelChat: r.modelChat, modelVision: r.modelVision, modelStt: r.modelStt,
      modelTts: r.modelTts, modelImage: r.modelImage,
      enabled: r.enabled,
    }));
  }).catch(() => setCfg({}));
  useEffect(() => { load(); }, []);

  const pickProvider = (e) => {
    const provider = e.target.value;
    setF((s) => ({ ...s, provider, baseUrl: AI_PROVIDERS[provider]?.baseUrl || s.baseUrl }));
  };

  const save = async (event) => {
    event.preventDefault();
    if (busy || parentBusy) return;
    setBusy(true);
    try {
      await platformApi('/ai', {
        method: 'POST', csrf: true,
        body: {
          provider: f.provider,
          baseUrl: f.baseUrl.trim(),
          apiKey: f.apiKey.trim(), // خالی = کلیدِ قبلی بماند
          modelChat: f.modelChat.trim(),
          modelVision: f.modelVision.trim(),
          modelStt: f.modelStt.trim(),
          modelTts: f.modelTts.trim(),
          modelImage: f.modelImage.trim(),
          enabled: !!f.enabled,
        },
      });
      setF((s) => ({ ...s, apiKey: '' }));
      onNotice('هوشِ مصنوعیِ مرکزی ذخیره شد — شرکت‌های بدونِ تنظیمِ اختصاصی از همین می‌خوانند.');
      await load();
    } catch (error) {
      onNotice(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="pa-card pa-jobs pa-ai">
      <div className="pa-section-title">
        <span>{cfg ? (cfg.enabled ? 'روشن' : 'خاموش') : '…'}</span>
        <div>
          <h2>هوشِ مصنوعیِ مرکزی</h2>
          <p>
            اعتبار و مدلِ هر قابلیت برای همهٔ شرکت‌ها — شرکتی که در تنظیماتِ خودش مقدار گذاشته، همان مقدم است.
            {cfg?.apiKeySet ? ' کلید: ثبت شده (برای تعویض، کلیدِ تازه بنویسید).' : ' کلید: هنوز ثبت نشده.'}
          </p>
        </div>
      </div>

      <form className="pa-tariff-form pa-ai-form" onSubmit={save}>
        <select value={f.provider} onChange={pickProvider} aria-label="ارائه‌دهنده">
          {Object.entries(AI_PROVIDERS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <input value={f.baseUrl} onChange={set('baseUrl')} dir="ltr" placeholder="نشانیِ پایه (تا /v1)" required />
        <input value={f.apiKey} onChange={set('apiKey')} dir="ltr" placeholder={cfg?.apiKeySet ? 'کلید — خالی یعنی همان قبلی' : 'کلیدِ API'} />
        <input value={f.modelChat} onChange={set('modelChat')} dir="ltr" placeholder="مدلِ گفتگو (gpt-4o-mini)" required />
        <input value={f.modelVision} onChange={set('modelVision')} dir="ltr" placeholder="مدلِ تحلیلِ عکس" />
        <input value={f.modelStt} onChange={set('modelStt')} dir="ltr" placeholder="گفتار به متن (whisper-1)" />
        <input value={f.modelTts} onChange={set('modelTts')} dir="ltr" placeholder="متن به گفتار (tts-1)" />
        <input value={f.modelImage} onChange={set('modelImage')} dir="ltr" placeholder="تصویرسازی" />
        <label className="pa-ai-toggle">
          <input type="checkbox" checked={!!f.enabled} onChange={(e) => setF((s) => ({ ...s, enabled: e.target.checked }))} />
          فعال برای همهٔ شرکت‌ها
        </label>
        <button disabled={busy || parentBusy}>{busy ? 'در حال ذخیره…' : 'ذخیره'}</button>
      </form>
    </section>
  );
}
