import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiBlobUrl } from '../lib/api.js';
import { faDate, jStrToIso, todayJStr } from '../lib/jalali.js';
import { fmtMoney } from '../lib/money.js';
import { useAuth } from './auth.jsx';
import { useConfig, useStatusMap } from './config.jsx';
import { HERO, useAllowedTools } from './tools.jsx';
import RequiredItems from './RequiredItems.jsx';
import AssistedTextarea from '../ui/AssistedTextarea.jsx';
import Tabs from '../ui/Tabs.jsx';
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
/* ⚠️ برچسبِ وضعیت از سرور می‌آید (`statusFa`/`opStatusFa`)، نه از نگاشتِ
   کلاینتی — قانونِ «یک وضعیت، یک برچسب» در `server/src/patients/labels.ts`. */
/* ⚠️ ساعت هم عدد است: بقیهٔ میز فارسی بود و فقط «۰۸:۳۰» لاتین می‌ماند — در
   اسکرین‌شات مثلِ وصلهٔ زبانِ دیگر می‌زد. `faNum` روی `null` رشتهٔ خالی می‌دهد،
   پس سه‌راههٔ ساعت/شماره/خط‌تیره دست‌نخورده می‌مانَد. */
const faTime = (t) => (t ? faNum(t) : null);
/* ⚠️ نگاشتِ سومِ وضعیتِ سفارش برداشته شد — «نتیجه آمده» این‌جا در برابرِ
   «نتیجه آمد — بررسی نشده»ی شیتِ سفارش. از `/config.statuses.order` می‌آید. */

/**
 * پرتالِ پزشکِ همکار — در نورومانیتورینگ/ایمپلنت «پرتال جراح» (مراجعه‌ها، دستورِ تیم،
 * اقلام، بیلان) و در مطب «میزِ پزشک» (بستهٔ ۵ بازخوردِ مالک ۱۴۰۵/۰۶/۲۹): امروزِ من،
 * بیمارانِ من، نتایجِ رسیده، بیلان — و هر ردیف با پاپ‌آپِ خودش باز می‌شود
 * (`thing-popups.jsx`: فرمِ مراجعه، شیتِ سفارش، نوبت) تا پزشک همه‌کارش را از
 * همین‌جا انجام دهد. نام و راهنما از واژگانِ حوزه (`useTerms`)، نه هاردکد.
 *
 * ⚠️ چه چیزی این‌جا **نیست**: فرمِ تازه. همان فرمِ مراجعه و همان شیتِ سفارشِ
 * داشبورد با همان مجوزها باز می‌شوند؛ دامنهٔ داده را سرور می‌بندد
 * (`ownVisitWhere`: مراجعهٔ جراحِ متصل به همین حساب).
 */
export default function SurgeonPortal() {
  const { user } = useAuth();
  const { vertical, verticalLabel, t } = useConfig();
  const clinic = vertical === 'clinic';
  const admin = (user?.level ?? 0) >= 6;
  /* پاپ‌آپِ مراجعه و شیتِ سفارش همان APIِ ماژولِ «بیماران» را می‌خوانند و پاپ‌آپِ نوبت APIِ «تقویم» را؛
     پس هر ردیف فقط وقتی دکمه می‌شود که سرور همان ماژول را برای این حساب باز گفته باشد (`/features`) —
     نه با حدسِ سطح در رابط (قانونِ ۳). حسابِ متصل به پزشک که آن را ندارد میزِ فقط‌خواندنی می‌بیند، نه ۴۰۳. */
  const { hero, daily, tools, loading: accessLoading } = useAllowedTools();
  const has = (key) => [hero, ...daily, ...tools].some((x) => x && x.key === key);
  const access = { loading: accessLoading, open: has('dashboard'), appt: has('calendar') };
  /* ⚠️ تبِ آغازین را در `useState` قفل نکن: `clinic` از `/config` می‌آید و ممکن است
     پس از اولین رندر برسد — آن‌وقت پزشکِ مطب روی «بیمارانِ من» می‌افتاد نه «امروزِ من».
     تا وقتی کاربر خودش تبی نزده، پیش‌فرض دنبالِ حوزه می‌آید. */
  const [tab, setTab] = useState(clinic ? 'today' : 'visits');
  const picked = useRef(false);
  const choose = useCallback((k) => { picked.current = true; setTab(k); }, []);
  useEffect(() => { if (!picked.current) setTab(clinic ? 'today' : 'visits'); }, [clinic]);
  const [toast, setToast] = useState('');
  const [surgeons, setSurgeons] = useState([]);
  const [surgeonId, setSurgeonId] = useState('');
  const [notice, setNotice] = useState('');
  const [grantBusy, setGrantBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { document.title = `${t.portal} — عمل‌یار`; }, [t.portal]);
  useEffect(() => { if (!toast) return; const h = setTimeout(() => setToast(''), 2200); return () => clearTimeout(h); }, [toast]);
  useEffect(() => { if (admin) api('/surgeons').then(setSurgeons).catch((e) => setError(e.message)); }, [admin]);

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

  /* صاحبِ مطبی که خودش پزشک است (`jobRole = 'doctor'`): میز مالِ خودش است،
     پس نه زیرنویسِ «نمای مدیر» درست است نه برچسبِ «بیلانِ جراح». */
  const ownDesk = user?.jobRole === 'doctor';
  const financesLabel = admin && !ownDesk ? 'بیلان جراح' : 'بیلان مالی من';
  const items = clinic
    ? [{ key: 'today', label: 'امروزِ من' }, { key: 'visits', label: 'بیمارانِ من' }, { key: 'results', label: 'نتایجِ رسیده' }, { key: 'finances', label: financesLabel }]
    : [{ key: 'visits', label: 'بیماران و دستورها' }, { key: 'finances', label: financesLabel }];

  return (
    <main className="sp-page">
      <header className="sp-head"><h1>{t.portal}</h1><Link to="/app">سامانه</Link></header>
      {/* ⚠️ «نمای مدیر برای بررسی مراجعاتِ پزشکان» برای صاحبِ مطب **غلط** بود: او
          خودش پزشکِ همین میز است، نه ناظرِ پزشکانِ دیگر. مطبِ تک‌پزشکه از روی
          `jobRole` شناخته می‌شود، نه از روی سطح. */}
      <p className="sp-hint">
        {verticalLabel} · {admin && !ownDesk ? 'نمای مدیر برای بررسی مراجعاتِ پزشکان' : t.portalHint}
      </p>
      <Tabs className="sp-tabs" value={tab} onChange={choose} label={`بخش‌های ${t.portal}`} items={items} />
      {error && <p className="bl-error" role="alert">{error}</p>}
      {clinic && !admin && !access.loading && !access.open && (
        <p className="sp-hint sp-hint-ro" role="note">این میز فقط‌خواندنی است: برای ثبت و ویرایشِ مراجعه و بررسیِ نتیجه از همین‌جا، دسترسیِ «{HERO.label}» لازم است — از مدیرِ سامانه بخواهید.</p>
      )}
      {tab === 'today' && <DoctorToday things={things} reloadRef={reloadRef} toast={setToast} access={access} />}
      {tab === 'visits' && <VisitsPane clinic={clinic} things={things} reloadRef={reloadRef} access={access} />}
      {tab === 'results' && <ResultsPane things={things} reloadRef={reloadRef} access={access} />}
      {tab === 'finances' && <SurgeonFinances admin={admin} surgeons={surgeons} />}
      {/* ⚠️ **زیرِ کارِ روز، نه بالای آن.** این یک کارِ راه‌اندازیِ یک‌باره است و
          بالای صفحه بودنش یعنی پزشک هر روز اول آن را می‌دید و بعد بیمارانش را. */}
      {admin && (
        <details className="sp-card sp-setup"><summary>فعال‌سازی حساب جراح از تعاریف پایه</summary>
          <label className="ia-field"><span>جراح</span><select value={surgeonId} onChange={(e) => setSurgeonId(e.target.value)}><option value="">انتخاب جراح</option>{surgeons.filter((s) => s.active !== false).map((s) => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
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
 * «امروزِ من» — نوبت‌ها و مراجعه‌های امروزِ پزشک، نتیجه‌های بررسی‌نشده، و کارهای
 * بازِ خودش. هیچ عددی این‌جا حساب نمی‌شود؛ `GET /surgeon/today` و `GET /work` آماده می‌دهند.
 */
function DoctorToday({ things, reloadRef, toast, access }) {
  const orderFa = useStatusMap('order');
  const [data, setData] = useState(null);
  const [work, setWork] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(0);
  /* ⚠️ میزِ پزشک تنها میزی بود که **هیچ انتخابگرِ تاریخی نداشت**: پزشک
     نمی‌توانست برنامهٔ فردا را ببیند. بازخوردِ مالک ۱۴۰۵/۰۶/۳۱ صریحاً
     «تقویم‌ها … تو میزِ پزشک» را نام برد. */
  const [jday, setJday] = useState(todayJStr);
  const iso = jStrToIso(jday) ?? '';
  /**
   * نشانهٔ شلوغیِ روز — همان قراردادِ میزِ پذیرش و اتاقِ عمل.
   *
   * ⚠️ `JDate` **نگاشتِ `{روز: عدد}`** می‌خواهد، نه پاسخِ خامِ endpoint. نسخهٔ
   * اولِ همین‌جا پاسخ را دست‌نخورده برگرداند و تقویم بی‌صدا بی‌نشانه ماند —
   * چون شکستِ بارگذاریِ نشانه عمداً ساکت است، هیچ خطایی هم دیده نشد.
   * معیارِ تأیید اسکرین‌شات بود، نه سبزبودنِ بیلد (قانونِ ۲۴).
   *
   * ⚠️ و جمعِ **ویزیت + نوبت**، نه یکی‌شان: میزِ پزشک هر دو را در یک فهرست
   * نشان می‌دهد، پس نشانه هم باید همان را بشمارد.
   */
  const loadMarks = useCallback(async (y, m) => {
    try {
      const r = await api(`/surgeon/month?year=${y}&month=${m}`);
      return Object.fromEntries((r?.days ?? []).map((d) => [d.day, (d.visits ?? 0) + (d.appointments ?? 0)]));
    } catch { return {}; }
  }, []);
  const load = useCallback(() => {
    api(`/surgeon/today${iso ? `?date=${iso}` : ''}`).then((r) => { setData(r); setErr(''); }).catch((e) => setErr(e.message));
    /* ⚠️ خطا را به «کارِ بازی ندارید» ترجمه نکن — آن جمله یک **ادعا**ست. اگر
       ماژولِ کارها برای این حساب بسته باشد (۴۰۳) یا شبکه بیفتد، باید همان را بگوید. */
    api('/work?scope=inbox&limit=20').then((r) => setWork(Array.isArray(r) ? r : [])).catch((e) => setWork(e?.status === 403 ? 'forbidden' : 'error'));
  }, [iso]);
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
      setWork((rows) => (Array.isArray(rows) ? rows : []).filter((x) => x.id !== w.id));
      window.dispatchEvent(new Event(WORK_CHANGED));
      toast(action === 'done' ? 'انجام شد ✓' : 'به فردا موکول شد');
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
  /* ⚠️ **ردیفِ کاری که نتیجه‌اش همین بالا فهرست شده دوباره نشان داده نمی‌شود.**
     هر نتیجهٔ رسیده یک `WorkItem`ِ `review_result` هم می‌سازد، پس «نتایجِ رسیده» و
     «کارهای من» عیناً یک چیز را دو بار می‌گفتند (چهار نتیجه = هشت ردیف). ردیفِ
     نتیجه مفیدتر است چون پاپ‌آپِ تصمیم را باز می‌کند؛ ردیفِ کار فقط «انجام شد».
     بقیهٔ کارها (یادآوری، ویزیتِ بعدی، …) دست‌نخورده می‌مانند. */
  const shownOrders = new Set((data.unreviewed ?? []).map((o) => `${o.kind}-${o.id}`));
  const openWork = Array.isArray(work)
    ? work.filter((w) => { const tgt = workTarget(w); return !(tgt?.type === 'order' && shownOrders.has(`${tgt.kind}-${tgt.id}`)); })
    : work;
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
          {/* ⚠️ انتخابگر و «امروز» یک **گروه**اند: در عرضِ موبایل عنوان به خطِ
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
            {data.isToday === false ? 'این روز نوبت یا مراجعه‌ای به نامِ شما نیست.' : 'امروز نوبت یا مراجعه‌ای به نامِ شما نیست.'}
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
                    {/* ⚠️ مبلغ **بیرونِ** بخشِ کوتاه‌شونده است: روی عرضِ گوشی
                        `text-overflow: ellipsis` اول همان چیزی را می‌برید که
                        پزشک بیشتر لازمش دارد («… مانده ۴۰۰٬۰۰۰ تو…»). */}
                    <span className="sp-row-sub">
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
        {data.unreviewed.length === 0 ? <p className="sp-empty">نتیجه‌ای منتظرِ شما نیست.</p> : (
          <ul className="sp-rows">
            {data.unreviewed.map((o) => (
              <li key={`${o.kind}-${o.id}`}>
                <Row open={access.open ? () => openOrder(o) : null} className="sp-row-order" data-order-id={`${o.kind}-${o.id}`}>
                  <span className="sp-row-time">{faDate(o.updatedAt)}</span>
                  <span className="sp-row-name">{o.patient?.fullName} <span className="sp-kind">{o.kindFa}</span></span>
                  <span className="sp-row-sub">{access.open ? 'برای بررسی و ثبتِ تصمیم باز کنید' : 'منتظرِ بررسی'}</span>
                  <span className="sp-row-tag hot">{o.statusFa ?? orderFa[o.status] ?? o.status}</span>
                </Row>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="sp-sec" aria-labelledby="sp-work-h">
        <h2 id="sp-work-h">کارهای من</h2>
        {openWork === null ? <p className="sp-empty">در حالِ بارگذاری…</p>
          : openWork === 'forbidden' ? <p className="sp-empty">صفِ کارها برای حسابِ شما باز نیست.</p>
            : openWork === 'error' ? <p className="sp-empty">فهرستِ کارها نیامد؛ صفحه را تازه کنید.</p>
              : openWork.length === 0 ? <p className="sp-empty">{shownOrders.size ? 'جز نتیجه‌های بالا، کارِ بازِ دیگری ندارید.' : 'کارِ بازی ندارید.'}</p>
                : <ul className="wk-list">{openWork.map((w) => <WorkRow key={w.id} w={w} onAct={act} busy={busy} compact onOpen={access.open && workTarget(w) ? () => things.open(workTarget(w)) : undefined} />)}</ul>}
      </section>
    </>
  );
}

/** «نتایجِ رسیده» — همهٔ نتیجه‌های بررسی‌نشدهٔ بیمارانِ پزشک، نه فقط امروز. */
function ResultsPane({ things, reloadRef, access }) {
  const orderFa = useStatusMap('order');
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => { api('/surgeon/today').then((r) => { setRows(r.unreviewed ?? []); setErr(''); }).catch((e) => setErr(e.message)); }, []);
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
            <span className="sp-row-sub">{o.patient?.code}</span>
            <span className="sp-row-tag hot">{o.statusFa ?? orderFa[o.status] ?? o.status}</span>
          </Row>
        </li>
      ))}
    </ul>
  );
}

/** فهرستِ مراجعه‌های پزشک — با جستجو و صفحه‌بندی؛ در مطب هر کارت پاپ‌آپِ مراجعهٔ خودش را باز می‌کند. */
function VisitsPane({ clinic, things, reloadRef, access }) {
  const [data, setData] = useState(null), [query, setQuery] = useState(''), [page, setPage] = useState(1), [error, setError] = useState('');
  const requestId = useRef(0);
  const load = useCallback(async () => {
    const id = ++requestId.current;
    try { const next = await api(`/surgeon/visits?q=${encodeURIComponent(query)}&page=${page}`); if (id === requestId.current) { setData(next); setError(''); } }
    catch (e) { if (id === requestId.current) setError(e.message); }
  }, [query, page]);
  useEffect(() => { const timer = setTimeout(load, 200); return () => { requestId.current++; clearTimeout(timer); }; }, [load]);
  useEffect(() => { reloadRef.current = load; }, [load, reloadRef]);
  return (
    <>
      <label className="ia-field"><span>جستجوی بیمار یا کد پرونده</span><input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} /></label>
      {error && <p className="bl-error" role="alert">{error}</p>}
      {!data && !error && <p className="sp-empty">در حال بارگذاری…</p>}
      {data?.rows.length === 0 && <p className="sp-empty">مراجعه‌ای برای نمایش نیست. انتسابِ پزشک هر مراجعه از تعاریف پایه بررسی می‌شود.</p>}
      <div className="sp-list">{data?.rows.map((row) => <SurgeonCase key={row.id} row={row} clinic={clinic} implant={data.workflow === 'implant'} reload={load} things={things} access={access} />)}</div>
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

function SurgeonFinances({ admin, surgeons }) {
  const [id, setId] = useState(''), [page, setPage] = useState(1), [data, setData] = useState(null), [error, setError] = useState('');
  useEffect(() => { let alive = true; setData(null); setError(''); if (admin && !id) return;
    api(`/surgeon/finances?surgeonId=${id}&page=${page}`).then((d) => { if (alive) setData(d); }).catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [admin, id, page]);
  const money = (n) => Number(n ?? 0).toLocaleString('fa-IR');
  return <section className="sp-list">
    {admin && <label className="ia-field"><span>بیلان کدام جراح؟</span><select value={id} onChange={(e) => { setId(e.target.value); setPage(1); }}><option value="">انتخاب جراح</option>{surgeons.filter((s) => s.active !== false).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
    <p>همه مبالغ تومان است. سهم فقط از تسویه نهایی محاسبه می‌شود. پرداخت‌ها، ثبت‌های مالی شرکت هستند؛ ثبت چک به معنی وصول آن نیست. پرونده بدون تسویه نهایی، سهم قطعی ندارد.</p>
    {error && <p role="alert">{error}</p>}
    {!data && !error && (!admin || id) && <p>در حال دریافت بیلان…</p>}
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
