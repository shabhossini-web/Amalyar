import { QuickDefinitionEditor } from './Definitions.jsx';
import { useAuth } from './auth.jsx';
import { useConfig, useStatusMap } from './config.jsx';
import RequiredItems from './RequiredItems.jsx';
import DynForm from '../ui/DynForm.jsx';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { api, apiBlobUrl } from '../lib/api.js';
import { faDate, isoToJStr, jStrToIso } from '../lib/jalali.js';
import { normalizeMobile } from '../lib/identity.js';
import './intake-admin.css';
import './dashboard.css'; // bl-mini / db-hint
import { Alert, Bank, CheckCircle, Close, Copy, Doctor, External, Eye, Form, Hospital, Pencil, Plus, Scalpel, Search, Send, Trash, User } from '../ui/icons.jsx';
import { ThingPopups, useThings } from './thing-popups.jsx';
import { prefersReducedMotion } from '../lib/utils.js';
import { group3, numToWordsFa, parseMoney } from '../lib/money.js';
import Tabs from '../ui/Tabs.jsx';
import Overlay from '../ui/Overlay.jsx';
import JDate from './JDate.jsx';
import TimePick from '../ui/TimePick.jsx';
import { useStagger } from '../ui/stagger.js';
import PageHeader from '../ui/PageHeader.jsx';

const faNum = (n) => Number(n ?? 0).toLocaleString('fa-IR');
/* ⚠️ برای شماره‌ی موبایل `faNum` **غلط** است: `Number` صفرِ اول را می‌خورد و
   جداکنندهٔ سه‌رقمی می‌گذارد — «۰۹۱۲۱۲۳۴۵۶۷» به «۹٬۱۲۱٬۲۳۴٬۵۶۷» تبدیل می‌شد. */
const faDigits = (v) => String(v ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
/* ⚠️ مبلغ‌ها تومان‌اند؛ نسخهٔ اول تقسیم بر ۱۰ می‌کرد و عددِ یک‌دهم نشان می‌داد. */
/** نامِ ردیف — از پرونده اگر هست (اصلاحِ کارتِ هویت همین‌جا دیده شود)، وگرنه متنِ فرم. */
const nameOf = (s) => (s.patient ? `${s.patient.firstName} ${s.patient.lastName}` : `${s.data?.firstName ?? ''} ${s.data?.lastName ?? ''}`);
/** فیش‌های ردیف از سرور (`intake-docs.ts`)؛ fallback فقط برای پاسخِ سرورِ قدیمی. */
const receiptsOf = (s) => s.receipts ?? (s.data?.receiptDocumentId ? [{ id: s.data.receiptDocumentId }] : []);

/* ⚠️ عنوانِ تب‌ها هم از `/config.statuses.intake` می‌آید: نسخهٔ ثابتِ قبلی
   `pending_fill` را «ناتمام» می‌گفت در حالی که سرور «در انتظارِ تکمیل»
   می‌گوید — یعنی همان ردیف در تب و در کارتش دو نام داشت.
   ترتیب این‌جا می‌ماند چون **ترتیبِ کارِ منشی** است، نه ترتیبِ کاتالوگ. */
const TAB_ORDER = ['pending_approval', 'pending_payment', 'pending_fill', 'approved'];

/**
 * صفِ ثبت‌نامِ بیماران.
 *
 * ⚠️ **تأیید همان‌جایی است که ادعا به داده تبدیل می‌شود.** بیمار نوشته «دکتر
 * رضایی» — ادمین باید آن را به جراحِ تعریف‌شده گره بزند، وگرنه گزارشِ «درآمد
 * به تفکیکِ جراح» روی متنِ آزاد ساخته می‌شود و بی‌معنا است. برای همین فرمِ
 * تأیید انتخابگرِ واقعی دارد، نه یک دکمهٔ «تأیید».
 */
export default function IntakeAdmin() {
  const intakeFa = useStatusMap('intake');
  const cfgServices = useConfig().services ?? [];
  /* شمارِ هر زبانه از سرور (بازبینیِ UX، company-19): بی‌آن باید تک‌تک زبانه‌ها را باز کرد تا فهمید
     کدام صف کار دارد. زبانهٔ خالی نشان نمی‌گیرد — «۰» توجه را بی‌دلیل می‌کشد. */
  const [counts, setCounts] = useState(null);
  const badge = (key) => (counts?.[key] ? faNum(counts[key]) : null);
  const TABS = [
    ...TAB_ORDER.map((key) => ({ key, label: intakeFa[key] ?? key, badge: badge(key) })),
    { key: 'all', label: 'همه', badge: badge('all') },
  ];
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
  /* قدمِ بعد از تأیید (company-19): توستِ تنها «ساخته شد» بود و کاربر باید خودش مراجعه را پیدا می‌کرد
     تا کارشناس بگذارد. حالا توست دکمهٔ همان کار را دارد و فرمِ مراجعه همین‌جا باز می‌شود. */
  const [next, setNext] = useState(null); // { text, label, visitId }
  const things = useThings({ toast: setToast });
  const row = useStagger();

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 2400);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!next) return undefined;
    const t = setTimeout(() => setNext(null), 12000);
    return () => clearTimeout(t);
  }, [next]);

  const load = useCallback(async () => {
    setErr('');
    /* جدا و بی‌صدا: نبودنِ شمار (سرورِ قدیمی‌تر) نباید فهرست را خالی کند. */
    api('/intake/submissions/counts', { quiet401: true }).then(setCounts).catch(() => setCounts(null));
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
    try { await navigator.clipboard.writeText(url); setToast('لینک کپی شد'); }
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
      {/* نامِ صفحه = نامِ کاشی از کاتالوگ («ثبت‌نام‌های آنلاین») — بازبینیِ UX، shell-17. */}
      <PageHeader tool="formgen" sub="فرم‌هایی که بیماران از لینکِ عمومی پر کرده‌اند. تا تأیید نشوند، مراجعه‌ای ساخته نمی‌شود." />

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
            {/* وضعیت چیپ است و دکمه فعل (company-19): «غیرفعال» روی دکمه معلوم نبود حالت است یا فرمان. */}
            <i className={`ia-chip ia-state${l.active ? ' on' : ''}`}>{l.active ? 'فعال' : 'غیرفعال'}</i>
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
              {l.active ? 'غیرفعال‌کردن' : 'فعال‌کردن'}
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
          <motion.article
            key={s.id} {...row(i)}
            className={`ia-card st-${s.status}${s.status === 'pending_approval' ? ' open' : ''}`}
            /* ⚠️ مالک: «پاپ‌آپ از خودِ ردیف باز شود». کلیک روی دکمه‌ها، فیش و لینک‌های داخلِ کارت
               کارِ خودشان را می‌کنند؛ دسترسیِ صفحه‌کلید از دکمهٔ نامِ بیمار است، نه از کلِ کارت. */
            onClick={s.status === 'pending_approval'
              ? (e) => { if (!e.target.closest('button, a, input, select, textarea, label')) setApproving(s); }
              : undefined}
          >
            <header>
              <div className="ia-title">
                {/* نام از **پرونده** — اگر تأییدکننده در کارتِ هویت اصلاحش کرده، همان دیده شود. */}
                {s.status === 'pending_approval' ? (
                  <button type="button" className="ia-open" onClick={() => setApproving(s)}>
                    <b>{nameOf(s)}</b>
                  </button>
                ) : <b>{nameOf(s)}</b>}
                {/* کد و شماره‌ها هرکدام LTRِ جدا (قانونِ ۹) — کنارِ «·»ِ فارسی تکه‌تکه نمی‌شکنند (company-04). */}
                <small>
                  {[s.patient?.code, s.patient?.phone, s.data?.nationalId].filter(Boolean).map((x, k) => (
                    <Fragment key={k}>{k > 0 && ' · '}<bdi dir="ltr">{x}</bdi></Fragment>
                  ))}
                </small>
              </div>
              {/* خدمتِ همین ردیف — در شرکتِ دوخدمته هر دو نوع در یک صف‌اند. */}
              {s.serviceLabel && cfgServices.length > 1 && <span className="ia-tag ia-svc">{s.serviceLabel}</span>}
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
              {(s.data?.opDateOpen === true || s.data?.opDateOpen === 'true') && <span className="ia-undated">رزرو بدون تاریخ</span>}
              <span className="ia-when">{faDate(s.createdAt)}</span>
            </div>

            {s.data?.patientNotes && <p className="ia-note">{s.data.patientNotes}</p>}
            {s.reviewNote && <p className="ia-note warn">{s.reviewNote}</p>}
            {s.visitCode && <p className="ia-note ok"><CheckCircle width="13" height="13" /> مراجعهٔ {s.visitCode} ساخته شد</p>}

            {/* فیش روی خودِ کارت هم هست: ادمین اغلب می‌خواهد فقط نگاه کند
                و بعد تصمیم بگیرد، نه اینکه اول شیت را باز کند. **همهٔ** فیش‌ها، و
                «فیشی نیست» فقط وقتی پولی در کار است — ثبت‌نامِ رایگان فیش ندارد. */}
            {s.status === 'pending_approval' && (receiptsOf(s).length > 0 ? (
              <div className="ia-docs">
                {receiptsOf(s).map((doc, n) => (
                  <Receipt key={doc.id} documentId={doc.id} fileName={doc.name} pdf={doc.pdf} onOpen={setZoom}
                           label={receiptsOf(s).length > 1 ? `فیشِ ${faNum(n + 1)}` : 'فیشِ واریزی'} />
                ))}
              </div>
            ) : (s.payable ?? s.amount) > 0 && <Receipt onOpen={setZoom} />)}

            {s.status === 'pending_approval' && (
              <footer className="ia-acts">
                {/* ⚠️ متنِ دکمه از `makesVisit`ِ **سرور** می‌آید: فرمِ زیرپرونده
                    مراجعه نمی‌سازد و «تأیید و ساختِ مراجعه» روی آن یک وعدهٔ
                    دروغ بود. */}
                <button type="button" className="ia-ok" onClick={() => setApproving(s)}>
                  {s.makesVisit === false ? 'تأیید و ثبت در پرونده' : 'تأیید و ساختِ مراجعه'}
                </button>
                {/* برگشت و رد در همان پاپ‌آپ — مرحله و دلیل آن‌جا انتخاب می‌شوند، نه با `prompt`. */}
                <button type="button" className="ia-ghost" onClick={() => setApproving({ ...s, action: 'return' })}>بازگرداندن</button>
                <button type="button" className="ia-no" onClick={() => setApproving({ ...s, action: 'reject' })}>رد</button>
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
            onDone={(m, step) => { setApproving(null); if (step?.visitId) setNext({ text: m, ...step }); else setToast(m); load(); }}
            onZoom={setZoom}
            onChanged={load}
            initialAction={approving.action ?? 'approve'}
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

      <ThingPopups things={things} />
      {/* دو ظرفِ زنده، هر دو همیشه در DOM (DF14): توستِ «قدمِ بعد» (دکمه‌دار، ۱۲ ثانیه) و پیامِ عادی **بالای** آن —
          تا دیروز قدمِ بعد جای ظرفِ پیام را می‌گرفت و هر پیامِ تازه (خطا، «لینک کپی شد») تا ۱۲ ثانیه دیده و خوانده
          نمی‌شد؛ ظرفی هم که همراهِ متنش سوار می‌شود را صفحه‌خوان اعلام نمی‌کند. */}
      <div role="status" aria-live="polite">
        {next && (
          <div className="ia-toast on has-act">
            <span>{next.text}</span>
            <button type="button" className="ia-toast-act"
                    onClick={() => { const id = next.visitId; setNext(null); things.open({ type: 'visit', id }); }}>
              {next.label}
            </button>
            <button type="button" className="ia-toast-x" aria-label="بستن" onClick={() => setNext(null)}><Close width="14" height="14" /></button>
          </div>
        )}
      </div>
      <div className={`ia-toast${toast ? ' on' : ''}${next ? ' above' : ''}`} role="status" aria-live="polite">{toast}</div>
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
function Receipt({ documentId, onOpen, label = 'فیشِ واریزی', fileName = '', pdf = false }) {
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

  if (pdf || /\.pdf$/i.test(fileName)) return <a href={url} target="_blank" rel="noopener noreferrer" className="bl-mini">بازکردن {label} (PDF)</a>;
  return (
    <button type="button" className="ia-receipt" onClick={() => onOpen(url)} title="بزرگ‌نمایی">
      <img src={url} alt={label} />
      <span><Search width="13" height="13" /> {label} — برای بزرگ‌نمایی بزنید</span>
    </button>
  );
}

/**
 * **کارتِ هویت** — چه کسی ثبت‌نام کرده، از روی **پرونده** (نه متنِ خامِ فرم).
 *
 * ⚠️ تصمیمِ مالک (۱۴۰۵/۰۷/۰۱): غلطِ هویتی برای اصلاح به بیمار برنمی‌گردد؛
 * تأییدکننده همین‌جا درستش می‌کند. نام و موبایل از همان مسیرِ ویرایشِ پرونده
 * (`PATCH /patients/:id`) می‌روند — با همان دسترسی و همان ردِ ممیزی، نه مسیرِ دوم.
 *
 * ⚠️ کدِ ملی **این‌جا عوض نمی‌شود**: کلیدِ پرونده است و تغییرش یعنی ادغام یا
 * جداسازیِ پرونده (`record.service.ts`). رد کردنِ ثبت‌نام راهِ درستش است.
 */
function IdentityCard({ row, who, onSaved }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState({ firstName: '', lastName: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const d = row.data ?? {};
  const name = who ? `${who.firstName} ${who.lastName}` : `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim();
  const birth = who?.birthDate ?? d.birthDate;
  const open = () => {
    setV({ firstName: who?.firstName ?? '', lastName: who?.lastName ?? '', phone: who?.phone ?? '' });
    setErr(''); setEdit(true);
  };
  const save = async () => {
    /* فقط آنچه واقعاً عوض شده — بقیه دست‌نخورده در ردِ ممیزی نمی‌نشیند. */
    const patch = Object.fromEntries(Object.entries(v)
      .map(([k, x]) => [k, x.trim()])
      .filter(([k, x]) => x !== String(who?.[k] ?? '')));
    if (!Object.keys(patch).length) { setEdit(false); return; }
    setBusy(true); setErr('');
    try {
      await api(`/patients/${who.id}`, { method: 'PATCH', body: patch });
      onSaved({ ...who, ...patch });
      setEdit(false);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <section className="ia-block" aria-labelledby={`ia-b-id-${row.id}`}>
      <h3 id={`ia-b-id-${row.id}`}>
        <User width="15" height="15" /> هویت
        {who && !edit && (
          <button type="button" className="ia-block-act" onClick={open}><Pencil width="13" height="13" /> اصلاح</button>
        )}
      </h3>
      {!edit ? (
        <dl className="ia-id">
          <div><dt>نام</dt><dd>{name || '—'}</dd></div>
          <div><dt>کدِ ملی</dt><dd dir="ltr">{faDigits(who?.nationalId ?? d.nationalId ?? '—')}</dd></div>
          <div><dt>موبایل</dt><dd dir="ltr">{faDigits(who?.phone ?? d.phone ?? '—')}</dd>
            {/* پروندهٔ بی‌شماره: شماره از خودِ ثبت‌نام است و فقط با تأیید روی پرونده می‌نشیند (بستهٔ PS، PS12). */}
            {who && !who.phone && d.phone && <small className="ia-id-hint">از همین ثبت‌نام — با تأیید روی پرونده می‌نشیند</small>}
          </div>
          {who?.code && <div><dt>پرونده</dt><dd dir="ltr">{who.code}</dd></div>}
          {birth && <div><dt>تاریخِ تولد</dt><dd>{faDate(birth)}</dd></div>}
        </dl>
      ) : (
        <div className="ia-id-edit">
          <div className="ia-grid">
            <label className="ia-field"><span>نام</span>
              <input value={v.firstName} disabled={busy} autoFocus onChange={(e) => setV((x) => ({ ...x, firstName: e.target.value }))} /></label>
            <label className="ia-field"><span>نام خانوادگی</span>
              <input value={v.lastName} disabled={busy} onChange={(e) => setV((x) => ({ ...x, lastName: e.target.value }))} /></label>
            <label className="ia-field"><span>موبایل</span>
              <input dir="ltr" inputMode="numeric" value={v.phone} disabled={busy} onChange={(e) => setV((x) => ({ ...x, phone: normalizeMobile(e.target.value) }))} /></label>
          </div>
          <p className="ia-note">کدِ ملی کلیدِ پرونده است و این‌جا عوض نمی‌شود؛ اگر اشتباه است، ثبت‌نام را رد کنید تا بیمار با کدِ درست ثبت‌نام کند.</p>
          <div className="ia-acts">
            <button type="button" className="ia-ok" disabled={busy} onClick={save}>{busy ? 'در حال ذخیره…' : 'ذخیرهٔ هویت'}</button>
            <button type="button" className="ia-ghost" disabled={busy} onClick={() => setEdit(false)}>انصراف</button>
          </div>
        </div>
      )}
      {err && <p className="ia-note warn">{err}</p>}
    </section>
  );
}

const RETURN_STAGE_FA = [
  ['service', 'اطلاعاتِ خدمت', 'فرم دوباره باز می‌شود؛ فیش و مدارک می‌مانند'],
  ['documents', 'مدارک', 'عکس‌های فرم کنار گذاشته می‌شوند تا دوباره بارگذاری شوند'],
  ['receipt', 'فیش', 'فیش‌ها کنار گذاشته می‌شوند تا فیشِ تازه بیاید'],
  ['all', 'همه', 'فرم، مدارک و فیش هر سه از نو'],
];

/**
 * **برگشت برای اصلاح / رد** — داخلِ همان پاپ‌آپ، نه `prompt`ِ مرورگر.
 *
 * ⚠️ مالک: «مرحله باید انتخاب شود و پیام به بیمار برود». پس دکمه تا مرحله و دلیل پر نشده
 * غیرفعال است، و نتیجه می‌گوید پیامک در صف نشست یا شمارهٔ معتبری نبود — نه یک «انجام شد»ِ
 * کلی که پنهان کند بیمار خبردار نشده. هویت مرحله نیست: آن را کارتِ هویت همین‌جا درست می‌کند.
 */
function Decide({ row, mode, onCancel, onDone }) {
  const [stage, setStage] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const returning = mode === 'return';
  const ready = note.trim().length > 0 && (!returning || stage);
  const send = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api(`/intake/submissions/${row.id}/${returning ? 'return' : 'reject'}`, {
        method: 'POST', body: returning ? { stage, note: note.trim() } : { note: note.trim() },
      });
      /* `skipped` = پیامکی قرار نبود برود (ردِ پاسخِ خودکارتأییدشده) — نه «شماره نبود». */
      const sms = { queued: 'پیامک برای بیمار در صفِ ارسال است', no_phone: 'شمارهٔ معتبری برای پیامک نبود' }[r?.sms];
      const done = returning ? 'برای اصلاح برگشت خورد' : 'رد شد';
      onDone(sms ? `${done} — ${sms}` : done);
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <section className="ia-block ia-decide" aria-labelledby={`ia-decide-${row.id}`}>
      <h3 id={`ia-decide-${row.id}`}>{returning ? 'بازگرداندن برای اصلاح' : 'ردِ ثبت‌نام'}</h3>
      {returning && (
        <div className="ia-stage" role="radiogroup" aria-label="کدام بخش اصلاح شود">
          {RETURN_STAGE_FA.map(([key, label, hint]) => (
            <button key={key} type="button" role="radio" aria-checked={stage === key} disabled={busy}
                    className={`ia-chip${stage === key ? ' on' : ''}`} onClick={() => setStage(key)} title={hint}>
              {label}
            </button>
          ))}
        </div>
      )}
      {returning && stage && <p className="ia-note">{RETURN_STAGE_FA.find(([k]) => k === stage)?.[2]}</p>}
      <label className="ia-field">
        <span>{returning ? 'چه چیزی باید اصلاح شود؟ (بیمار همین را می‌بیند)' : 'دلیلِ رد (بیمار همین را می‌بیند)'}</span>
        <textarea rows={3} maxLength={300} value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} />
      </label>
      {err && <p className="ia-note warn">{err}</p>}
      <div className="ia-acts">
        <button type="button" className={returning ? 'ia-ok' : 'ia-no'} disabled={busy || !ready} onClick={send}>
          {busy ? 'در حال ارسال…' : returning ? 'بازگرداندن و ارسالِ پیامک' : 'رد و ارسالِ پیامک'}
        </button>
        <button type="button" className="ia-ghost" disabled={busy} onClick={onCancel}>انصراف</button>
      </div>
    </section>
  );
}

/** بزرگ‌نماییِ فیش — تصمیمِ مالی با تصویرِ کوچک گرفته نمی‌شود. */
export function ReceiptZoom({ url, onClose }) {
  return (
    <Overlay backdrop="ia-overlay" panel="ia-zoom" as="section" onClose={onClose}>
      <button type="button" className="ia-x" onClick={onClose} aria-label="بستن"><Close width="17" height="17" /></button>
      <img src={url} alt="فیشِ واریزی" />
    </Overlay>
  );
}

/** فرمِ تأیید — جایی که «دکتر رضایی»ِ متنی به جراحِ تعریف‌شده گره می‌خورد. */
export function ApproveSheet({ row, onClose, onDone, onZoom, onChanged, initialAction = 'approve' }) {
  const { user: me } = useAuth();
  const cfg = useConfig();
  /* سه تصمیمِ پاپ‌آپ (مالک، ۱۴۰۵/۰۷/۰۱): تأیید / برگشت برای اصلاح (با مرحله) / رد. */
  const [mode, setMode] = useState(initialAction);
  /* پروندهٔ بیمار — کارتِ هویت اصلاحش می‌کند و سربرگ همان را نشان می‌دهد. */
  const [who, setWho] = useState(row.patient ?? null);
  /* مدارک از سرور (`intake-docs.ts`)؛ fallbackِ پایین فقط برای پاسخِ سرورِ قدیمی. */
  const receipts = receiptsOf(row);
  const documents = row.documents ?? (Array.isArray(row.data?.prescription) ? row.data.prescription : row.data?.prescription?.id ? [row.data.prescription] : [])
    .map((doc) => ({ ...doc, label: 'دستور جراح' }));
  /* نوعِ نصب از **خودِ ردیف** (سرور)، نه کانفیگِ کش‌شدهٔ رابط: «الزامی»ِ جراح و
     بیمارستان باید همان قاعده‌ای باشد که `approve()` اجرا می‌کند. */
  const company = (row.profileKind ?? cfg.kind) === 'company';
  /* ⚠️ خدمتِ **همین ثبت‌نام** از سرور (`intake-service-of.ts`)، نه حوزهٔ کلِ
     شرکت: شرکتِ دوخدمته هر دو نوع را در یک صف دارد. کلاینتِ کش‌شده‌ای که
     `service` نمی‌گیرد به همان `workflow`ِ قدیمی برمی‌گردد. فقط فرمِ دلخواه در
     شرکتِ دوخدمته مبهم است و تأییدکننده انتخابش می‌کند. */
  const [service, setService] = useState(row.service !== undefined ? row.service : (row.workflow && row.workflow !== 'clinic' ? row.workflow : null));
  const workflow = service;
  const targetKind = row.approvalKind || (cfg.kind === 'clinic' ? 'clinic' : 'surgery');
  const [fields, setFields] = useState(null), [requiredItems, setRequiredItems] = useState([]), [itemsTouched, setItemsTouched] = useState(false);
  const [extra, setExtra] = useState(row.data ?? {});
  /**
   * ارجاع‌های پیشنهادی از روی متنی که بیمار نوشته (W3.8/U3).
   *
   * ⚠️ تا امروز فقط **بیمارستان** پیشنهاد می‌شد و ادمین جراح و نوعِ عمل را از
   * روی متنِ بیمار **دوباره** انتخاب می‌کرد — یک فرم، دو بار ورود. و اگر
   * انتخاب نمی‌کرد، متنِ آزاد روی مراجعه می‌ماند و بعداً «یکسان‌سازیِ نام‌ها»
   * لازم می‌شد.
   *
   * ⚠️ فقط جای **خالی** را پر می‌کند (`s.<key> ? s : …`): اگر کاربر همین حالا
   * چیزی انتخاب کرده، پاسخِ دیررسِ سرور نباید انتخابش را عوض کند.
   */
  const [match, setMatch] = useState({});
  /* نوشتهٔ خودِ بیمار برای نوعِ عمل — کنارِ کشویی، وقتی فهرست چیزی نزدیک به آن ندارد. */
  const patientProcedure = String(row.data?.procedure ?? '').trim();
  useEffect(() => {
    let live = true;
    api(`/intake/submissions/${row.id}/refs`).then(r => {
      if (!live || !r) return;
      setMatch(r);
      setF(s => ({
        ...s,
        hospitalId: s.hospitalId || (r.hospital?.id ? String(r.hospital.id) : s.hospitalId),
        surgeonId: s.surgeonId || (r.surgeon?.id ? String(r.surgeon.id) : s.surgeonId),
        procedureTypeId: s.procedureTypeId || (r.procedure?.id ? String(r.procedure.id) : s.procedureTypeId),
      }));
    }).catch(() => {});
    return () => { live = false; };
  }, [row.id]);
  /* کنترل‌هایی که **این نوعِ ثبت‌نام** در مرحلهٔ تأیید لازم دارد — از کاتالوگِ
     سرور (`form-types.ts`)، نه از `workflow === 'ionm'` در JSX. */
  const [ftype, setFtype] = useState(null);
  useEffect(() => {
    let live = true;
    api('/forms/types')
      .then((list) => { if (live) setFtype((list ?? []).find((t) => t.key === `intake.${targetKind}`) ?? (list ?? []).find((t) => t.key === 'intake') ?? null); })
      .catch(() => { if (live) setFtype(null); });
    return () => { live = false; };
  }, [targetKind]);
  const needs = (key) => ftype?.approval?.includes(key) ?? false;
  /* ⚠️ **دو منبع، با ترتیبِ روشن.** تعریفِ خودِ فرم مقدم است (ادمین در فرم‌ساز
     کادری را خاموش کرده = نمی‌خواهدش). ولی وقتی تعریف نیامده — خطای شبکه یا
     فرمی که هنوز ساخته نشده — دیگر به فهرستِ ثابتِ داخلِ JSX برنمی‌گردیم:
     کاتالوگِ سرور می‌گوید این نوعِ ثبت‌نام چه کنترل‌هایی می‌خواهد. */
  const visible = key => (fields ? fields.some(f => f.key === key && f.active !== false) : needs(key));
  const [quick, setQuick] = useState(null);
  const [refs, setRefs] = useState({ surgeons: [], hospitals: [], techs: [], types: [], banks: [] });
  const [f, setF] = useState({
    surgeonId: '', hospitalId: '', techId: '', procedureTypeId: '',
    // آنچه بیمار فرستاده ISO است؛ `JDate` شمسی می‌خواهد.
    opDate: row.data?.opDate ? isoToJStr(row.data.opDate) : '', opStartTime: '',
    /* ⚠️ پیش‌فرض **روشن**: ادمین همین حالا فیش را دیده و تأیید یعنی «پول
       رسیده». خاموش‌بودنش یعنی هر مراجعهٔ تأییدشده بدهکار بماند. */
    registerPayment: true,
    /* پیش‌فرض همان حسابی است که بیمار روی فرم دید (سرور، `payToAccountId`؛ company-19) — نه «نامشخص»
       وقتی لینک خودش حساب دارد. اگر فرم چند حساب نشان می‌داد، انتخاب با تأییدکننده می‌ماند. */
    bankAccountId: row.payToAccountId ? String(row.payToAccountId) : '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  /* خطای «الزامی» زیرِ همان فیلد (company-19)، نه یک خطِ کلی پایینِ پنجره و دور از فیلد. */
  const [fieldErr, setFieldErr] = useState({});
  const pick = (key) => (v) => { setF((s) => ({ ...s, [key]: v })); setFieldErr((e) => ({ ...e, [key]: undefined })); };
  /**
   * یادداشتِ تطبیق فقط وقتی **ناقص** است (بازبینیِ UX، company-19): نوشتهٔ بیمار چهار بار تکرار می‌شد —
   * خلاصهٔ بالا و سه جعبهٔ «مطابقِ دقیق» — حتی وقتی کشویی همان را نشان می‌داد. تطبیقِ دقیق، نامِ مستعار
   * و انتخابِ خودِ بیمار دیگر یادداشت ندارند؛ فقط پیشنهادِ فازی که هنوز انتخاب است «بررسی کنید» می‌گیرد،
   * با نوشتهٔ خودِ بیمار کنارش، زیرِ همان کشویی.
   */
  const typed = { hospital: row.data?.hospitalName, surgeon: row.data?.surgeonName, procedure: patientProcedure };
  const suggestNote = (k, key) => {
    const m = match[k];
    if (!m || m.source !== 'suggested' || String(m.id) !== String(f[key])) return null;
    const said = String(typed[k] ?? '').trim();
    return `پیشنهادی بر اساس نوشتهٔ بیمار؛ بررسی کنید: ${m.name}${said ? ` (بیمار نوشته: «${said}»)` : ''}`;
  };

  const loadRefs = useCallback(async () => {
    const keys = ['surgeons', 'hospitals', 'techs', 'types', 'banks'];
    const paths = ['/surgeons', '/hospitals', '/techs', '/procedure-types', '/bank-accounts'];
    const results = await Promise.allSettled(paths.map(path => api(path)));
    /* DF5: `/bank-accounts` پلنِ حسابداری می‌خواهد؛ بی‌آن فهرستِ حساب‌ها را از `/intake/link-options` بگیر (همان
       حساب‌هایی که روی فرمِ بیمار نشان داده می‌شوند، فقط نام) تا حسابِ لینک دیده و انتخاب‌شدنی بماند. */
    if (results[4].status === 'rejected') {
      try { results[4] = { status: 'fulfilled', value: (await api('/intake/link-options')).banks ?? [] }; } catch { /* همان خطای بالا */ }
    }
    setRefs(Object.fromEntries(results.map((r, i) => [keys[i], r.status === 'fulfilled' ? r.value : []])));
    const failed = results.flatMap((r, i) => r.status === 'rejected' ? [['جراحان', 'بیمارستان‌ها', 'کارشناسان', 'انواع عمل', 'حساب‌ها'][i]] : []);
    if (failed.length) setErr(`دریافت ${failed.join('، ')} انجام نشد؛ بقیهٔ انتخابگرها قابل استفاده‌اند.`);
  }, []);
  useEffect(() => { let live = true; api(`/forms/visit.${targetKind}`).then(form => { if (live) setFields(form.fields || []); }).catch(() => { if (live) setFields(null); }); return () => { live = false; }; }, [targetKind]);
  useEffect(() => {
    const reload = () => loadRefs().catch((e) => setErr(e.message));
    reload(); window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [loadRefs]);

  /* DF5: حسابی فقط وقتی انتخاب‌شده است که در همین فهرست دیده شود — وگرنه کشویی «نامشخص» نشان می‌داد و
     شناسهٔ حسابِ لینک بی‌صدا فرستاده می‌شد. */
  const bankShown = refs.banks.some((b) => String(b.id) === f.bankAccountId) ? f.bankAccountId : '';

  const save = async () => {
    /* همان قاعدهٔ `approve()`ِ سرور برای شرکت (جراح و بیمارستانِ تعریف‌شده الزامی)؛ سرور همچنان داور
       است — این فقط خطا را کنارِ فیلد می‌آورد و فوکوس را همان‌جا می‌برد. */
    const missing = company && row.makesVisit !== false
      ? [['surgeonId', 'جراح را از فهرست انتخاب کنید یا با + همین‌جا اضافه کنید'], ['hospitalId', 'بیمارستان را از فهرست انتخاب کنید یا با + همین‌جا اضافه کنید']].filter(([k]) => !f[k])
      : [];
    setFieldErr(Object.fromEntries(missing));
    if (missing.length) {
      const el = document.getElementById(`approve-${missing[0][0]}`);
      el?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      el?.focus({ preventScroll: true });
      return;
    }
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
          bankAccountId: f.registerPayment && bankShown ? Number(bankShown) : undefined,
          extra: Object.fromEntries((fields ?? []).filter(field => !field.builtin && field.active !== false).map(field => [field.key, extra[field.key]])),
          ...(row.makesVisit !== false && row.serviceAmbiguous && service ? { service } : {}),
          ...(workflow === 'implant' ? { requiredItems: requiredItems.map(({ itemId, quantity, notes }) => ({ itemId, quantity, notes: notes || '' })) } : {}),
        },
      });
      /* ⚠️ پیام از **پاسخِ سرور** ساخته می‌شود نه از حدس: فرمِ زیرپرونده
         `visitCode` ندارد و متنِ قبلی «مراجعهٔ undefined ساخته شد» می‌داد. */
      /* قدمِ بعد روی خودِ توست (company-19): در شرکت اگر کارشناس همین‌جا تعیین نشد، همان کار؛ وگرنه
         بازکردنِ مراجعهٔ تازه. */
      onDone(r.madeVisit === false ? 'در پروندهٔ بیمار ثبت شد' : `مراجعهٔ ${r.visitCode} ساخته شد`,
        r.visitId ? { visitId: r.visitId, label: company && !f.techId ? `تعیینِ ${cfg.t?.tech ?? 'کارشناس'}` : (cfg.t?.visitOpen ?? 'بازکردنِ مراجعه') } : undefined);
    } catch (e) { setErr(e.message); setBusy(false); }
  };


  return (
    <Overlay backdrop="ia-overlay" panel="ia-sheet" as="section" onClose={onClose} closable={!busy}>
      <header className="ia-sheet-head">
        <b>تأییدِ {who ? `${who.firstName} ${who.lastName}` : `${row.data?.firstName ?? ''} ${row.data?.lastName ?? ''}`}</b>
        <button type="button" className="ia-x" onClick={onClose} aria-label="بستن"><Close width="17" height="17" /></button>
      </header>
      <div className="ia-sheet-body">
        {/* ⚠️ سه کارت به ترتیبِ کارِ تأییدکننده (مالک، ۱۴۰۵/۰۷/۰۱): **چه کسی** (هویت)،
            **چه کاری** (خدمت: متنِ بیمار + مدارک + گره‌زدن به تعاریف)، **چه پولی**
            (پرداخت: فیش‌ها + ثبتِ پرداخت). فیش کنارِ همان تیکِ «پرداخت ثبت شود» و بالای
            دکمهٔ تأیید است — تصمیمِ مالی بدونِ دیدنِ مدرک گرفته نمی‌شود. */}
        {row.returns?.length > 0 && (
          <p className="ia-note warn">
            <Alert width="13" height="13" /> {faNum(row.returns.length)} بار برای اصلاح برگشت خورده — آخرین بار «{row.returns.at(-1).stageLabel}»: {row.returns.at(-1).note}
          </p>
        )}
        <IdentityCard row={row} who={who} onSaved={(p) => { setWho(p); onChanged?.(); }} />

        <section className="ia-block" aria-labelledby={`ia-b-svc-${row.id}`}>
          <h3 id={`ia-b-svc-${row.id}`}>
            <Scalpel width="15" height="15" /> {row.makesVisit === false ? 'فرم' : 'خدمت'}
            {row.makesVisit !== false && row.serviceLabel && !row.serviceAmbiguous && cfg.services?.length > 1 && (
              <span className="ia-tag ia-svc">{row.serviceLabel}</span>
            )}
          </h3>
          {/* ⚠️ فقط فرمِ **دلخواه** در شرکتِ دوخدمته مبهم است؛ پیش‌فرض خدمتِ اصلی
              است و تأییدکننده عوضش می‌کند (ردیف‌های ایمپلنت به همین بسته‌اند). */}
          {row.makesVisit !== false && row.serviceAmbiguous && cfg.services.length > 1 && (
            <div className="ia-svc-pick" role="radiogroup" aria-label="خدمتِ این ثبت‌نام">
              <span>خدمت:</span>
              {cfg.services.map((key) => (
                <button key={key} type="button" role="radio" aria-checked={service === key} disabled={busy}
                        className={`ia-chip${service === key ? ' on' : ''}`} onClick={() => setService(key)}>
                  {cfg.serviceCatalog?.find((x) => x.key === key)?.label ?? key}
                </button>
              ))}
            </div>
          )}
          {/* ⚠️ فرمِ زیرپرونده مراجعه نمی‌سازد، پس جراح/بیمارستان/تاریخ و ردیفِ
              پرداخت برایش بی‌معنی‌اند — نشان‌دادنشان یعنی ادمین چیزی را انتخاب
              کند که هیچ‌جا نمی‌نشیند. */}
          {row.makesVisit === false && (
            <p className="ia-note">
              فرمِ «{row.formTitle}» زیرپرونده است: با تأیید، پاسخ‌ها به پروندهٔ
              بیمار می‌چسبند و <b>مراجعه‌ای ساخته نمی‌شود</b>.
            </p>
          )}
          {row.makesVisit !== false && (
            <p className="ia-note">
              بیمار نوشته: {[row.data?.procedure, row.data?.surgeonName, row.data?.hospitalName].filter(Boolean).join(' · ') || '—'}
            </p>
          )}
          {(row.data?.opDateOpen === true || row.data?.opDateOpen === 'true') && (
            <p className="ia-note warn">بیمار «رزرو بدون تاریخ» زده: می‌توانید بی‌تاریخ تأیید کنید و تاریخِ عمل را بعداً روی مراجعه بگذارید.</p>
          )}
          {/* مدارکِ فرم (کارت ملی، دستور پزشک…) با برچسبِ کادرِ خودشان — از سرور. ⚠️ بزرگ‌نمایی
              **در والد** رندر می‌شود: پوششِ `fixed` داخلِ پنلی که `transform` دارد نسبت به همان
              پنل جا می‌گیرد، نه صفحه — همان تلهٔ آشنای شیت‌های تودرتو. */}
          {documents.length > 0 && (
            <div className="ia-docs">
              {documents.map((doc) => <Receipt key={doc.id} documentId={doc.id} fileName={doc.name} pdf={doc.pdf} onOpen={onZoom} label={doc.label} />)}
            </div>
          )}
          {row.makesVisit !== false && (
          <div className="ia-grid">
            {(visible('surgeonId') || needs('surgeonId') || company) && <ApprovalSelect field="surgeonId" section="surgeons" label={targetKind === 'clinic' ? 'پزشک' : (company || needs('surgeonId')) ? 'جراح (الزامی)' : 'جراح'} list={refs.surgeons} value={f.surgeonId} busy={busy} onChange={pick('surgeonId')} onAdd={setQuick} note={suggestNote('surgeon', 'surgeonId')} error={fieldErr.surgeonId} />}
            {(visible('hospitalId') || company) && <ApprovalSelect field="hospitalId" section="hospitals" label={company ? 'بیمارستان (الزامی)' : 'بیمارستان'} list={refs.hospitals} value={f.hospitalId} busy={busy} onChange={pick('hospitalId')} onAdd={setQuick} note={suggestNote('hospital', 'hospitalId')} error={fieldErr.hospitalId} />}
            {visible('techId') && <ApprovalSelect field="techId" section="techs" label={needs('techId') ? 'کارشناس (اختیاری؛ قابل تعیین در چینش)' : 'کارشناس'} list={refs.techs} value={f.techId} busy={busy} onChange={pick('techId')} onAdd={me?.level >= 6 ? setQuick : null} />}
            {/* ⚠️ مالک (۱۴۰۵/۰۷/۰۵): «اگر در لیستِ خودمان نیست، نوشتهٔ مریض باید نشان داده شود» — درست
                بالای همان کشویی، نه فقط در خلاصهٔ بالای پنل؛ «+» همین نوشته را پیش‌پر می‌کند. */}
            {visible('procedureTypeId') && patientProcedure && !match.procedure && !f.procedureTypeId && (
              <p className="ia-note warn ia-px-typed">
                <Alert width="13" height="13" /> بیمار نوشته «{patientProcedure}» — در فهرستِ انواعِ عمل نیست؛ نزدیک‌ترین را انتخاب کنید یا با + همین را اضافه کنید.
              </p>
            )}
            {visible('procedureTypeId') && <ApprovalSelect field="procedureTypeId" section="procedure-types" label="نوعِ عمل" list={refs.types} value={f.procedureTypeId} busy={busy} onChange={pick('procedureTypeId')}
              onAdd={(q) => setQuick({ ...q, initial: patientProcedure && !f.procedureTypeId ? { name: patientProcedure } : undefined })} note={suggestNote('procedure', 'procedureTypeId')} />}
            {visible('opDate') && <JDate className="ia-field" label={targetKind === 'clinic' ? 'تاریخ مراجعه' : 'تاریخِ عمل'} value={f.opDate}
                   onChange={(v) => setF((s) => ({ ...s, opDate: v }))} disabled={busy} />}
            {/* ⚠️ ساعتِ عمل هنگامِ تأییدِ ثبت‌نامِ شرکتی بی‌معناست (مالک، ۱۴۰۵/۰۷/۰۵): ساعت را کارشناس سرِ
                عمل ثبت می‌کند (`visits.times`). مطب همچنان ساعتِ مراجعه را این‌جا می‌گذارد. */}
            {visible('opStartTime') && !company && <TimePick className="ia-field" label={targetKind === 'clinic' ? 'ساعت مراجعه' : 'ساعتِ عمل'} value={f.opStartTime}
                      onChange={(v) => setF((s) => ({ ...s, opStartTime: v }))} disabled={busy} />}
          </div>
          )}
          {row.makesVisit !== false && workflow === 'implant' && <RequiredItems prescribing stock value={requiredItems} onChange={rows => { setItemsTouched(true); setRequiredItems(rows); }} disabled={busy} />}
          {row.makesVisit !== false && fields?.some(field => !field.builtin && field.active !== false) && <DynForm assistance fields={fields.filter(field => !field.builtin && field.active !== false)} values={extra} onChange={setExtra} disabled={busy} myRole={me?.level >= 6 ? null : me?.jobRole} />}
        </section>

        <section className="ia-block" aria-labelledby={`ia-b-pay-${row.id}`}>
          <h3 id={`ia-b-pay-${row.id}`}><Bank width="15" height="15" /> پرداخت</h3>
          <div className="ia-money">
            <span>مبلغ: <b>{faNum(row.amount)} تومان</b></span>
            {row.discountAmount > 0 && (
              <span className="off">تخفیف {faNum(row.discountAmount)} با کدِ {row.discountCode}</span>
            )}
            <span className="pay">قابلِ پرداخت: <b>{faNum(row.payable ?? row.amount)} تومان</b></span>
          </div>
          {/* **همهٔ** فیش‌ها، نه فقط اولی — بیماری که دو قسط واریز کرده دو فیش دارد. */}
          {receipts.length > 0 ? (
            <div className="ia-docs">
              {receipts.map((doc, n) => (
                <Receipt key={doc.id} documentId={doc.id} fileName={doc.name} pdf={doc.pdf} onOpen={onZoom}
                         label={receipts.length > 1 ? `فیشِ ${faNum(n + 1)}` : 'فیشِ واریزی'} />
              ))}
            </div>
          ) : (row.payable ?? row.amount) > 0 && (
            <p className="ia-note warn"><Alert width="13" height="13" /> فیشی آپلود نشده است</p>
          )}
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
                <select value={bankShown} disabled={busy}
                        onChange={(e) => setF((s) => ({ ...s, bankAccountId: e.target.value }))}>
                  <option value="">— نامشخص —</option>
                  {refs.banks.map((b) => <option key={b.id} value={b.id}>{b.label ?? [b.ownerName, b.bankName].filter(Boolean).join(" — ")}</option>)}
                </select>
                {row.payToAccountId && bankShown === String(row.payToAccountId) && (
                  <small className="ia-hint">همان حسابی که روی فرمِ بیمار بود</small>
                )}
              </label>
            )}
          </div>
          )}
        </section>

        {err && <p className="ia-note warn">{err}</p>}
        {mode === 'approve' ? (
          <>
            <button type="button" className="ia-ok" disabled={busy} onClick={save}>
              {busy
                ? 'در حال ثبت…'
                : row.makesVisit === false ? 'تأیید و ثبت در پرونده' : 'تأیید و ساختِ مراجعه'}
            </button>
            <div className="ia-acts">
              <button type="button" className="ia-ghost" disabled={busy} onClick={() => setMode('return')}>بازگرداندن برای اصلاح</button>
              <button type="button" className="ia-no" disabled={busy} onClick={() => setMode('reject')}>رد</button>
            </div>
          </>
        ) : (
          <Decide row={row} mode={mode} onCancel={() => setMode('approve')} onDone={onDone} />
        )}
      </div>
      {quick && <QuickDefinitionEditor sectionKey={quick.section} initial={quick.initial} onClose={() => setQuick(null)} onSaved={async (_message, saved) => {
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
        : r.sent ? `لینک به ${faDigits(r.to)} پیامک شد` : 'ارسال انجام نشد — شماره یا سرویس را بررسی کنید');
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
          متنِ پیامک: «{link.title}» به‌همراهِ نشانیِ ثبت‌نام. «لغو11» خودکار اضافه می‌شود.
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
      onDone(editing ? 'لینک ویرایش شد' : 'لینک ساخته شد');
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
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} placeholder="نامِ فرم" />
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

/**
 * کشوییِ تأیید. هشدار (company-19): پیوندِ «تعریف پایه» متنی بود و کنارِ «+» شبیهِ برچسب دیده می‌شد؛ حالا
 * آیکونِ «مدیریتِ فهرست» (زبانهٔ تازه) با نامِ کامل برای صفحه‌خوان. یادداشتِ تطبیق و خطای «الزامی» هم
 * زیرِ خودِ کشویی‌اند، و خطا با `aria-describedby` به آن وصل است.
 */
function ApprovalSelect({ field, section, label, list, value, busy, onChange, onAdd, note, error }) {
  const noun = String(label).replace(/\s*\(.*\)\s*$/, '');
  const errId = `approve-${field}-err`;
  return <div className="ia-field">
    <div className="ia-definition-head"><label htmlFor={`approve-${field}`}>{label}</label>
      {onAdd && <button type="button" disabled={busy} onClick={() => onAdd({ field, section })} aria-label={`افزودن ${label}`}><Plus width="16" height="16" /></button>}
      <Link to={section === 'techs' ? '/app/users' : `/app/definitions?section=${section}`} target="_blank" rel="noopener noreferrer"
            className="ia-manage" title="مدیریتِ فهرست (زبانهٔ تازه)" aria-label={`مدیریتِ فهرستِ ${noun} (در زبانهٔ تازه)`}>
        <External width="14" height="14" />
      </Link>
    </div>
    <select id={`approve-${field}`} value={value} disabled={busy} onChange={(e) => onChange(e.target.value)}
            aria-invalid={error ? true : undefined} aria-describedby={error ? errId : undefined}>
      <option value="">— انتخاب —</option>
      {list.filter((r) => r.active !== false).map((r) => <option key={r.id} value={r.id}>{r.name ?? r.displayName}</option>)}
    </select>
    {error && <p id={errId} className="ia-field-err"><Alert width="12" height="12" /> {error}</p>}
    {note && <p className="ia-note">{note}</p>}
  </div>;
}
