import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, apiBlobUrl, apiUpload } from '../lib/api.js';
import { faDate, isoToJStr, jStrToIso } from '../lib/jalali.js';
import { toEnDigits } from '../lib/identity.js';
import './launcher.css';
import './definitions.css';
import JDate from './JDate.jsx';
import './record.css';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' };
const Back = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 5 5v6" /></svg>);
const Plus = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M12 5v14M5 12h14" /></svg>);
const XIc = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M18 6 6 18M6 6l12 12" /></svg>);
const Trash = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>);
const Pencil = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" /></svg>);
const DlIc = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M12 3v12" /><path d="m7 11 5 5 5-5" /><path d="M4 21h16" /></svg>);
const Lock = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>);

const CATEGORIES = {
  lab: 'آزمایش', imaging: 'تصویربرداری', report: 'گزارش',
  consent: 'رضایت‌نامه', identity: 'مدرکِ شناسایی', receipt: 'فیشِ پرداخت', other: 'متفرقه',
};
const NOTE_KINDS = {
  visit: 'شرحِ ویزیت', op: 'شرحِ عمل', progress: 'سیرِ بیماری',
  discharge: 'خلاصهٔ ترخیص', consult: 'مشاوره',
};
const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const STATUS_FA = { pending: 'در انتظار', done: 'تمام‌شده', cancelled: 'کنسل' };
/** برچسبِ نوعِ ملاقات — همان فهرستِ داشبورد؛ پرونده باید ویزیت و عمل را از هم جدا نشان دهد. */
const VISIT_KINDS = { surgery: 'عمل', clinic: 'ویزیت', followup: 'پیگیری', consult: 'مشاوره' };

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
      if (!birthDate) { toast('تاریخِ تولد نامعتبر است (مثال: ۱۳۷۰/۰۱/۱۵)'); return; }
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
      toast(e.message);
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
function VisitsTab({ rec }) {
  if (!rec.visits.length) return <div className="df-empty">هنوز مراجعه‌ای ثبت نشده است</div>;
  return (
    <div className="df-list">
      {rec.visits.map((v) => (
        <div key={v.id} className="df-row">
          <div className="df-row-main">
            <b>
              <span dir="ltr">{v.code}</span>
              <i className={`rc-kind k-${v.kind || 'surgery'}`}>{VISIT_KINDS[v.kind] ?? VISIT_KINDS.surgery}</i>
              {v.procedureTypeName ? ` — ${v.procedureTypeName}` : ''}
            </b>
            <small>
              {[v.surgeonName && `جراح: ${v.surgeonName}`, v.hospitalName, v.techName && `کارشناس: ${v.techName}`,
                v.opDate && faDate(v.opDate)].filter(Boolean).join(' · ') || '—'}
            </small>
            {v.diagnosisTitle && <small>تشخیص: {v.diagnosisTitle}</small>}
          </div>
          <span className={`rc-st rc-st-${v.opStatus}`}>{STATUS_FA[v.opStatus]}</span>
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
      if (!takenAt) { toast('تاریخِ مدرک نامعتبر است (مثال: ۱۴۰۵/۰۴/۲۸)'); return; }
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
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (doc) => {
    try {
      await api(`/patients/documents/${doc.id}`, { method: 'DELETE' });
      await reload();
      toast('مدرک حذف شد');
    } catch (e) { toast(e.message); }
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
              {d.isImage ? <DocThumb id={d.id} alt={d.title || d.fileName} /> : <div className="rc-thumb rc-thumb-file">{(d.fileName.split('.').pop() || '?').slice(0, 4)}</div>}
              <div className="rc-doc-main">
                <b>{d.title || d.fileName}</b>
                <small>{CATEGORIES[d.category] ?? d.category} · {fmtSize(d.size)}{d.takenAt ? ` · ${faDate(d.takenAt)}` : ''}</small>
                {d.visitId && <small className="rc-doc-visit">{rec.visits.find((v) => v.id === d.visitId)?.code}</small>}
              </div>
              <div className="df-acts">
                <button title="دانلود" onClick={() => openDoc(d, toast)}><DlIc width="14" height="14" /></button>
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
  const [kind, setKind] = useState('visit');
  const [body, setBody] = useState('');
  const [visitId, setVisitId] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // {id, body}
  const [history, setHistory] = useState(null);

  const add = async () => {
    if (!body.trim()) { toast('متنِ شرح خالی است'); return; }
    setBusy(true);
    try {
      await api(`/patients/${rec.id}/notes`, {
        method: 'POST',
        body: { kind, body: body.trim(), ...(visitId ? { visitId: +visitId } : {}) },
      });
      setBody(''); setVisitId('');
      await reload();
      toast('شرح ثبت شد ✓');
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };

  const amend = async () => {
    setBusy(true);
    try {
      await api(`/patients/notes/${editing.id}`, { method: 'PATCH', body: { body: editing.body.trim() } });
      setEditing(null);
      await reload();
      toast('نسخهٔ تازه ثبت شد ✓ (نسخهٔ قبلی در تاریخچه می‌ماند)');
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };

  const showHistory = async (note) => {
    try { setHistory({ note, rows: await api(`/patients/notes/${note.id}/history`) }); }
    catch (e) { toast(e.message); }
  };

  return (
    <>
      <div className="rc-upload">
        <div className="pf-row2">
          <label className="pf-field"><span>نوعِ شرح</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.entries(NOTE_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="pf-field"><span>مربوط به مراجعه</span>
            <select value={visitId} onChange={(e) => setVisitId(e.target.value)}>
              <option value="">— کلِ پرونده —</option>
              {rec.visits.map((v) => <option key={v.id} value={v.id}>{v.code}</option>)}
            </select>
          </label>
        </div>
        <label className="pf-field"><span>متن</span>
          <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="یافته‌ها، سیرِ بیماری، توصیه‌ها…" />
        </label>
        <button className="df-save rc-save" onClick={add} disabled={busy}>
          <Plus width="15" height="15" /> ثبتِ شرح
        </button>
      </div>

      {rec.clinicalNotes.length === 0 ? <div className="df-empty">شرحی ثبت نشده است</div> : (
        <div className="df-list">
          {rec.clinicalNotes.map((n) => (
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

      {editing && (
        <div className="df-overlay" onClick={(e) => { if (e.target === e.currentTarget) setEditing(null); }}>
          <div className="df-sheet">
            <div className="df-sheet-head">
              <b>ویرایشِ شرح</b>
              <button className="df-x" onClick={() => setEditing(null)}><XIc width="16" height="16" /></button>
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
          </div>
        </div>
      )}

      {history && (
        <div className="df-overlay" onClick={(e) => { if (e.target === e.currentTarget) setHistory(null); }}>
          <div className="df-sheet">
            <div className="df-sheet-head">
              <b>تاریخچهٔ شرح</b>
              <button className="df-x" onClick={() => setHistory(null)}><XIc width="16" height="16" /></button>
            </div>
            <div className="df-sheet-body rc-history">
              {history.rows.map((r, i) => (
                <div key={r.id} className={`rc-hrow${i === 0 ? ' on' : ''}`}>
                  <small>{i === 0 ? 'نسخهٔ جاری' : `جایگزین‌شده در ${faDate(r.replacedAt)}`}{r.authorName ? ` · ${r.authorName}` : ''}</small>
                  <p>{r.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ══════════════ صفحه ══════════════ */
export default function PatientRecord() {
  const { id } = useParams();
  const [rec, setRec] = useState(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('profile');
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), toast.length > 40 ? 4500 : 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    try { setRec(await api(`/patients/${id}/record`)); setErr(''); }
    catch (e) { setErr(e.message); }
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
    ['docs', `مدارک (${faNum(rec.counts.documents)})`],
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
      </header>

      {/* هشدارِ حساسیت باید پیش از هر چیزِ دیگری دیده شود، نه لای فرم. */}
      {rec.allergies && <div className="rc-alert">⚠️ حساسیت: {rec.allergies}</div>}

      <div className="df-tabs">
        {TABS.map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      <div className="rc-body">
        {tab === 'profile' && <ProfileTab key={rec.updatedAt} rec={rec} onSave={save} toast={setToast} />}
        {tab === 'visits' && <VisitsTab rec={rec} />}
        {tab === 'docs' && <DocsTab rec={rec} reload={load} toast={setToast} />}
        {tab === 'notes' && <NotesTab rec={rec} reload={load} toast={setToast} />}
      </div>

      {toast && <div className="df-toast">{toast}</div>}
    </div>
  );
}
