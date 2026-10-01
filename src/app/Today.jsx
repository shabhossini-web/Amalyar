import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import Overlay from '../ui/Overlay.jsx';
import Tabs from '../ui/Tabs.jsx';
import { api } from '../lib/api.js';
import { useAuth } from './auth.jsx';
import WorkRow from './WorkRow.jsx';
import { ThingPopups, useThings, workTarget } from './thing-popups.jsx';
import { JOB_ROLES } from '../lib/job-roles.js';
import { WORK_CHANGED } from './WorkBell.jsx';
import { groupTools, usePageTitle, useAllowedTools, track } from './tools.jsx';
import { usePrefs } from './usePrefs.jsx';
import { usePendingAccounts } from './usePending.js';
import { useChatUnread } from './ChatBell.jsx';
import { useConfig } from './config.jsx';
import { Alert, ArrowStart, Calendar, Close, Diagnosis, Grid, Plus, Surgery, Truck } from '../ui/icons.jsx';
import { jToFa, todayJStr, ymdToJStr } from '../lib/jalali.js';
import './launcher.css';
import './shell.css';
import './work.css';
import './today.css';
import Toast, { useToast } from '../ui/Toast.jsx';

const faNum = (n) => Number(n || 0).toLocaleString('fa-IR');
/* سلام بر پایهٔ ساعتِ **دستگاه** — نه سرور: کاربرِ شبِ ایران نباید «صبح بخیر» بگیرد
   چون سرور جای دیگری است. این تنها چیزی است که این‌جا محاسبه می‌شود. */
const greeting = (h) => (h < 5 ? 'شبِ آرام' : h < 12 ? 'صبح بخیر' : h < 17 ? 'ظهر بخیر' : h < 21 ? 'عصر بخیر' : 'شب بخیر');
/* فهرستِ یک دستهٔ «مالِ کیست» — همان سقفِ نمای تیمِ خودِ `/work/today`؛ بقیه در `/app/work`. */
const OWNER_ROWS = 12;

/* هشدار: نگاشتِ فارسیِ وضعیت این‌جا **نیست** و نباید برگردد: سرور برچسب را همراهِ
   خودِ ردیف می‌فرستد (`statusFa`, `opStatusFa`). نسخهٔ کلاینتیِ قبلی با سرور
   نمی‌خواند («رسید» در برابرِ «در مطب»، «رزرو» در برابرِ «در انتظارِ پرداخت»)،
   پس یک بیمار در دو میز دو وضعیتِ متفاوت داشت. نگهبانِ CI همین را می‌سنجد. */

/**
 * صفحهٔ «امروز» (W2.3) — صفحهٔ نخستِ سامانه، به‌جای لانچر (`DECISIONS.md` #۲).
 *
 * تا امروز کاربر بعد از ورود یک **فهرستِ ابزار** می‌دید و باید خودش می‌فهمید
 * کارش کجاست؛ حالا اولین چیزی که می‌بیند کارِ خودش است و ابزارها یک کلیک
 * پایین‌تر در کشوی «همهٔ ابزارها» می‌مانند (لانچر هنوز روی `/app/tools` هست).
 *
 * هشدار: هیچ عددی این‌جا حساب نمی‌شود: `GET /work/today` آماده می‌دهدشان (قانونِ ۱۵).
 * هشدار: هر بخش سمتِ سرور گیت شده؛ `sections` می‌گوید کدام‌ها را اصلاً نشان بدهیم،
 * پس کارشناسِ سطح ۲ صفحهٔ نصفه‌خالی با کادرهای «دسترسی ندارید» نمی‌بیند.
 *
 * **سوپرادمین بی‌محدودیت است** (قانونِ ۲۹، خواستهٔ مالک ۱۴۰۵/۰۷/۰۳): سرور `team`
 * می‌گوید و «کارهای من» می‌شود «کارهای تیم» — کارِ همه، هر ردیف با «مالِ کیست»،
 * با همان «انجام شد»/«فردا» و «واگذاری». تا دیروز این بخش برای او تقریباً خالی بود
 * چون نقشِ شغلی ندارد، و برای دیدنِ کارِ دیگران باید پروفایل عوض می‌کرد.
 */
export default function Today() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(0);
  const { msg: toast, show: setToast } = useToast(1800);
  const [toolsOpen, setToolsOpen] = useState(false);
  const { hero, daily, tools, nothing } = useAllowedTools();
  /* شمارِ درخواست‌های عضویت روی کاشیِ «کاربران»ِ کشو — فقط سوپرادمین (بازبینیِ UX ۱۴۰۵/۰۷). */
  const pendingAccounts = usePendingAccounts((user?.level ?? 0) >= 6);
  /* پیام‌های نخواندهٔ پیام‌رسان — چیپِ خلاصه و نشانِ کاشی (بازبینیِ UX ۱۴۰۵/۰۷). */
  const chatUnread = useChatUnread(daily.some((x) => x.key === 'messenger'));
  /* **ابزارک‌های منتخب** (بازخوردِ مالک ۱۴۰۵/۰۷/۰۳) — سه خانه بالای صفحه، به‌ازای هر حساب
     (`/auth/prefs`). خانهٔ خالی کشوی ابزارها را برای **انتخاب** باز می‌کند، خانهٔ پر خودِ
     ابزار را. ابزاری که دیگر اجازه‌اش نیست خانه‌اش را خالی نشان می‌دهد. */
  const { prefs, save: savePrefs } = usePrefs();
  const [pickSlot, setPickSlot] = useState(null);
  const allTools = [hero, ...daily, ...tools].filter(Boolean);
  const toolByKey = new Map(allTools.map((x) => [x.key, x]));
  const setPin = async (slot, key) => {
    /* همان ابزار در خانهٔ دیگری بود؟ جابه‌جا می‌شود، نه دوتا. */
    const next = prefs.todayPins.map((k, i) => (i === slot ? key : k === key ? null : k));
    try { await savePrefs('todayPins', next); } catch (e) { setToast(e?.message || 'ذخیره نشد'); }
  };
  /* واژهٔ حوزه از واژگان (قانونِ ۲۴): «عملِ امروز» فقط در حوزه‌های عمل؛ مطب «ویزیت» — و تیغِ جراحی
     فقط آن‌جا که عمل است. `Surgery` نه `Scalpel`: تیغِ مورب همان مدادِ «ویرایش» بود. */
  const { t, vertical } = useConfig();
  const VisitIcon = vertical === 'clinic' ? Diagnosis : Surgery;
  /* چیپِ نوع روی هر ردیف: مطب ویزیت و عمل را در یک فهرست دارد، پس همه‌جا؛ جای دیگر فقط وقتی
     نوعِ ردیف همان «عمل»ِ پیش‌فرضِ فهرست نیست. برچسب را سرور می‌دهد (`kindFa`). */
  const kindChip = (v) => (vertical === 'clinic' || v.kind !== 'surgery') && (v.kindFa || v.kind);

  /* زبانه هم مثلِ همهٔ صفحه‌ها «نامِ صفحه — نامِ مطب/شرکت» (shell-15). */
  usePageTitle('امروز');

  const load = useCallback(() => {
    api('/work/today')
      .then((r) => { setData(r); setErr(null); })
      .catch((e) => setErr({ message: e?.message || 'بارگذاری نشد', status: e?.status ?? 0 }));
  }, []);
  /* هشدار: حساب در همین تب عوض می‌شود (`/auth/switch`) بی آنکه صفحه از نو سوار شود؛
     بی `user?.id` دادهٔ حسابِ قبلی (و دکمهٔ «+»ِ او) می‌ماند و به ۴۰۳ می‌خورد. */
  useEffect(() => { setData(null); load(); }, [load, user?.id]);

  /* ── نمای تیم (سوپرادمین، قانونِ ۲۹) ──
     سرور می‌گوید (`team`) و دسته‌های «مالِ کیست» را با شمار و `filter`ِ آماده می‌دهد
     (`owners`)؛ رابط سطح را حساب نمی‌کند (قانونِ ۳). دستهٔ انتخاب‌شده از خودِ سرور
     پرسیده می‌شود نه از میانِ همان ردیف‌های آمده — وگرنه تب «سارا ۸» می‌گفت و سه
     ردیف نشان می‌داد. */
  const team = data?.team === true;
  const owners = team ? data.owners ?? [] : [];
  const [facet, setFacet] = useState('all');
  const current = facet === 'all' ? null : owners.find((o) => o.key === facet) ?? null;
  const facetQuery = current ? new URLSearchParams({ scope: 'inbox', limit: String(OWNER_ROWS), ...current.filter }).toString() : '';
  const [facetRows, setFacetRows] = useState(null);
  const [facetTick, setFacetTick] = useState(0);
  const facetReq = useRef({ n: 0, query: '' });
  /* فهرستِ افراد برای «واگذاری» — یک‌بار، فقط در نمای تیم. `false` یعنی نیامد: ردیف‌ها
     برچسبِ ساده می‌مانند نه دکمه‌ای که به فهرستِ خالی باز شود. */
  const [assignees, setAssignees] = useState(null);
  useEffect(() => { setFacet('all'); setAssignees(null); }, [user?.id]);
  /* دسته‌ای که با تازه‌شدنِ صفحه خالی شد (آخرین کارش بسته یا واگذار شد) دیگر تب ندارد؛ برگرد به «همه». */
  useEffect(() => { if (facet !== 'all' && data && !current) setFacet('all'); }, [facet, data, current]);
  useEffect(() => {
    const req = facetReq.current;
    /* برگشت به «همه»: پرسشِ در راه دیگر مالِ این نما نیست، و انتخابِ دوبارهٔ همان دسته
       باید «در حالِ بارگذاری» بگیرد نه ردیف‌های کهنهٔ دفعهٔ قبل. */
    if (!facetQuery) { req.n += 1; req.query = ''; return; }
    const my = ++req.n;
    /* تعویضِ دسته = «در حالِ بارگذاری»؛ تازه‌شدنِ همان دسته (بعد از «انجام شد») ردیف‌ها را
       تا رسیدنِ پاسخ نگه می‌دارد — فهرست زیرِ دستِ کاربر چشمک نمی‌زند. */
    if (req.query !== facetQuery) { req.query = facetQuery; setFacetRows(null); }
    api(`/work?${facetQuery}`)
      .then((r) => { if (req.n === my) setFacetRows(Array.isArray(r) ? r : []); })
      .catch(() => { if (req.n === my) setFacetRows('error'); });
  }, [facetQuery, facetTick]);
  useEffect(() => {
    if (!team || assignees !== null) return undefined;
    let live = true;
    api('/work/assignees')
      .then((r) => { if (live) setAssignees(Array.isArray(r) ? r : []); })
      .catch(() => { if (live) setAssignees(false); });
    return () => { live = false; };
  }, [team, assignees]);

  /* پاپ‌آپِ «همان چیز» (سفارش/مراجعه) از ردیفِ کار و از نمای استثنا — بازخوردِ
     مالک: هشدار باید بگوید مالِ چیست و با کلیک بازِ شود و از همان‌جا انجام شود.
     بعد از هر ثبت، صفحه و زنگِ پوسته با هم تازه می‌شوند. */
  const things = useThings({
    onChanged: () => { load(); window.dispatchEvent(new Event(WORK_CHANGED)); },
    toast: (m) => setToast(m),
  });
  const [busyProc, setBusyProc] = useState(false);
  /* «پردازشِ صف» برای رویدادِ گیرکرده — همان `POST /work/process` که worker می‌زند؛
     دکمه فقط وقتی هست که سرور `canProcess` داده (مجوزِ `work.process`) — بیرونِ
     `exceptions`، که همیشه فقط `{count, items}` است. */
  const processQueue = async () => {
    setBusyProc(true);
    try {
      const r = await api('/work/process', { method: 'POST' });
      setToast(`صف پردازش شد (${faNum(r?.processed ?? 0)} رویداد)`);
      load();
      window.dispatchEvent(new Event(WORK_CHANGED));
    } catch (e) { setToast(e?.message || 'پردازش نشد'); } finally { setBusyProc(false); }
  };
  /* کاری که از زنگِ پوسته بسته شود باید همین‌جا هم برود — فهرستِ دستهٔ انتخاب‌شده هم. */
  useEffect(() => {
    const h = () => { load(); setFacetTick((n) => n + 1); };
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
      setFacetRows((r) => (Array.isArray(r) ? r.filter((x) => x.id !== w.id) : r));
      window.dispatchEvent(new Event(WORK_CHANGED));
      setToast(action === 'done' ? (body.outcome?.dismissed ? 'یادآوری بسته شد' : 'انجام شد') : 'یادآوری به فردا افتاد');
    } catch (e) {
      setToast(e?.message || 'انجام نشد');
    } finally {
      setBusy(0);
    }
  };
  /* «واگذاری» از ردیفِ تیم — همان `PATCH /work/:id` که سوپروایزر هم دارد؛ ممیزی به نامِ
     خودِ سوپرادمین ثبت می‌شود. نامِ مقصد در توست از پاسخِ سرور می‌آید، نه از فهرستِ کلاینت. */
  const assign = async (w, accountId) => {
    setBusy(w.id);
    try {
      const r = await api(`/work/${w.id}`, { method: 'PATCH', body: { action: 'assign', accountId } });
      window.dispatchEvent(new Event(WORK_CHANGED));
      setToast(r?.mine ? 'به نامِ خودتان شد' : r?.ownerName ? `به ${r.ownerName} واگذار شد` : 'واگذار شد');
    } catch (e) {
      setToast(e?.message || 'واگذار نشد');
    } finally {
      setBusy(0);
    }
  };

  const openTool = (t) => {
    if (pickSlot != null) { const slot = pickSlot; setPickSlot(null); setToolsOpen(false); setPin(slot, t.key); return; }
    setToolsOpen(false);
    if (t.to) navigate(t.to);
  };
  const b = data?.brief;
  const name = user?.displayName || user?.firstName || '';
  /* ردیف‌های بخشِ کار: «همه» از خودِ `/work/today`، هر دسته از `GET /work` با فیلترِ همان دسته.
     شمار و مقصدِ «همه» هم دنبالِ دستهٔ انتخاب‌شده می‌روند — «کارهای من» همان دسته را باز می‌کند. */
  const workRows = data == null ? null : current ? facetRows : data.work;
  const viewCount = current ? current.count : b?.work ?? 0;
  const workTo = current ? `/app/work?owner=${encodeURIComponent(current.key)}` : '/app/work';

  /* پرش از چیپ‌های خلاصه به بخشِ خودشان — فوکوس هم به سرتیترِ همان بخش می‌رود. */
  const jump = (id) => (e) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    el.querySelector('h2')?.focus({ preventScroll: true });
  };
  const next = b?.next ?? null;
  /* میان‌بُرها (بازخوردِ مالک ۱۴۰۵/۰۷/۰۳): خانه‌های پر به‌شکلِ کاشی؛ خانه‌های خالی دیگر سه کادرِ
     خط‌چینِ بزرگ بالای صفحه نیستند — یک دکمهٔ کوچکِ «+ افزودنِ میان‌بُر» (بازبینیِ UX ۱۴۰۵/۰۷). */
  const pinned = prefs.todayPins.map((key, i) => ({ key, i, tool: key ? toolByKey.get(key) : null })).filter((x) => x.tool);
  const freeSlot = prefs.todayPins.findIndex((key) => !(key && toolByKey.get(key)));
  /* ساعتِ خالی: «ساعت؟» کم‌رنگ، نه «—»ِ درشت که دکمهٔ «جمع‌کردن» خوانده می‌شد (company-22)؛ برای
     کسی که مراجعه ثبت می‌کند، همان دکمه پنجرهٔ مراجعه را برای ثبتِ ساعت باز می‌کند. */
  const noTime = (v) => (data?.canCreateVisit
    ? <button type="button" className="td-time none" onClick={() => things.open({ type: 'visit', id: v.id, patientId: v.patientId })} aria-label={`ثبتِ ساعتِ ${v.fullName}`}>ساعت؟</button>
    : <span className="td-time none">ساعت؟</span>);

  return (
    <div className={data?.canCreateVisit ? 'td has-fab' : 'td'}>
      <header className="td-head">
        <h1 className="td-hello">
          {greeting(new Date().getHours())}{name ? `، ${name}` : ''}
        </h1>
        {/* «بعدی» بر پایهٔ **ساعتِ اکنون** (سرور)، با نامِ بیمار — نه زودترین ساعتِ کلِ روز. */}
        {next && (
          <p className="td-nextline">
            {next.patientId
              ? <Link to={`/app/patients/${next.patientId}`}>بعدی: ساعتِ <bdi dir="ltr">{jToFa(next.at)}</bdi> — {next.name || 'بیمار'}</Link>
              : <>بعدی: ساعتِ <bdi dir="ltr">{jToFa(next.at)}</bdi>{next.name ? ` — ${next.name}` : ''}</>}
          </p>
        )}
        {b && (
          <ul className="td-chips" aria-label="خلاصهٔ امروز">
            {/* هر چیپ به بخشِ خودش می‌برد (بازبینیِ UX ۱۴۰۵/۰۷). چیپِ کار **اول** می‌ماند: شمارش‌ها و آزمون‌ها همین را می‌خوانند. */}
            <li className={`td-link${b.overdue ? ' hot' : ''}`}>
              <a href="#td-work" onClick={jump('td-work')}><b>{faNum(b.work)}</b> {team ? 'کارِ بازِ تیم' : 'کارِ باز'}{b.overdue > 0 && <em> ({faNum(b.overdue)} عقب‌افتاده)</em>}</a>
            </li>
            {data.sections.route && <li className="td-link"><a href="#td-route" onClick={jump('td-route')}><b>{faNum(b.stopsLeft)}</b> توقفِ مانده</a></li>}
            {data.sections.visits && <li className="td-link"><a href="#td-visits" onClick={jump('td-visits')}><b>{faNum(b.visits)}</b> {t.todayVisit}</a></li>}
            {data.sections.appointments && <li className="td-link"><a href="#td-appt" onClick={jump('td-appt')}><b>{faNum(b.appointments)}</b> نوبتِ امروز</a></li>}
            {data.sections.intake && b.intakePending > 0 && (
              <li className="td-link"><Link to="/app/intake"><b>{faNum(b.intakePending)}</b> ثبت‌نامِ در انتظار</Link></li>
            )}
            {chatUnread > 0 && (
              <li className="td-link"><Link to="/app/chat"><b>{faNum(chatUnread)}</b> پیامِ نخوانده</Link></li>
            )}
          </ul>
        )}
        <div className="td-acts">
          <button type="button" className="td-tools-btn" onClick={() => setToolsOpen(true)}>
            <Grid width="16" height="16" aria-hidden="true" /> همهٔ ابزارها
          </button>
          {/* ── «+» — افزودنِ سریعِ مراجعهٔ دستی (بازخوردِ مالک ۱۴۰۵/۰۷/۰۱). همان فرمِ «مراجعهٔ
              جدید»ِ داشبورد؛ فقط وقتی سرور گفته این کاربر اجازهٔ ساخت دارد (`canCreateVisit`).
              روی گوشی دکمهٔ شناورِ گرد، روی دسکتاپ دکمهٔ برچسب‌دار کنارِ «همهٔ ابزارها» — «+»ِ
              شناورِ بی‌برچسب آن‌جا روی ستونِ چیپ‌های وضعیت می‌نشست (بازبینیِ UX ۱۴۰۵/۰۷). */}
          {data?.canCreateVisit && (
            <button
              type="button"
              className="td-fab"
              data-quick-visit
              aria-label={t.visitNew}
              title={t.visitNew}
              onClick={() => things.show({ type: 'visit', prefill: { opDateJ: ymdToJStr(data?.clinicToday) || todayJStr() } })}
            >
              <Plus width="26" height="26" aria-hidden="true" />
              <span className="td-fab-t" aria-hidden="true">{t.visitNew}</span>
            </button>
          )}
        </div>
      </header>

      <section className={`td-favs${pinned.length ? '' : ' empty'}`} aria-label="میان‌بُرها" data-today-favs>
        {pinned.map(({ key, i, tool }) => (
          <div key={`fav-${i}`} className="td-fav on" data-fav-slot={i} data-fav={key}>
            <button type="button" className="td-fav-open" onClick={() => openTool(tool)}>
              <span className={`td-tile-ic tint-${tool.tint || 'violet'}`}><tool.icon width="22" height="22" aria-hidden="true" /></span>
              <span>{tool.label}</span>
            </button>
            <button type="button" className="td-fav-x" aria-label={`برداشتنِ «${tool.label}» از میان‌بُرها`}
              onClick={() => setPin(i, null)}>
              <Close width="13" height="13" aria-hidden="true" />
            </button>
          </div>
        ))}
        {freeSlot >= 0 && (
          <button type="button" className="td-fav-add" data-fav-add onClick={() => { setPickSlot(freeSlot); setToolsOpen(true); }}>
            <Plus width="16" height="16" aria-hidden="true" /> افزودنِ میان‌بُر
          </button>
        )}
      </section>

      {/* ۴۰۳ یعنی ماژولِ کار برای این نقش روشن نیست — این خطا نیست، پس قرمز هم نیست:
          کاربر باید از «همهٔ ابزارها» راهِ خودش را پیدا کند، نه با یک کادرِ قرمز روبه‌رو شود. */}
      {err && (
        <div className={err.status === 403 ? 'td-note' : 'td-err'} role={err.status === 403 ? 'status' : 'alert'}>
          {err.message}
          {err.status === 403 && <span> — از «همهٔ ابزارها» به بخش‌های خودتان بروید.</span>}
        </div>
      )}

      {/* ── برنامهٔ خودِ امروز **اول** (بازبینیِ UX ۱۴۰۵/۰۷): منشی و پزشک صفحه را برای «امروز چه
          کسی می‌آید» باز می‌کنند؛ ویزیت‌های مطب از ارتفاعِ ۶۵۰ و عمل‌های شرکت از صفحهٔ سوم شروع
          می‌شد، زیرِ سه خانهٔ خالی و فهرستِ کارها. کارها بعد از برنامه می‌آیند و چیپِ بالا به آن‌ها می‌پرد. */}
      {/* مسیرِ امروزِ راننده و پیک (گزارشِ مالک ۱۴۰۵/۰۷/۰۹): تحویلی که روی تختهٔ حمل‌ونقل به نامش
          ثبت شده همین‌جا دیده می‌شود؛ جزئیاتِ بار و ثبتِ تحویل در پنلِ «حمل‌ونقل» است. */}
      {data?.sections.route && (
        <section className="td-sec" id="td-route" aria-labelledby="td-route-h">
          <div className="td-sec-head">
            <h2 id="td-route-h" tabIndex={-1}><Truck width="16" height="16" aria-hidden="true" /> مسیرِ امروز</h2>
            <Link to="/app/transport" className="td-more">مسیرِ من <ArrowStart width="14" height="14" /></Link>
          </div>
          {data.route.length === 0 ? <p className="td-empty">امروز توقفی به نامِ شما ثبت نشده.</p> : (
            <ul className="td-list">
              {data.route.map((s) => (
                <li key={s.id} className="td-item">
                  {s.plannedAt
                    ? <span className="td-time"><bdi dir="ltr">{jToFa(s.plannedAt)}</bdi></span>
                    : <span className="td-time none">ساعت؟</span>}
                  <span className="td-main">
                    <Link to="/app/transport" className="td-name">{s.place || 'مقصدِ نامشخص'}</Link>
                    <span className="td-kind">{s.kindFa}</span>
                  </span>
                  <span className="td-sub">{s.waybills > 0 ? `${faNum(s.waybills)} حواله` : 'بی‌حواله'}</span>
                  <span className={`td-tag${s.done ? ' op-done' : ''}`}>{s.done ? 'انجام شد' : 'مانده'}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {data?.sections.visits && (
        <section className="td-sec" id="td-visits" aria-labelledby="td-visits-h">
          <div className="td-sec-head">
            <h2 id="td-visits-h" tabIndex={-1}><VisitIcon width="16" height="16" aria-hidden="true" /> {t.todayVisits}</h2>
            <Link to="/app/dashboard" className="td-more">فهرست <ArrowStart width="14" height="14" /></Link>
          </div>
          {data.visits.length === 0 ? <p className="td-empty">{t.todayVisitsEmpty}</p> : (
            <ul className="td-list">
              {data.visits.map((v) => (
                <li key={v.id} className="td-item">
                  {v.opStartTime ? <span className="td-time">{v.opStartTime}</span> : noTime(v)}
                  <span className="td-main">
                    <Link to={`/app/patients/${v.patientId}`} className="td-name">{v.fullName}</Link>
                    {kindChip(v) && (
                      <span className={`td-kind${v.kind === 'surgery' ? ' k-surgery' : ''}`}>
                        {v.kind === 'surgery' && <Surgery width="13" height="13" aria-hidden="true" />}
                        {kindChip(v)}
                      </span>
                    )}
                  </span>
                  <span className="td-sub">
                    {[v.surgeonName, v.hospitalName].filter(Boolean).join(' · ')}
                    {/* کارشناسِ مسئول — مهم‌ترین سؤالِ مدیرِ شرکت دربارهٔ عملِ امروز. */}
                    {v.techName && <>{v.surgeonName || v.hospitalName ? ' · ' : ''}<span className="td-tech">{t.tech}: {v.techName}</span></>}
                  </span>
                  <span className={`td-tag op-${v.opStatus}`}>{v.opStatusFa ?? v.opStatus}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {data?.sections.appointments && (
        <section className="td-sec" id="td-appt" aria-labelledby="td-appt-h">
          <div className="td-sec-head">
            <h2 id="td-appt-h" tabIndex={-1}><Calendar width="16" height="16" aria-hidden="true" /> نوبت‌های امروز</h2>
            <Link to="/app/schedule" className="td-more">برنامه <ArrowStart width="14" height="14" /></Link>
          </div>
          {data.appointments.length === 0 ? <p className="td-empty">امروز نوبتی نیست.</p> : (
            <ul className="td-list">
              {data.appointments.map((a) => (
                <li key={a.id} className={`td-item appt-${a.status}`}>
                  {a.time || a.seq != null
                    ? <span className="td-time">{a.time || `شمارهٔ ${faNum(a.seq)}`}</span>
                    : <span className="td-time none">ساعت؟</span>}
                  {a.patientId
                    ? <Link to={`/app/patients/${a.patientId}`} className="td-name">{a.fullName}</Link>
                    : <span className="td-name muted">ثبت‌نامِ تکمیل‌نشده</span>}
                  <span className="td-sub">{a.topic || ''}</span>
                  <span className={`td-tag appt-${a.status}`}>{a.statusFa ?? a.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="td-sec" id="td-work" aria-labelledby="td-work-h">
        <div className="td-sec-head">
          <h2 id="td-work-h" tabIndex={-1}>{team ? 'کارهای تیم' : 'کارهای من'}</h2>
          <Link to={workTo} className="td-more">همه <ArrowStart width="14" height="14" /></Link>
        </div>
        {/* «مالِ کیست» — یک ردیف تبِ اسکرولی با شمارِ هر دسته، تا پخشِ کار بینِ تیم
            در یک نگاه دیده شود و با یک لمس به کارِ یک نفر برسد. همان `Tabs`ِ سامانه
            (فلش‌ها/Home/End، قرصِ لغزان، حرکتِ کمتر). شمار داخلِ برچسب است نه `badge`:
            نشانِ کهربایی یعنی «هشدار» و این‌جا هیچ دسته‌ای هشدار نیست. */}
        {team && owners.length > 0 && (
          <Tabs
            variant="scroll" className="td-owners" label="مسئولِ کار" value={current ? current.key : 'all'} onChange={setFacet}
            items={[
              { key: 'all', label: <>همه <b className="td-own-n">{faNum(b.work)}</b></> },
              ...owners.map((o) => ({ key: o.key, label: <>{o.label} <b className="td-own-n">{faNum(o.count)}</b></> })),
            ]}
          />
        )}
        {workRows == null ? <p className="td-skel">در حالِ بارگذاری…</p>
          : workRows === 'error' ? (
            <p className="td-empty" role="alert">
              فهرستِ این دسته نیامد.{' '}
              <button type="button" className="td-retry" onClick={() => setFacetTick((n) => n + 1)}>دوباره</button>
            </p>
          )
            : workRows.length === 0 ? <p className="td-empty">{!team ? 'کارِ بازی ندارید.' : current ? 'در این دسته کارِ بازی نمانده.' : 'تیم کارِ بازی ندارد.'}</p>
              : (
                <>
                  <ul className="wk-list">
                    {workRows.map((w) => (
                      <WorkRow
                        key={w.id} w={w} onAct={act} busy={busy} compact
                        onOpen={workTarget(w) ? () => things.open(workTarget(w)) : undefined}
                        onAssign={assignees ? assign : undefined} assignees={assignees || undefined}
                      />
                    ))}
                  </ul>
                  {/* فهرست بریده شده؟ بگو چندتای دیگر هست و کجا — نه اینکه دوازده ردیف «همه» به‌نظر برسد. */}
                  {team && viewCount > workRows.length && (
                    <Link to={workTo} className="td-more td-more-all">همهٔ {faNum(viewCount)} کار <ArrowStart width="14" height="14" /></Link>
                  )}
                </>
              )}
      </section>

      {data?.sections.exceptions && data.exceptions && (
        <ExceptionsPanel ex={data.exceptions} onOpen={things.open} onProcess={data.canProcess ? processQueue : null} busyProc={busyProc} />
      )}

      <AnimatePresence>
        {toolsOpen && (
          <Overlay backdrop="td-overlay" panel="td-drawer" from="bottom" onClose={() => { setToolsOpen(false); setPickSlot(null); }} role="dialog" aria-modal="true"
            aria-label={pickSlot != null ? 'افزودنِ میان‌بُر' : 'همهٔ ابزارها'}>
            <div className="td-drawer-head">
              <h2>{pickSlot != null ? 'افزودنِ میان‌بُر' : 'همهٔ ابزارها'}</h2>
              {/* نمای کاملِ لانچر (`/app/tools`) تا بازبینیِ UX هیچ راهی نداشت. */}
              {pickSlot == null && <Link to="/app/tools" className="td-more td-full" onClick={() => setToolsOpen(false)}>نمای کامل <ArrowStart width="14" height="14" /></Link>}
              <button type="button" className="td-x" onClick={() => { setToolsOpen(false); setPickSlot(null); }} aria-label="بستن"><Close width="18" height="18" /></button>
            </div>
            {nothing && <p className="td-empty">دسترسیِ شما هنوز محدود است. مدیرِ سامانه باید سطحتان را ارتقا دهد.</p>}
            {/* گروه‌بندی‌شده — «کارِ روزانه» بالا، «مدیریت و تنظیمات» پایین (بازبینیِ UX ۱۴۰۵/۰۷). */}
            {groupTools([hero, ...daily, ...tools]).map((g) => (
              <section key={g.key} className="td-group" aria-labelledby={`td-g-${g.key}`}>
                <h3 id={`td-g-${g.key}`} className="td-group-h">{g.label}</h3>
                <div className="td-tiles">
                  {g.tools.map((t) => (
                    <button key={t.key} type="button" className="glass td-tile" onMouseMove={track} onClick={() => openTool(t)}>
                      <span className="glass-glow" aria-hidden="true" />
                      <span className={`td-tile-ic tint-${t.tint || 'violet'}`}><t.icon width="22" height="22" /></span>
                      <span className="td-tile-label">{t.label}</span>
                      {t.key === 'messenger' && chatUnread > 0 && (
                        <span className="td-badge" aria-label={`${faNum(chatUnread)} پیامِ نخوانده`}>{faNum(chatUnread)}</span>
                      )}
                      {t.key === 'users' && pendingAccounts > 0 && (
                        <span className="td-badge" aria-label={`${faNum(pendingAccounts)} درخواستِ عضویت در انتظارِ تأیید`}>{faNum(pendingAccounts)}</span>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </Overlay>
        )}
      </AnimatePresence>

      <ThingPopups things={things} />
      <Toast msg={toast} />
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
 * هشدار: وقتی هر چهار ردیف صفرند، کلِ بخش رندر **نمی‌شود** — نمای استثنا که همیشه
 * روی صفحه باشد دیگر استثنا نیست و چشم از رویش رد می‌شود.
 *
 * هر نمونه **نامِ بیمار** را می‌گوید و اگر مقصدی دارد (سفارش، مراجعه) دکمه است و
 * پاپ‌آپِ همان چیز را باز می‌کند؛ وگرنه به پرونده/صفحهٔ مربوط لینک می‌دهد.
 * تا دیروز «نتیجهٔ بررسی‌نشده» فقط «آزمایش · ۷۲ ساعت» بود — نه معلوم بود کدام
 * بیمار، نه از همین‌جا می‌شد بررسی‌اش کرد (بازخوردِ مالک).
 */
function ExceptionsPanel({ ex, onOpen, onProcess, busyProc }) {
  const who = (it) => it.patient?.fullName || '';
  const patientTo = (it) => ((it.patient?.id ?? it.patientId) ? `/app/patients/${it.patient?.id ?? it.patientId}` : null);
  const rows = [
    {
      key: 'unowned', count: ex.unowned.count, title: 'کارِ بی‌مسئول (بیش از ۲۴ ساعت)',
      hint: 'در صفِ نقش مانده و کسی برنداشته',
      /* خودِ عنوانِ کار کافی است — `TYPE_FA` همان جمله را دوباره می‌گوید و ردیف را می‌بُرد. */
      line: (w) => w.title,
      meta: (w) => `${faNum(hoursSince(w.createdAt))} ساعت${w.ownerRole ? ` · صفِ ${ROLE_FA[w.ownerRole] ?? w.ownerRole}` : ''}`,
      open: (w) => workTarget(w),
      to: (w) => patientTo(w) ?? '/app/work',
    },
    {
      key: 'stuckEvents', count: ex.stuckEvents.count, title: 'رویدادِ پردازش‌نشده',
      hint: 'زنجیرهٔ رویداد ← کار ایستاده؛ تا رفع نشود هیچ کارِ تازه‌ای ساخته نمی‌شود',
      /* برچسبِ فارسی از سرور (`typeFa`) — نوعِ خامِ `appointment.cancelled` برای مدیر معنا ندارد. */
      line: (e) => e.typeFa ?? e.type,
      meta: (e) => `${faNum(hoursSince(e.at))} ساعت`,
      open: () => null,
      to: patientTo,
      action: onProcess ? { label: busyProc ? 'در حالِ پردازش…' : 'پردازشِ صف', run: onProcess } : null,
    },
    {
      key: 'unreviewed', count: ex.unreviewed.count, title: 'نتیجهٔ بررسی‌نشده (بیش از ۴۸ ساعت)',
      hint: 'پاسخ آمده و تصمیمی ثبت نشده',
      line: (o) => `${REF_FA[o.refType] ?? o.kindFa ?? 'سفارش'} — نتیجه آمده`,
      meta: (o) => `${faNum(hoursSince(o.updatedAt))} ساعت`,
      open: (o) => ({ type: 'order', kind: o.kind ?? String(o.refType ?? '').replace(/_order$/, ''), id: o.id, patientId: o.patient?.id ?? o.patientId }),
      to: patientTo,
    },
    {
      key: 'halfApproved', count: ex.halfApproved.count, title: 'تأییدِ نیمه‌کارهٔ ثبت‌نام',
      hint: 'ثبت‌نام تأیید شده ولی مراجعه‌ای ساخته نشده',
      line: () => 'ثبت‌نامِ تأییدشده بدونِ مراجعه',
      meta: (i) => (i.reviewedAt ? `${faNum(hoursSince(i.reviewedAt))} ساعت` : ''),
      open: () => null,
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
                const spec = r.open(it);
                const to = spec ? null : r.to(it);
                const name = who(it);
                const body = (
                  <>
                    <span className="td-ex-line">{r.line(it)}</span>
                    {name && <span className="td-ex-who">{name}</span>}
                    <span className="td-ex-meta">{r.meta(it)}</span>
                  </>
                );
                return (
                  <li key={`${r.key}-${it.id}`}>
                    {spec
                      ? <button type="button" className="td-ex-btn" onClick={() => onOpen(spec)}>{body}</button>
                      : to ? <Link to={to}>{body}</Link> : body}
                  </li>
                );
              })}
            </ul>
            {r.count > (ex[r.key].items ?? []).length && (
              <p className="td-ex-more">و {faNum(r.count - (ex[r.key].items ?? []).length)} موردِ دیگر</p>
            )}
            {r.action && (
              <button type="button" className="td-ex-act" disabled={busyProc} onClick={r.action.run}>{r.action.label}</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
