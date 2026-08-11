import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { api, apiBlobUrl } from '../lib/api.js';
import { faDate, isoToJStr, jStrToIso } from '../lib/jalali.js';
import './intake-admin.css';
import { Alert, Back, Bank, CheckCircle, Close, Copy, Doctor, Form, Hospital, Plus, Search } from '../ui/icons.jsx';
import { group3, numToWordsFa, parseMoney } from '../lib/money.js';
import Tabs from '../ui/Tabs.jsx';
import Overlay from '../ui/Overlay.jsx';
import JDate from './JDate.jsx';
import TimePick from '../ui/TimePick.jsx';
import { useStagger } from '../ui/stagger.js';

const faNum = (n) => Number(n ?? 0).toLocaleString('fa-IR');
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
  const [newLink, setNewLink] = useState(false);
  const [zoom, setZoom] = useState(null); // نشانیِ blobِ فیشِ در حالِ بزرگ‌نمایی
  const row = useStagger();

  useEffect(() => { document.title = 'عمل‌یار — ثبت‌نامِ بیماران'; }, []);
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
          <h1>ثبت‌نامِ بیماران</h1>
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
            {/* ⚠️ از راهِ `toggleLink` و نه `api(...).then(load)`: نسخهٔ قبلی
                `catch` نداشت، پس یک ۴۰۳ ردیف را بی‌تغییر می‌گذاشت و فقط یک
                unhandled rejection در کنسول می‌ریخت. */}
            <button type="button" onClick={() => toggleLink(l)}>
              {l.active ? 'غیرفعال' : 'فعال'}
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
                <button type="button" className="ia-ok" onClick={() => setApproving(s)}>تأیید و ساختِ مراجعه</button>
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
        {newLink && (
          <LinkSheet onClose={() => setNewLink(false)} onDone={(m) => { setNewLink(false); setToast(m); load(); }} />
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
function Receipt({ documentId, onOpen }) {
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

  return (
    <button type="button" className="ia-receipt" onClick={() => onOpen(url)} title="بزرگ‌نمایی">
      <img src={url} alt="فیشِ واریزی" />
      <span><Search width="13" height="13" /> فیشِ واریزی — برای بزرگ‌نمایی بزنید</span>
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

  useEffect(() => {
    Promise.all([
      api('/surgeons').catch(() => []),
      api('/hospitals').catch(() => []),
      api('/techs').catch(() => []),
      api('/procedure-types').catch(() => []),
      api('/bank-accounts').catch(() => []),
    ]).then(([surgeons, hospitals, techs, types, banks]) => setRefs({ surgeons, hospitals, techs, types, banks }));
  }, []);

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
        },
      });
      onDone(`مراجعهٔ ${r.visitCode} ساخته شد ✓`);
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  const Sel = ({ k, label, list, name = 'name' }) => (
    <label className="ia-field">
      <span>{label}</span>
      <select value={f[k]} disabled={busy} onChange={(e) => setF((s) => ({ ...s, [k]: e.target.value }))}>
        <option value="">— انتخاب —</option>
        {list.map((o) => <option key={o.id} value={o.id}>{o[name] ?? o.displayName}</option>)}
      </select>
    </label>
  );

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
        <div className="ia-grid">
          <Sel k="surgeonId" label="جراح" list={refs.surgeons} />
          <Sel k="hospitalId" label="بیمارستان" list={refs.hospitals} />
          <Sel k="techId" label="کارشناس" list={refs.techs} name="displayName" />
          <Sel k="procedureTypeId" label="نوعِ عمل" list={refs.types} />
          <JDate className="ia-field" label="تاریخِ عمل" value={f.opDate}
                 onChange={(v) => setF((s) => ({ ...s, opDate: v }))} disabled={busy} />
          <TimePick className="ia-field" label="ساعتِ عمل" value={f.opStartTime}
                    onChange={(v) => setF((s) => ({ ...s, opStartTime: v }))} disabled={busy} />
        </div>
        {/* ⚠️ ثبتِ پرداخت همین‌جاست چون همین‌جا فیش جلوی چشمِ ادمین است و
            می‌داند پول کجا نشسته. نسخهٔ اول پرداخت ثبت نمی‌کرد و نتیجه‌اش
            مراجعهٔ تأییدشده‌ای بود که کلِ مبلغش «مانده» می‌ماند. */}
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

        {err && <p className="ia-note warn">{err}</p>}
        <button type="button" className="ia-ok" disabled={busy} onClick={save}>
          {busy ? 'در حال ساخت…' : 'تأیید و ساختِ مراجعه'}
        </button>
      </div>
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
function LinkSheet({ onClose, onDone }) {
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [formId, setFormId] = useState('');
  const [bankId, setBankId] = useState('');
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
        if (d.forms?.length === 1) setFormId(String(d.forms[0].id));
      })
      .catch(() => { if (alive) setOpts({ forms: [], banks: [] }); });
    return () => { alive = false; };
  }, []);

  const picked = opts?.forms?.find((f) => String(f.id) === formId) ?? null;
  const needsBank = !!picked?.hasPayment;
  const toman = parseMoney(amount);

  const save = async () => {
    setBusy(true); setErr('');
    try {
      await api('/intake/links', {
        method: 'POST',
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
      onDone('لینک ساخته شد ✓');
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <Overlay backdrop="ia-overlay" panel="ia-sheet sm" as="section" onClose={onClose} closable={!busy}>
      <header className="ia-sheet-head">
        <b>لینکِ ثبت‌نامِ تازه</b>
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
        <button type="button" className="ia-ok" disabled={busy || title.trim().length < 2} onClick={save}>ساختِ لینک</button>
      </div>
    </Overlay>
  );
}
