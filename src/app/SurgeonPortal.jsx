import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, apiBlobUrl } from '../lib/api.js';
import { faDate, jStrToIso, todayJStr } from '../lib/jalali.js';
import { fmtMoney } from '../lib/money.js';
import { useAuth } from './auth.jsx';
import { useConfig, useStatusMap } from './config.jsx';
import { HERO, useAllowedTools } from './tools.jsx';
import RequiredItems from './RequiredItems.jsx';
import AssistedTextarea from '../ui/AssistedTextarea.jsx';
import Tabs from '../ui/Tabs.jsx';
import Pick from '../ui/Pick.jsx';
import { Doctor, Eye } from '../ui/icons.jsx';
import WorkRow from './WorkRow.jsx';
import { WORK_CHANGED } from './WorkBell.jsx';
import { ThingPopups, useThings, workTarget } from './thing-popups.jsx';
import { kindOf } from './visit-kinds.js';
import JDate from './JDate.jsx';
import './surgeon-portal.css';
import './launcher.css';
import './dashboard.css';
import './intake-admin.css'; // پایهٔ db-*/bl-*/ia-* که تا پیش از lazy‌شدنِ مسیرها از باندلِ مشترک می‌آمد
import './shell.css'; // `.sh-toast`
import './work.css'; // ردیفِ کار (`.wk-*`) در «امروزِ من»

const faNum = (n) => String(n ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
/* هشدار: برچسبِ وضعیت از سرور می‌آید (`statusFa`/`opStatusFa`)، نه از نگاشتِ
   کلاینتی — قانونِ «یک وضعیت، یک برچسب» در `server/src/patients/labels.ts`. */
/* هشدار: ساعت هم عدد است: بقیهٔ میز فارسی بود و فقط «۰۸:۳۰» لاتین می‌ماند — در
   اسکرین‌شات مثلِ وصلهٔ زبانِ دیگر می‌زد. `faNum` روی `null` رشتهٔ خالی می‌دهد،
   پس سه‌راههٔ ساعت/شماره/خط‌تیره دست‌نخورده می‌مانَد. */
const faTime = (t) => (t ? faNum(t) : null);
/* هشدار: نگاشتِ سومِ وضعیتِ سفارش برداشته شد — «نتیجه آمده» این‌جا در برابرِ
   «نتیجه آمد — بررسی نشده»ی شیتِ سفارش. از `/config.statuses.order` می‌آید. */

/* پاسخِ «نمای ناظر نیست» — وقتی `/surgeon/desk` نیامد (شبکه، نسخهٔ قدیمیِ سرور) میز
   همان میزِ همیشگیِ پزشک می‌ماند، نه صفحهٔ شکسته. */
const PLAIN_DESK = { unrestricted: false, doctors: [] };

/**
 * پرتالِ پزشکِ همکار — در نورومانیتورینگ/ایمپلنت «پرتال جراح» (مراجعه‌ها، دستورِ تیم،
 * اقلام، بیلان) و در مطب «میزِ پزشک» (بستهٔ ۵ بازخوردِ مالک ۱۴۰۵/۰۶/۲۹): امروزِ من،
 * بیمارانِ من، نتایجِ رسیده، بیلان — و هر ردیف با پاپ‌آپِ خودش باز می‌شود
 * (`thing-popups.jsx`: فرمِ مراجعه، شیتِ سفارش، نوبت) تا پزشک همه‌کارش را از
 * همین‌جا انجام دهد. نام و راهنما از واژگانِ حوزه (`useTerms`)، نه هاردکد.
 *
 * هشدار: چه چیزی این‌جا **نیست**: فرمِ تازه. همان فرمِ مراجعه و همان شیتِ سفارشِ
 * داشبورد با همان مجوزها باز می‌شوند؛ دامنهٔ داده را سرور می‌بندد
 * (`ownVisitWhere`: مراجعهٔ جراحِ متصل به همین حساب).
 */
export default function SurgeonPortal() {
  const { user } = useAuth();
  const { vertical, verticalLabel, t } = useConfig();
  const clinic = vertical === 'clinic';
  /**
   * **نمای ناظر** (قانونِ ۲۹): سوپرادمین میزِ همهٔ پزشکان را می‌بیند یا میزِ یک پزشک را
   * انتخاب می‌کند، و هر کاری که آن پزشک از این میز می‌کند از همین‌جا انجام می‌شود —
   * بی‌عوض‌کردنِ پروفایل. اینکه «ناظر هست یا نه» را سرور می‌گوید (`GET /surgeon/desk`)؛
   * رابط سطح را حساب نمی‌کند (قانونِ ۳).
   *
   * هشدار: `null` یعنی «هنوز نمی‌دانیم» — تب‌ها و پنل‌ها تا آن موقع رندر نمی‌شوند، وگرنه
   * سوپرادمین اول «امروزِ من» و دادهٔ ادغامی می‌دید و بعد می‌پرید به میزِ پزشکِ انتخابی.
   */
  const [desk, setDesk] = useState(null);
  useEffect(() => {
    let live = true;
    setDesk(null);
    /* `quiet401`: نبودنِ این مسیر (آزمون‌های رابطِ ساختگی) نباید رویدادِ «نشست مُرد» بدهد. */
    api('/surgeon/desk', { quiet401: true })
      .then((r) => {
        if (!live) return;
        setDesk(r?.unrestricted === true
          ? { unrestricted: true, doctors: Array.isArray(r.doctors) ? r.doctors : [] }
          : PLAIN_DESK);
      })
      .catch(() => { if (live) setDesk(PLAIN_DESK); });
    return () => { live = false; };
  }, [user?.id]);
  const supervising = desk?.unrestricted === true;
  /* پزشکِ انتخاب‌شده در نشانی (`?doctor=`) — تازه‌سازی و لینکِ مستقیم همان میز را باز می‌کنند. */
  const [params, setParams] = useSearchParams();
  const inUrl = params.has('doctor');
  const wanted = Number(params.get('doctor')) || null;
  const picked = supervising && wanted ? desk.doctors.find((d) => d.id === wanted) ?? null : null;
  const pickId = picked?.id ?? null;
  const choosePick = useCallback((id) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id == null) next.delete('doctor'); else next.set('doctor', String(id));
      return next;
    }, { replace: true });
  }, [setParams]);
  /* پزشکی که در نشانی هست ولی در فهرست نیست (غیرفعال شد، شناسهٔ خراب، یا کاربر ناظر نیست): نشانی پاک می‌شود. */
  useEffect(() => { if (desk && inUrl && !picked) choosePick(null); }, [desk, inUrl, picked, choosePick]);
  /* «مالِ من»: هر کسی جز ناظر، یا ناظری که میزِ **خودش** را برداشته (صاحبِ مطبی که پزشک هم هست) —
     `me` را سرور روی همان ردیفِ فهرست می‌گذارد، رابط شناسه‌ها را با هم نمی‌سنجد. */
  const mine = !supervising || picked?.me === true;
  /* پاپ‌آپِ مراجعه و شیتِ سفارش همان APIِ ماژولِ «بیماران» را می‌خوانند و پاپ‌آپِ نوبت APIِ «تقویم» را؛
     پس هر ردیف فقط وقتی دکمه می‌شود که سرور همان ماژول را برای این حساب باز گفته باشد (`/features`) —
     نه با حدسِ سطح در رابط (قانونِ ۳). حسابِ متصل به پزشک که آن را ندارد میزِ فقط‌خواندنی می‌بیند، نه ۴۰۳. */
  const { hero, daily, tools, loading: accessLoading } = useAllowedTools();
  const has = (key) => [hero, ...daily, ...tools].some((x) => x && x.key === key);
  const access = { loading: accessLoading, open: has('dashboard'), appt: has('calendar') };
  /* هشدار: تبِ آغازین را در `useState` قفل نکن: `clinic` از `/config` می‌آید و ممکن است
     پس از اولین رندر برسد — آن‌وقت پزشکِ مطب روی «بیمارانِ من» می‌افتاد نه «امروزِ من».
     تا وقتی کاربر خودش تبی نزده، پیش‌فرض دنبالِ حوزه می‌آید. */
  const [tab, setTab] = useState(clinic ? 'today' : 'visits');
  const tabPicked = useRef(false);
  const choose = useCallback((k) => { tabPicked.current = true; setTab(k); }, []);
  useEffect(() => { if (!tabPicked.current) setTab(clinic ? 'today' : 'visits'); }, [clinic]);
  const [toast, setToast] = useState('');
  const [surgeonId, setSurgeonId] = useState('');
  const [notice, setNotice] = useState('');
  const [grantBusy, setGrantBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { document.title = `${t.portal} — عمل‌یار`; }, [t.portal]);
  useEffect(() => { if (!toast) return; const h = setTimeout(() => setToast(''), 2200); return () => clearTimeout(h); }, [toast]);

  /* هر پنل بازخوانیِ خودش را این‌جا می‌گذارد تا پاپ‌آپ بعد از ثبت همان را تازه کند. */
  const reloadRef = useRef(() => {});
  const things = useThings({ onChanged: () => reloadRef.current(), toast: (m) => setToast(m) });

  const grant = async () => {
    setGrantBusy(true);
    try {
      const result = await api(`/surgeon/accounts/${surgeonId}`, { method: 'POST', body: {} });
      setNotice(result.existing ? `حساب جراح موجود است (سطح ${result.level}، وضعیت ${result.status}). وضعیت و سطح از مدیریت کاربران قابل بررسی است.` : 'حساب جراح آماده شد. جراح با شمارهٔ ثبت‌شده، از «ثبت‌نام» و کد پیامکی حسابش را تحویل می‌گیرد؛ نیازی به ساخت هویت تکراری نیست.');
    } catch (e) { setError(e.message); } finally { setGrantBusy(false); }
  };

  /* هشدار: برچسبِ «من» فقط وقتی میز واقعاً مالِ خودِ بیننده است. «نمای مدیر برای بررسیِ
     مراجعاتِ پزشکان» برای صاحبِ مطبی که خودش پزشک است **غلط** بود؛ حالا همان قاعده از
     طرفِ دیگر: ناظری که میزِ همه یا پزشکِ دیگری را می‌بیند «امروزِ من» نمی‌خوانَد. */
  const financesLabel = mine ? 'بیلان مالی من' : clinic ? 'بیلانِ پزشک' : 'بیلان جراح';
  const items = clinic
    ? [{ key: 'today', label: mine ? 'امروزِ من' : 'امروز' }, { key: 'visits', label: mine ? 'بیمارانِ من' : 'بیماران' }, { key: 'results', label: 'نتایجِ رسیده' }, { key: 'finances', label: financesLabel }]
    : [{ key: 'visits', label: 'بیماران و دستورها' }, { key: 'finances', label: financesLabel }];
  const hint = mine ? t.portalHint
    : picked ? `نمای ناظر: میزِ ${picked.name} — هر کارِ این میز از همین‌جا انجام می‌شود، بی‌نیاز به ورود با حسابِ او.`
      : 'نمای ناظر: میزِ همهٔ پزشکان — هر ردیف نامِ پزشکش را دارد؛ برای میزِ یک پزشک او را انتخاب کنید.';
  const pane = { things, reloadRef, access, pickId, picked, mine };

  return (
    <main className="sp-page">
      <header className="sp-head"><h1>{t.portal}</h1><Link to="/app">سامانه</Link></header>
      {!desk ? <p className="sp-empty">در حالِ بارگذاری…</p> : (
        <>
          <p className="sp-hint">{verticalLabel} · {hint}</p>
          {supervising && (
            /* انتخابگرِ «میزِ کدام پزشک؟» — فقط برای ناظر، بالای تب‌ها چون دامنهٔ **همهٔ**
               تب‌هاست (امروز، بیماران، نتایج، بیلان)، نه فیلترِ یک تب. */
            <div className="sp-scope" role="group" aria-labelledby="sp-scope-l">
              <span id="sp-scope-l" className="sp-scope-l"><Eye size={16} />میزِ کدام پزشک؟</span>
              <div className="sp-scope-pick">
                <Pick label="میزِ کدام پزشک؟" value={pickId} onChange={choosePick} options={desk.doctors} labelOf={(d) => d.label || d.name} placeholder="همهٔ پزشکان" />
              </div>
            </div>
          )}
          <Tabs className="sp-tabs" value={tab} onChange={choose} label={`بخش‌های ${t.portal}`} items={items} />
          {error && <p className="bl-error" role="alert">{error}</p>}
          {clinic && !supervising && !access.loading && !access.open && (
            <p className="sp-hint sp-hint-ro" role="note">این میز فقط‌خواندنی است: برای ثبت و ویرایشِ مراجعه و بررسیِ نتیجه از همین‌جا، دسترسیِ «{HERO.label}» لازم است — از مدیرِ سامانه بخواهید.</p>
          )}
          {tab === 'today' && <DoctorToday {...pane} toast={setToast} />}
          {/* `key` با پزشک: صفحه‌بندی و جستجوی میزِ پزشکِ قبلی به میزِ بعدی نمی‌رسد. */}
          {tab === 'visits' && <VisitsPane key={pickId ?? 'all'} clinic={clinic} {...pane} />}
          {tab === 'results' && <ResultsPane key={pickId ?? 'all'} {...pane} />}
          {tab === 'finances' && <SurgeonFinances key={pickId ?? 'all'} pickId={pickId} />}
        </>
      )}
      {/* هشدار: **زیرِ کارِ روز، نه بالای آن.** این یک کارِ راه‌اندازیِ یک‌باره است و
          بالای صفحه بودنش یعنی پزشک هر روز اول آن را می‌دید و بعد بیمارانش را. */}
      {supervising && (
        <details className="sp-card sp-setup"><summary>فعال‌سازی حساب جراح از تعاریف پایه</summary>
          <label className="ia-field"><span>جراح</span><select value={surgeonId} onChange={(e) => setSurgeonId(e.target.value)}><option value="">انتخاب جراح</option>{desk.doctors.map((s) => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
          <button className="bl-mini" disabled={!surgeonId || grantBusy} type="button" onClick={grant}>آماده‌سازی حساب پرتال</button>
          <Link to="/app/definitions?section=surgeons">تعریف یا اصلاح مشخصات جراح</Link>
          {notice && <p role="status">{notice}</p>}
        </details>
      )}
      <ThingPopups things={things} />
      {toast && <div className="sh-toast" role="status">{toast}</div>}
    </main>
  );
}

/** ردیفِ میز — دکمه وقتی مقصدش برای این حساب باز است، وگرنه فقط متن (نه ۴۰۳، نه دکمهٔ شکسته). */
function Row({ open, className = '', children, ...attrs }) {
  return open
    ? <button type="button" className={`sp-row ${className}`.trim()} onClick={open} {...attrs}>{children}</button>
    : <div className={`sp-row is-static ${className}`.trim()} {...attrs}>{children}</div>;
}

/**
 * «مالِ کدام پزشک» — فقط در نمای ادغامیِ ناظر. نام را سرور روی ردیف می‌گذارد (`doctor`،
 * قانونِ ۱۵) و برای بقیه `null` است، پس ردیفِ پزشک در میزِ خودش عوض نمی‌شود.
 */
function DoctorTag({ name }) {
  if (!name) return null;
  return (
    <span className="sp-doc" data-doctor={name}>
      <Doctor size={13} /><span className="sp-sr">پزشک: </span><span className="sp-doc-n">{name}</span>
    </span>
  );
}

/** پارامترِ «کدام پزشک» برای مسیرهای میز — خالی برای میزِ خودِ بیننده یا نمای ادغامی. */
const withDoctor = (path, pickId) => (pickId ? `${path}${path.includes('?') ? '&' : '?'}surgeonId=${pickId}` : path);

/**
 * «امروزِ من» — نوبت‌ها و مراجعه‌های امروزِ پزشک، نتیجه‌های بررسی‌نشده، و کارهای
 * بازِ خودش. هیچ عددی این‌جا حساب نمی‌شود؛ `GET /surgeon/today` و `GET /work` آماده می‌دهند.
 *
 * در نمای ناظر همان میز است با دامنهٔ دیگر: همهٔ پزشکان (هر ردیف با نامِ پزشکش) یا پزشکِ
 * انتخاب‌شده — و «کارها» صفِ همان پزشک (`/work?owner=`) یا صفِ تیم.
 */
function DoctorToday({ things, reloadRef, toast, access, pickId, picked, mine }) {
  const orderFa = useStatusMap('order');
  const [data, setData] = useState(null);
  const [work, setWork] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(0);
  /* هشدار: میزِ پزشک تنها میزی بود که **هیچ انتخابگرِ تاریخی نداشت**: پزشک
     نمی‌توانست برنامهٔ فردا را ببیند. بازخوردِ مالک ۱۴۰۵/۰۶/۳۱ صریحاً
     «تقویم‌ها … تو میزِ پزشک» را نام برد. */
  const [jday, setJday] = useState(todayJStr);
  const iso = jStrToIso(jday) ?? '';
  /**
   * نشانهٔ شلوغیِ روز — همان قراردادِ میزِ پذیرش و اتاقِ عمل.
   *
   * هشدار: `JDate` **نگاشتِ `{روز: عدد}`** می‌خواهد، نه پاسخِ خامِ endpoint. نسخهٔ
   * اولِ همین‌جا پاسخ را دست‌نخورده برگرداند و تقویم بی‌صدا بی‌نشانه ماند —
   * چون شکستِ بارگذاریِ نشانه عمداً ساکت است، هیچ خطایی هم دیده نشد.
   * معیارِ تأیید اسکرین‌شات بود، نه سبزبودنِ بیلد (قانونِ ۲۴).
   *
   * هشدار: و جمعِ **ویزیت + نوبت**، نه یکی‌شان: میزِ پزشک هر دو را در یک فهرست
   * نشان می‌دهد، پس نشانه هم باید همان را بشمارد.
   */
  const loadMarks = useCallback(async (y, m) => {
    try {
      const r = await api(withDoctor(`/surgeon/month?year=${y}&month=${m}`, pickId));
      return Object.fromEntries((r?.days ?? []).map((d) => [d.day, (d.visits ?? 0) + (d.appointments ?? 0)]));
    } catch { return {}; }
  }, [pickId]);
  /* پاسخِ دیررسیده برای پزشکِ قبلی نباید روی میزِ پزشکِ تازه بنشیند. */
  const req = useRef(0);
  const doctorAccountId = picked?.accountId ?? null;
  const load = useCallback(() => {
    const id = ++req.current;
    const live = () => id === req.current;
    api(withDoctor(`/surgeon/today${iso ? `?date=${iso}` : ''}`, pickId)).then((r) => { if (live()) { setData(r); setErr(''); } }).catch((e) => { if (live()) setErr(e.message); });
    /* هشدار: خطا را به «کارِ بازی ندارید» ترجمه نکن — آن جمله یک **ادعا**ست. اگر
       ماژولِ کارها برای این حساب بسته باشد (۴۰۳) یا شبکه بیفتد، باید همان را بگوید.
       در نمای ناظر با پزشکِ انتخاب‌شده، صفِ **همان** پزشک (`owner=`)؛ و بی‌انتخاب، کارهای
       **پزشکان** (`ownerRole=doctor` — صفِ نقشِ پزشک و کارِ شخصیِ هر پزشک، که همه همین
       نقش را دارند)، نه کلِ صفِ تیم: کارِ منشی و راننده جایش «امروز» است، نه میزِ پزشک.
       اگر سرور فیلتر را نشناخت (۴۰۰/۴۰۳)، صفِ تیم با برچسبِ راست — نه صفِ تیم به نامِ پزشک. */
    const inbox = () => api('/work?scope=inbox&limit=20');
    const fallback = (e) => (e?.status === 400 || e?.status === 403 ? inbox().then((rows) => ({ rows, mode: 'fallback' })) : Promise.reject(e));
    const next = !picked
      ? (mine ? inbox().then((rows) => ({ rows, mode: 'mine' }))
        : api('/work?scope=inbox&ownerRole=doctor&limit=20').then((rows) => ({ rows, mode: 'team' })).catch(fallback))
      : !doctorAccountId ? Promise.resolve({ rows: [], mode: 'noaccount' })
        : api(`/work?scope=inbox&owner=${doctorAccountId}&limit=20`).then((rows) => ({ rows, mode: mine ? 'mine' : 'doctor' })).catch(fallback);
    next.then(({ rows, mode }) => { if (live()) setWork({ rows: Array.isArray(rows) ? rows : [], mode }); })
      .catch((e) => { if (live()) setWork(e?.status === 403 ? 'forbidden' : 'error'); });
  }, [iso, pickId, picked, doctorAccountId, mine]);
  /* پزشکِ دیگر = میزِ دیگر: تا دادهٔ تازه نیامده «در حالِ بارگذاری»، نه ردیف‌های پزشکِ قبلی. */
  useEffect(() => { setData(null); setWork(null); }, [pickId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { reloadRef.current = load; }, [load, reloadRef]);
  useEffect(() => {
    const h = () => load();
    window.addEventListener(WORK_CHANGED, h);
    return () => window.removeEventListener(WORK_CHANGED, h);
  }, [load]);

  const act = async (w, action, body = {}) => {
    setBusy(w.id);
    try {
      await api(`/work/${w.id}`, { method: 'PATCH', body: { action, ...body } });
      setWork((cur) => (cur && Array.isArray(cur.rows) ? { ...cur, rows: cur.rows.filter((x) => x.id !== w.id) } : cur));
      window.dispatchEvent(new Event(WORK_CHANGED));
      toast(action === 'done' ? 'انجام شد' : 'به فردا موکول شد');
    } catch (e) { toast(e?.message || 'انجام نشد'); } finally { setBusy(0); }
  };
  const openVisit = (v) => things.open({ type: 'visit', id: v.id, patientId: v.patientId });
  const openAppt = (a) => things.open({
    type: 'appointment', id: a.id,
    item: { title: `نوبت${a.topic ? ` — ${a.topic}` : ''}`, at: a.date, detail: a.time ?? (a.seq != null ? `شمارهٔ ${faNum(a.seq)}` : ''), state: a.status, stateFa: a.statusFa ?? a.status },
  });
  const openOrder = (o) => things.open({ type: 'order', kind: o.kind, id: o.id, patientId: o.patientId });

  if (err) return <p className="bl-error" role="alert">{err}</p>;
  if (!data || access.loading) return <p className="sp-empty">در حالِ بارگذاری…</p>;
  const sum = data.summary ?? {};
  const money = sum.money ?? { total: 0, paid: 0, due: 0 };
  /* هشدار: **ردیفِ کاری که نتیجه‌اش همین بالا فهرست شده دوباره نشان داده نمی‌شود.**
     هر نتیجهٔ رسیده یک `WorkItem`ِ `review_result` هم می‌سازد، پس «نتایجِ رسیده» و
     «کارهای من» عیناً یک چیز را دو بار می‌گفتند (چهار نتیجه = هشت ردیف). ردیفِ
     نتیجه مفیدتر است چون پاپ‌آپِ تصمیم را باز می‌کند؛ ردیفِ کار فقط «انجام شد».
     بقیهٔ کارها (یادآوری، ویزیتِ بعدی، …) دست‌نخورده می‌مانند. */
  const shownOrders = new Set((data.unreviewed ?? []).map((o) => `${o.kind}-${o.id}`));
  const openWork = work && Array.isArray(work.rows)
    ? work.rows.filter((w) => { const tgt = workTarget(w); return !(tgt?.type === 'order' && shownOrders.has(`${tgt.kind}-${tgt.id}`)); })
    : work;
  /* «به نامِ چه کسی» در متن‌های خالی و عنوان‌ها — از حالتِ میز، نه از سطح. */
  const who = mine ? 'شما' : picked?.name ?? null;
  const workMode = work?.mode ?? (mine ? 'mine' : 'team');
  const workTitle = workMode === 'mine' ? 'کارهای من'
    : workMode === 'doctor' || workMode === 'noaccount' ? `کارهای ${picked?.name ?? 'پزشک'}`
      : workMode === 'team' ? 'کارهای پزشکان' : 'کارهای تیم';
  return (
    <>
      {/* نوارِ خلاصه — «اطلاعاتِ لازم دمِ دست» (بازخوردِ مالک ۱۴۰۵/۰۶/۳۰). هیچ
          عددی این‌جا حساب نمی‌شود؛ همه از `summary`ِ سرور می‌آیند (قانونِ ۱۵). */}
      <ul className="sp-sum" aria-label="خلاصهٔ امروز">
        <li><b>{faNum(sum.appointments ?? 0)}</b> نوبت</li>
        <li className={sum.present ? 'hot' : ''}><b>{faNum(sum.present ?? 0)}</b> در مطب</li>
        <li><b>{faNum(sum.visits ?? 0)}</b> مراجعه</li>
        <li className={sum.unreviewed ? 'hot' : ''}><b>{faNum(sum.unreviewed ?? 0)}</b> نتیجهٔ منتظر</li>
        {money.total > 0 && (
          <li className="sp-sum-money">
            صورت‌حسابِ امروز <b>{fmtMoney(money.total)}</b>
            {money.due > 0 ? <> · مانده <b className="due">{fmtMoney(money.due)}</b></> : <> · تسویه</>} تومان
          </li>
        )}
      </ul>
      <section className="sp-sec" aria-labelledby="sp-day-h">
        <div className="sp-day-head">
          <h2 id="sp-day-h">{data.isToday === false ? `برنامهٔ ${faDate(data.date)}` : 'برنامهٔ امروز'}</h2>
          {/* هشدار: انتخابگر و «امروز» یک **گروه**اند: در عرضِ موبایل عنوان به خطِ
              خودش می‌رود و این دو با هم پایین می‌آیند. بدونِ این بسته‌بندی،
              دکمه تنها به خطِ سوم می‌افتاد و شبیهِ سرآیندِ کارتِ زیرش می‌شد. */}
          <div className="sp-day-pick">
            <JDate value={jday} onChange={setJday} loadMarks={loadMarks} />
            {data.isToday === false && (
              <button type="button" className="sp-today" onClick={() => setJday(todayJStr())}>امروز</button>
            )}
          </div>
        </div>
        {(data.day ?? []).length === 0 ? (
          <p className="sp-empty">
            {data.isToday === false ? 'این روز' : 'امروز'} نوبت یا مراجعه‌ای {who ? `به نامِ ${who}` : 'برای هیچ پزشکی'} نیست.
          </p>
        ) : (
          <ul className="sp-rows">
            {data.day.map((r) => {
              /* ردیف بازکردنیِ **مراجعه** است اگر مراجعه دارد، وگرنه نوبت. */
              const open = r.visitId && access.open ? () => openVisit({ id: r.visitId, patientId: r.patientId })
                : r.apptId && access.appt ? () => openAppt({ id: r.apptId, topic: r.topic, date: data.now, time: r.time, seq: r.seq, status: r.apptStatus })
                  : null;
              const due = r.billing?.due ?? 0;
              return (
                <li key={r.key}>
                  <Row open={open} data-day-key={r.key} data-visit-id={r.visitId ?? undefined} data-appt-id={r.apptId ?? undefined}>
                    <span className="sp-row-time">{faTime(r.time) || (r.seq != null ? `شمارهٔ ${faNum(r.seq)}` : '—')}</span>
                    <span className="sp-row-name">
                      {r.patient?.fullName ?? 'ثبت‌نامِ تکمیل‌نشده'}
                      {r.kind && <span className="sp-kind">{kindOf(r.kind).label}</span>}
                    </span>
                    {/* هشدار: مبلغ **بیرونِ** بخشِ کوتاه‌شونده است: روی عرضِ گوشی
                        `text-overflow: ellipsis` اول همان چیزی را می‌برید که
                        پزشک بیشتر لازمش دارد («… مانده ۴۰۰٬۰۰۰ تو…»). */}
                    <span className="sp-row-sub">
                      <DoctorTag name={r.doctor} />
                      <span className="sp-row-meta">{[r.topic, r.hospital, r.code].filter(Boolean).join(' · ') || (r.visitId ? '' : 'هنوز مراجعه‌ای ثبت نشده')}</span>
                      {due > 0 && <span className="sp-due">مانده {fmtMoney(due)} تومان</span>}
                    </span>
                    <span className="sp-row-tags">
                      {r.apptStatusFa && <span className={`sp-row-tag${r.apptStatus === 'arrived' ? ' hot' : ''}`}>{r.apptStatusFa}</span>}
                      {r.opStatusFa && <span className="sp-row-tag">{r.opStatusFa}</span>}
                    </span>
                  </Row>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="sp-sec" aria-labelledby="sp-res-h">
        <h2 id="sp-res-h">نتایجِ رسیده و بررسی‌نشده</h2>
        {data.unreviewed.length === 0 ? <p className="sp-empty">{mine ? 'نتیجه‌ای منتظرِ شما نیست.' : 'نتیجه‌ای منتظرِ بررسی نیست.'}</p> : (
          <ul className="sp-rows">
            {data.unreviewed.map((o) => (
              <li key={`${o.kind}-${o.id}`}>
                <Row open={access.open ? () => openOrder(o) : null} className="sp-row-order" data-order-id={`${o.kind}-${o.id}`}>
                  <span className="sp-row-time">{faDate(o.updatedAt)}</span>
                  <span className="sp-row-name">{o.patient?.fullName} <span className="sp-kind">{o.kindFa}</span></span>
                  <span className="sp-row-sub">
                    <DoctorTag name={o.doctor} />
                    <span className="sp-row-meta">{access.open ? 'برای بررسی و ثبتِ تصمیم باز کنید' : 'منتظرِ بررسی'}</span>
                  </span>
                  <span className="sp-row-tag hot">{o.statusFa ?? orderFa[o.status] ?? o.status}</span>
                </Row>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="sp-sec" aria-labelledby="sp-work-h">
        <h2 id="sp-work-h">{workTitle}</h2>
        {workMode === 'fallback' && <p className="sp-hint" role="note">فهرستِ جداگانهٔ کارهای {picked?.name ?? 'پزشکان'} در دسترس نیست؛ صفِ تیم نشان داده می‌شود و هر ردیف مالِ کیست را می‌گوید.</p>}
        {openWork === null ? <p className="sp-empty">در حالِ بارگذاری…</p>
          : openWork === 'forbidden' ? <p className="sp-empty">صفِ کارها برای حسابِ شما باز نیست.</p>
            : openWork === 'error' ? <p className="sp-empty">فهرستِ کارها نیامد؛ صفحه را تازه کنید.</p>
              : workMode === 'noaccount' ? <p className="sp-empty">{picked?.name ?? 'این پزشک'} حسابِ کاربری ندارد، پس کاری به نامِ او ثبت نمی‌شود.</p>
                : openWork.length === 0 ? <p className="sp-empty">{mine
                  ? (shownOrders.size ? 'جز نتیجه‌های بالا، کارِ بازِ دیگری ندارید.' : 'کارِ بازی ندارید.')
                  : (shownOrders.size ? 'جز نتیجه‌های بالا، کارِ بازِ دیگری نیست.' : workMode === 'team' ? 'کارِ بازی برای پزشکان نیست.' : 'کارِ بازی نیست.')}</p>
                  : <ul className="wk-list">{openWork.map((w) => <WorkRow key={w.id} w={w} onAct={act} busy={busy} compact onOpen={access.open && workTarget(w) ? () => things.open(workTarget(w)) : undefined} />)}</ul>}
      </section>
    </>
  );
}

/** «نتایجِ رسیده» — همهٔ نتیجه‌های بررسی‌نشدهٔ بیمارانِ پزشک، نه فقط امروز. */
function ResultsPane({ things, reloadRef, access, pickId }) {
  const orderFa = useStatusMap('order');
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const req = useRef(0);
  const load = useCallback(() => {
    const id = ++req.current;
    api(withDoctor('/surgeon/today', pickId))
      .then((r) => { if (id === req.current) { setRows(r.unreviewed ?? []); setErr(''); } })
      .catch((e) => { if (id === req.current) setErr(e.message); });
  }, [pickId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { reloadRef.current = load; }, [load, reloadRef]);
  if (err) return <p className="bl-error" role="alert">{err}</p>;
  if (rows === null || access.loading) return <p className="sp-empty">در حالِ بارگذاری…</p>;
  if (rows.length === 0) return <p className="sp-empty">نتیجه‌ای منتظرِ بررسی نیست.</p>;
  return (
    <ul className="sp-rows">
      {rows.map((o) => (
        <li key={`${o.kind}-${o.id}`}>
          <Row open={access.open ? () => things.open({ type: 'order', kind: o.kind, id: o.id, patientId: o.patientId }) : null} className="sp-row-order" data-order-id={`${o.kind}-${o.id}`}>
            <span className="sp-row-time">{faDate(o.updatedAt)}</span>
            <span className="sp-row-name">{o.patient?.fullName} <span className="sp-kind">{o.kindFa}</span></span>
            <span className="sp-row-sub">
              <DoctorTag name={o.doctor} />
              <span className="sp-row-meta" dir="ltr">{o.patient?.code}</span>
            </span>
            <span className="sp-row-tag hot">{o.statusFa ?? orderFa[o.status] ?? o.status}</span>
          </Row>
        </li>
      ))}
    </ul>
  );
}

/** فهرستِ مراجعه‌های پزشک — با جستجو و صفحه‌بندی؛ در مطب هر کارت پاپ‌آپِ مراجعهٔ خودش را باز می‌کند. */
function VisitsPane({ clinic, things, reloadRef, access, pickId }) {
  const [data, setData] = useState(null), [query, setQuery] = useState(''), [page, setPage] = useState(1), [error, setError] = useState('');
  const requestId = useRef(0);
  const load = useCallback(async () => {
    const id = ++requestId.current;
    try { const next = await api(withDoctor(`/surgeon/visits?q=${encodeURIComponent(query)}&page=${page}`, pickId)); if (id === requestId.current) { setData(next); setError(''); } }
    catch (e) { if (id === requestId.current) setError(e.message); }
  }, [query, page, pickId]);
  useEffect(() => { const timer = setTimeout(load, 200); return () => { requestId.current++; clearTimeout(timer); }; }, [load]);
  useEffect(() => { reloadRef.current = load; }, [load, reloadRef]);
  return (
    <>
      <label className="ia-field"><span>جستجوی بیمار یا کد پرونده</span><input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} /></label>
      {error && <p className="bl-error" role="alert">{error}</p>}
      {!data && !error && <p className="sp-empty">در حال بارگذاری…</p>}
      {data?.rows.length === 0 && <p className="sp-empty">مراجعه‌ای برای نمایش نیست. انتسابِ پزشک هر مراجعه از تعاریف پایه بررسی می‌شود.</p>}
      <div className="sp-list">{data?.rows.map((row) => <SurgeonCase key={row.id} row={row} clinic={clinic} implant={row.implant ?? data.workflow === 'implant'} reload={load} things={things} access={access} />)}</div>
      {data && <nav className="sp-pagination" aria-label="صفحه‌های مراجعات"><button className="bl-mini" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>قبلی</button><span>{faNum(page)} از {faNum(data.pages)} · {faNum(data.total)} مراجعه</span><button className="bl-mini" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>بعدی</button></nav>}
    </>
  );
}

function SurgeonCase({ row, clinic, implant, reload, things, access }) {
  const [instructions, setInstructions] = useState(row.instructions), [items, setItems] = useState(row.requiredItems), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [itemsDirty, setItemsDirty] = useState(false);
  const save = async () => {
    setBusy(true); setMessage('');
    try { await api(`/surgeon/visits/${row.id}/instructions`, { method: 'PATCH', body: { instructions, ...(implant && itemsDirty ? { requiredItems: items.map(({ itemId, quantity, notes }) => ({ itemId, quantity, notes: notes || '' })) } : {}) } }); setItemsDirty(false); await reload(); setMessage('دستور و نیازهای بیمار ثبت شد و در آماده‌سازی تیم دیده می‌شود'); }
    catch (e) { setMessage(e.message); } finally { setBusy(false); }
  };
  const document = async (doc) => {
    const w = window.open('', '_blank'); if (!w) { setMessage('اجازهٔ بازشدن پنجرهٔ مدرک را بدهید'); return; }
    try { const url = await apiBlobUrl(`/surgeon/visits/${row.id}/documents/${doc.id}`); w.location.href = url; setTimeout(() => URL.revokeObjectURL(url), 60000); }
    catch (e) { w.close(); setMessage(e.message); }
  };
  const status = row.opStatusFa || row.opStatus;
  return (
    <article className="sp-card glass" data-visit-id={row.id}>
      {/* در مطب نامِ بیمار دکمه است و فرمِ همان مراجعه را در همین صفحه باز می‌کند (بازخوردِ مالک). */}
      {clinic && access.open
        ? <h2><button type="button" className="sp-open" onClick={() => things.open({ type: 'visit', id: row.id, patientId: row.patientId })}>{row.fullName}</button></h2>
        : <h2>{row.fullName}</h2>}
      <DoctorTag name={row.doctor} />
      <span>{row.code} · {faDate(row.opDate)} · {row.hospital || 'مرکز تعیین نشده'}</span>
      <span>{clinic ? [kindOf(row.kind).label, row.topic].filter(Boolean).join(' · ') : (row.procedure || 'عمل تعیین نشده')} · {status}</span>
      {row.report && <details><summary>گزارشِ ثبت‌شدهٔ {kindOf(row.kind).label}</summary><div className="sp-report">{row.report}</div></details>}
      {row.documents?.map((doc) => <button className="bl-mini" type="button" key={doc.id} onClick={() => document(doc)}>{doc.title || doc.fileName}</button>)}
      {clinic ? (
        <div className="sp-card-acts">
          {row.patientId && access.open && <Link to={`/app/patients/${row.patientId}`}>پروندهٔ بیمار</Link>}
        </div>
      ) : (
        <details><summary>دستور جراح و آماده‌سازی بیمار</summary>
          <label className="ia-field"><span>دستور و توضیحات جراح</span><AssistedTextarea purpose="دستور و توضیحات جراح" rows={4} value={instructions} onChange={(e) => setInstructions(e.target.value)} disabled={busy} /></label>
          {implant && <RequiredItems endpoint="/surgeon/items" value={items} onChange={(next) => { setItems(next); setItemsDirty(true); }} disabled={busy} />}
          <button className="db-submit bl-btn" type="button" disabled={busy} onClick={save}>ثبت دستور</button>
        </details>
      )}
      {message && <p role="status">{message}</p>}
    </article>
  );
}

/**
 * بیلانِ پزشک. پزشک بیلانِ خودش را می‌بیند (سرور شناسهٔ دیگری را نادیده می‌گیرد)؛ ناظر
 * بیلانِ پزشکی را که بالای صفحه برداشته — بیلانِ «همهٔ پزشکان» معنا ندارد، پس سرور
 * `selectionRequired` می‌گوید و این‌جا همان را راهنمایی می‌کند.
 */
function SurgeonFinances({ pickId }) {
  const [page, setPage] = useState(1), [data, setData] = useState(null), [error, setError] = useState('');
  useEffect(() => { let alive = true; setData(null); setError('');
    api(`/surgeon/finances?surgeonId=${pickId ?? ''}&page=${page}`).then((d) => { if (alive) setData(d); }).catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [pickId, page]);
  const money = (n) => Number(n ?? 0).toLocaleString('fa-IR');
  return <section className="sp-list">
    <p>همه مبالغ تومان است. سهم فقط از تسویه نهایی محاسبه می‌شود. پرداخت‌ها، ثبت‌های مالی شرکت هستند؛ ثبت چک به معنی وصول آن نیست. پرونده بدون تسویه نهایی، سهم قطعی ندارد.</p>
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p>در حال دریافت بیلان…</p>}
    {data?.selectionRequired && <p className="sp-empty">بیلان مالِ یک پزشک است: پزشک را از «میزِ کدام پزشک؟» بالای صفحه انتخاب کنید.</p>}
    {data && !data.selectionRequired && <><article className="sp-card"><h2>{data.surgeon}</h2><p>سهم نهایی: {money(data.earned)} · پرداخت ثبت‌شده: {money(data.paid)} · مانده: {money(data.balance)}</p></article>
      {data.rows.length === 0 && <p>مراجعه‌ای ثبت نشده است.</p>}
      {data.rows.map((r) => <article className="sp-card" key={r.id}><h2>{r.patient}</h2><span>{r.code} · {faDate(r.date)} · {r.hospital}</span>
        <p>{r.finalized ? `سهم نهایی: ${money(r.earned)}` : 'در انتظار تسویه نهایی'} · پرداخت: {money(r.paid)}{r.finalized ? ` · مانده: ${money(r.balance)}` : ''}</p>
        {r.payments.length > 0 && <details><summary>پرداخت‌های این مراجعه</summary>{r.payments.map((p) => <p key={p.id}>{faDate(p.paidAt)} · {money(p.amount)} تومان {p.reference ? `· پیگیری ${p.reference}` : ''}</p>)}</details>}
      </article>)}
      <nav className="sp-pagination" aria-label="صفحه‌های بیلان"><button className="bl-mini" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>قبلی</button><span>{faNum(page)} از {faNum(data.pages)}</span><button className="bl-mini" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>بعدی</button></nav>
    </>}
  </section>;
}
