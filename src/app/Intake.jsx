import { QuickDefinitionEditor } from './Definitions.jsx';
import { useAuth } from './auth.jsx';
import { useConfig } from './config.jsx';
import RequiredItems from './RequiredItems.jsx';
import DynForm from '../ui/DynForm.jsx';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { api, apiBlobUrl } from '../lib/api.js';
import { faDate, isoToJStr, jStrToIso } from '../lib/jalali.js';
import './intake-admin.css';
import './dashboard.css'; // bl-mini / db-hint
import { Alert, Back, Bank, CheckCircle, Close, Copy, Doctor, Eye, Form, Hospital, Pencil, Plus, Search, Send, Trash } from '../ui/icons.jsx';
import { group3, numToWordsFa, parseMoney } from '../lib/money.js';
import Tabs from '../ui/Tabs.jsx';
import Overlay from '../ui/Overlay.jsx';
import JDate from './JDate.jsx';
import TimePick from '../ui/TimePick.jsx';
import { useStagger } from '../ui/stagger.js';

const faNum = (n) => Number(n ?? 0).toLocaleString('fa-IR');
/* ⚠️ برای شماره‌ی موبایل `faNum` **غلط** است: `Number` صفرِ اول را می‌خورد و
   جداکنندهٔ سه‌رقمی می‌گذارد — «۰۹۱۲۱۲۳۴۵۶۷» به «۹٬۱۲۱٬۲۳۴٬۵۶۷» تبدیل می‌شد. */
const faDigits = (v) => String(v ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
/* ⚠️ مبلغ‌ها تومان‌اند؛ نسخهٔ اول تقسیم بر ۱۰ می‌کرد و عددِ یک‌دهم نشان می‌داد. */

const TABS = [
  { key: 'pending_approval', label: 'در انتظارِ تأیید' },
  { key: 'pending_payment', label: 'در انتظارِ فیش' },
  { key: 'pending_fill', label: 'ناتمام' },
  { key: 'approved', label: 'تأییدشده' },
  { key: 'all', label: 'همه' },
];

/**
 * صفِ ثبت‌نامِ بیماران.
 *
 * ⚠️ **تأیید همان‌جایی است که ادعا به داده تبدیل می‌شود.** بیمار نوشته «دکتر
 * رضایی» — ادمین باید آن را به جراحِ تعریف‌شده گره بزند، وگرنه گزارشِ «درآمد
 * به تفکیکِ جراح» روی متنِ آزاد ساخته می‌شود و بی‌معنا است. برای همین فرمِ
 * تأیید انتخابگرِ واقعی دارد، نه یک دکمهٔ «تأیید».
 */
export default function IntakeAdmin() {
  const [tab, setTab] = useState('pending_approval');
  const [rows, setRows] = useState(null);
  const [links, setLinks] = useState([]);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [approving, setApproving] = useState(null);
  /* `true` یعنی «لینکِ تازه»، و یک شیء یعنی «همین لینک را ویرایش کن» — یک
     state برای یک شیت، نه دو تا که بشود هر دو را با هم باز کرد. */
  const [newLink, setNewLink] = useState(false);
  /* شمارهٔ درحالِ ارسال — `null` یعنی هیچ ردیفی باز نیست. */
  const [smsFor, setSmsFor] = useState(null);
  const [zoom, setZoom] = useState(null); // نشانیِ blobِ فیشِ در حالِ بزرگ‌نمایی
  const row = useStagger();

  useEffect(() => { document.title = 'عمل‌یار — پذیرش'; }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    setErr('');
    try {
      const [s, l] = await Promise.all([api(`/intake/submissions?status=${tab}`), api('/intake/links')]);
      setRows(s);
      setLinks(l);
    } catch (e) { setErr(e.message); setRows([]); }
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  const act = async (id, what, body, msg) => {
    try {
      await api(`/intake/submissions/${id}/${what}`, { method: 'POST', body });
      setToast(msg);
      await load();
    } catch (e) { setToast(e.message); }
  };

  const copyLink = async (token) => {
    const url = `${window.location.origin}/r/${token}`;
    try { await navigator.clipboard.writeText(url); setToast('لینک کپی شد ✓'); }
    catch { setToast(url); }
  };

  /** روشن/خاموشِ لینک — با گزارشِ خطا، نه سکوت. */
  /* حذفِ لینک: ثبت‌نام‌های موجود می‌مانند (سمتِ سرور SetNull)؛ تأییدِ دوقدمی
     با prompt نه، با confirm — عملِ برگشت‌ناپذیرِ ساده. */
  const deleteLink = async (l) => {
    const n = l.submissionCount
      ? `این لینک ${l.submissionCount} ثبت‌نام دارد؛ ثبت‌نام‌ها می‌مانند ولی نشانی برای همیشه بسته می‌شود. حذف شود؟`
      : 'لینک برای همیشه حذف شود؟';
    if (!window.confirm(n)) return;
    try {
      await api(`/intake/links/${l.id}`, { method: 'DELETE' });
      setToast('لینک حذف شد');
      await load();
    } catch (e) { setToast(e.message); }
  };

  const deleteSubmission = async (r) => {
    if (!window.confirm(`ثبت‌نامِ «${r.patient ? `${r.patient.firstName} ${r.patient.lastName}` : r.id}» حذف شود؟ نوبتِ نگه‌داشته هم آزاد می‌شود.`)) return;
    try {
      await api(`/intake/submissions/${r.id}`, { method: 'DELETE' });
      setToast('ثبت‌نام حذف شد');
      await load();
    } catch (e) { setToast(e.message); }
  };

  const toggleLink = async (l) => {
    try {
      await api(`/intake/links/${l.id}`, { method: 'PATCH', body: { active: !l.active } });
      setToast(l.active ? 'لینک غیرفعال شد' : 'لینک فعال شد');
      await load();
    } catch (e) { setToast(e.message); }
  };

  return (
    <div className="ia">
      <div className="ia-bg" aria-hidden="true" />
      <header className="ia-head">
        <Link to="/app" className="ia-back"><Back width="15" height="15" /> سامانه</Link>
        <div>
          <h1>پذیرش</h1>
          <p>فرم‌هایی که بیماران از لینکِ عمومی پر کرده‌اند. تا تأیید نشوند، مراجعه‌ای ساخته نمی‌شود.</p>
        </div>
      </header>

      {/* لینک‌های عمومی — همان چیزی که در بیو و کانال گذاشته می‌شود. */}
      <section className="ia-links">
        <b>لینک‌های ثبت‌نام</b>
        {links.map((l) => (
          <span key={l.id} className={`ia-link${l.active ? '' : ' off'}`}>
            {l.title}
            <em>{faNum(l.amount)} تومان</em>
            {/* ⚠️ بدونِ نشانِ فرم و حساب، دو لینک از هم قابلِ تفکیک نیستند و
                ادمین هیچ راهی ندارد بفهمد حسابِ اشتباهی انتخاب کرده. */}
            {l.formTitle && <i className="ia-chip"><Form width="12" height="12" /> {l.formTitle}</i>}
            {l.bankLabel && (
              <i className={`ia-chip${l.bankHidden ? ' warn' : ''}`}
                 title={l.bankHidden ? 'این حساب دیگر روی فرمِ بیمار نشان داده نمی‌شود' : undefined}>
                <Bank width="12" height="12" /> {l.bankLabel}
              </i>
            )}
            <i>{faNum(l.submissionCount)} ثبت‌نام</i>
            <button type="button" onClick={() => copyLink(l.token)} title="کپیِ نشانی"><Copy width="13" height="13" /></button>
            {/* ⚠️ پریویو = بازکردنِ **همان** نشانیِ بیمار در تبِ تازه، نه یک
                شبیه‌سازی. شبیه‌سازی چیزی را نشان می‌دهد که ممکن است با
                واقعیت فرق داشته باشد؛ این‌طور ادمین دقیقاً همانی را می‌بیند
                که بیمار می‌بیند. `noopener` چون تبِ باز‌شده به `window.opener`
                دسترسی پیدا می‌کند. */}
            <a
              className="ia-linkbtn"
              href={`${window.location.origin}/r/${l.token}`}
              target="_blank" rel="noopener noreferrer" title="پیش‌نمایشِ صفحهٔ بیمار"
            ><Eye width="13" height="13" /></a>
            <button type="button" onClick={() => setNewLink(l)} title="ویرایشِ لینک"><Pencil width="13" height="13" /></button>
            <button type="button" onClick={() => setSmsFor(l)} title="ارسال با پیامک"><Send width="13" height="13" /></button>
            {/* ⚠️ از راهِ `toggleLink` و نه `api(...).then(load)`: نسخهٔ قبلی
                `catch` نداشت، پس یک ۴۰۳ ردیف را بی‌تغییر می‌گذاشت و فقط یک
                unhandled rejection در کنسول می‌ریخت. */}
            <button type="button" onClick={() => toggleLink(l)}>
              {l.active ? 'غیرفعال' : 'فعال'}
            </button>
            <button type="button" className="ia-del" title="حذفِ لینک" onClick={() => deleteLink(l)}>
              <Trash width="13" height="13" />
            </button>
          </span>
        ))}
        <button type="button" className="ia-add" onClick={() => setNewLink(true)}><Plus size={14} /> لینکِ تازه</button>
      </section>

      <Tabs label="وضعیتِ ثبت‌نام" tone="brand" variant="scroll" value={tab} onChange={setTab} items={TABS} />

      {err && <div className="ia-err"><Alert width="15" height="15" /> {err}</div>}

      <div className="ia-list">
        {!rows && !err && <div className="ia-empty">در حال بارگذاری…</div>}
        {rows?.length === 0 && <div className="ia-empty">در این وضعیت ثبت‌نامی نیست</div>}
        {rows?.map((s, i) => (
          <motion.article key={s.id} {...row(i)} className={`ia-card st-${s.status}`}>
            <header>
              <div className="ia-title">
                <b>{s.data?.firstName} {s.data?.lastName}</b>
                <small>
                  {s.patient?.code}
                  {s.patient?.phone ? ` · ${s.patient.phone}` : ''}
                  {s.data?.nationalId ? ` · ${s.data.nationalId}` : ''}
                </small>
              </div>
              <span className={`ia-tag s-${s.status}`}>{s.statusLabel}</span>
              <span className="ia-amount">{faNum(s.amount)} تومان</span>
              {/* حذفِ ثبت‌نام — تأییدشده‌ای که مراجعه ساخته حذف نمی‌شود (سرور هم
                  رد می‌کند)؛ برای بقیه یعنی «این را از صف و پرونده پاک کن». */}
              {!(s.status === 'approved' && s.visitId) && (
                <button type="button" className="ia-cardel" title="حذفِ ثبت‌نام" onClick={() => deleteSubmission(s)}>
                  <Trash width="13" height="13" />
                </button>
              )}
            </header>

            <div className="ia-facts">
              {s.data?.procedure && <span>{s.data.procedure}</span>}
              {s.data?.surgeonName && <span><Doctor width="13" height="13" /> {s.data.surgeonName}</span>}
              {s.data?.hospitalName && <span><Hospital width="13" height="13" /> {s.data.hospitalName}</span>}
              {/* ⚠️ `faDate` نه رشتهٔ خام: مقدارِ ذخیره‌شده ISO است و چاپِ
                  خامش «2026-08-05» به ادمینِ فارسی‌زبان نشان می‌داد. */}
              {s.data?.opDate && <span>{faDate(s.data.opDate)}</span>}
              <span className="ia-when">{faDate(s.createdAt)}</span>
            </div>

            {s.data?.patientNotes && <p className="ia-note">{s.data.patientNotes}</p>}
            {s.reviewNote && <p className="ia-note warn">{s.reviewNote}</p>}
            {s.visitCode && <p className="ia-note ok"><CheckCircle width="13" height="13" /> مراجعهٔ {s.visitCode} ساخته شد</p>}

            {/* فیش روی خودِ کارت هم هست: ادمین اغلب می‌خواهد فقط نگاه کند
                و بعد تصمیم بگیرد، نه اینکه اول شیت را باز کند. */}
            {s.status === 'pending_approval' && (
              <Receipt documentId={s.data?.receiptDocumentId} onOpen={setZoom} />
            )}

            {s.status === 'pending_approval' && (
              <footer className="ia-acts">
                {/* ⚠️ متنِ دکمه از `makesVisit`ِ **سرور** می‌آید: فرمِ زیرپرونده
                    مراجعه نمی‌سازد و «تأیید و ساختِ مراجعه» روی آن یک وعدهٔ
                    دروغ بود. */}
                <button type="button" className="ia-ok" onClick={() => setApproving(s)}>
                  {s.makesVisit === false ? 'تأیید و ثبت در پرونده' : 'تأیید و ساختِ مراجعه'}
                </button>
                <button type="button" className="ia-ghost" onClick={() => {
                  const n = window.prompt('چه چیزی باید اصلاح شود؟');
                  if (n?.trim()) act(s.id, 'return', { note: n.trim() }, 'برای اصلاح برگردانده شد');
                }}>بازگرداندن</button>
                <button type="button" className="ia-no" onClick={() => {
                  const n = window.prompt('دلیلِ رد — بیمار همین را می‌بیند:');
                  if (n?.trim()) act(s.id, 'reject', { note: n.trim() }, 'رد شد');
                }}>رد</button>
              </footer>
            )}

            {/* ⚠️ رکوردِ **خودکارتأییدشده** (فرمِ زیرپرونده‌ی رایگان که بدونِ
                چشمِ انسان approved شده) باید ردشدنی بماند — وگرنه یک ثبتِ
                آشغال از نشانیِ عمومی برای همیشه در پروندهٔ بالینی می‌ماند.
                `autoApproved` از سرور می‌آید؛ تأییدشدهٔ دستی این دکمه را
                نمی‌گیرد و سرور هم پسش می‌زند. */}
            {s.autoApproved && (
              <footer className="ia-acts">
                <button type="button" className="ia-no" onClick={() => {
                  const n = window.prompt('دلیلِ حذف از پرونده — در دفترِ رسیدگی می‌ماند:');
                  if (n?.trim()) act(s.id, 'reject', { note: n.trim() }, 'از پرونده حذف شد');
                }}>حذف از پرونده</button>
              </footer>
            )}
          </motion.article>
        ))}
      </div>

      <AnimatePresence>
        {approving && (
          <ApproveSheet
            row={approving}
            onClose={() => setApproving(null)}
            onDone={(m) => { setApproving(null); setToast(m); load(); }}
            onZoom={setZoom}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {smsFor && (
          <SmsSheet link={smsFor} onClose={() => setSmsFor(null)} onDone={(m) => { setSmsFor(null); setToast(m); }} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {newLink && (
          <LinkSheet
            initial={newLink === true ? null : newLink}
            onClose={() => setNewLink(false)}
            onDone={(m) => { setNewLink(false); setToast(m); load(); }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {zoom && <ReceiptZoom url={zoom} onClose={() => setZoom(null)} />}
      </AnimatePresence>

      <div className={`ia-toast${toast ? ' on' : ''}`}>{toast}</div>
    </div>
  );
}

/**
 * فیشِ واریزی.
 *
 * ⚠️ عکسِ مدرک پشتِ هدرِ `Authorization` است و `<img src>` هدر نمی‌فرستد، پس
 * blob URL ساخته می‌شود — و در پاک‌سازی آزاد می‌شود وگرنه حافظه نشت می‌کند.
 * همان الگویی که رسیدِ توقف در تختهٔ چینش دارد.
 *
 * ⚠️ URLِ عمومیِ ثابت برای فیش عمداً نداریم: لینکِ فوروارد‌شده یعنی هر کسی
 * مدرکِ مالیِ بیمار را ببیند.
 */
function Receipt({ documentId, onOpen, label = 'فیشِ واریزی', fileName = '' }) {
  const [url, setUrl] = useState(null);
  const [bad, setBad] = useState(false);

  useEffect(() => {
    if (!documentId) return undefined;
    let alive = true;
    let made = null;
    apiBlobUrl(`/patients/documents/${documentId}/file`)
      .then((u) => { made = u; if (alive) setUrl(u); else URL.revokeObjectURL(u); })
      .catch(() => { if (alive) setBad(true); });
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [documentId]);

  if (!documentId) {
    return <p className="ia-note warn"><Alert width="13" height="13" /> فیشی آپلود نشده است</p>;
  }
  if (bad) return <p className="ia-note warn"><Alert width="13" height="13" /> فیش باز نشد</p>;
  if (!url) return <p className="ia-note">در حال بازکردنِ فیش…</p>;

  if (/\.pdf$/i.test(fileName)) return <a href={url} target="_blank" rel="noopener noreferrer" className="bl-mini">بازکردن {label} (PDF)</a>;
  return (
    <button type="button" className="ia-receipt" onClick={() => onOpen(url)} title="بزرگ‌نمایی">
      <img src={url} alt={label} />
      <span><Search width="13" height="13" /> {label} — برای بزرگ‌نمایی بزنید</span>
    </button>
  );
}

/** بزرگ‌نماییِ فیش — تصمیمِ مالی با تصویرِ کوچک گرفته نمی‌شود. */
function ReceiptZoom({ url, onClose }) {
  return (
    <Overlay backdrop="ia-overlay" panel="ia-zoom" as="section" onClose={onClose}>
      <button type="button" className="ia-x" onClick={onClose} aria-label="بستن"><Close width="17" height="17" /></button>
      <img src={url} alt="فیشِ واریزی" />
    </Overlay>
  );
}

/** فرمِ تأیید — جایی که «دکتر رضایی»ِ متنی به جراحِ تعریف‌شده گره می‌خورد. */
function ApproveSheet({ row, onClose, onDone, onZoom }) {
  const { user: me } = useAuth();
  const { vertical } = useConfig();
  const workflow = row.workflow || vertical;
  const targetKind = row.approvalKind || (workflow === 'clinic' ? 'clinic' : 'surgery');
  const [fields, setFields] = useState(null), [requiredItems, setRequiredItems] = useState([]), [itemsTouched, setItemsTouched] = useState(false);
  const [extra, setExtra] = useState(row.data ?? {});
  const [hospitalMatch, setHospitalMatch] = useState(null);
  useEffect(() => { let live = true; api(`/intake/submissions/${row.id}/hospital`).then(h => { if (live && h?.id) { setHospitalMatch(h); setF(s => s.hospitalId ? s : { ...s, hospitalId: String(h.id) }); } }).catch(() => {}); return () => { live = false; }; }, [row.id]);
  const visible = key => fields ? fields.some(f => f.key === key && f.active !== false) : targetKind !== 'clinic' || ['surgeonId', 'opDate', 'opStartTime'].includes(key);
  const [quick, setQuick] = useState(null);
  const [refs, setRefs] = useState({ surgeons: [], hospitals: [], techs: [], types: [], banks: [] });
  const [f, setF] = useState({
    surgeonId: '', hospitalId: '', techId: '', procedureTypeId: '',
    // آنچه بیمار فرستاده ISO است؛ `JDate` شمسی می‌خواهد.
    opDate: row.data?.opDate ? isoToJStr(row.data.opDate) : '', opStartTime: '',
    /* ⚠️ پیش‌فرض **روشن**: ادمین همین حالا فیش را دیده و تأیید یعنی «پول
       رسیده». خاموش‌بودنش یعنی هر مراجعهٔ تأییدشده بدهکار بماند. */
    registerPayment: true, bankAccountId: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const loadRefs = useCallback(async () => {
    const keys = ['surgeons', 'hospitals', 'techs', 'types', 'banks'];
    const paths = ['/surgeons', '/hospitals', '/techs', '/procedure-types', '/bank-accounts'];
    const results = await Promise.allSettled(paths.map(path => api(path)));
    setRefs(Object.fromEntries(results.map((r, i) => [keys[i], r.status === 'fulfilled' ? r.value : []])));
    const failed = results.flatMap((r, i) => r.status === 'rejected' ? [['جراحان', 'بیمارستان‌ها', 'کارشناسان', 'انواع عمل', 'حساب‌ها'][i]] : []);
    if (failed.length) setErr(`دریافت ${failed.join('، ')} انجام نشد؛ بقیهٔ انتخابگرها قابل استفاده‌اند.`);
  }, []);
  useEffect(() => { let live = true; api(`/forms/visit.${targetKind}`).then(form => { if (live) setFields(form.fields || []); }).catch(() => { if (live) setFields(null); }); return () => { live = false; }; }, [targetKind]);
  useEffect(() => {
    if (workflow !== 'implant' || !f.procedureTypeId || itemsTouched) return;
    let live = true;
    api(`/procedure-types/${f.procedureTypeId}/needs`).then(rows => { if (live) setRequiredItems(rows); }).catch(e => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [workflow, f.procedureTypeId, itemsTouched]);
  useEffect(() => {
    const reload = () => loadRefs().catch((e) => setErr(e.message));
    reload(); window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [loadRefs]);

  const save = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api(`/intake/submissions/${row.id}/approve`, {
        method: 'POST',
        body: {
          surgeonId: f.surgeonId ? Number(f.surgeonId) : undefined,
          hospitalId: f.hospitalId ? Number(f.hospitalId) : undefined,
          techId: f.techId ? Number(f.techId) : undefined,
          procedureTypeId: f.procedureTypeId ? Number(f.procedureTypeId) : undefined,
          // ⚠️ و در برگشت دوباره ISO — همان قاعده، همان اشتباهِ یک‌بار رخ‌داده.
          opDate: f.opDate.trim() ? jStrToIso(f.opDate) : undefined,
          opStartTime: f.opStartTime || undefined,
          registerPayment: f.registerPayment,
          bankAccountId: f.bankAccountId ? Number(f.bankAccountId) : undefined,
          extra: Object.fromEntries((fields ?? []).filter(field => !field.builtin && field.active !== false).map(field => [field.key, extra[field.key]])),
          ...(workflow === 'implant' ? { requiredItems: requiredItems.map(({ itemId, quantity, notes }) => ({ itemId, quantity, notes: notes || '' })) } : {}),
        },
      });
      /* ⚠️ پیام از **پاسخِ سرور** ساخته می‌شود نه از حدس: فرمِ زیرپرونده
         `visitCode` ندارد و متنِ قبلی «مراجعهٔ undefined ساخته شد» می‌داد. */
      onDone(r.madeVisit === false ? 'در پروندهٔ بیمار ثبت شد ✓' : `مراجعهٔ ${r.visitCode} ساخته شد ✓`);
    } catch (e) { setErr(e.message); setBusy(false); }
  };


  return (
    <Overlay backdrop="ia-overlay" panel="ia-sheet" as="section" onClose={onClose} closable={!busy}>
      <header className="ia-sheet-head">
        <b>تأییدِ {row.data?.firstName} {row.data?.lastName}</b>
        <button type="button" className="ia-x" onClick={onClose} aria-label="بستن"><Close width="17" height="17" /></button>
      </header>
      <div className="ia-sheet-body">
        <p className="ia-note">
          بیمار نوشته: {[row.data?.procedure, row.data?.surgeonName, row.data?.hospitalName].filter(Boolean).join(' · ') || '—'}
        </p>
        {/* ⚠️ فرمِ زیرپرونده مراجعه نمی‌سازد، پس جراح/بیمارستان/تاریخ و ردیفِ
            پرداخت برایش بی‌معنی‌اند — نشان‌دادنشان یعنی ادمین چیزی را انتخاب
            کند که هیچ‌جا نمی‌نشیند. */}
        {row.makesVisit === false && (
          <p className="ia-note">
            فرمِ «{row.formTitle}» زیرپرونده است: با تأیید، پاسخ‌ها به پروندهٔ
            بیمار می‌چسبند و <b>مراجعه‌ای ساخته نمی‌شود</b>.
          </p>
        )}
        {/* ⚠️ فیش **بالای** انتخابگرهاست و نه در یک صفحهٔ دیگر: تأیید یعنی
            «پول رسیده»، و تصمیمِ مالی نباید بدونِ دیدنِ مدرک گرفته شود. */}
        <div className="ia-money">
          <span>مبلغ: <b>{faNum(row.amount)} تومان</b></span>
          {row.discountAmount > 0 && (
            <span className="off">تخفیف {faNum(row.discountAmount)} با کدِ {row.discountCode}</span>
          )}
          <span className="pay">قابلِ پرداخت: <b>{faNum(row.payable ?? row.amount)} تومان</b></span>
        </div>
        {/* ⚠️ بزرگ‌نمایی **در والد** رندر می‌شود نه این‌جا: پوششِ `fixed` داخلِ
            پنلی که `transform` دارد نسبت به همان پنل جا می‌گیرد، نه صفحه —
            همان تلهٔ آشنای شیت‌های تودرتو. */}
        <Receipt documentId={row.data?.receiptDocumentId} onOpen={onZoom} />
        {(Array.isArray(row.data?.prescription) ? row.data.prescription : row.data?.prescription?.id ? [row.data.prescription] : []).map(doc => <Receipt key={doc.id} documentId={doc.id} fileName={doc.name} onOpen={onZoom} label="دستور جراح" />)}
        {row.makesVisit !== false && (
        <div className="ia-grid">
          {hospitalMatch && <p className="ia-note">بیمارستان {hospitalMatch.source === 'suggested' ? 'پیشنهادی بر اساس نوشته بیمار؛ بررسی کنید' : 'ثبت‌شده بیمار'}: {hospitalMatch.name}</p>}
          {(visible('surgeonId') || workflow === 'ionm') && <ApprovalSelect field="surgeonId" section="surgeons" label={targetKind === 'clinic' ? 'پزشک' : workflow === 'ionm' ? 'جراح (الزامی)' : 'جراح'} list={refs.surgeons} value={f.surgeonId} busy={busy} onChange={(v) => setF((s) => ({ ...s, surgeonId: v }))} onAdd={setQuick} />}
          {visible('hospitalId') && <ApprovalSelect field="hospitalId" section="hospitals" label="بیمارستان" list={refs.hospitals} value={f.hospitalId} busy={busy} onChange={(v) => setF((s) => ({ ...s, hospitalId: v }))} onAdd={setQuick} />}
          {visible('techId') && <ApprovalSelect field="techId" section="techs" label={workflow === 'ionm' ? 'کارشناس (اختیاری؛ قابل تعیین در چینش)' : 'کارشناس'} list={refs.techs} value={f.techId} busy={busy} onChange={(v) => setF((s) => ({ ...s, techId: v }))} onAdd={me?.level >= 6 ? setQuick : null} />}
          {visible('procedureTypeId') && <ApprovalSelect field="procedureTypeId" section="procedure-types" label="نوعِ عمل" list={refs.types} value={f.procedureTypeId} busy={busy} onChange={(v) => setF((s) => ({ ...s, procedureTypeId: v }))} onAdd={setQuick} />}
          {visible('opDate') && <JDate className="ia-field" label={targetKind === 'clinic' ? 'تاریخ مراجعه' : 'تاریخِ عمل'} value={f.opDate}
                 onChange={(v) => setF((s) => ({ ...s, opDate: v }))} disabled={busy} />}
          {visible('opStartTime') && <TimePick className="ia-field" label={targetKind === 'clinic' ? 'ساعت مراجعه' : 'ساعتِ عمل'} value={f.opStartTime}
                    onChange={(v) => setF((s) => ({ ...s, opStartTime: v }))} disabled={busy} />}
        </div>
        )}
        {row.makesVisit !== false && workflow === 'implant' && <RequiredItems value={requiredItems} onChange={rows => { setItemsTouched(true); setRequiredItems(rows); }} disabled={busy} />}
        {row.makesVisit !== false && fields?.some(field => !field.builtin && field.active !== false) && <DynForm assistance fields={fields.filter(field => !field.builtin && field.active !== false)} values={extra} onChange={setExtra} disabled={busy} myRole={me?.level >= 6 ? null : me?.jobRole} />}
        {/* ⚠️ ثبتِ پرداخت همین‌جاست چون همین‌جا فیش جلوی چشمِ ادمین است و
            می‌داند پول کجا نشسته. نسخهٔ اول پرداخت ثبت نمی‌کرد و نتیجه‌اش
            مراجعهٔ تأییدشده‌ای بود که کلِ مبلغش «مانده» می‌ماند. */}
        {row.makesVisit !== false && (row.payable ?? row.amount) > 0 && (
        <div className="ia-pay">
          <label className="ia-check">
            <input type="checkbox" checked={f.registerPayment} disabled={busy}
                   onChange={(e) => setF((s) => ({ ...s, registerPayment: e.target.checked }))} />
            <span>پرداختِ {faNum(row.payable ?? row.amount)} تومان ثبت شود</span>
          </label>
          {f.registerPayment && (
            <label className="ia-field">
              <span>به کدام حساب واریز شده؟</span>
              <select value={f.bankAccountId} disabled={busy}
                      onChange={(e) => setF((s) => ({ ...s, bankAccountId: e.target.value }))}>
                <option value="">— نامشخص —</option>
                {refs.banks.map((b) => <option key={b.id} value={b.id}>{[b.ownerName, b.bankName].filter(Boolean).join(" — ")}</option>)}
              </select>
            </label>
          )}
        </div>
        )}

        {err && <p className="ia-note warn">{err}</p>}
        <button type="button" className="ia-ok" disabled={busy} onClick={save}>
          {busy
            ? 'در حال ثبت…'
            : row.makesVisit === false ? 'تأیید و ثبت در پرونده' : 'تأیید و ساختِ مراجعه'}
        </button>
      </div>
      {quick && <QuickDefinitionEditor sectionKey={quick.section} onClose={() => setQuick(null)} onSaved={async (_message, saved) => {
        setF((s) => ({ ...s, [quick.field]: String(saved.id) })); setQuick(null); await loadRefs();
      }} />}
    </Overlay>
  );
}

/**
 * ساختِ لینکِ ثبت‌نام — **جایی که «چه فرمی؟» بالاخره جواب می‌گیرد.**
 *
 * ترتیبِ پرسش‌ها همان است که کاربر خواست: نام → فرم → (اگر فرم باکسِ پرداخت
 * دارد) حساب → ساخت. انتخابگرِ حساب عمداً **مشروط** است: فرمی که پرداخت ندارد
 * حساب هم لازم ندارد، و نشان‌دادنش فقط یک انتخابِ بی‌مصرف سرِ راه می‌گذارد.
 */
/**
 * فرستادنِ لینک با پیامک.
 *
 * ⚠️ نشانیِ داخلِ پیامک را **سرور** می‌سازد، نه این‌جا. اگر کلاینت متن را
 * می‌ساخت و می‌فرستاد، هر کسی که به این نشانی برسد می‌توانست هر متنی را با
 * نامِ شرکت به هر شماره‌ای بفرستد.
 */
function SmsSheet({ link, onClose, onDone }) {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const send = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api(`/intake/links/${link.id}/sms`, { method: 'POST', body: { phone } });
      /* ⚠️ `stub` یعنی سرویسِ پیامک پیکربندی نشده. اگر این را «فرستاده شد»
         می‌گفتیم، در محیطِ توسعه همه‌چیز موفق به‌نظر می‌رسید و کسی نمی‌فهمید
         هیچ پیامکی نرفته — و همان اشتباه روی سرورِ بدونِ کلید تکرار می‌شد. */
      onDone(r.stub
        ? 'سرویسِ پیامک پیکربندی نشده — چیزی ارسال نشد'
        : r.sent ? `لینک به ${faDigits(r.to)} پیامک شد ✓` : 'ارسال انجام نشد — شماره یا سرویس را بررسی کنید');
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <Overlay backdrop="ia-overlay" panel="ia-sheet sm" as="section" onClose={onClose} closable={!busy}>
      <header className="ia-sheet-head">
        <b>ارسالِ «{link.title}»</b>
        <button type="button" className="ia-x" onClick={onClose} aria-label="بستن"><Close width="17" height="17" /></button>
      </header>
      <div className="ia-sheet-body">
        <label className="ia-field">
          <span>شمارهٔ موبایلِ بیمار</span>
          <input
            dir="ltr" inputMode="numeric" value={phone} disabled={busy}
            onChange={(e) => setPhone(e.target.value)} placeholder="09xxxxxxxxx" autoFocus
          />
        </label>
        {/* ادمین باید پیش از زدنِ دکمه بداند چه چیزی می‌رود. */}
        <p className="ia-note">
          متنِ پیامک: «{link.title}» به‌همراهِ نشانیِ ثبت‌نام. «لغو۱۱» خودکار اضافه می‌شود.
        </p>
        {!link.active && (
          <p className="ia-note warn">این لینک غیرفعال است — اول فعالش کنید، وگرنه بیمار صفحهٔ بسته می‌بیند.</p>
        )}
        {err && <p className="ia-note warn">{err}</p>}
        <button type="button" className="ia-ok" onClick={send} disabled={busy || !phone.trim() || !link.active}>
          {busy ? 'در حال ارسال…' : 'ارسال'}
        </button>
      </div>
    </Overlay>
  );
}

/**
 * شیتِ لینک — **ساخت و ویرایش، یکی**.
 *
 * ⚠️ نسخهٔ دوم برای ویرایش نساختم: دو شیت که یک فرم را نشان می‌دهند یعنی
 * فیلدی که فردا به ساخت اضافه می‌شود، در ویرایش نیست — و کاربر می‌بیند
 * چیزی را که ساخته، نمی‌تواند عوض کند.
 */
function LinkSheet({ initial, onClose, onDone }) {
  const editing = !!initial?.id;
  const [title, setTitle] = useState(initial?.title ?? '');
  const [amount, setAmount] = useState(initial ? group3(String(initial.amount || '')) : '');
  const [formId, setFormId] = useState(initial?.formId ? String(initial.formId) : '');
  const [bankId, setBankId] = useState(initial?.bankAccountId ? String(initial.bankAccountId) : '');
  const [opts, setOpts] = useState(null); // {forms, banks} — null یعنی هنوز نیامده
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    api('/intake/link-options')
      .then((d) => {
        if (!alive) return;
        setOpts(d);
        /* یک فرم که بیشتر نیست، انتخابش را به کاربر تحمیل نکن — نصبِ تازه
           دقیقاً یک فرمِ ثبت‌نام دارد و «— انتخاب کنید —»ِ تک‌گزینه‌ای فقط
           یک کلیکِ اضافه است. */
        /* ⚠️ فقط هنگامِ **ساخت**: در ویرایش، فرمِ همان لینک از قبل ست شده و
           این خط رویش می‌نوشت — یعنی بازکردنِ شیتِ ویرایش، بی‌آنکه کاربر
           چیزی بزند، فرمِ لینک را عوض می‌کرد. */
        if (!editing) {
          const preferred = d.forms?.find(f => f.recommended) ?? (d.forms?.length === 1 ? d.forms[0] : null);
          if (preferred) setFormId(String(preferred.id));
        }
      })
      .catch(() => { if (alive) setOpts({ forms: [], banks: [] }); });
    return () => { alive = false; };
  }, [editing]);

  const picked = opts?.forms?.find((f) => String(f.id) === formId) ?? null;
  const needsBank = !!picked?.hasPayment;
  const toman = parseMoney(amount);

  const save = async () => {
    setBusy(true); setErr('');
    try {
      await api(editing ? `/intake/links/${initial.id}` : '/intake/links', {
        method: editing ? 'PATCH' : 'POST',
        body: {
          title: title.trim(),
          /* ⚠️ `parseMoney` و نه `Number(amount)`: کاربرِ فارسی «۵۰۰۰۰۰» تایپ
             می‌کند و `Number('۵۰۰۰۰۰')` برابرِ NaN است — `|| 0` آن را به صفر
             تبدیل می‌کرد و لینک با «۰ تومان» ساخته می‌شد، با پیامِ موفقیت و
             بدونِ هیچ خطایی. جداکنندهٔ سه‌رقمی هم همان بلا را می‌آورد. */
          amount: toman,
          /* صفر یعنی «هیچ‌کدام» و سرور همان را `null` می‌کند. */
          formId: formId ? Number(formId) : 0,
          bankAccountId: needsBank && bankId ? Number(bankId) : 0,
        },
      });
      onDone(editing ? 'لینک ویرایش شد ✓' : 'لینک ساخته شد ✓');
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <Overlay backdrop="ia-overlay" panel="ia-sheet sm" as="section" onClose={onClose} closable={!busy}>
      <header className="ia-sheet-head">
        <b>{editing ? `ویرایشِ «${initial.title}»` : 'لینکِ ثبت‌نامِ تازه'}</b>
        <button type="button" className="ia-x" onClick={onClose} aria-label="بستن"><Close width="17" height="17" /></button>
      </header>
      <div className="ia-sheet-body">
        <label className="ia-field">
          <span>نامِ لینک</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} placeholder="ثبت‌نامِ نورومانیتورینگ" />
        </label>

        <label className="ia-field">
          <span>مبلغ (تومان)</span>
          {/* ⚠️ گروه‌بندیِ سه‌رقمی در **blur** نه حینِ تایپ: روی Gboardِ اندروید
              بازنویسیِ مقدار وسطِ تایپ مکان‌نما را می‌پراند (قانون ۱۳). */}
          <input
            dir="ltr" inputMode="numeric" value={amount} disabled={busy}
            onChange={(e) => setAmount(e.target.value)}
            onBlur={() => setAmount(group3(amount))}
          />
          {toman > 0 && <small className="ia-words">{numToWordsFa(toman)} تومان</small>}
        </label>

        <label className="ia-field">
          <span>کدام فرم پر شود؟</span>
          <select value={formId} onChange={(e) => setFormId(e.target.value)} disabled={busy || !opts}>
            <option value="">— فرمِ پیش‌فرضِ سامانه —</option>
            {opts?.forms?.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
          </select>
          {opts && opts.forms.length === 0 && (
            <small className="ia-hint">هنوز فرمِ ثبت‌نامی ساخته نشده — در فرم‌ساز یکی بسازید.</small>
          )}
        </label>

        {needsBank && (
          <label className="ia-field">
            <span>واریز به کدام حساب؟</span>
            <select value={bankId} onChange={(e) => setBankId(e.target.value)} disabled={busy}>
              <option value="">— همهٔ حساب‌های علامت‌خورده —</option>
              {opts?.banks?.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
            <small className="ia-hint">
              {opts?.banks?.length
                ? 'شماره‌های همین حساب روی باکسِ پرداختِ فرم نشان داده می‌شود.'
                : 'هیچ حسابی برای نمایش در فرمِ بیمار علامت نخورده — اول در حسابداری علامتش بزنید.'}
            </small>
          </label>
        )}

        {err && <p className="ia-note warn">{err}</p>}
        <button type="button" className="ia-ok" disabled={busy || title.trim().length < 2} onClick={save}>{editing ? 'ذخیرهٔ تغییرات' : 'ساختِ لینک'}</button>
      </div>
    </Overlay>
  );
}

function ApprovalSelect({ field, section, label, list, value, busy, onChange, onAdd }) {
  return <div className="ia-field">
    <div className="ia-definition-head"><label htmlFor={`approve-${field}`}>{label}</label>
      {onAdd && <button type="button" disabled={busy} onClick={() => onAdd({ field, section })} aria-label={`افزودن ${label}`}><Plus width="16" height="16" /></button>}
      <Link to={section === 'techs' ? '/app/users' : `/app/definitions?section=${section}`} target="_blank" rel="noopener noreferrer">تعریف پایه</Link>
    </div>
    <select id={`approve-${field}`} value={value} disabled={busy} onChange={(e) => onChange(e.target.value)}>
      <option value="">— انتخاب —</option>
      {list.filter((r) => r.active !== false).map((r) => <option key={r.id} value={r.id}>{r.name ?? r.displayName}</option>)}
    </select>
  </div>;
}
