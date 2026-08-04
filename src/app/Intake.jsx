import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { faDate } from '../lib/jalali.js';
import './intake-admin.css';
import { Alert, Back, CheckCircle, Close, Copy, Doctor, Hospital, Plus } from '../ui/icons.jsx';
import Tabs from '../ui/Tabs.jsx';
import Overlay from '../ui/Overlay.jsx';
import JDate from './JDate.jsx';
import TimePick from '../ui/TimePick.jsx';
import { useStagger } from '../ui/stagger.js';

const faNum = (n) => Number(n ?? 0).toLocaleString('fa-IR');
const toman = (rial) => faNum(Math.round((rial ?? 0) / 10));

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
            <em>{toman(l.amount)} تومان</em>
            <i>{faNum(l.submissionCount)} ثبت‌نام</i>
            <button type="button" onClick={() => copyLink(l.token)} title="کپیِ نشانی"><Copy size={13} /></button>
            <button type="button" onClick={() => api(`/intake/links/${l.id}`, { method: 'PATCH', body: { active: !l.active } }).then(load)}>
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
              <span className="ia-amount">{toman(s.amount)} تومان</span>
            </header>

            <div className="ia-facts">
              {s.data?.procedure && <span>{s.data.procedure}</span>}
              {s.data?.surgeonName && <span><Doctor width="13" height="13" /> {s.data.surgeonName}</span>}
              {s.data?.hospitalName && <span><Hospital width="13" height="13" /> {s.data.hospitalName}</span>}
              {s.data?.opDate && <span>{s.data.opDate}</span>}
              <span className="ia-when">{faDate(s.createdAt)}</span>
            </div>

            {s.data?.patientNotes && <p className="ia-note">{s.data.patientNotes}</p>}
            {s.reviewNote && <p className="ia-note warn">{s.reviewNote}</p>}
            {s.visitCode && <p className="ia-note ok"><CheckCircle width="13" height="13" /> مراجعهٔ {s.visitCode} ساخته شد</p>}

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
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {newLink && (
          <LinkSheet onClose={() => setNewLink(false)} onDone={(m) => { setNewLink(false); setToast(m); load(); }} />
        )}
      </AnimatePresence>

      <div className={`ia-toast${toast ? ' on' : ''}`}>{toast}</div>
    </div>
  );
}

/** فرمِ تأیید — جایی که «دکتر رضایی»ِ متنی به جراحِ تعریف‌شده گره می‌خورد. */
function ApproveSheet({ row, onClose, onDone }) {
  const [refs, setRefs] = useState({ surgeons: [], hospitals: [], techs: [], types: [] });
  const [f, setF] = useState({
    surgeonId: '', hospitalId: '', techId: '', procedureTypeId: '',
    opDate: row.data?.opDate ?? '', opStartTime: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    Promise.all([
      api('/surgeons').catch(() => []),
      api('/hospitals').catch(() => []),
      api('/techs').catch(() => []),
      api('/procedure-types').catch(() => []),
    ]).then(([surgeons, hospitals, techs, types]) => setRefs({ surgeons, hospitals, techs, types }));
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
          opDate: f.opDate || undefined,
          opStartTime: f.opStartTime || undefined,
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
        {err && <p className="ia-note warn">{err}</p>}
        <button type="button" className="ia-ok" disabled={busy} onClick={save}>
          {busy ? 'در حال ساخت…' : 'تأیید و ساختِ مراجعه'}
        </button>
      </div>
    </Overlay>
  );
}

function LinkSheet({ onClose, onDone }) {
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    setBusy(true); setErr('');
    try {
      // ⚠️ کاربر تومان می‌زند و ستونِ مبلغ ریال است — همان قراردادِ کلِ سامانه.
      await api('/intake/links', { method: 'POST', body: { title, amount: (Number(amount) || 0) * 10 } });
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
          <span>عنوان</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} placeholder="ثبت‌نامِ نورومانیتورینگ" />
        </label>
        <label className="ia-field">
          <span>مبلغ (تومان)</span>
          <input dir="ltr" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} />
        </label>
        {err && <p className="ia-note warn">{err}</p>}
        <button type="button" className="ia-ok" disabled={busy || title.trim().length < 2} onClick={save}>ساختِ لینک</button>
      </div>
    </Overlay>
  );
}
