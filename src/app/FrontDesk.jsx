import { AnimatePresence } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { fmtMoney } from '../lib/money.js';
import { faDate, jStrToIso, todayJStr, toEnDigits } from '../lib/jalali.js';
import { useAuth } from './auth.jsx';
import { useTerms } from './config.jsx';
import { useVisitDefs } from './visit-defs.js';
import VisitForm from './VisitForm.jsx';
import JDate from './JDate.jsx';
import Tabs from '../ui/Tabs.jsx';
import { Arrive, Close, Money, Phone, Search } from '../ui/icons.jsx';
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

  /* می‌اندازد، نمی‌بلعد — پنجرهٔ دلیلِ لغو خودش خطا را نشان می‌دهد. */
  const run = async (row, status, cancel) => {
    setBusy(row.id);
    try {
      await api(`/frontdesk/appointments/${row.id}/status`, { method: 'POST', body: { status, ...cancel } });
      after();
    } finally { setBusy(0); }
  };

  /* لغوِ نوبت هم دلیل می‌خواهد: نوبت یادآوریِ روزِ قبل دارد، پس بیمارِ بی‌خبر
     منتظرِ پیامی می‌ماند که دیگر نمی‌آید (تصمیمِ مالک ۱۴۰۵/۰۶/۲۶). */
  const act = (row, status) => {
    if (status === 'cancelled') { setCancelAsk(row); return; }
    run(row, status).then(() => setToast('ثبت شد ✓')).catch((e) => setToast(e?.message || 'انجام نشد'));
  };

  /* «شروع» و «بازکردن» دو چیزند: اولی وضعیت را جلو می‌برد، دومی فقط فرم را
     باز می‌کند. سرور همین تفکیک را دارد (`FrontDeskService.start`). */
  const open = async (row, advance) => {
    setBusy(row.id);
    try {
      const visitId = advance
        ? (await api(`/frontdesk/appointments/${row.id}/start`, { method: 'POST' })).visitId
        : row.visitId;
      const visit = await api(`/visits/${visitId}`);
      setSheet({ visit });
      if (advance) after();
    } catch (e) { setToast(e?.message || 'باز نشد'); } finally { setBusy(0); }
  };

  const laneTitle = (k, title) => (k === 'inVisit' ? t.visitInProgress : title);

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
        <JDate value={jday} onChange={setJday} />
        <button type="button" className="fd-today" onClick={() => setJday(todayJStr())}>امروز</button>
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
            initial={sheet.visit}
            defs={defs}
            onDefsChanged={reloadDefs}
            onClose={() => setSheet(null)}
            onSaved={() => { setSheet(null); after(); }}
            onToast={setToast}
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
              setToast('لغو ثبت شد و به بیمار اطلاع داده شد ✓');
            }}
          />
        )}
      </AnimatePresence>

      {toast && <button type="button" className="fd-toast" onClick={() => setToast('')}>{toast}</button>}
    </div>
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
