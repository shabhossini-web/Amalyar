import AssistedTextarea from '../ui/AssistedTextarea.jsx';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { api, apiStream, apiUpload } from '../lib/api.js';
import { DocThumb, openDoc } from '../ui/DocThumb.jsx';
import { ThingPopups, useThings, workTarget } from './thing-popups.jsx';
import { KINDS, kindOf } from './visit-kinds.js';
import { faDate, isoToJStr, jStrToIso } from '../lib/jalali.js';
import { fmtMoney } from '../lib/money.js';
import { toEnDigits } from '../lib/identity.js';
import './launcher.css';
import './definitions.css';
import JDate from './JDate.jsx';
import './work.css';
import './record.css';
import {
  Alert, Back, Book, Calendar, Check, Clock, Close, Copy, Doctor, Download, Form, LinkIcon, Lock,
  Money, Pencil, Phone, Plus, Send, Trash,
} from '../ui/icons.jsx';
import Tabs from '../ui/Tabs.jsx';
import { useConfig, useStatusList } from './config.jsx';
import WorkRow from './WorkRow.jsx';
import { WORK_CHANGED } from './WorkBell.jsx';
import Overlay from '../ui/Overlay.jsx';
import VoiceInput from '../ui/VoiceInput.jsx';
import FileDrop from '../ui/FileDrop.jsx';


const CATEGORIES = {
  lab: 'آزمایش', imaging: 'تصویربرداری', report: 'گزارش',
  consent: 'رضایت‌نامه', identity: 'مدرکِ شناسایی', receipt: 'فیشِ پرداخت', other: 'متفرقه',
};
/** مرحلهٔ مدرک نسبت به عمل — همان سه تبِ فرمِ عمل، عمداً با همان واژه‌ها. */
const PHASES = { pre: 'قبل از عمل', intra: 'حین عمل', post: 'بعد از عمل' };
/* ⚠️ نگاشتِ نوعِ سند و وضعیتِ مراجعه از **سرور** می‌آید (`/config.statuses` و
   `kindFa`/`opStatusFa` روی خودِ ردیف). نسخهٔ کلاینتیِ قبلی سه کپی داشت و
   یکی‌شان (`VisitForm`) `discharge` را نداشت، پس خلاصهٔ ترخیص با کلیدِ خام
   چاپ می‌شد. قانون در `server/src/patients/labels.ts`. */
const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
/** برچسبِ نوعِ ملاقات — همان فهرستِ داشبورد؛ پرونده باید ویزیت و عمل را از هم جدا نشان دهد. */
/**
 * برچسبِ **پشتیبان** — نه فهرستِ نوع‌ها.
 *
 * ⚠️ نوع‌ها را سوپرادمین در فرم‌ساز می‌سازد؛ این‌جا فقط برای مراجعاتی مانده
 * که نوعشان دیگر فرمی ندارد (فرمش حذف شده) یا پیش از رسیدنِ تعریف. نوعِ
 * ناشناخته با **کلیدِ خودش** نشان داده می‌شود نه با «عمل»: برچسبِ حدسی
 * دروغ می‌گوید.
 */
/**
 * ⚠️ نوعِ **شناخته‌شده** با نامِ خودش می‌آید (عمل جراحی / ویزیت / پیگیری /
 * مشاوره)، نه با عنوانِ فرمش: مالک دید همهٔ مراجعه‌ها «فرمِ جراحی» و نوارِ مرحله
 * برای عمل هم «ویزیت» نوشته‌اند — عمل جراحی اسمش عمل جراحی است. عنوانِ فرم فقط
 * برای نوعِ سفارشی‌ای که در `KINDS` نیست، و روی برچسب به‌صورتِ tooltip می‌ماند.
 */
const kindLabel = (k, defs) => (KINDS[k] ? kindOf(k).label : (defs?.[k] ?? k ?? '—'));

/** مقصدِ یک ردیفِ خطِ زمان — پاپ‌آپِ **خودش**، نه فرمِ کلی (بازخوردِ مالک). */
const tlTarget = (it) => {
  if (it.type === 'visit' && it.refId) return { type: 'visit', id: it.refId };
  if (it.type === 'order') {
    const m = /^(\w+)Order$/.exec(it.refType ?? '');
    if (m && it.refId) return { type: 'order', kind: m[1], id: it.refId };
  }
  if (it.type === 'reminder' && it.refId) return { type: 'reminder', id: it.refId, item: it };
  if (it.type === 'appointment' && it.refId) return { type: 'appointment', id: it.refId, item: it };
  if (it.visitId) return { type: 'visit', id: it.visitId };
  return null;
};

const faNum = (v) => String(v ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const fmtSize = (b) => (b < 1024 ? `${faNum(b)} بایت`
  : b < 1024 * 1024 ? `${faNum((b / 1024).toFixed(0))} کیلوبایت`
  : `${faNum((b / 1024 / 1024).toFixed(1))} مگابایت`);

/* ══════════════ تبِ خلاصه/پروفایل ══════════════ */
function ProfileTab({ rec, onSave, toast }) {
  const [f, setF] = useState(() => ({
    firstName: rec.firstName || '', lastName: rec.lastName || '',
    phone: rec.phone || '', birthDateJ: rec.birthDate ? isoToJStr(rec.birthDate) : '',
    gender: rec.gender || '', city: rec.city || '',
    address: rec.address || '', bloodType: rec.bloodType || '',
    allergies: rec.allergies || '', chronicConditions: rec.chronicConditions || '',
    medications: rec.medications || '', insurer: rec.insurer || '',
    insuranceNo: rec.insuranceNo || '', supplementalInsurer: rec.supplementalInsurer || '',
    emergencyName: rec.emergencyName || '', emergencyPhone: rec.emergencyPhone || '',
    emergencyRelation: rec.emergencyRelation || '', notes: rec.notes || '',
  }));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const save = async () => {
    let birthDate = null;
    if (f.birthDateJ.trim()) {
      birthDate = jStrToIso(f.birthDateJ);
      if (!birthDate) { toast('تاریخِ تولد نامعتبر است (مثال: ۱۳۷۰/۰۱/۱۵)', true); return; }
    }
    setBusy(true);
    try {
      const body = { ...f, phone: toEnDigits(f.phone).trim(), birthDate };
      delete body.birthDateJ;
      // فیلدهای بالینی فقط وقتی فرستاده می‌شوند که کاربر اجازهٔ دیدنشان را دارد؛
      // وگرنه سرور با ۴۰۳ رد می‌کند و کاربر پیامِ بی‌ربط می‌گیرد.
      if (!rec.clinicalVisible) {
        for (const k of ['address', 'bloodType', 'allergies', 'chronicConditions', 'medications',
          'insurer', 'insuranceNo', 'supplementalInsurer',
          'emergencyName', 'emergencyPhone', 'emergencyRelation', 'notes']) delete body[k];
      }
      await onSave(body);
      toast('پرونده به‌روز شد ✓');
    } catch (e) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rc-form">
      <h3 className="rc-h3">اطلاعاتِ هویتی</h3>
      <div className="pf-row2">
        <label className="pf-field"><span>نام</span><input value={f.firstName} onChange={set('firstName')} /></label>
        <label className="pf-field"><span>نام خانوادگی</span><input value={f.lastName} onChange={set('lastName')} /></label>
        <label className="pf-field"><span>موبایل</span><input dir="ltr" inputMode="numeric" value={f.phone} onChange={set('phone')} /></label>
        <JDate className="pf-field" label="تاریخِ تولد (شمسی)" mode="birth" value={f.birthDateJ}
          onChange={(v) => setF((s2) => ({ ...s2, birthDateJ: v }))} placeholder="۱۳۷۰/۰۱/۱۵" />
        <label className="pf-field"><span>جنسیت</span>
          <select value={f.gender} onChange={set('gender')}>
            <option value="">—</option><option value="female">زن</option><option value="male">مرد</option>
          </select>
        </label>
        <label className="pf-field"><span>شهر</span><input value={f.city} onChange={set('city')} /></label>
      </div>
      <label className="pf-field"><span>کد ملی</span>
        <input dir="ltr" value={faNum(rec.nationalId) || '—'} readOnly />
        <i className="pf-hint">کد ملی کلیدِ پرونده است؛ تغییرش یعنی ادغام یا جداسازیِ پرونده و از این فرم انجام نمی‌شود.</i>
      </label>

      {rec.clinicalVisible ? (
        <>
          <h3 className="rc-h3">اطلاعاتِ بالینی</h3>
          <div className="pf-row2">
            <label className="pf-field"><span>گروهِ خونی</span>
              <select value={f.bloodType} onChange={set('bloodType')}>
                <option value="">—</option>
                {BLOOD_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
            <label className="pf-field"><span>نشانی</span><input value={f.address} onChange={set('address')} /></label>
          </div>
          <label className="pf-field"><span>حساسیت‌ها</span><AssistedTextarea disabled={busy} rows={2} value={f.allergies} onChange={set('allergies')} placeholder="دارو، غذا، ماده بی‌هوشی…" /></label>
          <label className="pf-field"><span>بیماری‌های زمینه‌ای</span><AssistedTextarea disabled={busy} rows={2} value={f.chronicConditions} onChange={set('chronicConditions')} /></label>
          <label className="pf-field"><span>داروهای مصرفی</span><AssistedTextarea disabled={busy} rows={2} value={f.medications} onChange={set('medications')} /></label>

          <h3 className="rc-h3">بیمه</h3>
          <div className="pf-row2">
            <label className="pf-field"><span>بیمهٔ پایه</span><input value={f.insurer} onChange={set('insurer')} /></label>
            <label className="pf-field"><span>شمارهٔ بیمه</span><input dir="ltr" value={f.insuranceNo} onChange={set('insuranceNo')} /></label>
          </div>
          <label className="pf-field"><span>بیمهٔ تکمیلی</span><input value={f.supplementalInsurer} onChange={set('supplementalInsurer')} /></label>

          <h3 className="rc-h3">تماسِ اضطراری</h3>
          <div className="pf-row2">
            <label className="pf-field"><span>نام</span><input value={f.emergencyName} onChange={set('emergencyName')} /></label>
            <label className="pf-field"><span>شماره</span><input dir="ltr" inputMode="numeric" value={f.emergencyPhone} onChange={set('emergencyPhone')} /></label>
          </div>
          <label className="pf-field"><span>نسبت</span><input value={f.emergencyRelation} onChange={set('emergencyRelation')} placeholder="همسر، فرزند، …" /></label>
          <label className="pf-field"><span>یادداشت</span><AssistedTextarea disabled={busy} rows={2} value={f.notes} onChange={set('notes')} /></label>
        </>
      ) : (
        <div className="rc-locked"><Lock width="15" height="15" /> اطلاعاتِ بالینی این پرونده در سطحِ دسترسیِ شما نیست.</div>
      )}

      <button className="df-save rc-save" onClick={save} disabled={busy}>
        {busy ? 'در حال ذخیره…' : 'ذخیرهٔ پرونده'}
      </button>
    </div>
  );
}

/* ══════════════ تبِ مراجعات ══════════════ */
/**
 * فرم‌هایی که به پرونده چسبیده‌اند — نظرسنجی، جوابِ آزمایش، شرحِ حال.
 *
 * ⚠️ برچسبِ هر پاسخ از **سرور** می‌آید، جوش‌خورده به مقدارش. این‌جا هیچ
 * zipکردنی نیست: اگر کلاینت تعریفِ فرم را جدا می‌گرفت، روزی که فیلدی حذف شود
 * پاسخِ یتیم زیرِ برچسبِ فیلدِ بعدی می‌نشست — و هیچ‌کس نمی‌فهمید.
 */
/** مقدارِ پاسخ به متنِ خواندنی — ارقام فارسی، بولی به بله/خیر. */
function answerText(v) {
  if (typeof v === 'boolean') return v ? 'بله' : 'خیر';
  return faNum(String(v ?? ''));
}

/**
 * پاسخِ یک فیلد — W0.4/D03b.
 *
 * ⚠️ این‌جا قبلاً `faNum(v.join('، '))` بود و روی آرایهٔ `{id,name}`ِ عکس یا
 * `{url,title}`ِ لینک «[object Object]» می‌داد. حالا سرور خودش هم متنِ خوانا
 * می‌دهد هم `items`ِ بازشدنی (همان `answerParts`).
 *
 * ⚠️ لینکِ بیرونی `rel="noopener noreferrer"` می‌گیرد و مدرک با `openDoc`
 * باز می‌شود، نه با نشانیِ مستقیم: فایلِ پزشکی پشتِ گاردهای پرونده می‌ماند.
 * اگر سرور `items` نداد (نسخهٔ قدیمی)، همان متن نشان داده می‌شود.
 */
function AnswerValue({ answer, onErr }) {
  const items = answer.items ?? [];
  if (!items.length) return <>{answerText(answer.value)}</>;
  return (
    <span className="rc-ans-items">
      {items.map((it, i) => (
        <Fragment key={`${it.kind}-${it.url ?? it.docId}-${i}`}>
          {i > 0 && '، '}
          {it.kind === 'link' ? (
            <a href={it.url} target="_blank" rel="noopener noreferrer" dir="ltr">{it.title}</a>
          ) : (
            <button type="button" className="rc-ans-doc" onClick={() => openDoc({ id: it.docId }, onErr)}>
              {it.title}
            </button>
          )}
        </Fragment>
      ))}
    </span>
  );
}

function FormsTab({ rec, onErr }) {
  const rows = rec.attachedForms ?? [];
  if (!rows.length) return <div className="df-empty">فرمی به این پرونده نچسبیده است</div>;
  return (
    <div className="df-list">
      {rows.map((f) => (
        <div key={f.id} className="df-row rc-form">
          <div className="rc-form-head">
            <b>{f.formTitle}</b>
            <i className="rc-kind" style={f.formColor ? { '--k': `var(--kind-${f.formColor})` } : undefined}>
              زیرپرونده
            </i>
            {f.submittedAt && <span className="rc-form-when">{faDate(f.submittedAt)}</span>}
          </div>
          {/* ⚠️ «قفل» با «خالی» یکی نیست و کاربر باید تفاوتشان را ببیند:
              یکی یعنی اجازه نداری، دیگری یعنی چیزی نیست. */}
          {f.locked ? (
            <p className="rc-form-lock">محتوای این فرم بالینی است و در سطحِ دسترسیِ شما دیده نمی‌شود.</p>
          ) : f.answers.length === 0 ? (
            <p className="rc-form-lock">این فرم بدونِ پاسخ ثبت شده است.</p>
          ) : (
            <dl className="rc-form-ans">
              {f.answers.map((a) => (
                <Fragment key={a.key}>
                  <dt>{a.label}</dt>
                  {/* ⚠️ `faNum` روی همهٔ مقادیر، نه فقط عددها: امتیازِ «۵» و
                      تاریخِ داخلِ متن باید مثلِ بقیهٔ صفحه فارسی دیده شوند.
                      در اسکرین‌شات دیدمش — «۲۰ مرداد ۱۴۰۵» فارسی بود و
                      امتیاز کنارش `5`. `bool` هم عدد نیست ولی «بله/خیر»
                      خواناتر از `true` است. */}
                  <dd><AnswerValue answer={a} onErr={onErr} /></dd>
                </Fragment>
              ))}
            </dl>
          )}
        </div>
      ))}
    </div>
  );
}

function VisitsTab({ rec, onErr, onOpen }) {
  if (!rec.visits.length) return <div className="df-empty">هنوز مراجعه‌ای ثبت نشده است</div>;
  return (
    <div className="df-list">
      {rec.visits.map((v) => (
        <div key={v.id} className="df-row">
          <div className="df-row-main">
            {/* سرآیندِ کارت دکمه است: مراجعه در **همین صفحه** پاپ‌آپ می‌شود، نه با
                پرش به داشبورد (بازخوردِ مالک: «تو پرونده رو مراجعه‌ها بزنیم پاپ‌آپ باز شه»). */}
            <button type="button" className="rc-visit-btn" onClick={() => onOpen({ type: 'visit', id: v.id })} title="بازکردنِ فرمِ این مراجعه">
              <b>
                <span dir="ltr">{v.code}</span>
                <i className="rc-kind" style={v.kindColor ? { '--k': `var(--kind-${v.kindColor})` } : undefined} title={v.kindTitle || undefined}>
                  {kindLabel(v.kind, rec.kindTitles)}
                </i>
                {v.procedureTypeName ? ` — ${v.procedureTypeName}` : ''}
              </b>
            </button>
            <small>
              {[v.surgeonName && `جراح: ${v.surgeonName}`, v.hospitalName, v.techName && `کارشناس: ${v.techName}`,
                v.opDate && faDate(v.opDate)].filter(Boolean).join(' · ') || '—'}
            </small>
            {v.diagnosisTitle && <small>تشخیص: {v.diagnosisTitle}</small>}
            {/* ⚠️ **پاسخ‌های فرمِ مراجعه.** پزشک «شکایتِ اصلی» و «شرحِ معاینه»
                را در فرمِ ویزیت می‌نویسد؛ تا دیروز پرونده هیچ اثری از آن‌ها
                نداشت و همه‌شان فقط داخلِ فرمِ خودِ مراجعه می‌ماندند. چیزی که
                نوشته شده ولی در پرونده خوانده نمی‌شود، عملاً نوشته نشده.
                برچسب و ترتیب از سرور می‌آید (قانون ۱۵)، نه از حدسِ کلاینت. */}
            {(v.answers ?? []).length > 0 && (
              <dl className="rc-answers">
                {v.answers.map((a) => (
                  <div key={a.key}>
                    <dt>{a.label}</dt>
                    <dd><AnswerValue answer={a} onErr={onErr} /></dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          <span className={`rc-st rc-st-${v.opStatus}`}>{v.opStatusFa ?? v.opStatus}</span>
        </div>
      ))}
    </div>
  );
}

/* ══════════════ تبِ مسیرِ درمان ══════════════ */

/**
 * مسیرِ درمان — **خوانده‌شده از توالیِ مراجعات، نه ساخته‌شده.**
 *
 * ⚠️ هیچ ترتیبی این‌جا تعریف نمی‌شود و هیچ مراجعه‌ای به مراجعهٔ دیگر گره
 * نمی‌خورد. دلیلش این است که مسیرِ واقعی جایگشتِ زیادی دارد — «ویزیت →
 * درمان → پیگیری»، «ویزیت → جراحی → ادامهٔ درمان → پیگیری»، مطبِ داخلی
 * بدونِ جراحی — و هر ساختارِ ثابتی دستِ‌کم یکی را غلط می‌کند. گره‌زدنِ دستی
 * هم یعنی کاربری که فراموش کند، مسیرش تکه‌تکه می‌شود.
 *
 * پس مسیر همان چیزی است که واقعاً اتفاق افتاده، به ترتیبِ تاریخ.
 */
function JourneyTab({ rec }) {
  const rows = rec.journey ?? [];
  if (!rows.length) return <div className="df-empty">هنوز مراجعه‌ای ثبت نشده است</div>;
  return (
    <div className="rc-journey">
      <p className="rc-jhint">
        این مسیر از خودِ مراجعات خوانده می‌شود — جایی تعریف نشده و لازم نیست
        چیزی را به هم گره بزنید.
      </p>
      {rows.map((r, i) => (
        <div key={r.id} className={`rc-jstep st-${r.opStatus}`}>
          <div className="rc-jline" aria-hidden="true">
            <i className="rc-jdot" />
            {i < rows.length - 1 && <i className="rc-jbar" />}
          </div>
          <div className="rc-jmain">
            <b>
              <span className="rc-kind" style={r.kindColor ? { '--k': `var(--kind-${r.kindColor})` } : undefined}>
                {r.kindTitle || kindLabel(r.kind, rec.kindTitles)}
              </span>
              {r.title ? ` — ${r.title}` : ''}
            </b>
            <small>
              <span dir="ltr">{r.code}</span>
              {r.opDate ? ` · ${faDate(r.opDate)}` : ' · بدونِ تاریخ'}
              {/* فاصله از مراجعهٔ قبلی — «۳۲ روز بعد» چیزی است که پزشک می‌خواهد بداند. */}
              {r.daysFromPrev != null && ` · ${faNum(r.daysFromPrev)} روز بعد`}
            </small>
          </div>
          <span className={`rc-st rc-st-${r.opStatus}`}>{r.opStatusFa ?? r.opStatus}</span>
        </div>
      ))}
    </div>
  );
}

/* ══════════════ تبِ مدارک ══════════════ */
function DocsTab({ rec, reload, toast }) {
  const [cat, setCat] = useState('other');
  const [title, setTitle] = useState('');
  const [visitId, setVisitId] = useState('');
  /* مرحله فقط وقتی معنی دارد که مراجعه انتخاب شده باشد — «قبل از کدام عمل؟»
     برای مدرکی که به کلِ پرونده چسبیده جواب ندارد. سرور هم همین را رد می‌کند. */
  const [phase, setPhase] = useState('');
  const [takenJ, setTakenJ] = useState('');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);
  const [filter, setFilter] = useState('all');
  const [phaseFilter, setPhaseFilter] = useState('all');

  /* ⚠️ فقط «چه چیزی فرستاده شود» این‌جاست؛ صف، پیش‌نمایش، خطای تک‌فایل و
     تلاشِ دوباره کارِ `FileDrop`ِ مشترک است. خطا **پرتاب** می‌شود تا همان
     فایل در فهرست قرمز شود، نه اینکه toast بیاید و معلوم نباشد کدام. */
  const upload = async (file) => {
    if (!file) return;
    let takenAt;
    if (takenJ.trim()) {
      takenAt = jStrToIso(takenJ);
      if (!takenAt) throw new Error('تاریخِ مدرک نامعتبر است (مثال: ۱۴۰۵/۰۴/۲۸)');
    }
    const fd = new FormData();
    fd.append('file', file);
    fd.append('category', cat);
    if (title.trim()) fd.append('title', title.trim());
    if (visitId) fd.append('visitId', visitId);
    if (visitId && phase) fd.append('phase', phase);
    if (takenAt) fd.append('takenAt', takenAt);
    await apiUpload(`/patients/${rec.id}/documents`, fd);
  };

  /* مدرکِ لینکی — MRI/پاراکلینیکی که روی پکس/درایو/سایتِ آزمایشگاه است و
     فایلش را کسی ندارد؛ دسته/عنوان/تاریخ از همان فیلدهای بالا می‌آید. */
  const [linkUrl, setLinkUrl] = useState('');
  /* ورودِ پورتالِ لینک (پکس/آزمایشگاه) — پشتِ یک قفل، چون بیشترِ لینک‌ها لازمش ندارند. */
  const [linkAuth, setLinkAuth] = useState(false);
  const [linkUser, setLinkUser] = useState('');
  const [linkPass, setLinkPass] = useState('');
  const addLink = async () => {
    const url = linkUrl.trim();
    if (!url) return;
    let takenAt;
    if (takenJ.trim()) {
      takenAt = jStrToIso(takenJ);
      if (!takenAt) { toast('تاریخِ مدرک نامعتبر است (مثال: ۱۴۰۵/۰۴/۲۸)', true); return; }
    }
    setBusy(true);
    try {
      await api(`/patients/${rec.id}/documents/link`, {
        method: 'POST',
        body: {
          url,
          category: cat,
          ...(title.trim() ? { title: title.trim() } : {}),
          ...(visitId ? { visitId: Number(visitId) } : {}),
          ...(visitId && phase ? { phase } : {}),
          ...(takenAt ? { takenAt } : {}),
          ...(linkAuth && linkUser.trim() ? { user: linkUser.trim() } : {}),
          ...(linkAuth && linkPass.trim() ? { pass: linkPass.trim() } : {}),
        },
      });
      setLinkUrl(''); setTitle(''); setTakenJ(''); setVisitId(''); setPhase(''); setLinkUser(''); setLinkPass(''); setLinkAuth(false);
      await reload();
      toast('لینک ثبت شد ✓');
    } catch (e) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (doc) => {
    try {
      await api(`/patients/documents/${doc.id}`, { method: 'DELETE' });
      await reload();
      toast('مدرک حذف شد');
    } catch (e) { toast(e.message, true); }
  };

  const shown = rec.documents.filter((d) => (filter === 'all' || d.category === filter)
    && (phaseFilter === 'all' || (phaseFilter === 'none' ? !d.phase : d.phase === phaseFilter)));
  const present = [...new Set(rec.documents.map((d) => d.category))];
  /* ردیفِ فیلترِ مرحله فقط وقتی می‌آید که واقعاً مدرکِ مرحله‌دار وجود داشته باشد —
     پرونده‌ای که هیچ عملی ندارد نباید یک ردیفِ همیشه‌خالی ببیند. */
  const phasesPresent = Object.keys(PHASES).filter((k) => rec.documents.some((d) => d.phase === k));

  return (
    <>
      <div className="rc-upload">
        <div className="pf-row2">
          <label className="pf-field"><span>دسته</span>
            <select value={cat} onChange={(e) => setCat(e.target.value)}>
              {Object.entries(CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="pf-field"><span>عنوان</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً: MRI کمر" />
          </label>
          <JDate className="pf-field" label="تاریخِ مدرک (شمسی)" value={takenJ}
            onChange={setTakenJ} placeholder="۱۴۰۵/۰۴/۲۸" hint="تاریخِ خودِ آزمایش، نه تاریخِ آپلود." />
          <label className="pf-field"><span>مربوط به مراجعه</span>
            <select value={visitId} onChange={(e) => { setVisitId(e.target.value); if (!e.target.value) setPhase(''); }}>
              <option value="">— کلِ پرونده —</option>
              {rec.visits.map((v) => <option key={v.id} value={v.id}>{v.code}</option>)}
            </select>
          </label>
          {/* مرحله بعد از انتخابِ مراجعه ظاهر می‌شود — بدونِ مراجعه بی‌معنی است
              و سرور هم ردش می‌کند؛ پس اصلاً نشان داده نمی‌شود. */}
          <label className="pf-field"><span>مرحله نسبت به عمل</span>
            <select value={phase} disabled={!visitId} onChange={(e) => setPhase(e.target.value)}>
              <option value="">{visitId ? '— مشخص نیست —' : '— اول مراجعه را انتخاب کنید —'}</option>
              {Object.entries(PHASES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
        </div>
        {/* inputِ نیتیو «Choose File» انگلیسی نشان می‌دهد و در رابطِ فارسی وصله است؛
            پس پنهانش می‌کنیم و خودِ label ناحیهٔ کلیک/رها‌کردن می‌شود. */}
        <FileDrop
          accept="image/*,.pdf"
          maxMb={25}
          hint={`عکس، PDF یا هر مدرکِ دیگر — تا ${faNum(25)} مگابایت`}
          onUpload={upload}
          onAllDone={async () => {
            setTitle(''); setTakenJ(''); setVisitId(''); setPhase('');
            await reload();
            toast('مدارک اضافه شدند ✓');
          }}
        />
        {/* لینک به‌جای فایل: MRI/پاراکلینیکی که جای دیگری میزبانی می‌شود. */}
        <div className="rc-linkrow">
          <LinkIcon width="15" height="15" />
          <input
            dir="ltr"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="…https://  — اگر فایل ندارید، لینکِ MRI/پاراکلینیک را بگذارید"
            disabled={busy}
            onKeyDown={(e) => { if (e.key === 'Enter') addLink(); }}
          />
          <button
            type="button" className={`rc-linkauth${linkAuth ? ' on' : ''}`} title="نامِ کاربری و رمزِ پورتال"
            aria-pressed={linkAuth} onClick={() => setLinkAuth((v) => !v)} disabled={busy}
          >
            <Lock width="14" height="14" />
          </button>
          <button type="button" className="df-save" disabled={busy || !linkUrl.trim()} onClick={addLink}>
            ثبتِ لینک
          </button>
        </div>
        {linkAuth && (
          <div className="rc-linkcred">
            <input dir="ltr" autoComplete="off" value={linkUser} onChange={(e) => setLinkUser(e.target.value)} placeholder="نامِ کاربری" disabled={busy} />
            <input dir="ltr" autoComplete="off" value={linkPass} onChange={(e) => setLinkPass(e.target.value)} placeholder="رمز" disabled={busy} />
          </div>
        )}
      </div>

      {present.length > 1 && (
        <div className="df-tabs rc-filter">
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>همه</button>
          {present.map((c) => (
            <button key={c} className={filter === c ? 'on' : ''} onClick={() => setFilter(c)}>{CATEGORIES[c] ?? c}</button>
          ))}
        </div>
      )}

      {/* «کدام عکس قبل از عمل بود و کدام بعدش؟» — سؤالی که تا دیروز جوابی
          نداشت. «بدونِ مرحله» عمداً یک چیپِ جداست: مدرکِ مرحله‌نخورده باید
          دیده شود تا برچسب بخورد، نه اینکه پشتِ فیلتر گم شود. */}
      {phasesPresent.length > 0 && (
        <div className="df-tabs rc-filter rc-phasefilter">
          <button className={phaseFilter === 'all' ? 'on' : ''} onClick={() => setPhaseFilter('all')}>هر مرحله</button>
          {phasesPresent.map((k) => (
            <button key={k} className={phaseFilter === k ? 'on' : ''} onClick={() => setPhaseFilter(k)}>{PHASES[k]}</button>
          ))}
          {rec.documents.some((d) => !d.phase) && (
            <button className={phaseFilter === 'none' ? 'on' : ''} onClick={() => setPhaseFilter('none')}>بدونِ مرحله</button>
          )}
        </div>
      )}

      {shown.length === 0 ? <div className="df-empty">مدرکی ثبت نشده است</div> : (
        <div className="rc-docs">
          {shown.map((d) => (
            <div key={d.id} className="rc-doc">
              {d.isLink
                ? <div className="rc-thumb rc-thumb-file"><LinkIcon width="16" height="16" /></div>
                : d.isImage
                  ? <DocThumb id={d.id} alt={d.title || d.fileName} className="rc-thumb" />
                  : <div className="rc-thumb rc-thumb-file">{(d.fileName.split('.').pop() || '?').slice(0, 4)}</div>}
              <div className="rc-doc-main">
                <b>{d.title || d.fileName}</b>
                <small>{CATEGORIES[d.category] ?? d.category} · {d.isLink ? 'لینک' : fmtSize(d.size)}{d.takenAt ? ` · ${faDate(d.takenAt)}` : ''}</small>
                {d.visitId && (
                  <small className="rc-doc-visit">
                    {rec.visits.find((v) => v.id === d.visitId)?.code}
                    {/* برچسب از سرور می‌آید (`phaseFa`، قانون ۱۵)؛ `PHASES` فقط
                        fallbackِ نصبِ قدیمی است که هنوز فیلد را برنمی‌گرداند. */}
                    {/* ⚠️ `<span>` و نه `<b>`: قاعدهٔ `.rc-doc-main b { display:block }`
                        با specificityِ بالاتر بر `.rc-doc-phase` غلبه می‌کند و بج
                        یک نوارِ تمام‌عرض می‌شود (در اسکرین‌شات دیده شد، نه در تست). */}
                    {d.phase && <span className={`rc-doc-phase ph-${d.phase}`}>{d.phaseFa ?? PHASES[d.phase]}</span>}
                  </small>
                )}
                {d.isLink && (d.externalUser || d.externalPass) && <DocCred user={d.externalUser} pass={d.externalPass} />}
              </div>
              <div className="df-acts">
                {d.isLink ? (
                  /* لینکِ خارجی در تبِ تازه — `noopener` تا صفحهٔ مقصد به پنجرهٔ پرونده دست نیابد. */
                  <a className="rc-doc-open" href={d.externalUrl} target="_blank" rel="noopener noreferrer" title="بازکردنِ لینک">
                    <LinkIcon width="14" height="14" />
                  </a>
                ) : (
                  <button title="دانلود" onClick={() => openDoc(d, toast)}><Download width="14" height="14" /></button>
                )}
                <button className="df-del" title="حذف" onClick={() => remove(d)}><Trash width="14" height="14" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** ورودِ پورتالِ مدرکِ لینکی — با کپیِ یک‌ضرب، چون همکار همین را می‌خواهد نه خواندنِ حرف‌به‌حرف. */
function DocCred({ user, pass }) {
  const [copied, setCopied] = useState('');
  const copy = async (what, text) => {
    try {
      await navigator.clipboard.writeText(String(text));
      setCopied(what);
      setTimeout(() => setCopied(''), 1600);
    } catch { /* بدونِ HTTPS یا با ردِ کاربر کار نمی‌کند — متن خوانا هست. */ }
  };
  return (
    <small className="rc-doc-cred">
      <Lock width="11" height="11" />
      {user && (
        <>
          <code dir="ltr">{user}</code>
          <button type="button" onClick={() => copy('user', user)} aria-label="کپیِ نامِ کاربری">
            {copied === 'user' ? <Check width="11" height="11" /> : <Copy width="11" height="11" />}
          </button>
        </>
      )}
      {pass && (
        <>
          <code dir="ltr">{pass}</code>
          <button type="button" onClick={() => copy('pass', pass)} aria-label="کپیِ رمز">
            {copied === 'pass' ? <Check width="11" height="11" /> : <Copy width="11" height="11" />}
          </button>
        </>
      )}
    </small>
  );
}

/* ══════════════ تبِ شرح‌ها ══════════════ */
function NotesTab({ rec, reload, toast }) {
  /* نوع‌های سندِ بالینی از `/config` — چیپ‌ها باید **همهٔ** گزینه‌ها را نشان
     دهند، پس فهرستِ کامل لازم است؛ برچسبِ یک سندِ مشخص از خودش می‌آید (`kindFa`). */
  const noteKinds = useStatusList('note');
  const noteFa = Object.fromEntries(noteKinds.map((k) => [k.key, k.label]));
  /* ⚠️ `kind` هم **فیلترِ فهرست** است و هم نوعِ شرحِ تازه — عمداً یک state،
     نه دو تا. کاربر وقتی روی «سیرِ بیماری» است، هم سیرِ بیماری را می‌خواند و
     هم اگر بنویسد سیرِ بیماری می‌نویسد؛ دو کنترلِ جدا برای همین یک مفهوم
     فقط جای بیشتری می‌گرفت و امکانِ ناهماهنگی می‌ساخت («سیرِ بیماری» را
     فیلتر کرده باشی و نوشته‌ات «مشاوره» ثبت شود). */
  const [kind, setKind] = useState('visit');
  const [body, setBody] = useState('');
  const [visitId, setVisitId] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // {id, body}
  const [history, setHistory] = useState(null);
  /* قالب‌های آمادهٔ همین نوع/مراجعه — HIS-گونه؛ از تعریف‌های پایه می‌آیند. */
  const [tpls, setTpls] = useState([]);
  /* دستیارِ AI — فقط وقتی در تنظیماتِ شرکت پیکربندی شده باشد دیده می‌شود. */
  const [aiOn, setAiOn] = useState(false);
  const [sttOn, setSttOn] = useState(false); // دستیارِ صوتی — فقط با مدلِ گفتار-به-متن
  const [aiBusy, setAiBusy] = useState(false);
  const [rawBody, setRawBody] = useState(null); // متنِ خامِ قبل از ساخت‌یافته‌کردن — برای برگرداندن
  /* آخرین پیش‌نویسِ کاملِ دستیار — اگر کاربر پیش از ثبت دستی اصلاحش کند،
     جفتِ (پیش‌نویس، نهایی) برای «یادگیری» فرستاده می‌شود. */
  const lastDraftRef = useRef(null);

  useEffect(() => {
    let on = true;
    api('/ai/status').then((r) => { if (on) { setAiOn(!!r?.enabled); setSttOn(!!r?.stt); } }).catch(() => {});
    return () => { on = false; };
  }, []);

  /**
   * دستیارِ AI روی ادیتور — **زنده** (SSE): متن همان‌طور که نوشته می‌شود
   * دیده می‌شود، نه بعد از انتظارِ کور. دو حالت: structure (تایپِ خام →
   * ساخت‌یافته؛ ادیتور خالی می‌شود و پیش‌نویس تکه‌تکه می‌نشیند) و continue
   * («ادامه بنویس» — به انتهای متنِ موجود اضافه می‌شود). متنِ خام برای
   * برگشت نگه داشته می‌شود و خطای وسطِ راه همان را برمی‌گرداند — پیش‌نویسِ
   * نیمه نباید نوشتهٔ پزشک را بخورد. تا «ثبت» زده نشود چیزی در پرونده نمی‌نشیند.
   */
  const aiDraft = async (mode) => {
    if (!body.trim()) { toast('اول متنِ خام را بنویسید، بعد دستیار ساخت‌یافته‌اش کند', true); return; }
    setAiBusy(mode);
    const raw = body;
    let draft = mode === 'continue' ? raw.replace(/\n?$/, '\n') : '';
    try {
      setRawBody(raw);
      await apiStream(
        '/ai/note-draft/stream',
        { patientId: rec.id, kind, mode, text: raw, ...(visitId ? { visitId: +visitId } : {}) },
        (d) => { draft += d; setBody(draft); },
      );
      /* متنِ کامل، همان‌طور که دستیار تحویل داد — مبنای تشخیصِ اصلاحِ دستی. */
      lastDraftRef.current = draft;
      toast(mode === 'structure' ? 'پیش‌نویسِ ساخت‌یافته آماده شد — پیش از ثبت مرورش کنید' : 'ادامه نوشته شد — مرورش کنید');
    } catch (e) {
      setBody(raw);
      setRawBody(null);
      toast(e.message, true);
    } finally { setAiBusy(false); }
  };

  useEffect(() => {
    if (kind === 'form') { setTpls([]); return undefined; }
    let on = true;
    api(`/patients/${rec.id}/note-templates?kind=${kind}${visitId ? `&visitId=${visitId}` : ''}`)
      .then((r) => { if (on) setTpls(Array.isArray(r) ? r : []); })
      .catch(() => { if (on) setTpls([]); });
    return () => { on = false; };
  }, [rec.id, kind, visitId]);

  /**
   * ثبتِ شرح — و بعد **اثباتِ** اینکه واقعاً در پرونده نشسته.
   *
   * ⚠️ گزارشِ کاربر: «شرح ویزیت می‌زنم، سیو شد هم می‌ده، ولی تو لیست نشون
   * نمی‌ده». تا دیروز «ثبت شد ✓» فقط یعنی «POST دو‌ایکس‌ایکس داد» — و همان
   * پیام را می‌داد حتی وقتی پروندهٔ بازخوانی‌شده هیچ شرحی نداشت. یعنی
   * بدترین حالتِ ممکن: پیامِ موفقیت روی یک شکست.
   *
   * حالا شناسه‌ای که خودِ سرور برگردانده در پروندهٔ تازه جست‌وجو می‌شود و
   * «ثبت شد» فقط وقتی گفته می‌شود که واقعاً آن‌جا باشد. اگر نباشد، پیامِ
   * قرمزِ ماندگار می‌گوید کدام نیمه شکسته — و نوشتهٔ کاربر هم پاک نمی‌شود.
   *
   * این خودش علت را رفع نمی‌کند؛ ولی «انگار ذخیره نمی‌شود» را به یک گزارشِ
   * دقیق تبدیل می‌کند، و مهم‌تر: جلوی از‌دست‌رفتنِ متنِ پزشک را می‌گیرد.
   */
  const add = async () => {
    if (!body.trim()) { toast('متنِ شرح خالی است', true); return; }
    setBusy(true);
    try {
      const created = await api(`/patients/${rec.id}/notes`, {
        method: 'POST',
        body: { kind, body: body.trim(), ...(visitId ? { visitId: +visitId } : {}) },
      });
      const fresh = await reload();
      const landed = created?.id != null
        ? (fresh?.clinicalNotes ?? []).some((n) => n.id === created.id)
        : (fresh?.clinicalNotes ?? []).length > (rec.clinicalNotes?.length ?? 0);
      if (!landed) {
        toast(
          `سرور ثبت را پذیرفت${created?.id != null ? ` (شناسهٔ ${faNum(created.id)})` : ''} `
          + 'ولی پرونده آن را برنگرداند. نوشتهٔ شما پاک نشد — همین پیام را گزارش کنید.',
          true,
        );
        return;
      }
      /* یادگیری از اصلاحِ دستی: اگر متنِ ثبت‌شده با پیش‌نویسِ دستیار فرق
         دارد، جفتش بی‌سروصدا می‌رود تا پیش‌نویس‌های بعدی سلیقهٔ کاربر را
         رعایت کنند. شکستِ این تماس نباید ثبتِ موفق را خراب کند. */
      const draft = lastDraftRef.current;
      if (draft && draft.trim() && draft.trim() !== body.trim()) {
        api('/ai/feedback', { method: 'POST', body: { kind, draft: draft.trim(), final: body.trim() } }).catch(() => {});
      }
      lastDraftRef.current = null;
      setBody(''); setVisitId('');
      toast('شرح ثبت شد ✓');
    } catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };

  /* ویرایش هم همان قرارداد را دارد: «ثبت شد» فقط وقتی که نسخهٔ تازه واقعاً
     در پروندهٔ بازخوانی‌شده باشد. */
  const amend = async () => {
    setBusy(true);
    try {
      const fresh = await api(`/patients/notes/${editing.id}`, { method: 'PATCH', body: { body: editing.body.trim() } });
      const rec2 = await reload();
      if (fresh?.id != null && !(rec2?.clinicalNotes ?? []).some((n) => n.id === fresh.id)) {
        toast(`سرور نسخهٔ تازه را پذیرفت (شناسهٔ ${faNum(fresh.id)}) ولی پرونده آن را برنگرداند. همین پیام را گزارش کنید.`, true);
        return;
      }
      setEditing(null);
      toast('نسخهٔ تازه ثبت شد ✓ (نسخهٔ قبلی در تاریخچه می‌ماند)');
    } catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };

  const showHistory = async (note) => {
    try { setHistory({ note, rows: await api(`/patients/notes/${note.id}/history`) }); }
    catch (e) { toast(e.message, true); }
  };

  /* فیلترِ نمایش — روی همان آرایه‌ای که سرور داده، بدونِ رفت‌وبرگشتِ تازه:
     شرح‌ها کم‌شمارند و صفحه از قبل همه را دارد. */
  const shown = rec.clinicalNotes.filter((n) => n.kind === kind);

  return (
    <>
      {/* ⚠️ **ردیفِ نوع‌ها، نه یک `<select>`.** شکایتِ کاربر این بود که
          «سیرِ بیماری از پرونده حذف شده» — حذف نشده بود، ولی تنها جایی که
          نامش دیده می‌شد داخلِ یک dropdownِ بسته بود. چیزی که برای دیدنش
          باید کلیک کنی، برای کاربر وجود ندارد. حالا هر پنج نوع با نام و
          شمارش روی صفحه‌اند؛ شمارش از سرور می‌آید (`counts.notesByKind`) و
          نوعِ بی‌شرح هم چیپِ «۰» دارد. */}
      {/* ⚠️ `radiogroup` است نه `tablist` — و این تفاوت هم معنایی است هم
          دیداری: نوارِ تبِ صفحه (`Tabs`) بالای همین صفحه هست و دو نوارِ
          هم‌شکلِ روی‌هم یعنی کاربر نداند کدام‌یک کجا می‌بَرد. این‌جا یکی از
          چند گزینه انتخاب می‌شود (هم فیلتر، هم نوعِ شرحِ تازه)، دقیقاً مثلِ
          `.db-kindrow`ِ داشبورد. نگهبانِ CI هم به‌درستی `tablist`ِ دست‌ساز را
          رد می‌کند: تبِ واقعی فقط از `Tabs` می‌آید. */}
      <div className="rc-kindrow" role="radiogroup" aria-label="نوعِ شرح">
        {noteKinds.map(({ key: k, label: l }) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            disabled={!!aiBusy}
            className={kind === k ? 'on' : ''}
            onClick={() => setKind(k)}
          >
            {l}<i>{faNum(rec.counts.notesByKind?.[k] ?? 0)}</i>
          </button>
        ))}
        {/* شرح‌هایی که در خودِ فرم‌های مراجعه نوشته شده‌اند (معاینه، طرحِ
            درمان، یادداشت…) — خواندنی؛ جای نوشتنشان خودِ فرم است. */}
        <button
          type="button"
          role="radio"
          aria-checked={kind === 'form'}
          disabled={!!aiBusy}
          className={kind === 'form' ? 'on' : ''}
          onClick={() => setKind('form')}
        >
          شرحِ فرم‌ها<i>{faNum(rec.counts.visitTexts ?? 0)}</i>
        </button>
      </div>

      {kind !== 'form' && (
      <div className="rc-upload">
        <div className="pf-row2">
          <label className="pf-field"><span>مربوط به مراجعه</span>
            <select value={visitId} disabled={!!aiBusy} onChange={(e) => setVisitId(e.target.value)}>
              <option value="">— کلِ پرونده —</option>
              {rec.visits.map((v) => <option key={v.id} value={v.id}>{v.code}</option>)}
            </select>
          </label>
        </div>
        {tpls.length > 0 && (
          <div className="rc-tpls" aria-label="قالب‌های آماده">
            <small>قالبِ آماده:</small>
            {tpls.map((t) => (
              <button
                key={t.id} type="button" className={`rc-tpl${t.specific ? ' sp' : ''}`}
                disabled={!!aiBusy}
                title={t.specific ? 'اختصاصیِ همین عمل/تشخیص/موضوع' : 'قالبِ عمومی'}
                onClick={() => setBody((b) => (b.trim() ? `${b}\n\n${t.body}` : t.body))}
              >
                {t.title}
              </button>
            ))}
          </div>
        )}
        <label className="pf-field"><span>متن</span>
          <textarea rows={4} value={body} readOnly={!!aiBusy} onChange={(e) => setBody(e.target.value)} placeholder="یافته‌ها، سیرِ بیماری، توصیه‌ها…" />
        </label>
        <div className="rc-notebar">
          {sttOn && (
            <VoiceInput
              disabled={busy || !!aiBusy}
              onText={(t) => setBody((b) => (b.trim() ? `${b}\n${t}` : t))}
              onErr={(m) => toast(m, true)}
            />
          )}
          {aiOn && (
            <button type="button" className="rc-ai" onClick={() => aiDraft('structure')} disabled={busy || !!aiBusy}>
              {aiBusy === 'structure' ? 'دستیار در حالِ نوشتن…' : 'ساخت‌یافته کن — دستیارِ AI'}
            </button>
          )}
          {aiOn && (
            <button type="button" className="rc-ai rc-ai-cont" onClick={() => aiDraft('continue')} disabled={busy || !!aiBusy}>
              {aiBusy === 'continue' ? 'در حالِ ادامه…' : 'ادامه بنویس'}
            </button>
          )}
          {rawBody !== null && (
            <button type="button" className="rc-ai-undo" disabled={!!aiBusy} onClick={() => { setBody(rawBody); setRawBody(null); }}>
              برگرداندنِ متنِ خام
            </button>
          )}
          <button className="df-save rc-save" onClick={add} disabled={busy || aiBusy}>
            {/* نوع در متنِ دکمه می‌آید تا وقتی چیپ بالا از چشم افتاده، کاربر
                نداند دارد چه چیزی ثبت می‌کند. */}
            <Plus width="15" height="15" /> ثبتِ {noteFa[kind] ?? kind}
          </button>
        </div>
      </div>
      )}

      {kind === 'form' ? (
        (rec.visitTexts ?? []).length === 0 ? (
          <div className="df-empty">هنوز شرحی در فرم‌های مراجعه نوشته نشده است</div>
        ) : (
          <div className="df-list">
            {rec.visitTexts.map((t, i) => (
              <div key={`${t.visitId}-${i}`} className="rc-note">
                <div className="rc-note-head">
                  <b>{t.label}</b>
                  <span className="rc-note-visit">{t.code}</span>
                  <small>{t.opDate ? faDate(t.opDate) : ''}</small>
                </div>
                <p className="rc-note-body">{t.body}</p>
              </div>
            ))}
          </div>
        )
      ) : shown.length === 0 ? (
        <div className="df-empty">هنوز «{noteFa[kind] ?? kind}»ی ثبت نشده است</div>
      ) : (
        <div className="df-list">
          {shown.map((n) => (
            <div key={n.id} className="rc-note">
              <div className="rc-note-head">
                <b>{n.kindFa ?? n.kind}</b>
                {n.visitId && <span className="rc-note-visit">{rec.visits.find((v) => v.id === n.visitId)?.code}</span>}
                <small>{faDate(n.createdAt)}{n.authorName ? ` · ${n.authorName}` : ''}</small>
                {n.edited && (
                  <button type="button" className="rc-edited" onClick={() => showHistory(n)}>ویرایش‌شده — تاریخچه</button>
                )}
                <button className="rc-note-edit" title="ویرایش" onClick={() => setEditing({ id: n.id, body: n.body })}>
                  <Pencil width="13" height="13" />
                </button>
              </div>
              <p className="rc-note-body">{n.body}</p>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {editing && (
          <Overlay backdrop="df-overlay" panel="df-sheet" onClose={() => setEditing(null)}>
            <div className="df-sheet-head">
              <b>ویرایشِ شرح</b>
              <button className="df-x" onClick={() => setEditing(null)}><Close width="16" height="16" /></button>
            </div>
            <div className="df-sheet-body">
              <div className="df-note">متنِ قبلی پاک نمی‌شود — نسخهٔ تازه‌ای ثبت می‌شود و نسخهٔ قبلی در تاریخچه می‌ماند.</div>
              <label className="pf-field"><span>متن</span>
                <AssistedTextarea disabled={busy} rows={7} value={editing.body} onChange={(e) => setEditing((s) => ({ ...s, body: e.target.value }))} />
              </label>
            </div>
            <div className="df-sheet-foot">
              <button className="df-ghost" onClick={() => setEditing(null)}>انصراف</button>
              <button className="df-save" onClick={amend} disabled={busy}>ثبتِ نسخهٔ تازه</button>
            </div>
          </Overlay>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {history && (
          <Overlay backdrop="df-overlay" panel="df-sheet" onClose={() => setHistory(null)}>
            <div className="df-sheet-head">
              <b>تاریخچهٔ شرح</b>
              <button className="df-x" onClick={() => setHistory(null)}><Close width="16" height="16" /></button>
            </div>
            <div className="df-sheet-body rc-history">
              {history.rows.map((r, i) => (
                <div key={r.id} className={`rc-hrow${i === 0 ? ' on' : ''}`}>
                  <small>{i === 0 ? 'نسخهٔ جاری' : `جایگزین‌شده در ${faDate(r.replacedAt)}`}{r.authorName ? ` · ${r.authorName}` : ''}</small>
                  <p>{r.body}</p>
                </div>
              ))}
            </div>
          </Overlay>
        )}
      </AnimatePresence>
    </>
  );
}


/* ══════════════ پروندهٔ زنده (W3.1، §۴.۳ سند) ══════════════

   چهار پرسشی که تا دیروز هیچ صفحه‌ای جواب نمی‌داد: **الان کجاییم · چه شده ·
   چه مانده · نوبتِ کیست**. تبِ پیش‌فرضِ «خلاصه» یک فرمِ ویرایشِ ۱۹ فیلدی بود؛
   کسی که پرونده را باز می‌کرد اول باید یک فرم را می‌خواند تا بفهمد چه خبر است.

   حالا پاسخ بالاست و تب‌ها ثانویه‌اند. داده از `GET /patients/:id/live` می‌آید
   که همه‌چیزش **مشتقِ سرور** است (قانون ۱۵) — این‌جا هیچ فرمولی نیست. */

/**
 * جای خالیِ واژهٔ حوزه‌ای را پُر می‌کند (قانون ۲۴). سرور `{visit}` می‌فرستد چون
 * واژه‌نامه فقط یک نسخه دارد و آن `src/lib/terms.js` است.
 */
const withTerm = (str, t) => (str ? String(str).replaceAll('{visit}', t.visit).replaceAll('{visits}', t.visits) : str);

/** نگاشتِ نوعِ ردیفِ خطِ زمان به آیکون و برچسب — تک‌منبع. */
const TL_META = {
  visit: { Icon: Doctor, fa: 'مراجعه' },
  appointment: { Icon: Calendar, fa: 'نوبت' },
  order: { Icon: Form, fa: 'سفارش' },
  document: { Icon: Book, fa: 'مدرک' },
  note: { Icon: Pencil, fa: 'شرح' },
  reminder: { Icon: Send, fa: 'یادآوری' },
};

/**
 * نوارِ «الان کجاییم» — شش گام که سرور از خودِ داده مشتق کرده است.
 *
 * ⚠️ گامِ `skipped` **محو** می‌شود و حذف نمی‌شود: «این بیمار نوبت نگرفت» خودش
 * یک واقعیت است؛ اگر گام را برداریم، نوار برای هر بیمار شکلِ دیگری دارد و
 * دیگر نمی‌شود با یک نگاه فهمید کجای مسیریم.
 */
/** عنوانِ گامِ «مراجعه» از نوعِ دوره (عمل جراحی / ویزیت)؛ بقیهٔ گام‌ها واژهٔ حوزه. */
const stepTitle = (s, t) => (s.key === 'visit' && s.kind && KINDS[s.kind] ? kindOf(s.kind).label : withTerm(s.title, t));

function StageBar({ stage, t }) {
  if (!stage?.steps?.length) return null;
  const cur = stage.key ? stage.steps.find((s) => s.key === stage.key) : null;
  return (
    <section className="rc-stage" aria-label="الان کجاییم">
      <p className="rc-stage-now">
        {/* ⚠️ متنِ سرور از `faNum` رد می‌شود: شمارش‌ها («۲ نتیجه…») آن‌جا عددِ
            لاتین‌اند و کلِ صفحه فارسی است. قالبِ **پول** این‌جا نمی‌آید — آن
            `fmtMoney` است و به همین دلیل سرور هیچ مبلغی را متن نمی‌کند. */}
        <b>الان کجاییم:</b> {faNum(cur ? stepTitle(cur, t) : withTerm(stage.title, t))}
        {stage.detail && <i> — {faNum(withTerm(stage.detail, t))}</i>}
      </p>
      <ol className="rc-steps">
        {stage.steps.map((s) => (
          <li key={s.key} className={`rc-step is-${s.state}`}>
            <span className="rc-step-dot" aria-hidden="true">
              {s.state === 'done' ? <Check width="11" height="11" /> : null}
            </span>
            <span className="rc-step-txt">
              <b>{stepTitle(s, t)}</b>
              {s.detail && <i>{faNum(withTerm(s.detail, t))}</i>}
              {s.at && <time dateTime={s.at}>{faDate(s.at)}</time>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * «چه مانده» — کارِ بعدی، نوبتِ پیشِ رو، نتیجه‌های بازِ منتظرِ بررسی، و ماندهٔ مالی.
 *
 * ⚠️ کارت وقتی هیچ‌کدام نیست **اصلاً رندر نمی‌شود**. یک کارتِ «چیزی نمانده» در
 * هر بار بازکردنِ پرونده فقط فضای بالای صفحه را می‌خورد و چشم یاد می‌گیرد
 * نادیده‌اش بگیرد — همان روزی که واقعاً کاری باشد هم دیده نمی‌شود.
 */
function NextUp({ live, onGo, onActed, toast, onOpen }) {
  const [busy, setBusy] = useState(0);
  const w = live.nextWork;
  const appt = live.upcoming?.[0] ?? null;
  const review = (live.openOrders ?? []).filter((o) => o.awaitingReview);
  const due = live.billing?.due > 0 ? live.billing.due : 0;
  if (!w && !appt && !review.length && !due) return null;

  /* ⚠️ همان مسیرِ صفحهٔ «امروز»: `PATCH /work/:id` + رویدادِ `WORK_CHANGED` تا
     زنگِ بالای پوسته هم تازه شود. کارتِ کارِ بعدی بدونِ دکمه فقط خبررسان است و
     §۴.۳ بندِ ۳ صریحاً «دکمهٔ اصلی» می‌خواهد. */
  const act = async (item, action, body = {}) => {
    setBusy(item.id);
    try {
      await api(`/work/${item.id}`, { method: 'PATCH', body: { action, ...body } });
      window.dispatchEvent(new Event(WORK_CHANGED));
      toast(action === 'done' ? 'انجام شد ✓' : 'به فردا موکول شد');
      await onActed();
    } catch (e) { toast(e?.message || 'انجام نشد', true); } finally { setBusy(0); }
  };

  return (
    <section className="rc-next" aria-label="چه مانده">
      {w && (
        <article className={`rc-next-main${w.overdue ? ' is-late' : ''}`}>
          <h3><Clock width="13" height="13" /> کارِ بعدی</h3>
          {/* ردیفِ کار از `WorkRow` می‌آید تا نوعِ کار، مالک و دکمه‌ها با زنگِ
              اعلان و صفحهٔ «کارهای من» یکی بمانند — نه نسخهٔ سومِ همان کارت. */}
          <ul className="wk-list">
            <WorkRow w={w} onAct={act} busy={busy} compact onOpen={workTarget(w) ? () => onOpen(workTarget(w)) : undefined} />
          </ul>
          <p className="rc-next-meta">
            <span>{w.ownerAccountId ? 'واگذارشده' : w.ownerRoleFa ? `به‌عهدهٔ ${w.ownerRoleFa}` : 'بی‌مسئول'}</span>
            {live.counts.work > 1 && (
              <Link to="/app/work" className="rc-next-more">{faNum(live.counts.work - 1)} کارِ دیگر</Link>
            )}
          </p>
        </article>
      )}
      <div className="rc-next-side">
        {appt && (
          <p className="rc-chip"><Calendar width="13" height="13" />
            نوبتِ بعدی: <b>{faDate(appt.date)}{appt.time ? ` — ${faNum(appt.time)}` : ''}</b>
            <i>{appt.statusFa}{appt.doctorName ? ` · ${appt.doctorName}` : ''}</i>
          </p>
        )}
        {review.length > 0 && (
          /* هر نتیجه یک دکمه: هشدار باید بگوید **کدام** سفارش و با کلیک شیتِ همان
             سفارش (با پاسخِ بیمار و دکمهٔ بررسی) باز شود — نه فقط یک شمارنده. */
          <div className="rc-chip is-warn rc-chip-list" role="group" aria-label="نتیجه‌های بررسی‌نشده">
            <span><Alert size={13} /> <b>{faNum(review.length)} نتیجه</b> آمده و بررسی نشده — برای بررسی بزنید</span>
            {review.map((o) => (
              <button key={`${o.kind}-${o.id}`} type="button" onClick={() => onOpen({ type: 'order', kind: o.kind, id: o.id })}>
                {o.kindFa}{o.summary ? ` — ${o.summary}` : ''}{o.visitCode ? ` · ${o.visitCode}` : ''}
              </button>
            ))}
          </div>
        )}
        {due > 0 && (
          <button type="button" className="rc-chip is-money" onClick={() => onGo('visits')}>
            <Money width="13" height="13" /> ماندهٔ مالی: <b>{fmtMoney(due)}</b>
            <i>از {fmtMoney(live.billing.total)} — {faNum(live.billing.paidPct)}٪ پرداخت شده</i>
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * خطِ زمانِ واحد — مراجعه، نوبت، سفارش، مدرک، شرح، یادآوری در یک ستون.
 *
 * ⚠️ هر ردیفی که به جایی می‌رود **کلیک‌پذیر** است و ردیفی که نمی‌رود، نه.
 * دکمه‌نمایی که کاری نمی‌کند از نبودنِ دکمه بدتر است (باگِ واقعیِ همین ریپو:
 * لینکِ «بازکردن در داشبورد» که هیچ‌کاری نمی‌کرد).
 */
function Timeline({ live, onGo, t, onOpen }) {
  const noteFa = Object.fromEntries(useStatusList('note').map((k) => [k.key, k.label]));
  const [all, setAll] = useState(false);
  const tl = live.timeline;
  if (!tl?.items?.length) return null;
  const items = all ? tl.items : tl.items.slice(0, 12);

  return (
    <section className="rc-tl" aria-label="خطِ زمانِ پرونده">
      <h3>چه شده</h3>
      <ol>
        {items.map((it) => {
          const meta = TL_META[it.type] ?? TL_META.document;
          const inner = (
            <>
              <span className="rc-tl-ico" style={it.color ? { '--k': `var(--kind-${it.color})` } : undefined}>
                <meta.Icon width="13" height="13" />
              </span>
              <span className="rc-tl-body">
                {/* نوعِ شرح **داده** است نه برچسب؛ نگاشتِ فارسی‌اش از سرور
                    می‌آید (`/config.statuses.note`) و دو نسخه‌کردنش فقط
                    واگرایی می‌آورد — همان چیزی که این بسته جمعش کرد. */}
                <b>
                  {it.type === 'note' ? (noteFa[it.title] ?? it.title)
                    : it.type === 'visit' && it.kind && KINDS[it.kind]
                      ? <>{kindOf(it.kind).label} <span dir="ltr">{it.code ?? ''}</span></>
                      : withTerm(it.title, t)}
                </b>
                {it.detail && <i>{faNum(it.detail)}</i>}
              </span>
              <span className="rc-tl-side">
                {it.stateFa && <em className={`rc-tl-state is-${it.state ?? 'none'}`}>{faNum(it.stateFa)}</em>}
                <time dateTime={it.at}>{faDate(it.at)}</time>
              </span>
            </>
          );
          /* مقصد: پاپ‌آپِ **خودِ** ردیف (مراجعه، سفارش، یادآوری، نوبت)؛ مدرک/شرح →
             تبِ خودش؛ بقیه بی‌لینک. تا دیروز هر ردیفِ مراجعه‌دار به فرمِ کلیِ
             داشبورد می‌پرید (بازخوردِ مالک). */
          const target = tlTarget(it);
          if (target) {
            return <li key={it.id} className="rc-tl-row is-link"><button type="button" onClick={() => onOpen(target)}>{inner}</button></li>;
          }
          if (it.type === 'document' || it.type === 'note') {
            return (
              <li key={it.id} className="rc-tl-row is-link">
                <button type="button" onClick={() => onGo(it.type === 'document' ? 'docs' : 'notes')}>{inner}</button>
              </li>
            );
          }
          return <li key={it.id} className="rc-tl-row"><div>{inner}</div></li>;
        })}
      </ol>
      {tl.items.length > 12 && (
        <button type="button" className="rc-tl-more" onClick={() => setAll(!all)}>
          {all ? 'کوتاه کن' : `${faNum(tl.items.length - 12)} رویدادِ قدیمی‌تر`}
        </button>
      )}
      {/* ⚠️ بریدنِ بی‌صدا ممنوع: اگر سرور سقف زده، صفحه باید بگوید — و متنش
          نباید با دکمهٔ «رویدادِ قدیمی‌تر» تناقض داشته باشد: آن دکمه همین
          فهرست را باز می‌کند، این جمله می‌گوید خودِ فهرست همه‌چیز نیست. */}
      {tl.truncated && (
        <p className="rc-tl-cut">{faNum(tl.total)} رویدادِ اخیر خوانده شده؛ قدیمی‌تر از این‌ها در فهرست نیست.</p>
      )}
    </section>
  );
}

/**
 * اقدام‌های همیشه‌دردسترس (§۴.۳ بندِ ۵).
 *
 * ⚠️ فقط اقدام‌هایی که **واقعاً کار می‌کنند**: مراجعهٔ جدید (با پیش‌پرشدنِ
 * بیمار)، ویرایشِ مشخصات، لینکِ پرونده، پیامکِ لینک، و تماس. نوبت‌دهیِ
 * بیمارمحور هنوز endpointِ خودش را ندارد (W3.3) و دکمه‌ای که به صفحهٔ
 * بی‌خبر از بیمار می‌رود، در نمی‌زند — به دیوار می‌زند.
 */
/**
 * **دورهٔ درمان** (W4.1) — «بیمارِ دوره‌دار مراحلش را با مسئول و موعد ببیند».
 *
 * ⚠️ فقط وقتی دیده می‌شود که دوره‌ای وجود داشته باشد. ماژولِ `pathway` روی
 * نصب روشن است ولی تا کسی دوره‌ای **شروع** نکند این بخش اصلاً رندر نمی‌شود —
 * نصبی که امروز کار می‌کند نباید یک‌شبه یک کارتِ خالیِ تازه ببیند.
 *
 * ⚠️ ۴۰۳ (ماژول خاموش یا بی‌مجوز) **سکوت** است نه خطا: مسیرِ درمان بخشِ
 * اختیاریِ پرونده است و کاربری که دسترسی ندارد نباید بنرِ قرمز ببیند.
 */
function Pathway({ patientId, toast }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(0);
  const load = useCallback(
    () => api(`/pathway/episodes?patientId=${patientId}`).then(setRows).catch(() => setRows([])),
    [patientId],
  );
  useEffect(() => { load(); }, [load]);
  if (!rows?.length) return null;

  const mark = async (step, status) => {
    setBusy(step.id);
    try {
      await api(`/pathway/steps/${step.id}`, { method: 'PATCH', body: { status } });
      toast(status === 'done' ? 'مرحله انجام شد ✓' : 'مرحله رد شد');
      await load();
    } catch (e) { toast(e?.message || 'ثبت نشد', true); } finally { setBusy(0); }
  };

  return (
    <>
      {rows.map((ep) => (
        <section key={ep.id} className="rc-path" aria-label={`دورهٔ ${ep.title}`}>
          <header className="rc-path-head">
            <b>{ep.title}</b>
            <span className={`rc-path-st st-${ep.status}`}>{ep.statusFa}</span>
            {/* درصد از سرور می‌آید (قانون ۱۵)؛ رابط فرمولی حساب نمی‌کند. */}
            <small>{faNum(ep.counts.done)} از {faNum(ep.counts.total)} مرحله</small>
          </header>
          <div className="rc-path-bar" role="img"
               aria-label={`${faNum(ep.percent)} درصدِ دوره انجام شده`}>
            <i style={{ width: `${ep.percent}%` }} />
          </div>
          <ol className="rc-path-steps">
            {ep.steps.map((st) => (
              <li key={st.id} className={`rc-path-step st-${st.status}`}>
                <div className="rc-path-when">
                  {st.dueAt ? <b>{faDate(st.dueAt)}</b> : <b className="none">—</b>}
                  {/* «مسئول» یعنی نقش، مگر شخصِ مشخصی تعیین شده باشد. */}
                  <small>{st.ownerName || st.ownerRoleFa || '—'}</small>
                </div>
                <div className="rc-path-main">
                  <b>{st.title}</b>
                  {st.notes && <small>{st.notes}</small>}
                </div>
                {ep.status === 'active' && st.status === 'pending' ? (
                  <div className="rc-path-acts">
                    <button type="button" disabled={busy === st.id} onClick={() => mark(st, 'done')}>انجام شد</button>
                    <button type="button" className="ghost" disabled={busy === st.id} onClick={() => mark(st, 'skipped')}>رد</button>
                  </div>
                ) : <span className="rc-path-tag">{st.statusFa}</span>}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}

function RecordActions({ rec, onEdit, onNew, toast, t }) {
  const [busy, setBusy] = useState('');

  const portalLink = async () => {
    setBusy('link');
    try {
      const r = await api(`/patients/${rec.id}/portal-link`, { method: 'POST' });
      /* clipboard در http یا بدونِ اجازه throw می‌کند — آن‌وقت دستِ‌کم خودِ
         نشانی نشان داده می‌شود تا کاربر دستی بردارد. */
      try { await navigator.clipboard.writeText(r.url); toast('لینکِ پرونده کپی شد'); }
      catch { toast(r.url); }
    } catch (e) { toast(e.message, true); } finally { setBusy(''); }
  };

  const portalSms = async () => {
    setBusy('sms');
    try { await api(`/patients/${rec.id}/portal-sms`, { method: 'POST' }); toast('لینک برای بیمار پیامک شد'); }
    catch (e) { toast(e.message, true); } finally { setBusy(''); }
  };

  return (
    <div className="rc-actions">
      {/* فرم در **همین صفحه** پاپ‌آپ می‌شود؛ تا دیروز به داشبورد می‌پرید و پرونده
          از دست می‌رفت (بازخوردِ مالک). */}
      <button type="button" className="rc-act is-main" onClick={onNew}><Plus width="13" height="13" /> {t.visitNew}</button>
      <button type="button" className="rc-act" onClick={onEdit}><Pencil width="13" height="13" /> ویرایشِ مشخصات</button>
      <button type="button" className="rc-act" onClick={portalLink} disabled={busy === 'link'}>
        <LinkIcon width="13" height="13" /> {busy === 'link' ? 'یک لحظه…' : 'لینکِ پرونده'}
      </button>
      <button type="button" className="rc-act" onClick={portalSms} disabled={busy === 'sms'}>
        <Send width="13" height="13" /> {busy === 'sms' ? 'در حالِ ارسال…' : 'پیامکِ لینک'}
      </button>
      {rec.phone && <a className="rc-act" href={`tel:${rec.phone}`}><Phone width="13" height="13" /> تماس</a>}
    </div>
  );
}

/* ══════════════ صفحه ══════════════ */
export default function PatientRecord() {
  const { id } = useParams();
  const { t, defaultKind = 'surgery' } = useConfig();
  const [rec, setRec] = useState(null);
  /* لایهٔ «پاسخ» — جدا از بایگانی و **موازی** با آن. اگر نیامد (سطحِ پایین‌تر،
     خطای شبکه) صفحه با تب‌ها سرِ جایش کار می‌کند؛ پاسخ اضافه است نه شرط. */
  const [live, setLive] = useState(null);
  const [err, setErr] = useState('');
  /* ⚠️ تبِ پیش‌فرض دیگر فرمِ ویرایش نیست. هویت و «چه مانده» و خطِ زمان بالای
     صفحه‌اند؛ تب‌ها بایگانی‌اند و بایگانی با «مراجعات» شروع می‌شود. */
  const [tab, setTab] = useState('visits');
  const tabsRef = useRef(null);
  /* ⚠️ **شکست باید از موفقیت قابلِ تشخیص باشد.**
     تا دیروز toast فقط یک رشته بود و خطا با موفقیت یک شکل داشت: همان قابِ
     بنفش، ۲٫۲ ثانیه، بعد رفت. یعنی اگر ثبتِ شرح ۴۰۳ یا ۵۰۰ می‌گرفت، کاربر
     یک چشمکِ بنفش می‌دید و نتیجه می‌گرفت «سیو نمی‌شود» — بدونِ هیچ متنی که
     بشود گزارشش کرد. دقیقاً همین شکایت آمد و بازتولیدش ممکن نبود، چون خودِ
     پیام هیچ‌جا نمی‌ماند.
     حالا خطا قرمز است، **خودش نمی‌رود** (کاربر می‌بندد) و متنِ سرور را
     کامل نشان می‌دهد. */
  const [toast, setToast] = useState(null);   // { text, bad }
  const say = useCallback((text, bad = false) => setToast(text ? { text, bad } : null), []);

  useEffect(() => {
    if (!toast || toast.bad) return undefined;   // خطا با دستِ کاربر بسته می‌شود
    const t = setTimeout(() => setToast(null), toast.text.length > 40 ? 4500 : 2200);
    return () => clearTimeout(t);
  }, [toast]);

  /* پروندهٔ تازه **برگردانده** می‌شود، نه فقط در state نشانده: فراخوان باید
     بتواند بلافاصله بسنجد که نوشته‌اش واقعاً در پرونده نشسته یا نه. */
  /* ⚠️ **برمی‌گرداند**: کارتِ «کارِ بعدی» تا نشستنِ نسخهٔ تازه باید دکمه را
     قفل نگه دارد، وگرنه کاربر «انجام شد» را دو بار می‌زند و کارِ بسته‌شده
     دوباره بسته می‌شود. (`Today` و زنگ ردیف را محلی برمی‌دارند؛ این‌جا کلِ
     پرونده تازه می‌شود، پس انتظار لازم است.) */
  const loadLive = useCallback(
    () => api(`/patients/${id}/live`).then(setLive).catch(() => setLive(null)),
    [id],
  );

  const load = useCallback(async () => {
    try {
      const fresh = await api(`/patients/${id}/record`);
      setRec(fresh); setErr('');
      /* هر نوشتنی در پرونده (مدرک، شرح، مشخصات) می‌تواند مرحله و خطِ زمان را
         عوض کند، پس «پاسخ» هم با همان `load` تازه می‌شود — وگرنه نوار یک
         حقیقتِ کهنه نشان می‌دهد. */
      loadLive();
      return fresh;
    } catch (e) { setErr(e.message); return null; }
  }, [id, loadLive]);
  useEffect(() => { load(); }, [load]);

  /* رفتن به یک تب از بیرونِ نوار (خطِ زمان، کارتِ مالی، دکمهٔ ویرایش). */
  const goTab = useCallback((k) => {
    setTab(k);
    tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  /* پاپ‌آپِ یک چیز از هر جای صفحه (خطِ زمان، کارتِ «چه مانده»، تبِ مراجعات) —
     همان ماژولِ مشترکِ «امروز» و «کارهای من» (`thing-popups.jsx`): دادهٔ کامل
     همان‌جا خوانده می‌شود، و هر ثبتی «پاسخ» را تازه می‌کند. */
  const things = useThings({ patientId: Number(id), onChanged: loadLive, toast: say });
  const openThing = things.open;

  useEffect(() => {
    document.title = rec ? `پروندهٔ ${rec.fullName} — عمل‌یار` : 'پروندهٔ بیمار — عمل‌یار';
  }, [rec]);

  const save = async (body) => { setRec(await api(`/patients/${id}`, { method: 'PATCH', body })); };

  if (err) return <div className="df"><div className="df-bg" /><div className="df-empty">{err}</div></div>;
  if (!rec) return <div className="df"><div className="df-bg" /><div className="df-empty">در حال بارگذاری…</div></div>;

  const TABS = [
    /* «خلاصه» نامِ درستی نبود: این تب یک فرمِ ویرایشِ کامل است و خلاصه حالا
       بالای صفحه است. اسمِ درست، انتظارِ درست. */
    ['profile', 'مشخصات'],
    /* واژهٔ **خنثی**: این فهرست عمل و ویزیت را با هم دارد و هر کارت نوعِ خودش را
       می‌گوید؛ «ویزیت‌ها» برای مطبی که عملِ جراحی هم ثبت می‌کند دروغ بود (مالک). */
    ['visits', `مراجعه‌ها (${faNum(rec.counts.visits)})`],
    ...(rec.counts.visits > 1 ? [['journey', 'مسیرِ درمان']] : []),
    ['docs', `مدارک (${faNum(rec.counts.documents)})`],
    /* فقط وقتی چیزی هست: تبِ همیشه‌خالی، فضای نوارِ تب را می‌گیرد و هیچ
       نمی‌گوید. نصبی که فرمِ زیرپرونده ندارد اصلاً این تب را نمی‌بیند. */
    ...(rec.counts.forms > 0 ? [['forms', `فرم‌ها (${faNum(rec.counts.forms)})`]] : []),
    ...(rec.clinicalVisible ? [['notes', `شرح‌ها (${faNum(rec.counts.notes)})`]] : []),
  ];

  return (
    <div className="df">
      <div className="df-bg" />
      <header className="df-head">
        <Link className="df-back" to="/app/dashboard"><Back width="14" height="14" /> داشبورد</Link>
        <div>
          <h1>{rec.fullName}</h1>
          <p>
            <span dir="ltr">{rec.code}</span>
            {rec.age != null && ` · ${faNum(rec.age)} ساله`}
            {rec.gender && ` · ${rec.gender === 'female' ? 'زن' : 'مرد'}`}
            {rec.nationalId && ` · کد ملی ${faNum(rec.nationalId)}`}
            {rec.phone && ` · ${faNum(rec.phone)}`}
          </p>
        </div>
        {rec.clinicalVisible && (
          <RefSummary rec={rec} toast={say} />
        )}
      </header>

      {/* هشدارِ حساسیت باید پیش از هر چیزِ دیگری دیده شود، نه لای فرم. */}
      {rec.allergies && <div className="rc-alert"><Alert size={13} /> حساسیت: {rec.allergies}</div>}

      {/* کارتِ هویت **فقط‌خواندنی** است و ویرایش یک اقدام (§۴.۳ بندِ ۱). */}
      {(rec.insurer || rec.bloodType || rec.chronicConditions || rec.medications) && (
        <dl className="rc-id">
          {rec.bloodType && <div><dt>گروهِ خونی</dt><dd dir="ltr">{rec.bloodType}</dd></div>}
          {rec.insurer && <div><dt>بیمه</dt><dd>{rec.insurer}{rec.insuranceNo ? ` — ${faNum(rec.insuranceNo)}` : ''}</dd></div>}
          {rec.chronicConditions && <div><dt>بیماریِ زمینه‌ای</dt><dd>{rec.chronicConditions}</dd></div>}
          {rec.medications && <div><dt>داروها</dt><dd>{rec.medications}</dd></div>}
        </dl>
      )}

      <RecordActions
        rec={rec} onEdit={() => goTab('profile')} toast={say} t={t}
        onNew={() => things.show({ type: 'visit', prefill: { patientId: rec.id, patientName: rec.fullName, kind: defaultKind } })}
      />

      {live && <StageBar stage={live.stage} t={t} />}
      {live && <NextUp live={live} onGo={goTab} onActed={loadLive} toast={say} onOpen={openThing} />}
      {live && <Timeline live={live} onGo={goTab} t={t} onOpen={openThing} />}
      <Pathway patientId={rec.id} toast={say} />

      <div ref={tabsRef} />
      <Tabs
        label="بخش‌های پرونده"
        variant="scroll"
        value={tab}
        onChange={setTab}
        items={TABS.map(([k, l]) => ({ key: k, label: l }))}
      />

      <div className="rc-body">
        {tab === 'profile' && <ProfileTab key={rec.updatedAt} rec={rec} onSave={save} toast={say} />}
        {tab === 'visits' && <VisitsTab rec={rec} onErr={(m) => say(m, true)} onOpen={openThing} />}
        {tab === 'journey' && <JourneyTab rec={rec} />}
        {tab === 'docs' && <DocsTab rec={rec} reload={load} toast={say} />}
        {tab === 'forms' && <FormsTab rec={rec} onErr={(m) => say(m, true)} />}
        {tab === 'notes' && <NotesTab rec={rec} reload={load} toast={say} />}
      </div>

      {/* ── پاپ‌آپ‌ها: هر چیزی در همین صفحه باز می‌شود ── */}
      <ThingPopups
        things={things}
        onVisitSaved={(saved, wasEdit, opts) => {
          load();
          /* «کاندیدای جراحی» — همان رفتارِ داشبورد: فرمِ عملِ همین بیمار بلافاصله. */
          if (opts?.openSurgery) {
            say('تصمیم ثبت شد ✓ حالا فرمِ عمل را برای همین بیمار پر کنید');
            /* همان پیوندِ داشبورد — شکایتِ اولیه از ویزیتِ تصمیم مشتق می‌شود. */
            setTimeout(() => things.show({ type: 'visit', prefill: {
              patientId: rec.id, patientName: rec.fullName, kind: 'surgery',
              decidedInVisitId: saved.id, chiefComplaint: saved.chiefComplaint, decidedInDate: saved.opDate,
            } }), 400);
            return;
          }
          say(wasEdit ? `${t.visit} ویرایش شد ✓` : `${t.visit} ثبت شد ✓`);
        }}
      />

      {toast && (
        <button
          type="button"
          className={`df-toast${toast.bad ? ' bad' : ''}`}
          onClick={() => setToast(null)}
          aria-live={toast.bad ? 'assertive' : 'polite'}
        >
          {toast.text}
          {toast.bad && <i>ثبت نشد — برای بستن بزنید</i>}
        </button>
      )}
    </div>
  );
}


/**
 * خلاصهٔ ارجاع با دستیارِ AI (#53) — از مراجعه‌ها و شرح‌های همین پرونده،
 * متنِ ارجاع می‌سازد. فقط نمایش/کپی/ثبتِ اختیاری به‌عنوانِ «مشاوره» — تا
 * دکمهٔ ثبت زده نشود چیزی در پرونده نمی‌نشیند. دکمه فقط وقتی دستیار
 * پیکربندی شده دیده می‌شود.
 */
function RefSummary({ rec, toast }) {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState(null);

  useEffect(() => {
    let alive = true;
    api('/ai/status').then((r) => { if (alive) setOn(!!r?.enabled); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const make = async () => {
    setBusy(true);
    try {
      const r = await api('/ai/record-summary', { method: 'POST', body: { patientId: rec.id } });
      setText(r.text);
    } catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast('کپی شد ✓'); }
    catch { toast('کپی نشد — دستی انتخاب کنید', true); }
  };

  const saveAsConsult = async () => {
    setBusy(true);
    try {
      await api(`/patients/${rec.id}/notes`, { method: 'POST', body: { kind: 'consult', body: text } });
      toast('به‌عنوانِ «مشاوره» در پرونده ثبت شد ✓');
      setText(null);
    } catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };

  if (!on) return null;
  return (
    <>
      <button type="button" className="rc-refsum-btn" onClick={make} disabled={busy}>
        {busy && text === null ? 'در حالِ خلاصه‌سازی…' : 'خلاصهٔ ارجاع (AI)'}
      </button>
      <AnimatePresence>
        {text !== null && (
          <Overlay backdrop="rc-refsum-bg" panel="glass rc-refsum" as="section" onClose={() => setText(null)} role="dialog" aria-label="خلاصهٔ ارجاع">
            <header>
              <b>خلاصهٔ ارجاع — پیش‌نویسِ دستیار</b>
              <button type="button" onClick={() => setText(null)} aria-label="بستن"><Close width="17" height="17" /></button>
            </header>
            <div className="rc-refsum-body">{text}</div>
            <footer>
              <button type="button" className="rc-refsum-ghost" onClick={copy}>کپی</button>
              <button type="button" className="rc-refsum-main" disabled={busy} onClick={saveAsConsult}>
                ثبت به‌عنوانِ «مشاوره» در پرونده
              </button>
            </footer>
          </Overlay>
        )}
      </AnimatePresence>
    </>
  );
}
