import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { api, apiBlobUrl, apiStream, apiUpload } from '../lib/api.js';
import { faDate, isoToJStr, jStrToIso } from '../lib/jalali.js';
import { toEnDigits } from '../lib/identity.js';
import './launcher.css';
import './definitions.css';
import JDate from './JDate.jsx';
import './record.css';
import { Alert, Back, Close, Download, LinkIcon, Lock, Pencil, Plus, Trash } from '../ui/icons.jsx';
import Tabs from '../ui/Tabs.jsx';
import Overlay from '../ui/Overlay.jsx';
import VoiceInput from '../ui/VoiceInput.jsx';


const CATEGORIES = {
  lab: 'آزمایش', imaging: 'تصویربرداری', report: 'گزارش',
  consent: 'رضایت‌نامه', identity: 'مدرکِ شناسایی', receipt: 'فیشِ پرداخت', other: 'متفرقه',
};
const NOTE_KINDS = {
  history: 'شرحِ حال', visit: 'شرحِ ویزیت', op: 'شرحِ عمل', progress: 'سیرِ بیماری',
  discharge: 'خلاصهٔ ترخیص', consult: 'مشاوره',
};
const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const STATUS_FA = { pending: 'در انتظار', done: 'تمام‌شده', cancelled: 'کنسل' };
/** برچسبِ نوعِ ملاقات — همان فهرستِ داشبورد؛ پرونده باید ویزیت و عمل را از هم جدا نشان دهد. */
/**
 * برچسبِ **پشتیبان** — نه فهرستِ نوع‌ها.
 *
 * ⚠️ نوع‌ها را سوپرادمین در فرم‌ساز می‌سازد؛ این‌جا فقط برای مراجعاتی مانده
 * که نوعشان دیگر فرمی ندارد (فرمش حذف شده) یا پیش از رسیدنِ تعریف. نوعِ
 * ناشناخته با **کلیدِ خودش** نشان داده می‌شود نه با «عمل»: برچسبِ حدسی
 * دروغ می‌گوید.
 */
const VISIT_KINDS = { surgery: 'عمل', clinic: 'ویزیت', followup: 'پیگیری', consult: 'مشاوره' };
const kindLabel = (k, defs) => defs?.[k] ?? VISIT_KINDS[k] ?? k ?? '—';

const faNum = (v) => String(v ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const fmtSize = (b) => (b < 1024 ? `${faNum(b)} بایت`
  : b < 1024 * 1024 ? `${faNum((b / 1024).toFixed(0))} کیلوبایت`
  : `${faNum((b / 1024 / 1024).toFixed(1))} مگابایت`);

/* ── پیش‌نمایشِ عکس: فایل پشتِ توکن است، پس باید blob گرفته شود ── */
function DocThumb({ id, alt }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    let made = null;
    apiBlobUrl(`/patients/documents/${id}/file`)
      .then((u) => { if (alive) { made = u; setUrl(u); } else URL.revokeObjectURL(u); })
      .catch(() => {});
    // بدونِ revoke، هر بار بازکردنِ پرونده یک blob در حافظه جا می‌گذارد.
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [id]);
  return url ? <img className="rc-thumb" src={url} alt={alt} /> : <div className="rc-thumb rc-thumb-ph" />;
}

/* ── دانلود/بازکردنِ مدرک با توکن ── */
async function openDoc(doc, onErr) {
  try {
    const url = await apiBlobUrl(`/patients/documents/${doc.id}/file`);
    const a = document.createElement('a');
    a.href = url;
    if (!doc.isImage) a.download = doc.fileName;
    else a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    onErr(e.message);
  }
}

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
          <label className="pf-field"><span>حساسیت‌ها</span><textarea rows={2} value={f.allergies} onChange={set('allergies')} placeholder="دارو، غذا، ماده بی‌هوشی…" /></label>
          <label className="pf-field"><span>بیماری‌های زمینه‌ای</span><textarea rows={2} value={f.chronicConditions} onChange={set('chronicConditions')} /></label>
          <label className="pf-field"><span>داروهای مصرفی</span><textarea rows={2} value={f.medications} onChange={set('medications')} /></label>

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
          <label className="pf-field"><span>یادداشت</span><textarea rows={2} value={f.notes} onChange={set('notes')} /></label>
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
/** مقدارِ پاسخ به متنِ خواندنی — ارقام فارسی، آرایه با «،»، بولی به بله/خیر. */
function answerText(v) {
  if (typeof v === 'boolean') return v ? 'بله' : 'خیر';
  if (Array.isArray(v)) return faNum(v.join('، '));
  return faNum(String(v));
}

function FormsTab({ rec }) {
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
                  <dd>{answerText(a.value)}</dd>
                </Fragment>
              ))}
            </dl>
          )}
        </div>
      ))}
    </div>
  );
}

function VisitsTab({ rec }) {
  if (!rec.visits.length) return <div className="df-empty">هنوز مراجعه‌ای ثبت نشده است</div>;
  return (
    <div className="df-list">
      {rec.visits.map((v) => (
        <div key={v.id} className="df-row">
          <div className="df-row-main">
            <b>
              <span dir="ltr">{v.code}</span>
              <i className="rc-kind" style={v.kindColor ? { '--k': `var(--kind-${v.kindColor})` } : undefined}>
                {v.kindTitle || kindLabel(v.kind, rec.kindTitles)}
              </i>
              {v.procedureTypeName ? ` — ${v.procedureTypeName}` : ''}
            </b>
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
                    <dd>{a.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          <span className={`rc-st rc-st-${v.opStatus}`}>{STATUS_FA[v.opStatus]}</span>
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
          <span className={`rc-st rc-st-${r.opStatus}`}>{STATUS_FA[r.opStatus]}</span>
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
  const [takenJ, setTakenJ] = useState('');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);
  const [filter, setFilter] = useState('all');

  const upload = async (file) => {
    if (!file) return;
    let takenAt;
    if (takenJ.trim()) {
      takenAt = jStrToIso(takenJ);
      if (!takenAt) { toast('تاریخِ مدرک نامعتبر است (مثال: ۱۴۰۵/۰۴/۲۸)', true); return; }
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('category', cat);
      if (title.trim()) fd.append('title', title.trim());
      if (visitId) fd.append('visitId', visitId);
      if (takenAt) fd.append('takenAt', takenAt);
      await apiUpload(`/patients/${rec.id}/documents`, fd);
      setTitle(''); setTakenJ(''); setVisitId('');
      if (fileRef.current) fileRef.current.value = '';
      await reload();
      toast('مدرک اضافه شد ✓');
    } catch (e) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  /* مدرکِ لینکی — MRI/پاراکلینیکی که روی پکس/درایو/سایتِ آزمایشگاه است و
     فایلش را کسی ندارد؛ دسته/عنوان/تاریخ از همان فیلدهای بالا می‌آید. */
  const [linkUrl, setLinkUrl] = useState('');
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
          ...(takenAt ? { takenAt } : {}),
        },
      });
      setLinkUrl(''); setTitle(''); setTakenJ(''); setVisitId('');
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

  const shown = filter === 'all' ? rec.documents : rec.documents.filter((d) => d.category === filter);
  const present = [...new Set(rec.documents.map((d) => d.category))];

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
            <select value={visitId} onChange={(e) => setVisitId(e.target.value)}>
              <option value="">— کلِ پرونده —</option>
              {rec.visits.map((v) => <option key={v.id} value={v.id}>{v.code}</option>)}
            </select>
          </label>
        </div>
        {/* inputِ نیتیو «Choose File» انگلیسی نشان می‌دهد و در رابطِ فارسی وصله است؛
            پس پنهانش می‌کنیم و خودِ label ناحیهٔ کلیک/رها‌کردن می‌شود. */}
        <label
          className={`rc-drop${drag ? ' on' : ''}${busy ? ' busy' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files?.[0]); }}
        >
          <input ref={fileRef} type="file" disabled={busy} onChange={(e) => upload(e.target.files?.[0])} />
          <b>{busy ? 'در حال آپلود…' : 'انتخاب یا رهاکردنِ فایل'}</b>
          <small>عکس، PDF یا هر مدرکِ دیگر — تا {faNum(25)} مگابایت</small>
        </label>
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
          <button type="button" className="df-save" disabled={busy || !linkUrl.trim()} onClick={addLink}>
            ثبتِ لینک
          </button>
        </div>
      </div>

      {present.length > 1 && (
        <div className="df-tabs rc-filter">
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>همه</button>
          {present.map((c) => (
            <button key={c} className={filter === c ? 'on' : ''} onClick={() => setFilter(c)}>{CATEGORIES[c] ?? c}</button>
          ))}
        </div>
      )}

      {shown.length === 0 ? <div className="df-empty">مدرکی ثبت نشده است</div> : (
        <div className="rc-docs">
          {shown.map((d) => (
            <div key={d.id} className="rc-doc">
              {d.isLink
                ? <div className="rc-thumb rc-thumb-file"><LinkIcon width="16" height="16" /></div>
                : d.isImage
                  ? <DocThumb id={d.id} alt={d.title || d.fileName} />
                  : <div className="rc-thumb rc-thumb-file">{(d.fileName.split('.').pop() || '?').slice(0, 4)}</div>}
              <div className="rc-doc-main">
                <b>{d.title || d.fileName}</b>
                <small>{CATEGORIES[d.category] ?? d.category} · {d.isLink ? 'لینک' : fmtSize(d.size)}{d.takenAt ? ` · ${faDate(d.takenAt)}` : ''}</small>
                {d.visitId && <small className="rc-doc-visit">{rec.visits.find((v) => v.id === d.visitId)?.code}</small>}
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

/* ══════════════ تبِ شرح‌ها ══════════════ */
function NotesTab({ rec, reload, toast }) {
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
    try {
      setRawBody(raw);
      if (mode === 'structure') setBody('');
      else setBody((b) => (!b || b.endsWith('\n') ? b : `${b}\n`));
      await apiStream(
        '/ai/note-draft/stream',
        { patientId: rec.id, kind, mode, text: raw, ...(visitId ? { visitId: +visitId } : {}) },
        (d) => setBody((b) => b + d),
      );
      /* متنِ کامل، همان‌طور که دستیار تحویل داد — مبنای تشخیصِ اصلاحِ دستی. */
      setBody((b) => { lastDraftRef.current = b; return b; });
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
        {Object.entries(NOTE_KINDS).map(([k, l]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
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
            <select value={visitId} onChange={(e) => setVisitId(e.target.value)}>
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
                title={t.specific ? 'اختصاصیِ همین عمل/تشخیص/موضوع' : 'قالبِ عمومی'}
                onClick={() => setBody((b) => (b.trim() ? `${b}\n\n${t.body}` : t.body))}
              >
                {t.title}
              </button>
            ))}
          </div>
        )}
        <label className="pf-field"><span>متن</span>
          <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="یافته‌ها، سیرِ بیماری، توصیه‌ها…" />
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
            <button type="button" className="rc-ai-undo" onClick={() => { setBody(rawBody); setRawBody(null); }}>
              برگرداندنِ متنِ خام
            </button>
          )}
          <button className="df-save rc-save" onClick={add} disabled={busy || aiBusy}>
            {/* نوع در متنِ دکمه می‌آید تا وقتی چیپ بالا از چشم افتاده، کاربر
                نداند دارد چه چیزی ثبت می‌کند. */}
            <Plus width="15" height="15" /> ثبتِ {NOTE_KINDS[kind]}
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
        <div className="df-empty">هنوز «{NOTE_KINDS[kind]}»ی ثبت نشده است</div>
      ) : (
        <div className="df-list">
          {shown.map((n) => (
            <div key={n.id} className="rc-note">
              <div className="rc-note-head">
                <b>{NOTE_KINDS[n.kind] ?? n.kind}</b>
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
                <textarea rows={7} value={editing.body} onChange={(e) => setEditing((s) => ({ ...s, body: e.target.value }))} />
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

/* ══════════════ صفحه ══════════════ */
export default function PatientRecord() {
  const { id } = useParams();
  const [rec, setRec] = useState(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('profile');
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
  const load = useCallback(async () => {
    try { const fresh = await api(`/patients/${id}/record`); setRec(fresh); setErr(''); return fresh; }
    catch (e) { setErr(e.message); return null; }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    document.title = rec ? `پروندهٔ ${rec.fullName} — عمل‌یار` : 'پروندهٔ بیمار — عمل‌یار';
  }, [rec]);

  const save = async (body) => { setRec(await api(`/patients/${id}`, { method: 'PATCH', body })); };

  if (err) return <div className="df"><div className="df-bg" /><div className="df-empty">{err}</div></div>;
  if (!rec) return <div className="df"><div className="df-bg" /><div className="df-empty">در حال بارگذاری…</div></div>;

  const TABS = [
    ['profile', 'خلاصه'],
    ['visits', `مراجعات (${faNum(rec.counts.visits)})`],
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

      <Tabs
        label="بخش‌های پرونده"
        variant="scroll"
        value={tab}
        onChange={setTab}
        items={TABS.map(([k, l]) => ({ key: k, label: l }))}
      />

      <div className="rc-body">
        {tab === 'profile' && <ProfileTab key={rec.updatedAt} rec={rec} onSave={save} toast={say} />}
        {tab === 'visits' && <VisitsTab rec={rec} />}
        {tab === 'journey' && <JourneyTab rec={rec} />}
        {tab === 'docs' && <DocsTab rec={rec} reload={load} toast={say} />}
        {tab === 'forms' && <FormsTab rec={rec} />}
        {tab === 'notes' && <NotesTab rec={rec} reload={load} toast={say} />}
      </div>

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
