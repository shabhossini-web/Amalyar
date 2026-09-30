import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from './auth.jsx';
import { api } from '../lib/api.js';
import { JOB_ROLES } from '../lib/job-roles.js';
import PersonFields, { personErrors } from './PersonFields.jsx';
import { toEnDigits } from '../lib/identity.js';
/* ⚠️ `faDate` استفاده می‌شد ولی هرگز ایمپورت نشده بود. چون پشتِ
   `row.createdAt &&` بود، فقط وقتی می‌ترکید که **واقعاً کاربرِ در انتظار
   وجود داشت** — یعنی دقیقاً روی نصبِ مشتری، و هرگز روی دیتابیسِ خالیِ
   توسعه. همین کرش صفحهٔ کاربران را روی error boundary می‌انداخت. */
import { faDate } from '../lib/jalali.js';
import './definitions.css';
import './launcher.css';
import './users.css';
import { Caret, Check, Close, Lock, Plus, Search, User } from '../ui/icons.jsx';
import PageHeader from '../ui/PageHeader.jsx';
import { useConfirm } from '../ui/Confirm.jsx';
import Tabs from '../ui/Tabs.jsx';
import Overlay from '../ui/Overlay.jsx';
import { useStagger } from '../ui/stagger.js';
import Toast, { useToast } from '../ui/Toast.jsx';
import { useConfig } from './config.jsx';
import { roleShown } from '../lib/terms.js';
import { PENDING_CHANGED } from './usePending.js';


/**
 * وضعیتِ **حساب** — نه وضعیتِ مراجعه.
 *
 * ⚠️ این ثابت اصلاً نوشته نشده بود و `STATUS_FA[row.status]` مستقیم به
 * `ReferenceError` می‌خورد؛ کلِ صفحهٔ کاربران روی error boundary می‌افتاد و
 * ادمین نه می‌توانست کاربری را تأیید کند نه ببیند. نامِ یکسان در
 * `Dashboard.jsx` و `PatientRecord.jsx` وجود دارد ولی آن‌ها وضعیتِ **عمل**‌اند
 * (pending/done/cancelled) — پس ایمپورت‌کردنشان اشتباه بود، نه راه‌حل.
 */
const STATUS_FA = {
  pending: 'در انتظارِ تأیید',
  active: 'فعال',
  disabled: 'غیرفعال',
  rejected: 'ردشده',
};

const LEVELS = [
  { v: 1, l: 'بازدید' },
  { v: 2, l: 'کارشناس' },
  { v: 3, l: 'کارشناس‌ادمین' },
  { v: 4, l: 'سوپروایزر' },
  { v: 5, l: 'ادمین' },
  { v: 6, l: 'سوپرادمین' },
];
/** شیتِ تکمیلِ پروفایل — همان PersonFields جراح، تا شکلِ «شخص» همه‌جا یکی بماند. */
function ProfileSheet({ id, onClose, onSaved, onError }) {
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api(`/accounts/${id}`)
      .then((d) => { if (alive) setForm({ ...d, fee: d.fee ?? '' }); })
      .catch((e) => onError(e.message));
    return () => { alive = false; };
  }, [id, onError]);

  const save = async () => {
    if (busy || !form) return;
    const e = personErrors(form);
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const body = {};
      for (const k of ['firstName', 'lastName', 'phone', 'nationalId', 'email', 'city', 'address', 'iban', 'notes']) {
        body[k] = form[k] ?? '';
      }
      const fee = String(form.fee ?? '').trim();
      if (fee !== '') body.fee = Number(toEnDigits(fee).replace(/[^0-9]/g, '')) || 0;
      await api(`/accounts/${id}`, { method: 'PATCH', body });
      await onSaved();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay backdrop="df-overlay" panel="df-sheet" as="section" onClose={onClose} closable={!busy}>
      <header className="df-sheet-head">
        <b>پروفایلِ کارشناس</b>
        <button type="button" className="df-x" onClick={onClose} aria-label="بستن"><Close size={16} /></button>
      </header>
      <div className="df-sheet-body">
        {!form ? <p className="us-empty">در حال بارگذاری…</p> : (
          <>
            {/* نادرست بود (بستهٔ PS، PS5): شبا و کدِ ملیِ جراح/رانندهٔ صاحبِ حساب از «تعاریف» هم عوض می‌شد. حالا نام،
                موبایل، عکس و شبای صاحبِ حساب فقط از همین‌جا عوض می‌شوند؛ کدِ ملی از «تعاریف» هم (با ممیزی). */}
            <p className="us-hint" style={{ marginTop: 0 }}>
              نام، موبایل و عکس را خودِ شخص هنگامِ ثبت‌نام پر کرده است. نام، موبایل و شبا فقط از همین‌جا عوض
              می‌شوند (نه از «تعاریف»)؛ کد ملی و دستمزد هم این‌جا تکمیل می‌شوند.
            </p>
            <PersonFields value={form} onChange={setForm} errors={errors} disabled={busy} />
            <label className="pf-field">
              <span>دستمزد (تومان)</span>
              <input
                type="text"
                inputMode="numeric"
                dir="ltr"
                value={form.fee ?? ''}
                onChange={(ev) => setForm((f) => ({ ...f, fee: toEnDigits(ev.target.value).replace(/[^0-9]/g, '') }))}
                disabled={busy}
              />
              <em className="pf-hint">قراردادِ کاملِ مالی بعداً در ماژولِ حسابداری</em>
            </label>
          </>
        )}
      </div>
      <footer className="df-sheet-foot">
        <button type="button" className="df-ghost" onClick={onClose} disabled={busy}>انصراف</button>
        <button type="button" className="df-save" onClick={save} disabled={busy || !form}>{busy ? '…' : 'ذخیره'}</button>
      </footer>
    </Overlay>
  );
}

function TemporaryAccountSheet({ onClose, onSaved, testingEnabled }) {
  const { vertical } = useConfig();
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '' });
  const [testAccount, setTestAccount] = useState(false), [username, setUsername] = useState('');
  const [level, setLevel] = useState(2), [jobRole, setRole] = useState('technician');
  const [busy, setBusy] = useState(false), [errors, setErrors] = useState({}), [message, setMessage] = useState(''), [result, setResult] = useState(null);
  const save = async () => {
    const next = personErrors(form); if (!form.phone) next.phone = 'شماره همراه لازم است'; if (testAccount && !/^(?=.*[a-zA-Z])[a-zA-Z0-9_.-]{3,40}$/.test(username)) next.username = '۳ تا ۴۰ کاراکتر، شامل حرف لاتین؛ مثل test-doctor';
    /* دست‌کم یک حرفِ لاتین (بستهٔ PS، PS9) — تمام‌رقم با شمارهٔ موبایلِ کسِ دیگری اشتباه می‌شد. */
    else if (username && !/^(?=.*[a-zA-Z])[a-zA-Z0-9_.-]{3,40}$/.test(username)) next.username = 'نام کاربری ۳ تا ۴۰ حرف لاتین یا عدد و دست‌کم یک حرفِ لاتین باشد';
    setErrors(next);
    if (Object.keys(next).length || busy) return;
    setBusy(true); setMessage('');
    try { const body = { level, jobRole, ...(testAccount ? { testAccount: true } : {}), ...(username ? { username } : {}) }; for (const k of ['firstName', 'lastName', 'phone', 'nationalId', 'email', 'city', 'address', 'iban', 'notes']) if (form[k]) body[k] = form[k];
      setResult(await api('/accounts/temporary', { method: 'POST', body })); await onSaved();
    } catch (e) { setMessage(e.message); } finally { setBusy(false); }
  };
  return <Overlay backdrop="df-overlay" panel="df-sheet" as="section" onClose={onClose} closable={!busy}>
    <header className="df-sheet-head"><b>ساخت حساب موقت</b><button className="df-x" onClick={onClose} disabled={busy} aria-label="بستن"><Close size={16} /></button></header>
    <div className="df-sheet-body">
      {result ? <><p>حساب ساخته شد. این رمز فقط همین بار نمایش داده می‌شود؛ اطلاعات ورود را به صاحب حساب تحویل دهید.</p>
        <p>{result.account.isTestAccount ? 'حساب آزمایشی؛ ورود فقط با نام کاربری. ' : ''}نام کاربری: <b dir="ltr">{result.account.username}</b></p><p>رمز اولیه: <b dir="ltr">{result.temporaryPassword}</b></p>
        <p>مهلت تأیید شماره: {faDate(result.account.verificationDueAt)}. شخص پس از ورود از «پروفایل من» شماره را با کد پیامکی تأیید و مشخصات و رمز خود را تکمیل کند. بعد از مهلت، حساب تأییدنشده غیرفعال می‌شود.</p>
      </> : <>{testingEnabled && <label className="us-test-toggle"><input type="checkbox" checked={testAccount} onChange={e => setTestAccount(e.target.checked)} disabled={busy} /><span>حساب آزمایشی با شماره مشترک</span></label>}
        {testAccount && <p>پروفایل جدید و مستقل با همین شماره ساخته می‌شود. ورود فقط با نام کاربری است. کد ملی تکراری وارد نکنید؛ این فیلد اختیاری است. حساب آزمایشی به داده‌های همین شرکت طبق نقش انتخابی دسترسی دارد.</p>}
        <label className="pf-field"><span>نام کاربری {testAccount ? '(الزامی)' : '(اختیاری)'}</span><input dir="ltr" autoComplete="off" value={username} maxLength={40} onChange={e => setUsername(e.target.value.trim())} disabled={busy} placeholder="test-doctor" />{errors.username && <em role="alert">{errors.username}</em>}</label>
        <p>حساب بلافاصله قابل ورود است. صاحب شماره هفت روز برای تأیید پیامکی و تکمیل پروفایل فرصت دارد. مشخصات افراد موجود در تعاریف پایه حفظ می‌شود.</p>
        <PersonFields value={form} onChange={setForm} errors={errors} disabled={busy} />
        <label className="pf-field"><span>سطح دسترسی</span><select value={level} onChange={e => setLevel(+e.target.value)} disabled={busy}>{LEVELS.map(l => <option key={l.v} value={l.v}>{l.l}</option>)}</select></label>
        <label className="pf-field"><span>نقش شغلی</span><select value={jobRole} onChange={e => setRole(e.target.value)} disabled={busy}>{JOB_ROLES.filter(r => roleShown(vertical, r.v)).map(r => <option key={r.v} value={r.v}>{r.l}</option>)}</select></label>
        {['driver', 'courier'].includes(jobRole) && <p>حساب به نیروی حمل‌ونقل متصل می‌شود و مسیرها و ابلاغ‌ها در پرتال حمل‌ونقل قابل مشاهده خواهند بود.</p>}
        {jobRole === 'doctor' && <p>در شرکت‌های نورومانیتورینگ و ایمپلنت، حساب پزشک به جراح در تعاریف پایه و پرتال او متصل می‌شود.</p>}
      </>}
      {message && <p role="alert">{message}</p>}
    </div><footer className="df-sheet-foot"><button className="df-ghost" disabled={busy} onClick={onClose}>بستن</button>{!result && <button className="df-save" disabled={busy} onClick={save}>{busy ? 'در حال ساخت…' : 'ساخت حساب'}</button>}</footer>
  </Overlay>;
}

export default function Users() {
  const stagger = useStagger();
  const { user } = useAuth();
  const { vertical } = useConfig();
  const [tab, setTab] = useState('pending'); // pending | all
  const [q, setQ] = useState('');
  const [confirmNode, confirm] = useConfirm();
  const [pending, setPending] = useState(null);
  const [all, setAll] = useState(null);
  const [levelSel, setLevelSel] = useState({}); // id → سطحِ انتخابی
  const [busyId, setBusyId] = useState(0);
  const { msg: toast, show: setToast } = useToast(1800);
  const [profileId, setProfileId] = useState(0);
  const [creating, setCreating] = useState(false);
  const [testingEnabled, setTestingEnabled] = useState(false), [modeBusy, setModeBusy] = useState(false);


  const load = useCallback(async () => {
    try {
      const [p, a, mode] = await Promise.all([api('/accounts/pending'), api('/accounts'), api('/accounts/testing-mode')]);
      setTestingEnabled(mode.enabled === true);
      setPending(p);
      setAll(a);
    } catch (e) {
      setToast(e.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  /* جستجو در «همهٔ کاربران» — نام، نامِ کاربری، موبایل (ارقامِ فارسی هم). */
  const needle = toEnDigits(q.trim()).toLowerCase();
  const shownAll = all && (needle
    ? all.filter((r) => [r.displayName, r.username, r.phone].some((v) => toEnDigits(String(v ?? '')).toLowerCase().includes(needle)))
    : all);

  if (user && user.level < 6) return <Navigate to="/app" replace />;

  const toggleTesting = async () => {
    if (modeBusy) return;
    setModeBusy(true);
    try { const result = await api('/accounts/testing-mode', { method: 'POST', body: { enabled: !testingEnabled } }); await load(); setToast(result.enabled ? 'ساخت حساب آزمایشی فعال شد' : `${result.disabled} حساب آزمایشی غیرفعال شد`); }
    catch (e) { setToast(e.message); } finally { setModeBusy(false); }
  };

  const approve = async (row) => {
    const level = levelSel[row.id] ?? 2;
    setBusyId(row.id);
    try {
      await api(`/accounts/${row.id}/approve`, { method: 'POST', body: { level } });
      setToast(`«${row.displayName}» تأیید شد — ${LEVELS.find((x) => x.v === level)?.l}`);
      window.dispatchEvent(new Event(PENDING_CHANGED));
      await load();
    } catch (e) {
      setToast(e.message);
    } finally {
      setBusyId(0);
    }
  };

  const reject = async (row) => {
    /* «رد» بی‌پرسش انجام می‌شد (بازبینیِ UX ۱۴۰۵/۰۷) — حالا با نامِ فرد و اثرش. */
    const ok = await confirm({
      title: `درخواستِ «${row.displayName}» رد شود؟`,
      body: 'این حساب وارد سامانه نمی‌شود و از فهرستِ «در انتظارِ تأیید» بیرون می‌رود؛ در «همهٔ کاربران» با وضعیتِ «ردشده» می‌ماند.',
      ok: 'رد کن',
      danger: true,
    });
    if (!ok) return;
    setBusyId(row.id);
    try {
      await api(`/accounts/${row.id}/reject`, { method: 'POST' });
      setToast(`درخواستِ «${row.displayName}» رد شد`);
      window.dispatchEvent(new Event(PENDING_CHANGED));
      await load();
    } catch (e) {
      setToast(e.message);
    } finally {
      setBusyId(0);
    }
  };

  const setJobRole = async (row, jobRole) => {
    setBusyId(row.id);
    try {
      await api(`/accounts/${row.id}/job-role`, { method: 'POST', body: { jobRole } });
      setToast(jobRole ? 'نقشِ شغلی ثبت شد' : 'نقشِ شغلی برداشته شد');
      await load();
    } catch (e) { setToast(e.message); } finally { setBusyId(0); }
  };

  const setLevel = async (row, level) => {
    setBusyId(row.id);
    try {
      await api(`/accounts/${row.id}/level`, { method: 'POST', body: { level } });
      setToast(`سطحِ «${row.displayName}» شد ${LEVELS.find((x) => x.v === level)?.l}`);
      await load();
    } catch (e) {
      setToast(e.message);
    } finally {
      setBusyId(0);
    }
  };

  const Avatar = ({ row, size = 46 }) => (
    <span className="us-avatar" style={{ width: size, height: size }}>
      {row.selfie
        ? <img src={row.selfie} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        : <User width={size * 0.5} height={size * 0.5} />}
    </span>
  );

  return (
    <div className="lx us">
      <div className="lx-bg" aria-hidden="true" />
      <div className="lx-grid" aria-hidden="true" />

      <div className="lx-shell us-shell">
        {/* نامِ صفحه همان نامِ کاشی است («کاربران») — قانونِ ۲۴؛ کاتالوگ تنها منبعِ نام است. */}
        <PageHeader tool="users">
          {/* «دسترسی‌ها» تبی بود که فقط یک لینک داشت — حالا خودِ لینک کنارِ عنوان است. */}
          <Link to="/app/access" className="us-headlink"><Lock width="14" height="14" aria-hidden="true" /> سطوحِ دسترسی</Link>
        </PageHeader>

        {/* کارِ اصلیِ صفحه — تأییدِ کارکنان و فهرستِ همه — بالا؛ ساختِ حساب یک دکمهٔ عادی کنارِ آن،
            نه پررنگ‌ترین دکمهٔ صفحه، و ابزارِ آزمایشیِ نقش‌ها تاشو پایینِ صفحه (بازبینیِ UX ۱۴۰۵/۰۷). */}
        <div className="us-bar">
          <Tabs
            variant="inset"
            className="us-tabs"
            label="بخش‌های کاربران"
            value={tab}
            onChange={setTab}
            items={[
              { key: 'pending', label: 'در انتظار تأیید', badge: pending?.length || null },
              { key: 'all', label: 'همهٔ کاربران' },
            ]}
          />
          <button type="button" className="us-btn us-new" onClick={() => setCreating(true)}>
            <Plus width="15" height="15" aria-hidden="true" /> ساختِ حسابِ موقت
          </button>
        </div>

        {/* ── در انتظار تأیید ── */}
        {tab === 'pending' && (
          <div className="us-list">
            {pending === null && <p className="us-empty">در حال بارگذاری…</p>}
            {pending?.length === 0 && <p className="us-empty">درخواستی در انتظارِ تأیید نیست.</p>}
            {pending?.map((row, i) => (
              <motion.div key={row.id} {...stagger(i)} className="glass us-card">
                <div className="us-row">
                  <Avatar row={row} size={52} />
                  <div className="us-meta">
                    <b>{row.displayName}</b>
                    <span dir="ltr">@{row.username}</span>
                    <span dir="ltr">{row.phone}</span>
                    {row.createdAt && <small>{faDate(row.createdAt)}</small>}
                  </div>
                </div>
                <div className="us-actions">
                  <label className="us-levelpick">
                    <span>سطح:</span>
                    <select
                      value={levelSel[row.id] ?? 2}
                      onChange={(e) => setLevelSel((s) => ({ ...s, [row.id]: +e.target.value }))}
                    >
                      {LEVELS.map((l) => <option key={l.v} value={l.v}>{l.v} — {l.l}</option>)}
                    </select>
                  </label>
                  <button className="us-btn ok" disabled={busyId === row.id} onClick={() => approve(row)}>
                    <Check width="16" height="16" /> تأیید
                  </button>
                  <button className="us-btn no" disabled={busyId === row.id} onClick={() => reject(row)}>
                    <Close width="16" height="16" /> رد
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {/* ── همهٔ کاربران ── */}
        {tab === 'all' && (
          <div className="us-list">
            <label className="us-search">
              <Search width="16" height="16" aria-hidden="true" />
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="نام، نامِ کاربری یا موبایل…"
                aria-label="جستجو در کاربران" autoComplete="off" />
            </label>
            {all === null && <p className="us-empty">در حال بارگذاری…</p>}
            {all && shownAll.length === 0 && <p className="us-empty">کاربری با «{q.trim()}» پیدا نشد.</p>}
            {shownAll?.map((row, i) => (
              <motion.div key={row.id} {...stagger(i)} className="glass us-card slim">
                <div className="us-row">
                  <Avatar row={row} />
                  <div className="us-meta">
                    <b>{row.isTestAccount && <i className="us-you">آزمایشی</i>}{row.displayName}{row.id === user.id && <i className="us-you">شما</i>}</b>
                    <span dir="ltr">@{row.username}</span>
                  </div>
                  {row.verificationDueAt && !row.phoneVerifiedAt && <small>تأیید شماره تا {faDate(row.verificationDueAt)}</small>}
                  <span className={`us-status ${row.status}`}>{STATUS_FA[row.status] || row.status}</span>
                </div>
                <div className="us-actions">
                  <label className="us-levelpick grow">
                    <span>سطح:</span>
                    <select
                      value={row.level}
                      disabled={busyId === row.id || row.id === user.id || row.status !== 'active'}
                      onChange={(e) => setLevel(row, +e.target.value)}
                    >
                      {LEVELS.map((l) => <option key={l.v} value={l.v}>{l.v} — {l.l}</option>)}
                    </select>
                  </label>
                  {/* نقشِ شغلی — «هر کس قسمتِ خودش را پر کند» (BOOKING مرحلهٔ ۴).
                      جدا از سطح: سطح می‌گوید چقدر می‌بینی، نقش می‌گوید کدام
                      بخشِ فرم مالِ توست. سوپرادمین (سطح ۶) بیرون از قاعده است:
                      نقش رویش اثری ندارد، پس انتخابگر برایش بسته است. */}
                  <label
                    className="us-levelpick"
                    title={row.level >= 6 ? 'سوپرادمین بیرون از قاعدهٔ نقش است — کلِ چرخه را می‌بیند و ویرایش می‌کند' : undefined}
                  >
                    <span>نقش:</span>
                    <select
                      value={row.jobRole ?? ''}
                      disabled={busyId === row.id || row.status !== 'active' || row.level >= 6}
                      onChange={(e) => setJobRole(row, e.target.value || null)}
                    >
                      <option value="">— بدونِ نقش —</option>
                      {/* نقشِ بی‌ربط به حوزه پنهان است، مگر همین حساب از قبل آن را دارد. */}
                      {JOB_ROLES.filter((r) => roleShown(vertical, r.v) || r.v === row.jobRole).map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
                    </select>
                  </label>
                  <button type="button" className="us-btn" onClick={() => setProfileId(row.id)}>پروفایل</button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
        {!user?.isTestAccount && (
          <details className="glass us-card us-testing">
            <summary>تست نقش‌ها با یک شماره (حسابِ آزمایشی) <Caret className="us-caret" width="15" height="15" aria-hidden="true" /></summary>
            <p>حالت آزمایشی را روشن کنید، سپس در «ساختِ حسابِ موقت» گزینهٔ شماره مشترک و نام کاربری مستقل را انتخاب کنید. از منوی حساب، «افزودن حساب» و جابه‌جایی بین نقش‌ها استفاده کنید.</p>
            <p>پایان تست همهٔ حساب‌های آزمایشی و نشست‌هایشان را غیرفعال می‌کند؛ اطلاعات ثبت‌شده حذف نمی‌شود. روشن‌کردن دوباره، حساب‌های قبلی را خودکار فعال نمی‌کند.</p>
            <button className="us-btn" disabled={modeBusy} onClick={toggleTesting}>{modeBusy ? 'در حال ثبت…' : testingEnabled ? 'پایان تست و غیرفعال‌کردن حساب‌های آزمایشی' : 'فعال‌کردن ساخت حساب آزمایشی'}</button>
          </details>
        )}
      </div>

      <AnimatePresence>
        {creating && <TemporaryAccountSheet testingEnabled={testingEnabled && !user?.isTestAccount} onClose={() => setCreating(false)} onSaved={load} />}
        {profileId > 0 && (
          <ProfileSheet
            id={profileId}
            onClose={() => setProfileId(0)}
            onSaved={async () => { setProfileId(0); setToast('پروفایل ذخیره شد'); await load(); }}
            onError={setToast}
          />
        )}
      </AnimatePresence>

      {confirmNode}
      <Toast msg={toast} />
    </div>
  );
}
