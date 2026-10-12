import HospitalDirectory from './HospitalDirectory.jsx';
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import Mark from '../components/Mark.jsx';
import './platform.css';
import Overlay from '../ui/Overlay.jsx';
import { Caret, Hospital } from '../ui/icons.jsx';
import { isoToJStr, jStrToIso, jToFa } from '../lib/jalali.js';

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
  succeeded: ['ساخته شد', 'ok'],
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

/**
 * چرخهٔ عمرِ تجاری (دسترسی) — متن و رنگِ بج از `tenant.access`ِ سرور ساخته می‌شود:
 * وضعیت، روزهای مانده و پیام همان‌جا حساب شده‌اند و پنل خودش روز نمی‌شمارد (قانونِ ۱۵).
 */
function accessText(a) {
  if (!a) return '';
  const until = a.accessUntil ? jToFa(isoToJStr(a.accessUntil)) : '';
  if (a.state === 'suspended') return 'معلق';
  if (a.state === 'expired') return `منقضی · فقط‌خواندنی${until ? ` (از ${until})` : ''}`;
  const left = a.daysLeft == null ? 'بی‌مهلت' : a.daysLeft === 0 ? 'امروز آخرین روز' : `${jToFa(a.daysLeft)} روز مانده`;
  if (a.plan === 'demo') return `دمو · ${left}${until ? ` (تا ${until})` : ''}`;
  return a.daysLeft != null ? `اشتراک تا ${until} · ${left}` : 'اشتراک · بی‌مهلت';
}
function accessBadge(tenant) {
  const a = tenant?.access;
  if (!a) return null;
  if (a.state === 'suspended' || a.state === 'expired') return [accessText(a), 'fail'];
  if (a.plan === 'demo' || (a.daysLeft != null && a.daysLeft <= 14)) return [accessText(a), 'warn'];
  if (a.daysLeft != null) return [accessText(a), 'ok'];
  return null; // اشتراکِ بی‌مهلت: همان «فعال»ِ ساخت کافی است
}

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
/* `loaded`: «گزینه‌های نوعِ نصب نیامده» دو معنی دارد — سرورِ قدیمی (فیلد پنهان، ساخت مجاز) یا snapshotی که هنوز نرسیده یا
   شکست خورده. دومی نباید فرم را بی‌نوع بفرستد (شرکت بی‌صدا نوعِ پیش‌فرض می‌گرفت)، پس ساخت تا اولین snapshotِ موفق بسته است. */
const EMPTY_SNAPSHOT = { loaded: false, tenants: [], jobs: [], deletions: [], profileOptions: { kinds: [], services: [] } };

/**
 * «تمام‌شده» فقط `succeeded` است؛ هر وضعیتِ دیگری — حتی وضعیتی که این نسخه نمی‌شناسد —
 * باز حساب می‌شود تا هیچ کارِ ناتمامی از صف پنهان نشود. سرور هم همین مرز را می‌کشد
 * (`OPEN_JOBS_CAP` در `platform.module.ts`).
 */
const isDone = (job) => job.status === 'succeeded';

export default function PlatformAdmin() {
  const [phase, setPhase] = useState('loading');
  const [authOptions, setAuthOptions] = useState([]);
  const [phoneRef, setPhoneRef] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [form, setForm] = useState({ name: '', slug: '', hostname: '', plan: 'paid', accessDays: '', kind: '', services: [] });
  const [hostnameEdited, setHostnameEdited] = useState(false);
  /* گزینه‌های نوعِ نصب از سرور (`profileOptions`)؛ سرورِ قدیمی که نمی‌فرستد فیلد را پنهان می‌کند، نه بشکند. */
  const kindOptions = snapshot.profileOptions?.kinds ?? [];
  const serviceOptions = snapshot.profileOptions?.services ?? [];

  // نشانیِ سایتِ یک شرکت — افزودن و اصلی‌کردن، برگشت به نشانیِ قبلی، حذفِ نشانیِ فرعی
  const [addrFor, setAddrFor] = useState(null);
  // دسترسیِ یک شرکت — فعال/معلق، دمو/اشتراک، مهلت، یادداشت (خواستهٔ مالک ۱۴۰۵/۰۷/۱۵)
  const [accessFor, setAccessFor] = useState(null);
  const accessChanged = (next) => {
    setSnapshot((snap) => ({ ...snap, tenants: snap.tenants.map((t) => (t.id === next.id ? { ...t, ...next } : t)) }));
    setAccessFor((cur) => (cur && cur.id === next.id ? { ...cur, ...next } : cur));
  };
  /** کارتِ همان شرکت با پاسخِ سرور تازه می‌شود — بی‌بارگذاریِ دوبارهٔ کلِ پنل. */
  const domainsChanged = (next) => setSnapshot((snap) => ({
    ...snap,
    tenants: snap.tenants.map((t) => (t.id === next.id
      ? { ...t, hostname: next.hostname, domains: next.domains, shared: next.shared }
      : t)),
  }));

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

  /**
   * «صف عملیات» فقط کارهای باز را نشان می‌دهد؛ تمام‌شده‌ها (ساخت و حذف) زیرِ
   * «انجام‌شده‌ها»ی تاشو می‌روند. تا ۱۴۰۵/۰۷/۰۴ همهٔ سی کارِ آخر زیرِ عنوانِ «صف»
   * بودند و شمارِ کنارش هم همان سی را می‌شمرد؛ شرکتی که «آماده» و در «شرکت‌های فعال»
   * بود هنوز «در صف» به نظر می‌رسید.
   */
  const queue = useMemo(() => ({
    open: snapshot.jobs.filter((job) => !isDone(job)),
    deletions: snapshot.deletions.filter((job) => !isDone(job)),
    done: [
      ...snapshot.jobs.filter(isDone).map((job) => ({ ...job, kind: 'build' })),
      ...snapshot.deletions.filter(isDone).map((job) => ({ ...job, kind: 'delete' })),
    ].sort((a, b) => new Date(b.finishedAt ?? b.updatedAt) - new Date(a.finishedAt ?? a.updatedAt)),
  }), [snapshot.jobs, snapshot.deletions]);
  const [historyOpen, setHistoryOpen] = useState(false);

  const stats = useMemo(() => {
    const all = [...snapshot.jobs, ...snapshot.deletions];
    return {
      /* «فعال» = ساخته‌شده و معلق‌نشده؛ شرکتِ معلق جایی جز بجِ خودش شمرده نمی‌شود. */
      active: snapshot.tenants.filter((t) => t.status === 'active' && t.access?.state !== 'suspended').length,
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
      loaded: true,
      tenants: Array.isArray(data?.tenants) ? data.tenants : [],
      jobs: Array.isArray(data?.jobs) ? data.jobs : [],
      deletions: Array.isArray(data?.deletions) ? data.deletions : [],
      /* گزینه‌های نوعِ نصب برای فرمِ ساخت — سرورِ قدیمی که نمی‌فرستد یعنی فیلد پنهان (نه فرمِ شکسته). */
      profileOptions: {
        kinds: Array.isArray(data?.profileOptions?.kinds) ? data.profileOptions.kinds : [],
        services: Array.isArray(data?.profileOptions?.services) ? data.profileOptions.services : [],
      },
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
    if (busy || !snapshot.loaded) return;
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
          plan: form.plan,
          /* دمو بی‌مدت معنا ندارد (پیش‌فرض ۱۴ روز)؛ اشتراکِ بی‌عدد = بی‌مهلت. */
          accessDays: form.accessDays ? Number(form.accessDays) : (form.plan === 'demo' ? 14 : null),
          /* نوعِ نصب — Worker همین را روی دیتابیسِ تازه می‌نویسد؛ خدمات فقط برای شرکتی. */
          ...(kindOptions.length && form.kind ? { kind: form.kind, services: form.kind === 'company' ? form.services : [] } : {}),
        },
      });
      setForm({ name: '', slug: '', hostname: '', plan: 'paid', accessDays: '', kind: '', services: [] });
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

          <HealthPanel />

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
              <label htmlFor="pa-plan">نوعِ حساب</label>
              <select
                id="pa-plan"
                value={form.plan}
                onChange={(e) => setForm((s) => ({ ...s, plan: e.target.value, accessDays: e.target.value === 'demo' ? (s.accessDays || '14') : s.accessDays }))}
              >
                <option value="paid">اشتراک</option>
                <option value="demo">نسخهٔ آزمایشی (دمو)</option>
              </select>
              <label htmlFor="pa-days">{form.plan === 'demo' ? 'مدتِ دمو (روز)' : 'مهلتِ اشتراک (روز؛ خالی = بی‌مهلت)'}</label>
              <input
                id="pa-days"
                value={form.accessDays}
                onChange={(e) => setForm((s) => ({ ...s, accessDays: toEn(e.target.value).slice(0, 4) }))}
                inputMode="numeric"
                dir="ltr"
                placeholder={form.plan === 'demo' ? '14' : '—'}
                required={form.plan === 'demo'}
              />
              {/* نوعِ نصب: همان انتخابی که بعداً در تنظیماتِ خودِ شرکت هست، ولی از روزِ اول درست — مطب از
                  همان لحظه لانچر و واژه‌های مطب را دارد و بنیان‌گذارش پزشک حساب می‌شود. گزینه‌ها از سرور می‌آیند. */}
              {kindOptions.length > 0 && (
                <>
                  <label htmlFor="pa-kind">نوعِ نصب</label>
                  <select
                    id="pa-kind"
                    value={form.kind}
                    required
                    onChange={(e) => setForm((s) => ({ ...s, kind: e.target.value, services: e.target.value === 'company' && !s.services.length ? serviceOptions.slice(0, 1).map((x) => x.key) : s.services }))}
                  >
                    <option value="">— انتخاب کنید —</option>
                    {kindOptions.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                  </select>
                  {form.kind === 'company' && (
                    <fieldset className="pa-services">
                      <legend>خدماتِ این شرکت</legend>
                      {serviceOptions.map((sv) => (
                        <label key={sv.key} className="pa-check">
                          <input
                            type="checkbox"
                            checked={form.services.includes(sv.key)}
                            onChange={(e) => setForm((s) => ({ ...s, services: e.target.checked ? [...s.services, sv.key] : s.services.filter((x) => x !== sv.key) }))}
                          />
                          <span>{sv.label}</span>
                        </label>
                      ))}
                    </fieldset>
                  )}
                </>
              )}
              <button disabled={busy || !snapshot.loaded || (kindOptions.length > 0 && (!form.kind || (form.kind === 'company' && !form.services.length)))}>{busy ? 'در حال ثبت…' : !snapshot.loaded ? 'در حال خواندنِ گزینه‌ها…' : 'ساخت امن شرکت'}</button>
              <p className="pa-hint">رمز دیتابیس در UI یا API نمایش داده نمی‌شود.</p>
            </form>

            <section className="pa-card">
              <div className="pa-section-title">
                <span>{faNum(snapshot.tenants.length)}</span>
                <div><h2>شرکت‌های فعال</h2><p>هر شرکت دیتابیس و نقش PostgreSQL مستقل دارد.</p></div>
              </div>
              <div className="pa-list">
                {snapshot.tenants.length === 0 && <div className="pa-empty">هنوز شرکتی ساخته نشده است.</div>}
                {snapshot.tenants.map((tenant) => {
                  const status = TENANT_STATUS[tenant.status] || [tenant.status, ''];
                  const removing = tenant.status === 'deleting';
                  const acc = accessBadge(tenant);
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
                        {tenant.profile && <small className="pa-profile" data-kind={tenant.profile.kind}>{tenant.profile.label}</small>}
                        {/* مدرکِ بی‌فایل — فقط **شمار** (تصمیمِ مالک): نامِ بیمار دادهٔ خودِ شرکت است و فهرستش
                            در «کارهای من»ِ منشیِ همان شرکت. عدد از آخرین سنجشِ ساعتیِ سرور می‌آید. */}
                        {tenant.lostDocs > 0 && (
                          <small className="pa-lost">
                            {faNum(tenant.lostDocs)} مدرک فایلش روی سرور نیست — منشیِ همین شرکت در «کارهای من» فهرستش را دارد
                          </small>
                        )}
                        <small>ساخته‌شده {faDate(tenant.createdAt)}</small>
                      </div>
                      <div className="pa-row-side">
                        {/* یک بج برای هر کارت: «معلق»/«دمو · N روز» جای «فعال» را می‌گیرد — دو بجِ هم‌زمانِ «فعال» و «معلق» گیج‌کننده بود. */}
                        {(!acc || tenant.status !== 'active') && <span className={`pa-badge ${status[1]}`}>{status[0]}</span>}
                        {acc && <span className={`pa-badge ${acc[1]}`} data-access={tenant.access?.state}>{acc[0]}</span>}
                        <button
                          type="button"
                          className="pa-soft"
                          disabled={busy || tenant.status !== 'active'}
                          onClick={() => setAccessFor(tenant)}
                          title="فعال/معلق، دمو یا اشتراک، مهلت و یادداشت"
                        >
                          دسترسی
                        </button>
                        <button
                          type="button"
                          className="pa-soft"
                          disabled={busy || tenant.status !== 'active'}
                          onClick={() => setAddrFor(tenant)}
                          title="نشانیِ تازه برای سایتِ این شرکت؛ نشانیِ قبلی هم کار می‌کند"
                        >
                          تغییرِ نشانی
                        </button>
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

          <section className="pa-card pa-jobs" data-section="queue">
            <div className="pa-section-title">
              <span>{faNum(queue.open.length)}</span>
              <div>
                <h2>صف عملیات</h2>
                <p>فقط کارهای باز — در صف، در حال ساخت یا ناموفق. شرکتِ ساخته‌شده از صف بیرون می‌رود و در «شرکت‌های فعال» می‌نشیند.</p>
              </div>
              <button className="pa-refresh" type="button" onClick={() => load().catch((e) => setNotice(e.message))}>به‌روزرسانی</button>
            </div>
            <div className="pa-job-grid">
              {queue.open.length === 0 && <div className="pa-empty">کاری در صف نیست.</div>}
              {queue.open.map((job) => {
                const status = STATUS[job.status] || [job.status, ''];
                return (
                  <article key={job.id} className="pa-job">
                    <div className="pa-job-top"><b>{job.name}</b><span className={`pa-badge ${status[1]}`}>{status[0]}</span></div>
                    <code dir="ltr">{job.slug}</code>
                    <small dir="ltr">{job.hostname}</small>
                    {job.profile && <small className="pa-profile" data-kind={job.profile.kind}>{job.profile.label}</small>}
                    <div className="pa-job-foot">
                      <span>{faDate(job.updatedAt)}</span>
                      {job.status === 'failed' && <button type="button" disabled={busy} onClick={() => retry(job.id)}>تلاش مجدد</button>}
                    </div>
                  </article>
                );
              })}
            </div>
            {queue.done.length > 0 && (
              <div className="pa-history">
                <button
                  type="button"
                  className="pa-history-btn"
                  aria-expanded={historyOpen}
                  aria-controls="pa-history-list"
                  onClick={() => setHistoryOpen((open) => !open)}
                >
                  انجام‌شده‌ها <i>{faNum(queue.done.length)}</i>
                  <Caret width="15" height="15" aria-hidden="true" />
                </button>
                <div id="pa-history-list" hidden={!historyOpen}>
                  {historyOpen && (
                    <>
                      <p className="pa-history-note">تازه‌ترین ساخت‌ها و حذف‌های تمام‌شده (تا سی ساخت و بیست حذفِ آخر).</p>
                      <div className="pa-job-grid">
                        {queue.done.map((job) => {
                          const status = (job.kind === 'delete' ? DELETE_STATUS : STATUS)[job.status] || [job.status, ''];
                          return (
                            <article key={`${job.kind}:${job.id}`} className="pa-job pa-job-done">
                              <div className="pa-job-top"><b>{job.name}</b><span className={`pa-badge ${status[1]}`}>{status[0]}</span></div>
                              <code dir="ltr">{job.slug}</code>
                              {job.hostname && <small dir="ltr">{job.hostname}</small>}
                              {job.profile && <small className="pa-profile" data-kind={job.profile.kind}>{job.profile.label}</small>}
                              <div className="pa-job-foot"><span>{faDate(job.finishedAt ?? job.updatedAt)}</span></div>
                            </article>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </section>

          <Fold
            id="hospitals"
            icon={<Hospital width="20" height="20" />}
            title="فهرست مرکزی بیمارستان‌ها"
            sub="بیمارستان‌هایی که شرکت‌ها از این فهرست دریافت می‌کنند — برای جستجو، افزودن یا ویرایش باز کنید."
          >
            <HospitalDirectory platformApi={platformApi} embedded />
          </Fold>
          <TariffsPanel busy={busy} onNotice={setNotice} />
          <CentralAiPanel busy={busy} onNotice={setNotice} />

          {/* فقط وقتی حذفی باز است؛ حذف‌های تمام‌شده در «انجام‌شده‌ها»ی صفِ عملیات‌اند. */}
          {queue.deletions.length > 0 && (
            <section className="pa-card pa-jobs" data-section="deletions">
              <div className="pa-section-title">
                <span>{faNum(queue.deletions.length)}</span>
                <div><h2>صف حذف</h2><p>دیتابیس و نقشِ PostgreSQL شرکت توسط Worker حذف می‌شود.</p></div>
              </div>
              <div className="pa-job-grid">
                {queue.deletions.map((job) => {
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
        {accessFor && (
          <TenantAccessDialog tenant={accessFor} onClose={() => setAccessFor(null)} onChanged={accessChanged} />
        )}
        {addrFor && (
          <TenantDomainsDialog tenant={addrFor} onClose={() => setAddrFor(null)} onChanged={domainsChanged} />
        )}
      </AnimatePresence>

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
 * آمادگیِ سامانه برای مشتریِ پولی (گزارشِ آمادگیِ فروش، بندهای ۱ و ۳) — یک نواری باریک: چیپِ هر مورد و فقط برای
 * موردِ نامطلوب یک سطرِ علتِ فارسی. وقتی همه‌چیز سالم است جز یک سطرِ چیپ جایی نمی‌گیرد؛ وقتی نیست علت **بالای صفحه**
 * دیده می‌شود، نه پشتِ یک بخشِ تاشو. همه‌چیز را سرور حساب کرده (`/platform/health`)؛ این‌جا فقط رنگ و متن است.
 *
 * ⚠️ «پشتیبان‌گیری» عمداً چیپِ «خارج از برنامه» است نه سبز: Coolify انجامش می‌دهد و برنامه از آن چیزی نمی‌داند؛
 * سبزِ ساختگی بدترین حالت است.
 */
/* تکه‌های لاتینیِ داخلِ متنِ فارسی (مسیر، نامِ متغیر، نامِ ابزار) جدا می‌شوند تا «/» و «_» کنارِ متنِ راست‌چین
   جابه‌جا نشوند — «/app/storage» بی‌این به‌شکلِ «app/storage/» دیده می‌شد. */
const LTR_RUN = /(\/?[A-Za-z][A-Za-z0-9_.-]*(?:\s*\/\s*[A-Za-z][A-Za-z0-9_.-]*)*)/g;
function Bidi({ text }) {
  return String(text ?? '').split(LTR_RUN).map((part, i) => (i % 2 ? <bdi key={i} dir="ltr">{part}</bdi> : part));
}
const STORAGE_TONE = { ok: 'ok', unproven: 'warn', ephemeral: 'fail', broken: 'fail', dev: 'run' };
const STORAGE_LABEL = {
  ok: 'ماندگار', unproven: 'ماندگاری ثابت نشده', ephemeral: 'روی volume نیست', broken: 'قابل نوشتن نیست', dev: 'محیطِ توسعه',
};
function HealthPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try { setData(await platformApi('/health')); setError(''); }
    catch (e) { setError(e.message || 'نامشخص'); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []);

  const items = data ? [
    { key: 'storage', title: 'فایل‌ها', tone: STORAGE_TONE[data.storage?.verdict] ?? 'warn', label: STORAGE_LABEL[data.storage?.verdict] ?? '—', hint: faNum(data.storage?.message) },
    { key: 'sms', title: 'پیامک', tone: data.sms?.configured ? 'ok' : 'fail', label: data.sms?.configured ? 'آماده' : 'تنظیم نیست', hint: data.sms?.message },
    { key: 'runtime', title: 'نسخه', tone: 'run', label: data.runtime?.commit ?? 'نامشخص', hint: `روشن‌شده ${faDate(data.runtime?.bootedAt)}`, ltr: true },
    /* پشتیبانِ اصلی `backup.sh` با cron روی **میزبانِ سرور** است (Backupsِ Coolify فقط لایهٔ دومِ اختیاری است و نقش‌ها و
       فایل‌ها را ندارد). برنامه از آن خبر ندارد، پس سبزِ ساختگی ممنوع است و توضیحش همیشه زیرِ چیپ‌ها دیده می‌شود —
       نه فقط در `title` که لمس و صفحه‌کلید و صفحه‌خوان نمی‌بینند. */
    { key: 'backup', title: 'پشتیبان', tone: 'run', label: 'خارج از برنامه', hint: 'از برنامه دیده نمی‌شود — آخرین پشتیبانِ شبانه (backup.sh روی سرور) و تمرینِ بازگردانی را طبقِ docs/BACKUP-RESTORE.md بررسی کن', always: true },
  ] : [];
  const notes = items.filter((i) => (i.tone === 'fail' || i.tone === 'warn' || i.always) && i.hint);

  return (
    <section className="pa-card pa-health" data-section="health" aria-label="آمادگیِ سامانه">
      {/* یک ناحیهٔ زندهٔ ثابت دورِ چیپ‌ها، یادداشت‌ها و خطا — هر تغییری اعلام می‌شود، نه فقط خطایی که تازه سوار شده. */}
      <div role="status" aria-live="polite">
      <div className="pa-health-row">
        <h2>آمادگیِ سامانه</h2>
        {error
          ? <span className="pa-badge fail">خوانده نشد — {error}</span>
          : (
            <ul className="pa-health-chips">
              {items.map((i) => (
                <li key={i.key}>
                  <span className={`pa-badge ${i.tone}`} title={i.hint}>
                    {i.title}: <b dir={i.ltr ? 'ltr' : undefined}>{i.label}</b>
                  </span>
                </li>
              ))}
              {!data && <li><span className="pa-badge run">در حال بررسی…</span></li>}
            </ul>
          )}
        <button type="button" className="pa-refresh" onClick={load} disabled={busy}>{busy ? 'در حال بررسی…' : 'بازخوانی'}</button>
      </div>
      {/* بازخوانیِ ناموفق یادداشت‌های پاسخِ قبلی را زیرِ «خوانده نشد» نگه نمی‌دارد — آن‌ها دیگر وضعیتِ فعلی نیستند. */}
      {!error && notes.length > 0 && (
        <ul className="pa-health-notes">
          {notes.map((n) => <li key={n.key} className={n.tone}>{n.title}: <Bidi text={n.hint} /></li>)}
        </ul>
      )}
      </div>
    </section>
  );
}

/**
 * بخشِ تاشوی پنل — بسته به‌طورِ پیش‌فرض. سربرگ همان `.pa-section-title` است و کلِ
 * ردیفش دکمه است (`::after`ِ دکمه روی ردیف کشیده می‌شود، پس سرخط معتبر می‌ماند:
 * `h2 > button`). بدنه فقط وقتِ باز بودن mount می‌شود: فهرستِ مرکزیِ بیمارستان‌ها تا
 * باز نشده هیچ درخواستی نمی‌زند (درخواستِ مالک، ۱۴۰۵/۰۷/۰۴: «خیلی جا گرفته»).
 */
function Fold({ id, icon, title, sub, children }) {
  const [open, setOpen] = useState(false);
  return (
    <section className={`pa-card pa-jobs pa-fold${open ? ' is-open' : ''}`} data-section={id}>
      <div className="pa-section-title pa-fold-title">
        <span aria-hidden="true">{icon}</span>
        <div>
          <h2>
            <button type="button" aria-expanded={open} aria-controls={`pa-fold-${id}`} onClick={() => setOpen((x) => !x)}>
              {title}
            </button>
          </h2>
          <p>{sub}</p>
        </div>
        <Caret className="pa-fold-caret" width="18" height="18" aria-hidden="true" />
      </div>
      <div id={`pa-fold-${id}`} hidden={!open}>{open && children}</div>
    </section>
  );
}

/**
 * نشانیِ سایتِ یک شرکت (درخواستِ مشتری، ۱۴۰۵/۰۷/۰۴).
 *
 * «تغییرِ نشانی» یعنی نشانیِ تازه **اضافه و اصلی** شود و نشانیِ قبلی هم کار کند؛ وگرنه
 * هر لینکی که قبلاً برای بیماران پیامک شده (ثبت‌نام، پیگیری، پرونده) می‌شکست. داده و
 * دیتابیس جابه‌جا نمی‌شود. کارِ دستیِ Coolify همین‌جا نوشته می‌شود — بدونِ آن نشانیِ
 * تازه اصلاً به سرور نمی‌رسد و مدیر گمان می‌کند خرابی از ماست.
 */
function TenantDomainsDialog({ tenant, onClose, onChanged }) {
  const [domains, setDomains] = useState(() => domainsOf(tenant));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [added, setAdded] = useState('');
  const [sure, setSure] = useState('');

  const primary = domains.find((d) => d.primary)?.hostname ?? domains[0]?.hostname ?? '';
  /* «نامِ تازه» بدونِ نقطه یعنی زیردامنه‌ای روی همان دامنهٔ اصلی — همان کاری که فرمِ ساخت می‌کند. */
  const apex = primary.split('.').slice(-2).join('.') || 'amalyar.com';
  const clean = input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/\.$/, '');
  const target = clean && !clean.includes('.') ? `${clean}.${apex}` : clean;

  const call = async (path, hostname) => {
    setBusy(true);
    setError('');
    try {
      const next = await platformApi(`/tenants/${tenant.id}/domains${path}`, { method: 'POST', csrf: true, body: { hostname } });
      setDomains(next.domains);
      onChanged(next);
      return next;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
      setSure('');
    }
  };
  const add = async () => {
    if (!target || busy) return;
    const next = await call('', target);
    /* نشانیِ فرعیِ موجود که فقط اصلی شد `added` ندارد — از قبل کار می‌کرد، راهنما لازم نیست. */
    if (next) { setAdded(next.added ?? null); setInput(''); }
  };

  return (
    <Overlay
      backdrop="pa-modal-bg"
      panel="pa-card pa-modal pa-addr"
      as="section"
      onClose={onClose}
      closable={!busy}
      role="dialog" aria-modal="true" aria-labelledby="pa-addr-title"
    >
      <h2 id="pa-addr-title">نشانیِ سایتِ {tenant.name}</h2>
      <p className="pa-modal-sub">
        نشانیِ تازه اضافه و اصلی می‌شود و نشانیِ قبلی هم کار می‌کند تا لینک‌هایی که قبلاً برای
        بیماران پیامک شده نشکنند. داده جابه‌جا نمی‌شود.
      </p>

      <ul className="pa-addr-list">
        {domains.map((d) => (
          <li key={d.hostname} className={d.primary ? 'on' : ''}>
            <a dir="ltr" href={`https://${d.hostname}`} target="_blank" rel="noreferrer">{d.hostname}</a>
            {d.primary ? <em>اصلی</em> : (
              <span>
                <button type="button" disabled={busy} onClick={() => call('/primary', d.hostname)}>اصلی کن</button>
                {sure === d.hostname ? (
                  <button type="button" className="pa-addr-del" disabled={busy} onClick={() => call('/remove', d.hostname)}>
                    مطمئنم، حذف
                  </button>
                ) : (
                  <button type="button" className="pa-addr-del" disabled={busy} onClick={() => setSure(d.hostname)}>حذف</button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
      {sure && (
        <p className="pa-addr-warn">
          با حذفِ <b dir="ltr">{sure}</b> هر لینکی که با این نشانی برای بیماران رفته دیگر باز نمی‌شود.
        </p>
      )}

      <label htmlFor="pa-addr-new">نشانیِ تازه</label>
      <input
        id="pa-addr-new"
        dir="ltr"
        value={input}
        onChange={(e) => { setInput(e.target.value); setError(''); }}
        onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
        placeholder={`new-name.${apex}`}
        autoComplete="off"
        spellCheck={false}
        disabled={busy}
      />
      {target && target !== clean && <p className="pa-addr-preview" dir="ltr">{target}</p>}

      <div className="pa-modal-actions">
        <button type="button" className="pa-ghost" onClick={onClose} disabled={busy}>بستن</button>
        <button type="button" className="pa-primary-btn" onClick={add} disabled={busy || !target}>
          {busy ? 'در حالِ ثبت…' : 'ثبت و اصلی‌کردن'}
        </button>
      </div>
      {error && <div className="pa-modal-err">{error}</div>}

      {added && (
        <div className="pa-addr-next" role="status">
          {added.automatic ? (
            <b>
              ثبت شد و همین حالا روی <a dir="ltr" href={`https://${added.hostname}`} target="_blank" rel="noreferrer">{added.hostname}</a> باز
              می‌شود — گواهی و مسیرِ زیردامنه‌های amalyar.com خودکار است.
            </b>
          ) : (
            <>
              <b>ثبت شد. این نشانی زیرِ amalyar.com نیست، پس دو کارِ دستی لازم است:</b>
              <ol>
                <li>در DNSِ همان دامنه، رکوردِ A را به IPِ سرور بدهید.</li>
                <li>
                  در Coolify نشانیِ <code dir="ltr">https://{added.hostname}</code> را به اپِ فرانت و
                  {' '}<code dir="ltr">https://{added.hostname}/api</code> را به اپِ بک‌اند اضافه، ذخیره و Redeploy کنید.
                </li>
              </ol>
            </>
          )}
          <p>کاربران روی نشانیِ تازه یک بار دوباره وارد می‌شوند و اثرِ انگشت را همان‌جا از نو ثبت می‌کنند.</p>
        </div>
      )}
    </Overlay>
  );
}

/** مهلت‌های سریع — از امروز به بعد؛ تاریخِ نهایی را اپراتور می‌بیند و می‌تواند دستی عوض کند. */
const QUICK_DAYS = [[7, 'یک هفته'], [14, '۱۴ روز'], [30, 'یک ماه'], [90, 'سه ماه'], [365, 'یک سال']];

/**
 * دسترسیِ یک شرکت (خواستهٔ مالک ۱۴۰۵/۰۷/۱۵): فعال/معلق، دمو/اشتراک، مهلت، یادداشت.
 * تاریخ شمسی تایپ می‌شود و میلادیِ آن به سرور می‌رود؛ وضعیت و روزهای مانده را سرور
 * برمی‌گرداند و همان نشان داده می‌شود. معلق = هیچ درخواستی پذیرفته نمی‌شود؛ منقضی =
 * فقط‌خواندنی. هیچ‌کدام داده‌ای پاک نمی‌کند.
 */
function TenantAccessDialog({ tenant, onClose, onChanged }) {
  const a = tenant.access || {};
  const [suspended, setSuspended] = useState(Boolean(a.suspended));
  const [plan, setPlan] = useState(a.plan === 'demo' ? 'demo' : 'paid');
  const [untilJ, setUntilJ] = useState(a.accessUntil ? isoToJStr(a.accessUntil) : '');
  const [note, setNote] = useState(tenant.accessNote || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(null);

  const plusDays = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    setUntilJ(isoToJStr(d));
    setError('');
  };
  const iso = untilJ.trim() ? jStrToIso(untilJ) : null;
  const badDate = Boolean(untilJ.trim()) && !iso;

  const save = async () => {
    if (badDate) { setError('تاریخِ مهلت نامعتبر است (مثال: ۱۴۰۵/۰۸/۱۵)'); return; }
    setBusy(true);
    setError('');
    try {
      const next = await platformApi(`/tenants/${tenant.id}/access`, {
        method: 'POST', csrf: true, body: { suspended, plan, accessUntil: iso, note: note.trim() || null },
      });
      onChanged(next);
      setSaved(next.access);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay
      backdrop="pa-modal-bg"
      panel="pa-card pa-modal pa-access"
      as="section"
      onClose={onClose}
      closable={!busy}
      role="dialog" aria-modal="true" aria-labelledby="pa-access-title"
    >
      <h2 id="pa-access-title">دسترسیِ {tenant.name}</h2>
      <p className="pa-modal-sub">
        حسابِ معلق هیچ درخواستی را نمی‌پذیرد و کاربران هنگامِ ورود علت را می‌بینند. پس از پایانِ مهلت،
        سامانه فقط برای مشاهده باز می‌ماند؛ هیچ داده‌ای پاک نمی‌شود.
      </p>

      <label className="pa-access-row">
        <input type="checkbox" checked={!suspended} onChange={(e) => setSuspended(!e.target.checked)} disabled={busy} />
        <span>حساب فعال است</span>
        {suspended && <em>معلق</em>}
      </label>

      <label htmlFor="pa-access-plan">نوعِ حساب</label>
      <select id="pa-access-plan" value={plan} onChange={(e) => setPlan(e.target.value)} disabled={busy}>
        <option value="paid">اشتراک</option>
        <option value="demo">نسخهٔ آزمایشی (دمو)</option>
      </select>

      <label htmlFor="pa-access-until">مهلت تا (شمسی)</label>
      <input
        id="pa-access-until"
        value={untilJ}
        onChange={(e) => { setUntilJ(e.target.value); setError(''); }}
        dir="ltr"
        inputMode="numeric"
        placeholder="۱۴۰۵/۰۸/۱۵ — خالی یعنی بی‌مهلت"
        disabled={busy}
        aria-invalid={badDate || undefined}
      />
      <div className="pa-chips" role="group" aria-label="مهلتِ سریع">
        {QUICK_DAYS.map(([n, label]) => (
          <button key={n} type="button" className="pa-chip" disabled={busy} onClick={() => plusDays(n)}>{label}</button>
        ))}
        <button type="button" className="pa-chip" disabled={busy} onClick={() => { setUntilJ(''); setError(''); }}>بی‌مهلت</button>
      </div>

      <label htmlFor="pa-access-note">یادداشت (فقط اپراتور می‌بیند)</label>
      <textarea
        id="pa-access-note"
        value={note}
        onChange={(e) => setNote(e.target.value.slice(0, 300))}
        rows={2}
        maxLength={300}
        placeholder="مثلاً: پرداختِ شش‌ماهه در ۱۴۰۵/۰۷/۱۵"
        disabled={busy}
      />

      <div className="pa-modal-actions">
        <button type="button" className="pa-ghost" onClick={onClose} disabled={busy}>بستن</button>
        <button type="button" className="pa-primary-btn" onClick={save} disabled={busy || badDate}>
          {busy ? 'در حالِ ذخیره…' : 'ذخیره'}
        </button>
      </div>
      {error && <div className="pa-modal-err">{error}</div>}
      {saved && (
        <div className="pa-addr-next pa-access-sum" role="status">
          <b>ذخیره شد.</b> وضعیتِ فعلی: {accessText(saved)}
        </div>
      )}
    </Overlay>
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
        <span>{rows ? faNum(rows.length) : '…'}</span>
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
