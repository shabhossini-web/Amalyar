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
import ProfileMenu from './ProfileMenu.jsx';
import './launcher.css';
import './users.css';
import { Back, Check, Close, User } from '../ui/icons.jsx';
import Tabs from '../ui/Tabs.jsx';
import Overlay from '../ui/Overlay.jsx';
import { useStagger } from '../ui/stagger.js';


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
            <p className="us-hint" style={{ marginTop: 0 }}>
              نام، موبایل و عکس هنگامِ ثبت‌نام توسطِ خودِ کارشناس پر شده‌اند.
              کد ملی، شبا و دستمزد فقط از این‌جا تکمیل می‌شوند.
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

export default function Users() {
  const stagger = useStagger();
  const { user } = useAuth();
  const [tab, setTab] = useState('pending'); // pending | all | perm
  const [pending, setPending] = useState(null);
  const [all, setAll] = useState(null);
  const [levelSel, setLevelSel] = useState({}); // id → سطحِ انتخابی
  const [busyId, setBusyId] = useState(0);
  const [toast, setToast] = useState('');
  const [profileId, setProfileId] = useState(0);

  useEffect(() => { document.title = 'عمل‌یار — مدیریت کاربران'; }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([api('/accounts/pending'), api('/accounts')]);
      setPending(p);
      setAll(a);
    } catch (e) {
      setToast(e.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (user && user.level < 6) return <Navigate to="/app" replace />;

  const approve = async (row) => {
    const level = levelSel[row.id] ?? 2;
    setBusyId(row.id);
    try {
      await api(`/accounts/${row.id}/approve`, { method: 'POST', body: { level } });
      setToast(`«${row.displayName}» تأیید شد — ${LEVELS.find((x) => x.v === level)?.l}`);
      await load();
    } catch (e) {
      setToast(e.message);
    } finally {
      setBusyId(0);
    }
  };

  const reject = async (row) => {
    setBusyId(row.id);
    try {
      await api(`/accounts/${row.id}/reject`, { method: 'POST' });
      setToast(`درخواستِ «${row.displayName}» رد شد`);
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
      setToast(jobRole ? 'نقشِ شغلی ثبت شد ✓' : 'نقشِ شغلی برداشته شد ✓');
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
        <header className="us-head">
          <Link to="/app" className="lx-back" aria-label="بازگشت به لانچر"><Back width="15" height="15" /> لانچر</Link>
          <h1>مدیریت کاربران</h1>
          <div className="us-head-left"><ProfileMenu onToast={setToast} /></div>
        </header>

        <Tabs
          variant="inset"
          className="us-tabs"
          label="بخش‌های کاربران"
          value={tab}
          onChange={setTab}
          items={[
            { key: 'pending', label: 'در انتظار تأیید', badge: pending?.length || null },
            { key: 'all', label: 'همهٔ کاربران' },
            { key: 'perm', label: 'دسترسی‌ها' },
          ]}
        />

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
            {all === null && <p className="us-empty">در حال بارگذاری…</p>}
            {all?.map((row, i) => (
              <motion.div key={row.id} {...stagger(i)} className="glass us-card slim">
                <div className="us-row">
                  <Avatar row={row} />
                  <div className="us-meta">
                    <b>{row.displayName}{row.id === user.id && <i className="us-you">شما</i>}</b>
                    <span dir="ltr">@{row.username}</span>
                  </div>
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
                      بخشِ فرم مالِ توست. */}
                  <label className="us-levelpick">
                    <span>نقش:</span>
                    <select
                      value={row.jobRole ?? ''}
                      disabled={busyId === row.id || row.status !== 'active'}
                      onChange={(e) => setJobRole(row, e.target.value || null)}
                    >
                      <option value="">— بدونِ نقش —</option>
                      {JOB_ROLES.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
                    </select>
                  </label>
                  <button type="button" className="us-btn" onClick={() => setProfileId(row.id)}>پروفایل</button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
        {/* ── دسترسی‌ها ──
            ⚠️ ماتریسِ کامل (ماژول‌ها + مجوزهای عملیاتی) صفحهٔ خودش را دارد.
            این‌جا فقط یک در است: تنظیمِ دسترسی تا امروز داخلِ همین تب قایم
            بود و مدیر پیدایش نمی‌کرد — قابلیتی که پیدا نشود وجود ندارد. */}
        {tab === 'perm' && (
          <div className="us-list">
            <p className="us-hint">
              سطحِ لازم برای هر بخش و هر مجوزِ عملیاتی در صفحهٔ «سطوحِ دسترسی» تعیین
              می‌شود — همان‌جا هم می‌شود دید که یک سطحِ مشخص به چه چیزهایی می‌رسد.
            </p>
            <Link className="us-btn ok us-acclink" to="/app/access">رفتن به سطوحِ دسترسی</Link>
          </div>
        )}
      </div>

      <AnimatePresence>
        {profileId > 0 && (
          <ProfileSheet
            id={profileId}
            onClose={() => setProfileId(0)}
            onSaved={async () => { setProfileId(0); setToast('پروفایل ذخیره شد ✓'); await load(); }}
            onError={setToast}
          />
        )}
      </AnimatePresence>

      <div className={`lx-toast${toast ? ' on' : ''}`}>{toast}</div>
    </div>
  );
}
