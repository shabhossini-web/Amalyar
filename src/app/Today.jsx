import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import Overlay from '../ui/Overlay.jsx';
import { api } from '../lib/api.js';
import { useAuth } from './auth.jsx';
import WorkRow from './WorkRow.jsx';
import { JOB_ROLES } from '../lib/job-roles.js';
import { WORK_CHANGED } from './WorkBell.jsx';
import { useAllowedTools, track } from './tools.jsx';
import { Alert, ArrowStart, Calendar, Close, Grid, Scalpel } from '../ui/icons.jsx';
import './launcher.css';
import './shell.css';
import './work.css';
import './today.css';

const faNum = (n) => Number(n || 0).toLocaleString('fa-IR');
const tomorrow9 = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
};
/* سلام بر پایهٔ ساعتِ **دستگاه** — نه سرور: کاربرِ شبِ ایران نباید «صبح بخیر» بگیرد
   چون سرور جای دیگری است. این تنها چیزی است که این‌جا محاسبه می‌شود. */
const greeting = (h) => (h < 5 ? 'شبِ آرام' : h < 12 ? 'صبح بخیر' : h < 17 ? 'ظهر بخیر' : h < 21 ? 'عصر بخیر' : 'شب بخیر');

const APPT_FA = {
  held: 'رزرو', confirmed: 'قطعی', arrived: 'رسید', done: 'انجام شد', noshow: 'نیامد', cancelled: 'لغو',
};
const OP_FA = { pending: 'در انتظار', done: 'انجام شد', cancelled: 'لغو' };

/**
 * صفحهٔ «امروز» (W2.3) — صفحهٔ نخستِ سامانه، به‌جای لانچر (`DECISIONS.md` #۲).
 *
 * تا امروز کاربر بعد از ورود یک **فهرستِ ابزار** می‌دید و باید خودش می‌فهمید
 * کارش کجاست؛ حالا اولین چیزی که می‌بیند کارِ خودش است و ابزارها یک کلیک
 * پایین‌تر در کشوی «همهٔ ابزارها» می‌مانند (لانچر هنوز روی `/app/tools` هست).
 *
 * ⚠️ هیچ عددی این‌جا حساب نمی‌شود: `GET /work/today` آماده می‌دهدشان (قانونِ ۱۵).
 * ⚠️ هر بخش سمتِ سرور گیت شده؛ `sections` می‌گوید کدام‌ها را اصلاً نشان بدهیم،
 * پس کارشناسِ سطح ۲ صفحهٔ نصفه‌خالی با کادرهای «دسترسی ندارید» نمی‌بیند.
 */
export default function Today() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(0);
  const [toast, setToast] = useState('');
  const [toolsOpen, setToolsOpen] = useState(false);
  const { hero, daily, tools, nothing } = useAllowedTools();

  useEffect(() => { document.title = 'امروز — عمل‌یار'; }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 1800); return () => clearTimeout(t); }, [toast]);

  const load = useCallback(() => {
    api('/work/today')
      .then((r) => { setData(r); setErr(null); })
      .catch((e) => setErr({ message: e?.message || 'بارگذاری نشد', status: e?.status ?? 0 }));
  }, []);
  useEffect(() => { load(); }, [load]);
  /* کاری که از زنگِ پوسته بسته شود باید همین‌جا هم برود. */
  useEffect(() => {
    const h = () => load();
    window.addEventListener(WORK_CHANGED, h);
    return () => window.removeEventListener(WORK_CHANGED, h);
  }, [load]);

  const act = async (w, action, body = {}) => {
    setBusy(w.id);
    try {
      await api(`/work/${w.id}`, { method: 'PATCH', body: { action, ...body } });
      /* «فردا» کار را **نمی‌بندد** — فقط از فهرستِ امروز می‌رود؛ پس شمارندهٔ «کارِ باز»
         فقط با «انجام شد» پایین می‌آید. (بعدش هم `load()` از سرور تازه‌اش می‌کند.) */
      setData((d) => (d ? {
        ...d,
        work: d.work.filter((x) => x.id !== w.id),
        brief: action === 'done' ? { ...d.brief, work: Math.max(0, d.brief.work - 1) } : d.brief,
      } : d));
      window.dispatchEvent(new Event(WORK_CHANGED));
      setToast(action === 'done' ? 'انجام شد ✓' : 'به فردا موکول شد');
    } catch (e) {
      setToast(e?.message || 'انجام نشد');
    } finally {
      setBusy(0);
    }
  };

  const openTool = (t) => { setToolsOpen(false); if (t.to) navigate(t.to); };
  const b = data?.brief;
  const name = user?.displayName || user?.firstName || '';

  return (
    <div className="td">
      <header className="td-head">
        <h1 className="td-hello">
          {greeting(new Date().getHours())}{name ? `، ${name}` : ''}
        </h1>
        {b && (
          <ul className="td-chips" aria-label="خلاصهٔ امروز">
            <li className={b.overdue ? 'hot' : ''}><b>{faNum(b.work)}</b> کارِ باز{b.overdue > 0 && <em> ({faNum(b.overdue)} عقب‌افتاده)</em>}</li>
            {data.sections.visits && <li><b>{faNum(b.visits)}</b> عملِ امروز</li>}
            {data.sections.appointments && <li><b>{faNum(b.appointments)}</b> نوبتِ امروز</li>}
            {data.sections.intake && b.intakePending > 0 && (
              <li className="td-link"><Link to="/app/intake"><b>{faNum(b.intakePending)}</b> ثبت‌نامِ در انتظار</Link></li>
            )}
            {b.nextAt && <li className="td-next">اولین ساعت <b>{b.nextAt}</b></li>}
          </ul>
        )}
        <button type="button" className="td-tools-btn" onClick={() => setToolsOpen(true)}>
          <Grid width="16" height="16" aria-hidden="true" /> همهٔ ابزارها
        </button>
      </header>

      {/* ۴۰۳ یعنی ماژولِ کار برای این نقش روشن نیست — این خطا نیست، پس قرمز هم نیست:
          کاربر باید از «همهٔ ابزارها» راهِ خودش را پیدا کند، نه با یک کادرِ قرمز روبه‌رو شود. */}
      {err && (
        <div className={err.status === 403 ? 'td-note' : 'td-err'} role={err.status === 403 ? 'status' : 'alert'}>
          {err.message}
          {err.status === 403 && <span> — از «همهٔ ابزارها» به بخش‌های خودتان بروید.</span>}
        </div>
      )}

      <section className="td-sec" aria-labelledby="td-work-h">
        <div className="td-sec-head">
          <h2 id="td-work-h">کارهای من</h2>
          <Link to="/app/work" className="td-more">همه <ArrowStart width="14" height="14" /></Link>
        </div>
        {data == null ? <p className="td-skel">در حالِ بارگذاری…</p>
          : data.work.length === 0 ? <p className="td-empty">کارِ بازی ندارید.</p>
            : <ul className="wk-list">{data.work.map((w) => <WorkRow key={w.id} w={w} onAct={act} busy={busy} compact />)}</ul>}
      </section>

      {data?.sections.visits && (
        <section className="td-sec" aria-labelledby="td-visits-h">
          <div className="td-sec-head">
            <h2 id="td-visits-h"><Scalpel width="16" height="16" aria-hidden="true" /> عمل‌های امروز</h2>
            <Link to="/app/dashboard" className="td-more">فهرست <ArrowStart width="14" height="14" /></Link>
          </div>
          {data.visits.length === 0 ? <p className="td-empty">امروز عملی ثبت نشده.</p> : (
            <ul className="td-list">
              {data.visits.map((v) => (
                <li key={v.id} className="td-item">
                  <span className="td-time">{v.opStartTime || '—'}</span>
                  <Link to={`/app/patients/${v.patientId}`} className="td-name">{v.fullName}</Link>
                  <span className="td-sub">{[v.surgeonName, v.hospitalName].filter(Boolean).join(' · ')}</span>
                  <span className={`td-tag op-${v.opStatus}`}>{OP_FA[v.opStatus] ?? v.opStatus}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {data?.sections.appointments && (
        <section className="td-sec" aria-labelledby="td-appt-h">
          <div className="td-sec-head">
            <h2 id="td-appt-h"><Calendar width="16" height="16" aria-hidden="true" /> نوبت‌های امروز</h2>
            <Link to="/app/schedule" className="td-more">برنامه <ArrowStart width="14" height="14" /></Link>
          </div>
          {data.appointments.length === 0 ? <p className="td-empty">امروز نوبتی نیست.</p> : (
            <ul className="td-list">
              {data.appointments.map((a) => (
                <li key={a.id} className={`td-item appt-${a.status}`}>
                  <span className="td-time">{a.time || (a.seq != null ? `شمارهٔ ${faNum(a.seq)}` : '—')}</span>
                  {a.patientId
                    ? <Link to={`/app/patients/${a.patientId}`} className="td-name">{a.fullName}</Link>
                    : <span className="td-name muted">ثبت‌نامِ تکمیل‌نشده</span>}
                  <span className="td-sub">{a.topic || ''}</span>
                  <span className={`td-tag appt-${a.status}`}>{APPT_FA[a.status] ?? a.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {data?.sections.exceptions && data.exceptions && (
        <ExceptionsPanel ex={data.exceptions} />
      )}

      <AnimatePresence>
        {toolsOpen && (
          <Overlay backdrop="td-overlay" panel="td-drawer" from="bottom" onClose={() => setToolsOpen(false)} role="dialog" aria-modal="true" aria-label="همهٔ ابزارها">
            <div className="td-drawer-head">
              <h2>همهٔ ابزارها</h2>
              <button type="button" className="td-x" onClick={() => setToolsOpen(false)} aria-label="بستن"><Close width="18" height="18" /></button>
            </div>
            {nothing && <p className="td-empty">دسترسیِ شما هنوز محدود است. مدیرِ سامانه باید سطحتان را ارتقا دهد.</p>}
            <div className="td-tiles">
              {[hero, ...daily, ...tools].filter(Boolean).map((t) => (
                <button key={t.key} type="button" className="glass td-tile" onMouseMove={track} onClick={() => openTool(t)}>
                  <span className="glass-glow" aria-hidden="true" />
                  <span className={`td-tile-ic tint-${t.tint || 'violet'}`}><t.icon width="22" height="22" /></span>
                  <span className="td-tile-label">{t.label}</span>
                </button>
              ))}
            </div>
          </Overlay>
        )}
      </AnimatePresence>

      {toast && <div className="sh-toast" role="status">{toast}</div>}
    </div>
  );
}

const REF_FA = {
  lab_order: 'آزمایش', imaging_order: 'تصویربرداری', consult_order: 'مشاوره',
};
/* نامِ نقش فارسی نوشته می‌شود؛ `secretary` روی صفحهٔ مدیر یعنی کلیدِ خامِ پایگاه‌داده. */
const ROLE_FA = Object.fromEntries(JOB_ROLES.map((r) => [r.v, r.l]));
const hoursSince = (iso) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 3600e3));

/**
 * **نمای استثنا** (W2.5) — فقط برای سوپروایزر و بالاتر.
 *
 * چهار شکافی که هیچ‌کس خبردار نمی‌شود چون هیچ‌کس مسئولشان نیست. عمداً **پایینِ**
 * صفحه است: کارِ خودِ کاربر اول می‌آید، این نما دربارهٔ کارِ تیم است.
 *
 * ⚠️ وقتی هر چهار ردیف صفرند، کلِ بخش رندر **نمی‌شود** — نمای استثنا که همیشه
 * روی صفحه باشد دیگر استثنا نیست و چشم از رویش رد می‌شود.
 */
function ExceptionsPanel({ ex }) {
  const rows = [
    {
      key: 'unowned', count: ex.unowned.count, title: 'کارِ بی‌مسئول (بیش از ۲۴ ساعت)',
      hint: 'در صفِ نقش مانده و کسی برنداشته',
      /* خودِ عنوانِ کار کافی است — `TYPE_FA` همان جمله را دوباره می‌گوید و ردیف را می‌بُرد. */
      line: (w) => w.title,
      meta: (w) => `${faNum(hoursSince(w.createdAt))} ساعت${w.ownerRole ? ` · صفِ ${ROLE_FA[w.ownerRole] ?? w.ownerRole}` : ''}`,
      to: () => '/app/work',
    },
    {
      key: 'stuckEvents', count: ex.stuckEvents.count, title: 'رویدادِ پردازش‌نشده',
      hint: 'زنجیرهٔ رویداد ← کار ایستاده؛ تا رفع نشود هیچ کارِ تازه‌ای ساخته نمی‌شود',
      line: (e) => e.type,
      meta: (e) => `${faNum(hoursSince(e.at))} ساعت`,
      to: () => null,
    },
    {
      key: 'unreviewed', count: ex.unreviewed.count, title: 'نتیجهٔ بررسی‌نشده (بیش از ۴۸ ساعت)',
      hint: 'پاسخ آمده و تصمیمی ثبت نشده',
      line: (o) => REF_FA[o.refType] ?? o.kindFa ?? 'سفارش',
      meta: (o) => `${faNum(hoursSince(o.updatedAt))} ساعت`,
      to: (o) => (o.patientId ? `/app/patients/${o.patientId}` : null),
    },
    {
      key: 'halfApproved', count: ex.halfApproved.count, title: 'تأییدِ نیمه‌کارهٔ ثبت‌نام',
      hint: 'ثبت‌نام تأیید شده ولی مراجعه‌ای ساخته نشده',
      line: () => 'ثبت‌نامِ تأییدشده بدونِ مراجعه',
      meta: (i) => (i.reviewedAt ? `${faNum(hoursSince(i.reviewedAt))} ساعت` : ''),
      to: () => '/app/intake',
    },
  ].filter((r) => r.count > 0);

  if (!rows.length) return null;

  return (
    <section className="td-sec td-ex" aria-labelledby="td-ex-h">
      <div className="td-sec-head">
        <h2 id="td-ex-h"><Alert width="16" height="16" aria-hidden="true" /> از دستِ تیم افتاده</h2>
      </div>
      <ul className="td-ex-list">
        {rows.map((r) => (
          <li key={r.key} className="td-ex-card">
            <div className="td-ex-top">
              <b className="td-ex-count">{faNum(r.count)}</b>
              <span className="td-ex-title">{r.title}</span>
            </div>
            <p className="td-ex-hint">{r.hint}</p>
            <ul className="td-ex-items">
              {(ex[r.key].items ?? []).map((it) => {
                const to = r.to(it);
                const body = <><span className="td-ex-line">{r.line(it)}</span><span className="td-ex-meta">{r.meta(it)}</span></>;
                return <li key={`${r.key}-${it.id}`}>{to ? <Link to={to}>{body}</Link> : body}</li>;
              })}
            </ul>
            {r.count > (ex[r.key].items ?? []).length && (
              <p className="td-ex-more">و {faNum(r.count - (ex[r.key].items ?? []).length)} موردِ دیگر</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
