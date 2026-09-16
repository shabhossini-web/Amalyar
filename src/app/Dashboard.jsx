import AssistedTextarea from '../ui/AssistedTextarea.jsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from './auth.jsx';
import { api, apiStream } from '../lib/api.js';
import { faDate, isoToJStr, jStrToIso, todayJStr, toJalaali, toGregorian } from '../lib/jalali.js';
import { isValidNationalId, toEnDigits } from '../lib/identity.js';
import { badTime, durationMin, faDuration, normTime } from '../lib/time.js';
import { useConfig, useTerms } from './config.jsx';
import { useFormDef, star } from './useFormDef.jsx';
import DynForm, { dynErrors } from '../ui/DynForm.jsx';
import VoiceInput from '../ui/VoiceInput.jsx';
import OrderSheet, { ORDER_META } from './OrderSheet.jsx';
import BillingSheet from './BillingSheet.jsx';
import JDate from './JDate.jsx';
import { downloadCsv, printVisits, visitsToCsv } from './exports.js';
import './launcher.css';
import './users.css';
import './dashboard.css';
import './surgeon-portal.css'; // sp-card در فرمِ ویرایشِ مراجعه
import { Arrive, Back, Book, Calendar, Clock, Close, Diagnosis, Doctor, Download, Filter, Gear, Hospital, Money, Pencil, Plus, Print, Scalpel, Search, Send, Trash, User } from '../ui/icons.jsx';
import Tabs from '../ui/Tabs.jsx';
import Overlay from '../ui/Overlay.jsx';
import TimePick from '../ui/TimePick.jsx';
import Pick from '../ui/Pick.jsx';
import { useStagger } from '../ui/stagger.js';
/* W3.2: فرمِ ثبت/ویرایشِ مراجعه به فایلِ خودش رفت — این فایل فهرست و کارت است. */
import VisitForm from './VisitForm.jsx';
import { kindOf } from './visit-kinds.js';

/* ── آیکون‌های خطی ── */


/** فیلترهای پیشرفته‌ای که مستقیم به query سرور می‌روند. */

const ADV_IDS = ['surgeonId', 'hospitalId', 'techId', 'procedureTypeId', 'diagnosisId'];
const EMPTY_ADV = { surgeonId: '', hospitalId: '', techId: '', procedureTypeId: '', diagnosisId: '', fromJ: '', toJ: '', owing: false };
const EMPTY_META = { total: 0, pages: 1, stats: { total: 0, pending: 0, today: 0, due: 0, kinds: [] } };

const SORT_OPTIONS = [
  { v: 'date', l: 'تاریخ' },
  { v: 'created', l: 'تاریخِ ثبت' },
  { v: 'name', l: 'نامِ بیمار' },
  { v: 'code', l: 'کدِ پرونده' },
  // ⚠️ این دو مشتق‌اند و ستونِ دیتابیس ندارند؛ سرور با aggregate مرتب می‌کند.
  // تا فازِ حسابداری عمداً نبودند — ساختنِ ستونِ ذخیره‌شده ناقضِ computeVisit بود.
  { v: 'due', l: 'مانده' },
  { v: 'total', l: 'جمعِ کل' },
];
const PAGE_SIZES = [25, 50, 100, 200];

/**
 * بازه‌های سریع بر تقویمِ شمسی حساب می‌شوند، نه میلادی: «این ماه» یعنی ماهِ
 * شمسی، و هفته از شنبه شروع می‌شود. حسابِ میلادی این‌جا جوابِ غلط می‌دهد.
 */
function quickRange(key) {
  const now = new Date();
  const iso = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
  if (key === 'today') return { fromJ: isoToJStr(iso(now)), toJ: isoToJStr(iso(now)) };
  if (key === 'week') {
    const back = (now.getDay() + 1) % 7; // شنبه = ابتدای هفته
    const from = new Date(now); from.setDate(now.getDate() - back);
    const to = new Date(from); to.setDate(from.getDate() + 6);
    return { fromJ: isoToJStr(iso(from)), toJ: isoToJStr(iso(to)) };
  }
  const [jy, jm] = jParts(now);
  const start = jToDate(jy, jm, 1);
  const nextY = jm === 12 ? jy + 1 : jy;
  const nextM = jm === 12 ? 1 : jm + 1;
  const end = jToDate(nextY, nextM, 1);
  end.setDate(end.getDate() - 1);
  return { fromJ: isoToJStr(start.toISOString()), toJ: isoToJStr(end.toISOString()) };
}
const jParts = (d) => {
  const j = toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return [j.jy, j.jm, j.jd];
};
const jToDate = (jy, jm, jd) => {
  const g = toGregorian(jy, jm, jd);
  return new Date(g.gy, g.gm - 1, g.gd);
};

const statusLabel = (v) => (v.opStatus === 'pending' ? kindOf(v.kind).pending : STATUS_FA[v.opStatus]);

const STATUS_FA = { pending: 'در انتظار', done: 'تمام‌شده', cancelled: 'کنسل' };
const FILTERS = [
  { v: 'all', l: 'همه' },
  { v: 'pending', l: 'در انتظار' },
  { v: 'done', l: 'تمام‌شده' },
  { v: 'cancelled', l: 'کنسل' },
];
/**
 * فیلترِ نوع از **نوع‌هایی که واقعاً در داده هستند** ساخته می‌شود، نه از فهرستی
 * در کد. نوعِ دلخواهی که سوپرادمین ساخته (مثلاً «درمان») همان‌جا در فیلتر
 * پیدا می‌شود، بی‌آنکه کسی این فایل را دست بزند.
 */
/**
 * ⚠️ `titles` نگاشتِ سرور است (`visitKind → عنوانِ فرم`). بدونِ آن، فیلترِ یک
 * نوعِ دلخواه کلیدِ خامِ انگلیسی را نشان می‌داد (`implantr14518`) در حالی که
 * برچسبِ همان نوع روی کارت فارسی بود — دو نامِ متفاوت برای یک چیز، در یک صفحه.
 */
const kindFilters = (present, titles = {}) => [
  { v: 'all', l: 'همه' },
  ...present.map((v) => ({ v, l: titles[v] || kindOf(v).label })),
];
const faNum = (n) => Number(n || 0).toLocaleString('fa-IR');
/// ارقامِ لاتینِ یک رشته (مثلِ «۱۴۰۵/۰۵/۰۱»ِ ورودی) را فارسی می‌کند — فقط برای
/// نمایش؛ مقدارِ داخلِ input عمداً لاتین می‌ماند تا تایپ و ویرایش ساده بماند.
const faDigits = (s) => String(s ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);



/* ── شیتِ «تعریف‌ها»: مدیریتِ جراحان و بیمارستان‌ها ── */

/* ── کارتِ مراجعه ── */
/**
 * ارسالِ فرمِ زیرپرونده از روی کارتِ مراجعه.
 *
 * ⚠️ صفحهٔ مشخصات ندارد: هویت از خودِ پرونده می‌آید (`/intake/send` سمتِ
 * سرور پُرش می‌کند). کلیک روی نامِ فرم = ساختِ ثبت‌نام + کپیِ لینک — ادمین
 * فقط باید لینک را برای بیمار بفرستد.
 * فهرستِ فرم‌ها یک‌بار برای کلِ صفحه کش می‌شود؛ منو per-card است ولی داده
 * مشترک است.
 */
let recordFormsCache = null;
function SendFormMenu({ patientId, busy, onToast }) {
  const [open, setOpen] = useState(false);
  const [forms, setForms] = useState(recordFormsCache);
  const [sending, setSending] = useState(0);
  const wrapRef = useRef(null);

  /* ⚠️ بستن با شنوندهٔ سند، نه با پردهٔ `position:fixed`: کارتِ framer-motion
     `transform` دارد و transform مرجعِ fixed را به خودِ کارت محدود می‌کند —
     پرده فقط روی کارت می‌افتاد و کلیکِ بیرونِ کارت هیچ‌جا نمی‌خورد. */
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !recordFormsCache) {
      try {
        const all = await api('/forms');
        recordFormsCache = (all ?? []).filter((f) => f.scope === 'record' && f.active !== false);
        setForms(recordFormsCache);
      } catch (e) { onToast(e.message); setOpen(false); }
    }
  };

  const sendForm = async (f) => {
    setSending(f.id);
    try {
      const r = await api('/intake/send', { method: 'POST', body: { patientId, formId: f.id } });
      /* «ارسال» = پیامک به خودِ بیمار (سمتِ سرور). گزارش باید همان واقعیت
         باشد: فرستاده شد / پیکربندی نیست / نرفت — نه «کپی شد». */
      const toFa = String(r.to ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
      /* ⚠️ نشانی از توکن بازسازی می‌شود، نه فقط از `r.url`: وقتی سرورِ در
         حالِ دیپلوی هنوز نسخهٔ قدیم است، `url/sent/stub` در پاسخ نیست و
         toast «undefined» چاپ می‌کرد. توکن در هر دو نسخه هست. */
      const url = r.url ?? `${window.location.origin}/f/${r.token}`;
      if (r.sent) {
        onToast(`«${f.title}» پیامک شد به ${toFa}${r.reused ? ' (یادآوریِ همان فرمِ باز)' : ''} ✓`);
      } else if (r.stub) {
        onToast(`سرویسِ پیامک پیکربندی نشده — لینک: ${url}`);
      } else if (r.sent === undefined) {
        let copied = false;
        try { await navigator.clipboard.writeText(url); copied = true; } catch { /* کلیپ‌بورد بسته */ }
        onToast(`سرور هنوز به‌روز نشده و پیامک نفرستاد — لینک${copied ? ' کپی شد' : ''}: ${url}`);
      } else {
        onToast(`پیامک نرفت — لینک: ${url}`);
      }
      setOpen(false);
    } catch (e) { onToast(e.message); } finally { setSending(0); }
  };

  return (
    <span className="db-sendwrap" ref={wrapRef}>
      <button type="button" className="db-ico" title="ارسالِ فرم برای بیمار" disabled={busy} onClick={toggle}>
        <Send width="15" height="15" />
      </button>
      {open && (
        <div className="db-sendmenu" role="menu">
          <b>ارسالِ فرم برای این بیمار</b>
          {forms === null && <small>در حال بارگذاری…</small>}
          {forms?.length === 0 && <small>فرمِ زیرپرونده‌ای ساخته نشده — از فرم‌ساز بسازید</small>}
          {forms?.map((f) => (
            <button key={f.id} type="button" role="menuitem" disabled={!!sending} onClick={() => sendForm(f)}>
              {sending === f.id ? 'در حال ساخت…' : f.title}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/**
 * منوی «خلاصهٔ ویزیت» — چاپ/PDF برای خودِ ادمین، یا پیامکِ لینک برای بیمار.
 * لینک تنبل سمتِ سرور ساخته می‌شود؛ بازکردنِ دوباره همان را می‌دهد.
 */
function SummaryMenu({ visitId, patientId, busy, onToast }) {
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, [open]);

  const openPrint = async () => {
    setWorking(true);
    try {
      const r = await api(`/visits/${visitId}/summary-link`, { method: 'POST' });
      window.open(r.url ?? `/v/${r.token}`, '_blank', 'noopener');
      setOpen(false);
    } catch (e) { onToast(e.message); } finally { setWorking(false); }
  };
  const sendPortal = async () => {
    setWorking(true);
    try {
      const r = await api(`/patients/${patientId}/portal-sms`, { method: 'POST' });
      const toFa = String(r.to ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
      onToast(r.sent ? `لینکِ پرونده پیامک شد به ${toFa} ✓`
        : r.stub ? `سرویسِ پیامک پیکربندی نشده — لینک: ${r.url}`
          : `پیامک نرفت — لینک: ${r.url}`);
      setOpen(false);
    } catch (e) { onToast(e.message); } finally { setWorking(false); }
  };
  const sendSms = async () => {
    setWorking(true);
    try {
      const r = await api(`/visits/${visitId}/summary-sms`, { method: 'POST' });
      const toFa = String(r.to ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
      onToast(r.sent ? `خلاصهٔ ویزیت پیامک شد به ${toFa} ✓`
        : r.stub ? `سرویسِ پیامک پیکربندی نشده — لینک: ${r.url}`
          : `پیامک نرفت — لینک: ${r.url}`);
      setOpen(false);
    } catch (e) { onToast(e.message); } finally { setWorking(false); }
  };

  return (
    <span className="db-sendwrap" ref={wrapRef}>
      <button type="button" className="db-ico" title="خلاصهٔ ویزیت (چاپ / ارسال)" disabled={busy} onClick={() => setOpen((o) => !o)}>
        <Print width="15" height="15" />
      </button>
      {open && (
        <div className="db-sendmenu" role="menu">
          <b>خلاصهٔ ویزیت</b>
          <button type="button" role="menuitem" disabled={working} onClick={openPrint}>بازکردن — چاپ / ذخیرهٔ PDF</button>
          <button type="button" role="menuitem" disabled={working} onClick={sendSms}>پیامکِ لینک برای بیمار</button>
          <button type="button" role="menuitem" disabled={working} onClick={sendPortal}>پیامکِ پروندهٔ الکترونیک</button>
        </div>
      )}
    </span>
  );
}

function VisitCard({ v, index, busy, onEdit, onStatus, onDelete, onBilling, onToast }) {
  const row = useStagger();
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => {
    if (!confirmDel) return undefined;
    const t = setTimeout(() => setConfirmDel(false), 3000);
    return () => clearTimeout(t);
  }, [confirmDel]);

  return (
    /* ⚠️ رنگِ اکسنت روی **کلِ کارت** می‌نشیند نه فقط برچسب: طرحِ مرجع
       (21st.dev/Course Design Cards) درخششِ گوشه، لبه و نوارِ پیشرفت را از یک
       رنگ می‌گیرد. چون `kindColor` را در مرحلهٔ ۵ سمتِ سرور ساختیم، همان یک
       متغیر هر سه را می‌بَرد و کارتِ ویزیت/جراحی/پیگیری از دور از هم جدا
       دیده می‌شوند. نوعِ بی‌فرم `--k` نمی‌گیرد و کارت به خاکستریِ خنثی
       برمی‌گردد — دروغِ رنگی بهتر از بی‌رنگی نیست. */
    <motion.div
      className="db-card"
      style={v.kindColor ? { '--k': `var(--kind-${v.kindColor})` } : undefined}
      {...row(index)}
    >
      {/* ⚠️ درخشش **ثابت** است و دنبالِ نشانگر نمی‌آید. اسپاتلایتِ قبلی روی
          هر جابه‌جاییِ ماوس دو متغیرِ inline روی کارت می‌نوشت — روی فهرستی
          که ۵۰ کارت دارد، هزینه‌ای بود که هیچ‌کس نمی‌دید. */}
      <div className="db-panel">
        <span className="db-panel-glow" aria-hidden="true" />

        {/* ⚠️ **دو مقصدِ متفاوت روی یک کارت** — و این تفکیک عمدی است:
            کارت = خودِ مراجعه (باز شود تا دیده یا تکمیل شود) · نام = پروندهٔ
            بیمار. تا دیروز `.db-title` تمامِ عرضِ پنل را می‌گرفت، پس کلیک روی
            هر جای کارت «پرونده» را باز می‌کرد و راهی برای بازکردنِ خودِ
            مراجعه جز آیکونِ مداد نبود — یعنی پرتکرارترین کارِ صفحه پشتِ
            کوچک‌ترین هدفِ صفحه قایم شده بود.

            دکمهٔ پوششی (`.db-open`) به‌جای `onClick` روی خودِ `div` است تا با
            صفحه‌کلید هم قابلِ رسیدن باشد و صداگذارِ صفحه بداند این یک کنش
            است؛ و چون `.db-title` یک لینکِ واقعی است، تودرتویِ نامعتبرِ
            «لینک داخلِ دکمه» هم پیش نمی‌آید — این دو **کنارِ هم**اند، نه
            داخلِ هم. */}
        <button
          type="button"
          className="db-open"
          onClick={() => onEdit(v)}
          disabled={busy}
          aria-label={`گشودنِ ${v.code} — ${v.fullName}`}
        />

        <div className="db-panel-top">
          <span className="db-when">{v.opDate ? faDate(v.opDate) : 'بدونِ تاریخ'}</span>
          {v.kind && <span className="db-kindtag">{v.kindTitle || kindOf(v.kind).label}</span>}
        </div>

        {/* نامِ بیمار درِ ورودیِ پرونده است — کاربر همان‌جا که بیمار را می‌بیند
            انتظار دارد بتواند سابقه‌اش را باز کند، نه از یک منویِ دیگر.

            ⚠️ **فقط خودِ نام لینک است، نه کلِ بلوکِ عنوان.** تا دیروز کدِ
            مراجعه و بالشتکِ دورش هم داخلِ لینک بودند، پس یک هدفِ ۲۰۲×۶۳ در
            **مرکزِ دیداریِ کارت** می‌ساخت. روی کارتِ کم‌ارتفاع (بی‌عمل،
            بی‌مبلغ) مرکزِ هندسیِ کارت دقیقاً همان‌جا می‌افتاد — یعنی ضربهٔ
            طبیعیِ وسط، «پرونده» را باز می‌کرد نه «مراجعه» را. سنجیده شد،
            حدس نیست.

            حالا سطحِ لینک به یک خطِ متن کوچک شده و زیرخطِ نقطه‌چین دارد تا
            پیدا باشد یک مقصدِ **دیگر** است؛ برای هدفِ مطمئن هم دکمهٔ
            «پرونده» در ردیفِ ابزار هست. */}
        <div className="db-title">
          <Link className="db-name" to={`/app/patients/${v.patientId}`} title="پروندهٔ بیمار">
            {v.fullName}
          </Link>
          <span className="db-code" dir="ltr">{v.code}</span>
        </div>
        {(v.procedureTypeName || v.opType) && (
          <p className="db-sub">{v.procedureTypeName || v.opType}</p>
        )}

        <div className="db-facts">
          {v.surgeonName && <span><Doctor width="14" height="14" /> {v.surgeonName}</span>}
          {v.techName && <span><User width="14" height="14" /> {v.techName}</span>}
          {v.hospitalName && <span><Hospital width="14" height="14" /> {v.hospitalName}</span>}
          {/* ساعت فقط وقتی ثبت شده باشد؛ «—:—» روی هر کارت اطلاعات نیست.
              مدت از سرور می‌آید (durationMin)، نه از تفریقِ همین‌جا. */}
          {v.opStartTime && (
            <span title={v.durationMin != null ? `مدت: ${faDuration(v.durationMin)}` : undefined}>
              <Clock width="14" height="14" />
              <span dir="ltr">{v.opStartTime}{v.opEndTime ? `–${v.opEndTime}` : ''}</span>
              {v.durationMin != null && ` (${faDuration(v.durationMin)})`}
            </span>
          )}
          {v.techArriveTime && (
            <span title={`ساعتِ حضورِ ${v.techName || 'کارشناس'}`}>
              <Arrive width="14" height="14" /> <span dir="ltr">{v.techArriveTime}</span>
            </span>
          )}
          {v.diagnosisTitle && <span><Diagnosis width="14" height="14" /> {v.diagnosisTitle}</span>}
          {/* «ویزیتِ بعدی» — پزشک روی فرم ثبت کرده؛ منشی از روی همین کارت
              پیگیری می‌کند تا فازِ یادآوریِ خودکار برسد. */}
          {v.nextVisitDate && (
            <span className="db-nextvisit" title="ویزیتِ بعدی">
              <Calendar width="14" height="14" /> ویزیتِ بعدی: {faDate(v.nextVisitDate)}
            </span>
          )}
        </div>

        {/* ⚠️ نوارِ پیشرفت = **وصولِ صورت‌حساب**، و فقط وقتی صورت‌حسابی هست.
            `paidPct` از سرور می‌آید (قانون ۱۵): تقسیم بر صفر یک‌جا مهار
            می‌شود، نه در هر صفحه‌ای که نوار می‌کشد. مراجعهٔ بی‌فاکتور نوار
            نمی‌گیرد — نوارِ صفردرصد روی کارتی که اصلاً فاکتور ندارد، خبرِ
            غلط می‌دهد. */}
        {v.total !== 0 && (
          <div className="db-prog">
            <div className="db-prog-head">
              <span>وصول</span>
              <b>{faNum(v.paidPct)}٪</b>
            </div>
            <div className="db-prog-bar" role="progressbar"
                 aria-valuenow={v.paidPct} aria-valuemin={0} aria-valuemax={100}
                 aria-label={`وصولِ صورت‌حسابِ ${v.fullName}`}>
              <i style={{ inlineSize: `${v.paidPct}%` }} />
            </div>
            <small className={v.due <= 0 ? 'ok' : undefined}>
              {v.due > 0 ? `مانده ${faNum(v.due)} از ${faNum(v.total)}` : `تسویه — ${faNum(v.total)}`}
            </small>
          </div>
        )}
      </div>

      {/* ⚠️ ردیفِ پایین **بیرونِ** پنل است، مثلِ طرحِ مرجع: پنل «خودِ مراجعه»
          است و این ردیف «کاری که با آن می‌کنی». جداکردنشان یعنی چشم برای
          خواندنِ کارت لازم نیست از میانِ دکمه‌ها رد شود.

          ⚠️ وضعیت این‌جا **قرصِ خواندنی** است و انتخابگرِ وضعیت هم همین‌جا
          می‌ماند — پنهان‌کردنش پشتِ یک منویِ ⋮ (مثلِ طرحِ مرجع) یعنی
          پرتکرارترین کارِ این صفحه دو کلیک شود. طرح را می‌گیریم، نه ضعفِ
          کاربردی‌اش را. */}
      <div className="db-foot">
        <span className={`us-status db-st-${v.opStatus}`}>{statusLabel(v)}</span>
        <div className="db-statuspick" role="group" aria-label="تغییر وضعیت">
          {Object.entries(STATUS_FA).map(([k, l]) => (
            <button
              key={k}
              type="button"
              className={v.opStatus === k ? `on db-st-${k}` : ''}
              disabled={busy || v.opStatus === k}
              onClick={() => onStatus(v, k)}
            >
              {l}
            </button>
          ))}
        </div>
        {/* ⚠️ آیکون‌ها یک **گروه**اند نه سه فرزندِ جدا: در عرضِ کم باید با هم
            به خطِ دوم بروند. تا وقتی مستقیم فرزندِ `.db-foot` بودند فقط
            «حذف» تنها می‌افتاد پایین و ردیف شکسته به‌نظر می‌رسید. */}
        <div className="db-tools">
          {/* ⚠️ هدفِ **مطمئنِ** پرونده. نامِ وسطِ کارت یک میان‌بُر است و روی
              موبایل با ضربهٔ «وسطِ کارت» قاطی می‌شود؛ این یکی هرگز قاطی
              نمی‌شود چون کنارِ بقیهٔ ابزارهاست و برچسب دارد. */}
          <Link className="db-ico" to={`/app/patients/${v.patientId}`} title="پروندهٔ بیمار"><Book width="15" height="15" /></Link>
          <SendFormMenu patientId={v.patientId} busy={busy} onToast={onToast} />
          <SummaryMenu visitId={v.id} patientId={v.patientId} busy={busy} onToast={onToast} />
          <button type="button" className="db-ico" title="صورت‌حساب" onClick={() => onBilling(v)} disabled={busy}><Money width="15" height="15" /></button>
          <button type="button" className="db-ico" title="ویرایش" onClick={() => onEdit(v)} disabled={busy}><Pencil width="15" height="15" /></button>
          <button
            type="button"
            className={`db-ico del${confirmDel ? ' arm' : ''}`}
            title={confirmDel ? 'برای حذفِ قطعی دوباره بزنید' : 'حذف'}
            disabled={busy}
            onClick={() => (confirmDel ? onDelete(v) : setConfirmDel(true))}
          >
            {confirmDel ? 'حذف؟' : <Trash width="15" height="15" />}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

/* ── جستجوی پیشرفته ──
   پاپ‌آپِ چندپارامتری. عمداً «اعمال» دارد و زنده نیست: کاربر پنج فیلتر را
   می‌چیند و یک‌بار نتیجه می‌خواهد، نه پنج بار بارگذاریِ نصفه‌کاره. */
function AdvancedSearch({ value, defs, onApply, onClose }) {
  const t = useTerms();
  const [f, setF] = useState(value);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const pickRange = (key) => setF((s) => ({ ...s, ...quickRange(key) }));

  const badDate = (v) => !!v.trim() && !jStrToIso(v);
  const invalid = badDate(f.fromJ) || badDate(f.toJ);

  const FIELDS = [
    { key: 'surgeonId', label: 'جراح', options: defs.surgeons },
    { key: 'hospitalId', label: 'بیمارستان', options: defs.hospitals },
    { key: 'techId', label: t.tech, options: defs.techs },
    { key: 'procedureTypeId', label: 'نوعِ عمل', options: defs.procedures },
    { key: 'diagnosisId', label: 'تشخیص', options: defs.diagnoses },
    { key: 'topicId', label: 'موضوعِ ویزیت', options: defs.topics ?? [] },
  ];

  return (
    <Overlay backdrop="db-overlay" panel="glass db-sheet db-advsheet" from="bottom" onClose={onClose}>
      <header className="db-sheet-head">
        <b>جستجوی پیشرفته</b>
        <button type="button" className="db-x" onClick={onClose} aria-label="بستن"><Close width="18" height="18" /></button>
      </header>

      <div className="db-advbody">
        <div className="db-grid2">
          {FIELDS.map((fl) => (
            <label key={fl.key} className="db-field">
              <span>{fl.label}</span>
              <select value={f[fl.key] ?? ''} onChange={set(fl.key)}>
                <option value="">همه</option>
                {(fl.options ?? []).map((o) => (
                  <option key={o.id} value={o.id}>{o.name || o.title || o.displayName}</option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <div className="db-quickdates">
          <button type="button" onClick={() => pickRange('today')}>امروز</button>
          <button type="button" onClick={() => pickRange('week')}>این هفته</button>
          <button type="button" onClick={() => pickRange('month')}>این ماه</button>
          <button type="button" onClick={() => setF((s) => ({ ...s, fromJ: '', toJ: '' }))}>بدونِ بازه</button>
        </div>

        <div className="db-grid2">
          <JDate label="از تاریخ (شمسی)" value={f.fromJ}
            onChange={(v) => setF((s2) => ({ ...s2, fromJ: v }))} placeholder="۱۴۰۵/۰۱/۰۱" />
          <JDate label="تا تاریخ (شمسی)" value={f.toJ}
            onChange={(v) => setF((s2) => ({ ...s2, toJ: v }))} placeholder={todayJStr()} />
        </div>

        {/* فیلترِ مالی — تا فازِ حسابداری نبود چون «مانده» ستون ندارد. */}
        <label className="db-owing">
          <input type="checkbox" checked={!!f.owing} onChange={(e) => setF((s2) => ({ ...s2, owing: e.target.checked }))} />
          <span>فقط مراجعاتی که هنوز بدهی دارند</span>
        </label>
      </div>

      <footer className="db-sheet-foot">
        <button type="button" className="db-ghost" onClick={() => setF(EMPTY_ADV)}>پاک‌کردن</button>
        <button type="button" className="db-submit" disabled={invalid} onClick={() => onApply(f)}>اعمال</button>
      </footer>
    </Overlay>
  );
}

/**
 * «از همان ثبت، پیشنهادِ نوبت» — بعد از ذخیرهٔ ویزیتی که «ویزیتِ بعدی» دارد،
 * همان‌جا نوبتِ واقعیِ همان روز پیشنهاد می‌شود. از **همان مسیرِ** نوبتِ
 * حضوری (`POST /appointments`) می‌گذرد: ظرفیت و اسلات و یادآوری‌ها سرِ
 * جای خودشان — این پنجره فقط راهِ رسیدن را کوتاه می‌کند.
 *
 * حالت‌ها همه از پاسخِ `suggest` سرور می‌آیند (قاعدهٔ ۱۵): نوبتِ موجودِ
 * همان روز، روزِ بسته/پر، حالتِ ظرفیتی (یک دکمه) یا اسلاتی (انتخابِ ساعت).
 */
function NextVisitBook({ data, onClose, onToast }) {
  const { visit, sug, day } = data;
  const [startMin, setStartMin] = useState(null);
  const [busy, setBusy] = useState(false);
  const [booked, setBooked] = useState(null);
  const dateFa = faDate(day);
  const freeSlots = (sug.slots ?? []).filter((s) => !s.taken);

  const book = async () => {
    setBusy(true);
    try {
      const appt = await api('/appointments', {
        method: 'POST',
        body: {
          patientId: visit.patientId,
          date: day,
          ...(sug.mode === 'slot' ? { startMin } : {}),
          ...(visit.topicId ? { topicId: visit.topicId } : {}),
          note: 'ویزیتِ بعدی — از فرمِ مراجعه',
        },
      });
      setBooked(appt);
    } catch (e) {
      onToast(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay backdrop="db-overlay" panel="glass db-sheet db-nvb" from="bottom" onClose={onClose}>
      <header className="db-sheet-head">
        <b><Calendar width="16" height="16" /> نوبت برای ویزیتِ بعدی</b>
        <button type="button" className="db-x" onClick={onClose} aria-label="بستن"><Close width="18" height="18" /></button>
      </header>

      {booked ? (
        <div className="db-nvb-done">
          <p>
            نوبتِ <b>{dateFa}</b> ثبت شد ✓
            {booked.time ? <> — ساعتِ <b>{booked.time}</b></> : booked.seq ? <> — شمارهٔ صف <b>{faNum(booked.seq)}</b></> : null}
          </p>
          <em>یادآوریِ پیامکیِ نوبت، عصرِ روزِ قبل خودکار می‌رود.</em>
          <button type="button" className="db-nvb-main" onClick={onClose}>بستن</button>
        </div>
      ) : sug.existing ? (
        <div className="db-nvb-done">
          <p>
            این بیمار برای <b>{dateFa}</b> از قبل نوبت دارد
            {sug.existing.time ? <> — ساعتِ <b>{sug.existing.time}</b></> : sug.existing.seq ? <> — شمارهٔ صف <b>{faNum(sug.existing.seq)}</b></> : null}
            {' '}({sug.existing.statusLabel}).
          </p>
          <button type="button" className="db-nvb-main" onClick={onClose}>باشه</button>
        </div>
      ) : !sug.open ? (
        <div className="db-nvb-done">
          <p>
            <b>{dateFa}</b> در برنامهٔ کاری {sug.closed ? 'تعطیل اعلام شده' : sug.free === 0 && sug.mode !== 'none' ? 'جای آزاد ندارد' : 'باز نیست'}.
          </p>
          <em>می‌توانید از صفحهٔ «برنامهٔ کاری» روز را باز کنید، یا تاریخِ ویزیتِ بعدی را عوض کنید.</em>
          <button type="button" className="db-nvb-main" onClick={onClose}>باشه</button>
        </div>
      ) : (
        <div className="db-nvb-body">
          <p>
            برای <b>{visit.fullName}</b> در <b>{dateFa}</b>
            {sug.mode === 'capacity'
              ? <> نوبت ثبت شود؟ ({faNum(sug.free)} جای آزاد)</>
              : <> کدام ساعت؟</>}
          </p>
          {sug.mode === 'slot' && (
            <div className="db-nvb-slots" role="radiogroup" aria-label="ساعتِ نوبت">
              {freeSlots.map((s) => (
                <button
                  key={s.startMin} type="button"
                  className={`db-nvb-slot${startMin === s.startMin ? ' on' : ''}`}
                  onClick={() => setStartMin(s.startMin)}
                >
                  <Clock width="12" height="12" /> {s.time}
                </button>
              ))}
            </div>
          )}
          <div className="db-nvb-actions">
            <button type="button" className="db-nvb-ghost" onClick={onClose}>حالا نه</button>
            <button
              type="button" className="db-nvb-main"
              disabled={busy || (sug.mode === 'slot' && startMin === null)}
              onClick={book}
            >
              {busy ? 'در حالِ ثبت…' : 'ثبتِ نوبت'}
            </button>
          </div>
        </div>
      )}
    </Overlay>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  // brandName برای سربرگِ برگهٔ چاپ لازم است، پس کلِ config خوانده می‌شود نه فقط واژگان.
  const { t, brandName } = useConfig();
  const [visits, setVisits] = useState(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [kind, setKind] = useState('all');
  // فیلترِ پیشرفته، سورت و صفحه — همه در URL نیستند چون داشبورد صفحهٔ کاری است
  // نه لینکِ اشتراکی؛ اگر روزی لینکِ فیلتر لازم شد، همین شیء به query می‌رود.
  const [adv, setAdv] = useState(EMPTY_ADV);
  const [advOpen, setAdvOpen] = useState(false);
  const [sort, setSort] = useState('date');
  const [dir, setDir] = useState('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [meta, setMeta] = useState(EMPTY_META);
  const [modal, setModal] = useState(null); // null | {} | {visit}
  const [nvBook, setNvBook] = useState(null); // پیشنهادِ نوبتِ «ویزیتِ بعدی» بعد از ذخیره
  const [billing, setBilling] = useState(null); // مراجعه‌ای که صورت‌حسابش باز است
  const [busyId, setBusyId] = useState(0);
  const [toast, setToast] = useState('');
  const [denied, setDenied] = useState(false);
  const [defs, setDefs] = useState({ surgeons: [], hospitals: [], techs: [], procedures: [], diagnoses: [], topics: [] });
  const qRef = useRef(q);
  qRef.current = q;

  useEffect(() => { document.title = 'عمل‌یار — داشبورد مدیریت'; }, []);
  useEffect(() => {
    if (!toast) return undefined;
    // پیامِ «کدام پرونده، چندمین مراجعه» بلند است؛ ۲۲۰۰ms برای خواندنش کم بود.
    const t = setTimeout(() => setToast(''), toast.length > 40 ? 4500 : 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback((query, st, kn, a = EMPTY_ADV, so = 'date', dr = 'desc', pg = 1, ps = 50) => {
    const params = new URLSearchParams();
    if (query?.trim()) params.set('q', query.trim());
    if (st && st !== 'all') params.set('status', st);
    if (kn && kn !== 'all') params.set('kind', kn);
    for (const key of ADV_IDS) if (a[key]) params.set(key, a[key]);
    // تاریخِ شمسیِ نامعتبر اصلاً فرستاده نمی‌شود؛ کاربر وسطِ تایپ نباید
    // فهرستش خالی شود.
    const from = a.fromJ ? jStrToIso(a.fromJ) : null;
    const to = a.toJ ? jStrToIso(a.toJ) : null;
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (a.owing) params.set('owing', '1');
    params.set('sort', so); params.set('dir', dr);
    params.set('page', String(pg)); params.set('pageSize', String(ps));
    return api(`/visits?${params}`)
      .then((res) => {
        setDenied(false);
        setVisits(res.rows);
        setMeta({ total: res.total, pages: res.pages, stats: res.stats ?? EMPTY_META.stats });
      })
      .catch((e) => {
        setVisits([]);
        setMeta(EMPTY_META);
        if (e.status === 403) setDenied(true);
        else setToast(e.message);
      });
  }, []);

  const loadDefs = useCallback(async () => {
    try {
      const [surgeons, hospitals, techs, procedures, diagnoses, topics] = await Promise.all([
        api('/surgeons'),
        api('/hospitals'),
        api('/techs'),
        api('/procedure-types'),
        api('/diagnoses'),
        api('/visit-topics'),
      ]);
      setDefs({ surgeons, hospitals, techs, procedures, diagnoses, topics });
    } catch {
      /* دسترسی نداشته باشد، denied از load اصلی می‌آید */
    }
  }, []);

  /* دیپ‌لینکِ ?patient=<visitId> — تقویم و نوتیف به همین‌جا لینک می‌دهند.
     ⚠️ تا امروز این پارامتر **هیچ‌جا خوانده نمی‌شد**: لینکِ «بازکردن در
     داشبورد»ِ تقویم صفحه را باز می‌کرد و هیچ اتفاقی نمی‌افتاد — دری که به
     دیوار باز می‌شد. حالا شیتِ ویرایشِ همان مراجعه باز می‌شود؛ پایهٔ
     مرحلهٔ ۵ نوبت‌دهی (کلیک روی نوبت ← فرمِ ویزیت) هم همین است. */
  const deepRef = useRef(false);
  useEffect(() => {
    if (deepRef.current) return;
    deepRef.current = true;
    const vid = Number(new URLSearchParams(window.location.search).get('patient'));
    if (!vid) return;
    api(`/visits/${vid}`)
      .then((v) => { if (v?.id) setModal({ visit: v }); })
      .catch(() => { /* مراجعهٔ حذف‌شده یا بی‌دسترسی — صفحه عادی می‌ماند */ });
  }, []);

  // بارِ اول + سرچِ زنده (debounce) + فیلترِ وضعیت.
  // ⚠️ user.id هم جزو وابستگی‌هاست: بعد از سوییچِ حساب، دسترسی/داده با حسابِ جدید
  // دوباره از سرور خوانده می‌شود (باگِ واقعی: دادهٔ حسابِ قبلی تا رفرش می‌ماند)
  useEffect(() => {
    setDenied(false);
    const t = setTimeout(() => load(q, status, kind, adv, sort, dir, page, pageSize), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, status, kind, adv, sort, dir, page, pageSize, load, user?.id]);

  // هر تغییرِ فیلتر کاربر را به صفحهٔ یک برمی‌گرداند؛ وگرنه در صفحهٔ ۴ فیلتری
  // می‌زند که سه صفحه بیشتر ندارد و فهرستِ خالی می‌بیند.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    setPage(1);
  }, [q, status, kind, adv, sort, dir, pageSize]);

  useEffect(() => { loadDefs(); }, [loadDefs, user?.id]);

  /* نوع‌های مراجعه — برای برچسبِ فیلتر. کارتِ مراجعه به این نیازی ندارد
     (`kindTitle`/`kindColor` را سرور در خودِ ردیف می‌فرستد)؛ این فقط برای
     نوع‌هایی است که در `stats.kinds` کلید خام‌اند. */
  const [visitKinds, setVisitKinds] = useState([]);
  useEffect(() => {
    api('/forms/visit-kinds')
      .then((r) => setVisitKinds(Array.isArray(r) ? r : []))
      .catch(() => setVisitKinds([]));
  }, [user?.id]);
  const kindTitles = useMemo(
    () => Object.fromEntries(visitKinds.map((k) => [k.kind, k.title])),
    [visitKinds],
  );

  // سوییچِ حساب وسطِ فرم/شیتِ باز → بسته شود
  useEffect(() => { setModal(null); }, [user?.id]);

  // آمار از سرور می‌آید و کلِ نتیجهٔ فیلترشده را می‌شمارد، نه صفحهٔ جاری را.
  const stats = meta.stats;

  /** نامِ خواندنیِ هر فیلترِ فعال — از همان تعریف‌هایی که در فرم انتخاب شدند. */
  const activeChips = useMemo(() => {
    const nameOf = (list, id, get) => get(list.find((r) => String(r.id) === String(id))) || `#${id}`;
    const out = [];
    if (adv.surgeonId) out.push({ key: 'surgeonId', label: `جراح: ${nameOf(defs.surgeons, adv.surgeonId, (r) => r?.name)}` });
    if (adv.hospitalId) out.push({ key: 'hospitalId', label: `بیمارستان: ${nameOf(defs.hospitals, adv.hospitalId, (r) => r?.name)}` });
    if (adv.techId) out.push({ key: 'techId', label: `کارشناس: ${nameOf(defs.techs, adv.techId, (r) => r?.name)}` });
    if (adv.procedureTypeId) out.push({ key: 'procedureTypeId', label: `نوعِ عمل: ${nameOf(defs.procedures, adv.procedureTypeId, (r) => r?.name)}` });
    if (adv.diagnosisId) out.push({ key: 'diagnosisId', label: `تشخیص: ${nameOf(defs.diagnoses, adv.diagnosisId, (r) => r?.title)}` });
    if (adv.fromJ) out.push({ key: 'fromJ', label: `از ${faDigits(adv.fromJ)}` });
    if (adv.toJ) out.push({ key: 'toJ', label: `تا ${faDigits(adv.toJ)}` });
    if (adv.owing) out.push({ key: 'owing', label: 'فقط بدهکار' });
    return out;
  }, [adv, defs]);
  const advCount = activeChips.length;
  const clearOne = (key) => setAdv((a) => ({ ...a, [key]: key === 'owing' ? false : '' }));

  /**
   * خروجی — ردیف‌ها از سرور و با همین فیلتر خوانده می‌شوند، نه از صفحهٔ جاری.
   *
   * با صفحه‌بندی، `visits` فقط یک صفحه است؛ خروجی گرفتن از آن یعنی کاربر فایلی
   * می‌گیرد که فکر می‌کند کلِ نتیجه است و نیست.
   */
  const [exporting, setExporting] = useState('');
  const runExport = async (mode) => {
    if (exporting) return;
    setExporting(mode);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (status !== 'all') params.set('status', status);
      if (kind !== 'all') params.set('kind', kind);
      for (const key of ADV_IDS) if (adv[key]) params.set(key, adv[key]);
      const from = adv.fromJ ? jStrToIso(adv.fromJ) : null;
      const to = adv.toJ ? jStrToIso(adv.toJ) : null;
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (adv.owing) params.set('owing', '1');
      params.set('sort', sort); params.set('dir', dir);

      const res = await api(`/visits/export?${params}`);
      if (!res.rows.length) { setToast('برای این فیلتر موردی نیست'); return; }

      const opts = {
        rows: res.rows,
        stats: res.stats,
        truncated: res.truncated,
        limit: res.limit,
        filterLabel: [
          q.trim() && `جستجو: ${q.trim()}`,
          status !== 'all' && `وضعیت: ${FILTERS.find((f) => f.v === status)?.l}`,
          kind !== 'all' && `نوع: ${kindTitles[kind] || kindOf(kind).label}`,
          ...activeChips.map((c) => c.label),
        ].filter(Boolean).join(' · '),
        kindLabel: (v) => v.kindTitle || kindOf(v.kind).label,
        statusLabel,
        brandName,
        title: `فهرستِ ${t.visits}`,
      };

      if (mode === 'csv') {
        const name = downloadCsv(visitsToCsv(res.rows, opts));
        setToast(res.truncated
          ? `${faNum(res.rows.length)} ردیف در «${name}» — نتیجه از سقفِ ${faNum(res.limit)} بیشتر بود`
          : `${faNum(res.rows.length)} ردیف در «${name}» ذخیره شد ✓`);
      } else if (!printVisits(res.rows, opts)) {
        setToast('پنجرهٔ چاپ مسدود شد — اجازهٔ پاپ‌آپ را برای این سایت بدهید');
      }
    } catch (e) { setToast(e.message); } finally { setExporting(''); }
  };
  const kindsPresent = stats.kinds ?? [];
  const showKindFilter = kind !== 'all' || kindsPresent.length > 1;

  /**
   * «از همان ثبت، پیشنهادِ نوبت»: اگر ویزیتِ ذخیره‌شده «ویزیتِ بعدیِ»
   * امروز-به-بعد دارد، وضعیتِ آن روز از سرور پرسیده و پنجرهٔ پیشنهاد باز
   * می‌شود. ساکت می‌ماند وقتی: برنامهٔ کاری اصلاً تعریف نشده (fail-soft)،
   * فیچرِ تقویم خاموش است (۴۰۳)، یا خطای شبکه — پیشنهاد نباید ذخیره را خراب کند.
   */
  const maybeOfferBooking = async (saved) => {
    if (!saved?.nextVisitDate || !saved?.patientId) return;
    const day = String(saved.nextVisitDate).slice(0, 10);
    if (day < new Date().toISOString().slice(0, 10)) return;
    try {
      const sug = await api(
        `/appointments/suggest?patientId=${saved.patientId}&date=${day}${saved.topicId ? `&topicId=${saved.topicId}` : ''}`,
      );
      if (!sug.scheduled && !sug.existing) return;
      setNvBook({ visit: saved, sug, day });
    } catch {
      /* پیشنهاد اختیاری است — بی‌صدا رد می‌شویم. */
    }
  };

  const onSaved = (saved, wasEdit, opts) => {
    setModal(null);
    load(qRef.current, status, kind);
    maybeOfferBooking(saved);
    /* «کاندیدای جراحی» یعنی همین‌جا کار تمام نشده: فرمِ عملِ همان بیمار
       بلافاصله باز می‌شود تا نوبت و اطلاعاتِ عمل در همان نشست ثبت شود —
       نه اینکه کاربر خودش دنبالِ دکمهٔ «مراجعهٔ تازه» بگردد. */
    if (opts?.openSurgery) {
      setToast('تصمیم ثبت شد ✓ حالا فرمِ عمل را برای همین بیمار پر کنید');
      setTimeout(() => setModal({ prefill: { patientId: saved.patientId, patientName: saved.patientName, kind: 'surgery' } }), 400);
      return;
    }
    if (wasEdit) { setToast(`${t.visit} ویرایش شد ✓`); return; }

    // کاربر باید بفهمد مراجعه در کدام پرونده و با چه شماره‌ای نشست — به‌ویژه وقتی
    // کد ملی به پروندهٔ موجود خورده و پروندهٔ تکراری ساخته نشده است.
    const seq = faNum(saved.code.split('-V')[1] || '1');
    const where = `${t.record} ${saved.patientCode} — ${t.visit} ${seq}`;
    setToast({
      new: `${t.record}ِ جدید ساخته شد ✓ ${where}`,
      matched: `بیمار از قبل ${t.record} داشت؛ ${t.visit}ِ تازه ثبت شد ✓ ${where}`,
      restored: `${t.record}ِ حذف‌شده برگشت و ${t.visit}ِ تازه ثبت شد ✓ ${where}`,
      existing: `${t.visit} ثبت شد ✓ ${where}`,
    }[saved.patientStatus] ?? `${t.visit} ${saved.code} ثبت شد ✓`);
  };

  const onStatus = async (v, st) => {
    setBusyId(v.id);
    try {
      const fresh = await api(`/visits/${v.id}/status`, { method: 'PATCH', body: { opStatus: st } });
      setVisits((rows) => rows.map((r) => (r.id === v.id ? fresh : r)));
    } catch (e) {
      setToast(e.message);
    } finally {
      setBusyId(0);
    }
  };

  const onDelete = async (v) => {
    setBusyId(v.id);
    try {
      await api(`/visits/${v.id}`, { method: 'DELETE' });
      setVisits((rows) => rows.filter((r) => r.id !== v.id));
      setToast('مراجعه حذف شد');
    } catch (e) {
      setToast(e.message);
    } finally {
      setBusyId(0);
    }
  };

  return (
    <div className="lx">
      <div className="lx-bg" aria-hidden="true" />
      <div className="lx-grid" aria-hidden="true" />
      <div className="lx-shell us-shell db-shell">
        <header className="us-head">
          <Link to="/app" className="lx-back" aria-label="بازگشت به صفحهٔ امروز"><Back width="15" height="15" /> سامانه</Link>
          <h1>داشبورد مدیریت</h1>
        </header>

        {!denied && (<>
        <div className="db-stats">
          <div className="glass db-stat"><b>{faNum(stats.total)}</b><span>{t.visit}</span></div>
          {/* برچسب‌ها کلی‌اند چون فهرست می‌تواند عمل و ویزیت و پیگیری را با هم داشته باشد؛
              وقتی روی یک نوع فیلتر شده، همان نوع را می‌گویند. */}
          <div className="glass db-stat"><b>{faNum(stats.pending)}</b><span>در انتظار</span></div>
          {stats.due > 0 && <div className="glass db-stat db-stat-due"><b>{faNum(stats.due)}</b><span>ماندهٔ کل</span></div>}
          <div className="glass db-stat db-stat-today"><b>{faNum(stats.today)}</b><span>{kind === 'all' ? 'امروز' : `${kindTitles[kind] || kindOf(kind).label}ِ امروز`}</span></div>
        </div>

        <div className="db-toolbar">
          <div className="db-search">
            <Search width="16" height="16" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t.searchHint}
              aria-label="جستجو"
            />
          </div>
          <button
            type="button"
            className={`db-ico db-advbtn${advCount ? ' on' : ''}`}
            title="جستجوی پیشرفته"
            onClick={() => setAdvOpen(true)}
          >
            <Filter width="17" height="17" />
            {advCount > 0 && <i>{faNum(advCount)}</i>}
          </button>
          {/* پیش‌تر این دکمه یک شیتِ کوچکِ خودش داشت که فقط نام و فامیلِ جراح را
              می‌گرفت — نسخهٔ ناقصی از صفحهٔ «تعاریف پایه» که تخصص و شمارهٔ
              نظام‌پزشکی و تلفن هم دارد. نتیجه‌اش جراحانِ نصفه‌کاره بود. حالا
              مستقیم به همان صفحه می‌رود؛ افزودنِ سریعِ داخلِ فرم (دکمهٔ +) سرِ
              جایش است، چون آن یکی در جریانِ کار است نه مدیریتِ فهرست. */}
          <Link to="/app/definitions" className="db-ico db-defbtn" title="تعاریف پایه (جراحان، بیمارستان‌ها، انواعِ عمل…)">
            <Gear width="17" height="17" />
          </Link>
          <button type="button" className="db-add" onClick={() => setModal({})}>
            <Plus width="17" height="17" /> {t.visitNew}
          </button>
        </div>

        <Tabs
          variant="inset"
          className="db-filters"
          label="وضعیت"
          value={status}
          onChange={setStatus}
          items={FILTERS.map((fl) => ({ key: fl.v, label: fl.l }))}
        />

        {/* فیلترِ نوع فقط وقتی دیده می‌شود که واقعاً بیش از یک نوع در کار باشد؛
            برای شرکتی که فقط عمل ثبت می‌کند، یک ردیفِ اضافه فقط شلوغی است.
            ⚠️ وقتی فیلتر فعال است حتماً می‌ماند، وگرنه لیست به یک نوع محدود
            می‌شد، ردیف ناپدید می‌گشت و راهِ برگشتی نبود. */}
        {showKindFilter && (
          <Tabs
            variant="inset"
            className="db-filters db-kindfilter"
            label={`نوعِ ${t.visit}`}
            value={kind}
            onChange={setKind}
            items={kindFilters(kindsPresent, kindTitles).map((fl) => ({ key: fl.v, label: fl.l }))}
          />
        )}

        {/* چیپِ هر فیلترِ فعال با ضربدرِ خودش — کاربر باید بتواند یک فیلتر را
            بردارد بی‌آنکه پاپ‌آپ را باز کند یا همه را پاک کند. */}
        {activeChips.length > 0 && (
          <div className="db-chips">
            {activeChips.map((c) => (
              <button key={c.key} type="button" onClick={() => clearOne(c.key)}>
                {c.label}<Close width="12" height="12" />
              </button>
            ))}
            <button type="button" className="db-chip-clear" onClick={() => setAdv(EMPTY_ADV)}>پاک‌کردنِ همه</button>
          </div>
        )}

        <div className="db-sortbar">
          <label>
            <span>مرتب‌سازی</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORT_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </label>
          <button
            type="button"
            className="db-dir"
            title={dir === 'desc' ? 'نزولی' : 'صعودی'}
            onClick={() => setDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
          >
            {dir === 'desc' ? '↓' : '↑'}
          </button>
          <span className="db-count">
            {meta.total > 0
              ? `${faNum((page - 1) * pageSize + 1)}–${faNum(Math.min(page * pageSize, meta.total))} از ${faNum(meta.total)}`
              : ''}
          </span>
          <button
            type="button" className="db-ico db-expbtn" title="خروجیِ CSV"
            disabled={!!exporting || !meta.total} onClick={() => runExport('csv')}
          >
            {exporting === 'csv' ? '…' : <Download width="16" height="16" />}
          </button>
          <button
            type="button" className="db-ico db-expbtn" title="چاپ"
            disabled={!!exporting || !meta.total} onClick={() => runExport('print')}
          >
            {exporting === 'print' ? '…' : <Print width="16" height="16" />}
          </button>
          <label className="db-psize">
            <span>در صفحه</span>
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{faNum(n)}</option>)}
            </select>
          </label>
        </div>
        </>)}

        <div className="us-list">
          {!denied && visits === null && <div className="us-empty">در حال بارگذاری…</div>}
          {denied && <div className="us-empty">دسترسیِ کافی برای این بخش ندارید — مدیرِ سامانه باید سطحِ شما را ارتقا دهد.</div>}
          {!denied && visits?.length === 0 && (
            <div className="us-empty">{q || status !== 'all' ? 'موردی مطابقِ جستجو پیدا نشد' : t.emptyList}</div>
          )}
          {visits?.map((v, i) => (
            <VisitCard
              key={v.id}
              v={v}
              index={i}
              busy={busyId === v.id}
              onEdit={(vv) => setModal({ visit: vv })}
              onStatus={onStatus}
              onDelete={onDelete}
              onBilling={setBilling}
              onToast={setToast}
            />
          ))}
        </div>

        {!denied && meta.pages > 1 && (
          <div className="db-pager">
            <button type="button" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>قبلی</button>
            <span>صفحهٔ {faNum(page)} از {faNum(meta.pages)}</span>
            <button type="button" disabled={page >= meta.pages} onClick={() => setPage((n) => n + 1)}>بعدی</button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {advOpen && (
          <AdvancedSearch
            value={adv}
            defs={defs}
            onApply={(next) => { setAdv(next); setAdvOpen(false); }}
            onClose={() => setAdvOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {modal && (
          <VisitForm
            initial={modal.visit}
            prefill={modal.prefill}
            defs={defs}
            onDefsChanged={loadDefs}
            onClose={() => setModal(null)}
            onSaved={onSaved}
            onToast={setToast}
          />
        )}
      </AnimatePresence>


      <AnimatePresence>
        {billing && (
          <BillingSheet
            visit={billing}
            onClose={() => setBilling(null)}
            onChanged={() => load(qRef.current, status, kind)}
            onToast={setToast}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {nvBook && (
          <NextVisitBook
            data={nvBook}
            onClose={() => setNvBook(null)}
            onToast={setToast}
          />
        )}
      </AnimatePresence>

      <div className={`lx-toast${toast ? ' on' : ''}`}>{toast}</div>
    </div>
  );
}
