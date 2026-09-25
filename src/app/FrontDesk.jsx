import { AnimatePresence } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { fmtMoney } from '../lib/money.js';
import { faDate, jStrToIso, todayJStr, toEnDigits } from '../lib/jalali.js';
import { useAuth } from './auth.jsx';
import { useTerms } from './config.jsx';
import { useVisitDefs } from './visit-defs.js';
import VisitForm, { surgeryPrefill } from './VisitForm.jsx';
import JDate from './JDate.jsx';
import Tabs from '../ui/Tabs.jsx';
import { Arrive, Close, Money, Phone, Plus, Search } from '../ui/icons.jsx';
import Overlay from '../ui/Overlay.jsx';
import CancelReason from '../ui/CancelReason.jsx';
import './launcher.css';
import './definitions.css';
import './frontdesk.css';

const faNum = (v) => String(v ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

/** هر چند ثانیه تخته خودش تازه شود — میز صفحه‌ای است که باز می‌ماند. */
const POLL_MS = 20000;

/**
 * **میزِ پذیرشِ روز** (W3.3، §۴.۵ سند) — تختهٔ پنج‌ستونیِ امروز.
 *
 * ⚠️ **فرمِ مراجعه را خودِ همین صفحه میزبانی می‌کند، نه داشبورد.** معیارِ پذیرش
 * «≤ ۱ کلیک برگشت» است و پرش به `/app/dashboard` آن را می‌شکند — ولی دلیلِ
 * اصلی سلیقه نیست: فیچرِ `dashboard` سطحِ ادمین است، پس منشیِ سطح‌۲ اصلاً
 * آن‌جا فرود نمی‌آید. بستنِ شیت = برگشت به میز، بدونِ هیچ ناوبری‌ای.
 *
 * ⚠️ ستون و برچسبِ دکمه‌ها **مشتقِ سرور**اند (`lane`, `nextOptions`, `canStart`).
 * کپیِ کلاینتیِ ماشینِ وضعیت یعنی روزی تقویم و میز دو حرفِ متفاوت بزنند.
 */
export default function FrontDesk() {
  const { user } = useAuth();
  const t = useTerms();
  const [jday, setJday] = useState(todayJStr());
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(0);
  const [toast, setToast] = useState('');
  const [sheet, setSheet] = useState(null);      // { visit }
  const [cancelAsk, setCancelAsk] = useState(null); // نوبتی که دلیلِ لغوش پرسیده می‌شود
  const [lane, setLane] = useState('booked');    // فقط موبایل
  const [showCancelled, setShowCancelled] = useState(false);
  /* ⚠️ فیلترِ **سمتِ کلاینت** عمدی است: تخته از قبل یک روزِ کامل را در دست دارد
     (سقفِ ۲۰۰ ردیف)، پس رفت‌وبرگشتِ تازه فقط تأخیر اضافه می‌کرد. شمارندهٔ ستون‌ها
     هم عمداً **کلِ روز** را می‌شمارد نه نتیجهٔ جستجو را — وگرنه منشی با یک
     جستجوی باز فراموش می‌کند سه نفر دیگر هم منتظرند. */
  const [q, setQ] = useState('');
  const [walkIn, setWalkIn] = useState(false);

  /* تنبل: تا شیت باز نشود، شش fetchِ تعریف‌ها نمی‌رود. */
  const { defs, reload: reloadDefs } = useVisitDefs(!!sheet, user?.id);

  const iso = jStrToIso(jday);
  const load = useCallback(async () => {
    if (!iso) return;
    try { setData(await api(`/frontdesk/day?date=${iso}`)); setErr(null); }
    catch (e) { setErr({ message: e.message, status: e.status }); }
  }, [iso]);

  useEffect(() => { load(); }, [load]);

  /* ⚠️ وقتی شیت باز است تازه‌سازی **متوقف** می‌شود: با فرمی که کاربر در حالِ
     تایپ در آن است نباید جنگید. و روی برگشتن به تب هم یک‌بار تازه می‌شود،
     چون میز ساعت‌ها باز می‌ماند. */
  /* ⚠️ پنجرهٔ دلیلِ لغو هم «باز» حساب می‌شود: تازه‌سازی ردیف‌ها را از نو
     می‌سازد و یادداشتی که کاربر در حالِ نوشتنش است زیرِ دستش عوض می‌شود. */
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet || cancelAsk;
  useEffect(() => {
    const tick = () => { if (!sheetRef.current && document.visibilityState === 'visible') load(); };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [load]);


  /**
   * شمارشِ نوبت‌های هر روزِ ماه برای **نشانهٔ تقویمِ انتخابِ تاریخ**.
   *
   * ⚠️ `useCallback` لازم است نه تزئین: `JDate` این تابع را در وابستگیِ
   * افکتش دارد، و تابعِ inline هر رندر هویتِ تازه می‌گیرد — یعنی یک حلقهٔ
   * بی‌پایانِ fetch روی هر تیکِ پولینگِ میز.
   *
   * ⚠️ شکستش بلعیده می‌شود: نشانه کمک است، نه شرطِ انتخابِ تاریخ.
   */
  const loadMarks = useCallback(async (yy, mm) => {
    try {
      const r = await api(`/frontdesk/month?year=${yy}&month=${mm}`);
      return Object.fromEntries((r?.days ?? []).map((d) => [d.day, d.appointments]));
    } catch { return {}; }
  }, []);

  useEffect(() => { document.title = 'میزِ پذیرش — عمل‌یار'; }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(''), toast.length > 40 ? 4500 : 2200);
    return () => clearTimeout(id);
  }, [toast]);

  const after = () => {
    /* زنگِ بالای پوسته هم باید بداند — `CONTRACTS.md` §۱۰. */
    window.dispatchEvent(new Event('amalyar:work-changed'));
    load();
  };

  /* می‌اندازد، نمی‌بلعد — پنجرهٔ دلیلِ لغو خودش خطا را نشان می‌دهد.
     ⚠️ پاسخِ سرور برمی‌گردد چون **ستونِ مقصد** در آن است (`lane`)؛ بدونش
     کلاینت باید خودش از وضعیت حدسش بزند، یعنی کپیِ دومِ `apptLane()`. */
  const run = async (row, status, cancel) => {
    setBusy(row.id);
    try {
      const updated = await api(`/frontdesk/appointments/${row.id}/status`, { method: 'POST', body: { status, ...cancel } });
      after();
      return updated;
    } finally { setBusy(0); }
  };

  /* «ویزیتِ در جریان» واژهٔ حوزه است، پس از `useTerms` می‌آید نه از عنوانِ سرور. */
  const laneTitle = (k, title) => (k === 'inVisit' ? t.visitInProgress : title);

  /**
   * **نما کارت را دنبال می‌کند.**
   *
   * ⚠️ گزارشِ مالک: «تو میزِ منشی وقتی می‌زنیم مریض رسید، دیگه نمی‌شه زد شروعِ
   * ویزیت و گم می‌شه». دکمه پاک نشده بود — **ستونش** عوض شده بود: روی موبایل
   * فقط یک ستون دیده می‌شود (`.fd-lane.on`) و پیش‌فرضش «نوبت‌دار» است، پس
   * «رسید» کارت را به «حاضر» می‌بَرد و از جلوی چشم برمی‌دارد. روی دسکتاپ چون
   * هر پنج ستون کنارِ هم‌اند همین رفتار درست به‌نظر می‌رسید.
   *
   * ⚠️ ستونِ مقصد از **پاسخِ سرور** می‌آید نه از نگاشتِ کلاینتی: `apptLane()`
   * تنها منبعِ این تصمیم است و کپیِ دومش با اولین وضعیتِ تازه واگرا می‌شد.
   *
   * ⚠️ «لغوشده» ستون ندارد (یک بخشِ تاشو کنارِ تخته است)، پس به‌جای عوض‌کردنِ
   * ستون همان بخش باز می‌شود — وگرنه کاربر به ستونی فرستاده می‌شد که وجود ندارد.
   */
  const follow = (row, updated) => {
    const name = row.fullName || 'بیمار';
    const to = updated?.lane ?? null;
    if (to === 'cancelled') { setShowCancelled(true); setToast(`${name} لغو شد — در «لغوشده‌ها»ست`); return; }
    if (!to) { setToast('ثبت شد ✓'); return; }
    const found = (data?.lanes ?? []).find((l) => l.key === to);
    if (to !== lane) setLane(to);
    setToast(found ? `${name} رفت به «${laneTitle(to, found.title)}»` : 'ثبت شد ✓');
  };

  /* لغوِ نوبت هم دلیل می‌خواهد: نوبت یادآوریِ روزِ قبل دارد، پس بیمارِ بی‌خبر
     منتظرِ پیامی می‌ماند که دیگر نمی‌آید (تصمیمِ مالک ۱۴۰۵/۰۶/۲۶). */
  const act = (row, status) => {
    if (status === 'cancelled') { setCancelAsk(row); return; }
    run(row, status).then((updated) => follow(row, updated)).catch((e) => setToast(e?.message || 'انجام نشد'));
  };

  /* «شروع» و «بازکردن» دو چیزند: اولی وضعیت را جلو می‌برد، دومی فقط فرم را
     باز می‌کند. سرور همین تفکیک را دارد (`FrontDeskService.start`). */
  const open = async (row, advance) => {
    setBusy(row.id);
    try {
      const started = advance
        ? await api(`/frontdesk/appointments/${row.id}/start`, { method: 'POST' })
        : null;
      const visitId = advance ? started.visitId : row.visitId;
      const visit = await api(`/visits/${visitId}`);
      setSheet({ visit });
      /* همان قاعدهٔ `follow`: بعد از بستنِ فرم، کارت باید همان‌جا باشد که
         کاربر انتظارش را دارد — «ویزیتِ در جریان»، نه ستونی که ترکش کرده. */
      if (advance) { after(); follow(row, started.appointment); }
    } catch (e) { setToast(e?.message || 'باز نشد'); } finally { setBusy(0); }
  };


  if (err && err.status === 403) {
    return (
      <div className="fd"><div className="df-bg" />
        <div className="fd-note" role="status">{err.message} — از «همهٔ ابزارها» به بخش‌های خودتان بروید.</div>
      </div>
    );
  }

  const all = data?.rows ?? [];
  const needle = toEnDigits(q.trim());
  const rows = needle
    ? all.filter((r) => `${r.fullName ?? ''} ${r.patientCode ?? ''} ${r.phone ?? ''}`.includes(needle))
    : all;
  const lanes = data?.lanes ?? [];

  return (
    <div className="fd">
      <div className="df-bg" />
      <header className="fd-head">
        <div>
          <h1><Arrive width="19" height="19" aria-hidden="true" /> میزِ پذیرش</h1>
          <p>{faDate(iso)}{data?.isToday ? ' — امروز' : ''}</p>
        </div>
        <JDate value={jday} onChange={setJday} loadMarks={loadMarks} />
        <button type="button" className="fd-today" onClick={() => setJday(todayJStr())}>امروز</button>
        {/* بیمارِ بدونِ نوبت — تصمیمِ مالک ۱۴۰۵/۰۶/۳۰: «ممکن است حضوری بیاید که
            اگر وقت بشود پذیرش می‌شود». فقط برای **امروز**؛ حضوریِ فردا یعنی
            نوبت، و جایش تقویم است. */}
        {data?.isToday && (
          <button type="button" className="fd-walkin" onClick={() => setWalkIn(true)}>
            <Plus width="15" height="15" aria-hidden="true" /> بیمارِ بدونِ نوبت
          </button>
        )}
        <label className="fd-find">
          <Search width="15" height="15" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="نام، کدِ پرونده یا شماره" aria-label="جستجوی نام، کدِ پرونده یا شماره" />
          {q && <button type="button" className="fd-find-x" onClick={() => setQ('')} aria-label="پاک‌کردنِ جستجو"><Close width="13" height="13" /></button>}
        </label>
      </header>

      {err && err.status !== 403 && <div className="fd-err" role="alert">{err.message}</div>}

      {data && (
        <p className="fd-sum">
          {lanes.map((l) => (
            <span key={l.key}><b>{faNum(l.count)}</b> {laneTitle(l.key, l.title)}</span>
          ))}
          {data.cancelledCount > 0 && (
            <button type="button" className={`fd-cancel-chip${showCancelled ? ' on' : ''}`}
              onClick={() => setShowCancelled((v) => !v)}>
              {faNum(data.cancelledCount)} لغوشده
            </button>
          )}
        </p>
      )}

      {/* موبایل: ستون‌ها تب می‌شوند. ⚠️ `key` پایدار است، نه وابسته به شمارنده. */}
      <div className="fd-tabs">
        <Tabs
          label="ستون‌های میز" variant="scroll" value={lane} onChange={setLane}
          items={lanes.map((l) => ({ key: l.key, label: `${laneTitle(l.key, l.title)} (${faNum(l.count)})` }))}
        />
      </div>

      <div className="fd-board">
        {lanes.map((l) => (
          <section key={l.key} className={`fd-lane${lane === l.key ? ' on' : ''}`} aria-label={laneTitle(l.key, l.title)}>
            <h2>{laneTitle(l.key, l.title)} <em>{faNum(l.count)}</em></h2>
            <ul>
              {rows.filter((r) => r.lane === l.key).map((r) => (
                <Card key={r.id} row={r} t={t} busy={busy} onAct={act} onOpen={open} />
              ))}
              {!rows.some((r) => r.lane === l.key) && <li className="fd-empty">{needle && all.some((r) => r.lane === l.key) ? 'در این ستون نتیجه‌ای نیست' : '—'}</li>}
            </ul>
          </section>
        ))}
      </div>

      {showCancelled && (
        <section className="fd-cancelled" aria-label="لغوشده‌های امروز">
          <h2>لغوشده</h2>
          <ul>{rows.filter((r) => r.lane === 'cancelled').map((r) => (
            <Card key={r.id} row={r} t={t} busy={busy} onAct={act} onOpen={open} />
          ))}</ul>
        </section>
      )}

      {data?.truncated && (
        <p className="fd-cut">{faNum(data.total)} نوبتِ این روز — فقط بخشی نشان داده شده.</p>
      )}

      {/* ⚠️ `AnimatePresence` بیرونِ فرم می‌ماند (الگوی `Dashboard`)؛ Escape و
          focus-trap از خودِ `Overlay` داخلِ `VisitForm` می‌آید. */}
      <AnimatePresence>
        {sheet && (
          <VisitForm
            key={sheet.visit?.id ?? 'new-surgery'}
            initial={sheet.visit}
            prefill={sheet.prefill}
            defs={defs}
            onDefsChanged={reloadDefs}
            onClose={() => setSheet(null)}
            onSaved={(saved, wasEdit, opts) => {
              setSheet(null);
              after();
              /* «کاندیدای جراحی» — همان قولِ فرم در داشبورد و پرونده (بازبینیِ ۱۴۰۵/۰۷/۰۳):
                 تا دیروز میزِ پذیرش `openSurgery` را نادیده می‌گرفت و عمل به ویزیتِ تصمیم گره نمی‌خورد. */
              if (opts?.openSurgery && saved?.id) {
                setToast('تصمیم ثبت شد ✓ حالا فرمِ عمل را برای همین بیمار پر کنید');
                setTimeout(() => setSheet({ prefill: surgeryPrefill(saved) }), 400);
              }
            }}
            onToast={setToast}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {walkIn && (
          <WalkInSheet
            date={iso}
            onClose={() => setWalkIn(false)}
            onDone={(msg) => { setWalkIn(false); setToast(msg); after(); }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {cancelAsk && (
          <CancelReason
            kind="appointment"
            what={cancelAsk.fullName}
            onClose={() => setCancelAsk(null)}
            onConfirm={async (c) => {
              await run(cancelAsk, 'cancelled', c);
              setCancelAsk(null);
              /* همان قاعدهٔ `follow`: کارت به بخشِ تاشوی «لغوشده‌ها» می‌رود، پس
                 همان بخش باز می‌شود — وگرنه بیمار بی‌هیچ ردی از تخته می‌رفت. */
              setShowCancelled(true);
              setToast('لغو ثبت شد و به بیمار اطلاع داده شد ✓');
            }}
          />
        )}
      </AnimatePresence>

      {toast && <button type="button" className="fd-toast" onClick={() => setToast('')}>{toast}</button>}
    </div>
  );
}

/**
 * **پذیرشِ بیمارِ بدونِ نوبت.**
 *
 * ⚠️ فقط بیمارِ **موجود** — پروندهٔ تازه از «پذیرش» ساخته می‌شود، نه از این
 * پنجره: ساختنِ پرونده کدِ ملی و تأییدِ شماره می‌خواهد و فشردنش در یک پنجرهٔ
 * سه‌فیلدی یعنی پرونده‌های نصفه که بعداً باید ادغام شوند.
 *
 * ⚠️ ظرفیت **نشان داده می‌شود ولی مانع نیست** (تصمیمِ مالک): اگر روز پر باشد،
 * پنجره می‌گوید و اجازه می‌دهد — قاضیِ «وقت هست یا نه» منشی است. رد فقط برای
 * دو چیز است که قضاوت نیستند: روزِ تعطیل، و اسلاتِ پرِ نام‌برده.
 */
function WalkInSheet({ date, onClose, onDone }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [picked, setPicked] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const reqId = useRef(0);

  /* debounce — همان قاعدهٔ سرچِ فهرست‌ها؛ رندر به‌ازای هر حرف ممنوع. */
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setRows(null); return undefined; }
    const id = ++reqId.current;
    const h = setTimeout(() => {
      api(`/search/patients?q=${encodeURIComponent(t)}`)
        .then((r) => { if (id === reqId.current) setRows(Array.isArray(r) ? r : []); })
        .catch((e) => { if (id === reqId.current) { setRows([]); setErr(e.message); } });
    }, 220);
    return () => { clearTimeout(h); };
  }, [q]);

  const submit = async (e) => {
    e.preventDefault();
    if (!picked || busy) return;
    setErr(''); setBusy(true);
    try {
      const r = await api('/frontdesk/walk-in', { method: 'POST', body: { patientId: picked.id, date, note: note.trim() || undefined } });
      onDone(r?.beyondCapacity
        ? `${picked.fullName} پذیرش شد — بیش از ظرفیتِ امروز ✓`
        : `${picked.fullName} پذیرش شد ✓`);
    } catch (e2) { setErr(e2?.message || 'پذیرش نشد'); setBusy(false); }
  };

  return (
    <Overlay backdrop="cr-overlay" panel="glass fd-sheet" as="form" onClose={onClose} closable={!busy} onSubmit={submit} aria-label="بیمارِ بدونِ نوبت">
      <header className="fd-sheet-head">
        <h3>بیمارِ بدونِ نوبت</h3>
        <button type="button" onClick={onClose} aria-label="بستن"><Close width="16" height="16" /></button>
      </header>

      {!picked && (
        <>
          <label className="fd-sheet-field">
            <span>نام، کدِ پرونده یا شماره</span>
            <input value={q} onChange={(ev) => setQ(ev.target.value)} autoFocus placeholder="دستِ‌کم دو حرف" />
          </label>
          {rows === null && <p className="fd-sheet-hint">برای یافتنِ پرونده بنویسید.</p>}
          {rows?.length === 0 && <p className="fd-sheet-hint">پرونده‌ای پیدا نشد. پروندهٔ تازه از «پذیرش» ساخته می‌شود.</p>}
          {rows?.length > 0 && (
            <ul className="fd-found">
              {rows.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setPicked(r)}>
                    <b>{r.fullName}</b>
                    <span dir="ltr">{[r.code, r.phone].filter(Boolean).join(' · ')}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {picked && (
        <>
          <p className="fd-picked">
            <b>{picked.fullName}</b> <span dir="ltr">{picked.code}</span>
            <button type="button" onClick={() => setPicked(null)}>تغییر</button>
          </p>
          <label className="fd-sheet-field">
            <span>یادداشت (اختیاری)</span>
            <input value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="مثلاً: ارجاع از اورژانس" />
          </label>
        </>
      )}

      {err && <p className="fd-sheet-err" role="alert">{err}</p>}
      <div className="fd-sheet-acts">
        <button type="submit" className="fd-btn primary" disabled={!picked || busy}>{busy ? 'در حالِ ثبت…' : 'پذیرش'}</button>
        <button type="button" className="fd-btn" onClick={onClose} disabled={busy}>انصراف</button>
      </div>
    </Overlay>
  );
}

/** یک کارتِ بیمار روی تخته. همهٔ برچسب‌ها از سرور می‌آیند. */
function Card({ row, t, busy, onAct, onOpen }) {
  const due = row.billing && row.billing.total > 0 ? row.billing.due : 0;
  /* بدهیِ مراجعه‌های **دیگرِ** همین بیمار — سرور جمعش را داده و مراجعهٔ وصل‌شده
     را کنار گذاشته، پس با `due` بالا دوبار شمرده نمی‌شود. */
  const debt = row.debt?.due ?? 0;
  return (
    <li className={`fd-card${busy === row.id ? ' busy' : ''}`} data-appt={row.id}>
      <div className="fd-card-top">
        {/* سه‌راهه: ساعت، وگرنه شمارهٔ نوبت، وگرنه هیچ — نوبتِ آنلاین و
            حضوریِ اسلات‌محور `seq` ندارند. */}
        <span className="fd-when" dir="ltr">{row.time ? faNum(row.time) : row.seq ? `#${faNum(row.seq)}` : '—'}</span>
        <b>{row.fullName ?? '—'}</b>
        {row.patientCode && <span className="fd-code" dir="ltr">{row.patientCode}</span>}
      </div>
      <div className="fd-card-meta">
        {row.topicName && (
          <span className="fd-topic" style={row.topicColor ? { '--k': `var(--kind-${row.topicColor})` } : undefined}>
            {row.topicName}
          </span>
        )}
        <span className="fd-state">{row.statusLabel}</span>
        {row.phone && <a className="fd-tel" href={`tel:${row.phone}`}><Phone width="12" height="12" /> تماس</a>}
      </div>
      {due > 0 && (
        <p className="fd-money"><Money width="12" height="12" /> مانده <b>{fmtMoney(due)}</b></p>
      )}
      {debt > 0 && (
        <p className="fd-money fd-debt">
          <Money width="12" height="12" /> بدهیِ قبلی <b>{fmtMoney(debt)}</b>
          {row.debt.visits > 1 && <span> ({faNum(row.debt.visits)} مراجعه)</span>}
        </p>
      )}
      <div className="fd-actions">
        {row.canStart && (
          <button type="button" className="fd-btn primary" disabled={busy === row.id}
            onClick={() => onOpen(row, true)}>{t.visitStart}</button>
        )}
        {!row.canStart && row.visitId && (
          <button type="button" className="fd-btn" disabled={busy === row.id}
            onClick={() => onOpen(row, false)}>{t.visitOpen}</button>
        )}
        {(row.nextOptions ?? []).map((o) => (
          <button key={o.status} type="button" className={`fd-btn${o.status === 'cancelled' ? ' danger' : ''}`}
            disabled={busy === row.id} onClick={() => onAct(row, o.status)}>{o.label}</button>
        ))}
      </div>
    </li>
  );
}
