import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { J_MONTHS, jToday } from '../lib/jalali.js';
import { useAuth } from './auth.jsx';
import JGrid from './JGrid.jsx';
import './dispatch.css';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' };
const Back = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M9 6l6 6-6 6" /></svg>);
const Copy = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>);

const faNum = (n) => Number(n ?? 0).toLocaleString('fa-IR');

/** نقشِ شغلی — بازتابِ `JOB_ROLES` سرور. */
const JOB_ROLES = [
  { v: 'tech', l: 'کارشناس' },
  { v: 'driver', l: 'راننده' },
  { v: 'courier', l: 'پیک' },
  { v: 'office', l: 'دفتر' },
];
/** فقط این دو از این‌جا تخصیص داده می‌شوند؛ کارشناس روی خودِ فرمِ مراجعه است. */
const ASSIGN_ROLES = [
  { v: 'driver', l: 'راننده' },
  { v: 'courier', l: 'پیک' },
];

/**
 * پنلِ چینش — چه کسی، کجا، با چه ستی.
 *
 * ساختارِ صفحه از خودِ کارِ چینش‌کننده می‌آید: اول ماه را نگاه می‌کند تا ببیند
 * کدام روز هنوز کسری دارد (نشانِ قرمزِ سلول)، بعد آن روز را باز می‌کند و برای
 * هر عمل راننده/پیک می‌گذارد، آخر هم متنِ ابلاغ را برمی‌دارد و می‌فرستد.
 *
 * ⚠️ متنِ ابلاغ از سرور می‌آید، نه از این‌جا: قاعدهٔ «راننده اطلاعاتِ بیمار
 * نمی‌گیرد» باید یک‌جا اعمال شود تا کانالِ بعدی (بله/پیامک) دورش نزند.
 */
export default function Dispatch() {
  const { user } = useAuth();
  const [ty, tm, td] = jToday();
  const [ym, setYm] = useState({ y: ty, m: tm });
  const [day, setDay] = useState(td);
  const [month, setMonth] = useState(null);
  const [board, setBoard] = useState(null);
  const [staff, setStaff] = useState([]);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [brief, setBrief] = useState(null); // {visitId, role, text}
  const [showStaff, setShowStaff] = useState(false);

  useEffect(() => { document.title = 'عمل‌یار — چینش'; }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2000);
    return () => clearTimeout(t);
  }, [toast]);

  const loadStaff = useCallback(() => {
    api('/dispatch/staff').then(setStaff).catch((e) => setErr(e.message));
  }, []);
  useEffect(loadStaff, [loadStaff]);

  useEffect(() => {
    let alive = true;
    api(`/dispatch/month?year=${ym.y}&month=${ym.m}`)
      .then((d) => { if (alive) setMonth(d); })
      .catch((e) => { if (alive) { setErr(e.message); setMonth(null); } });
    return () => { alive = false; };
  }, [ym]);

  const loadDay = useCallback(async () => {
    setErr('');
    try { setBoard(await api(`/dispatch/day?year=${ym.y}&month=${ym.m}&day=${day}`)); }
    catch (e) { setErr(e.message); setBoard(null); }
  }, [ym, day]);
  useEffect(() => { loadDay(); }, [loadDay]);

  const byDay = useMemo(() => new Map((month?.days ?? []).map((d) => [d.day, d])), [month]);
  const pool = useMemo(() => {
    const m = {};
    for (const r of ASSIGN_ROLES) m[r.v] = staff.filter((s) => s.jobRole === r.v);
    return m;
  }, [staff]);

  const refresh = async () => {
    await loadDay();
    api(`/dispatch/month?year=${ym.y}&month=${ym.m}`).then(setMonth).catch(() => {});
  };

  const assign = async (visitId, role, accountId) => {
    if (!accountId || busy) return;
    setBusy(true);
    try {
      await api(`/dispatch/visits/${visitId}/assign`, { method: 'POST', body: { accountId: Number(accountId), role } });
      await refresh();
      setToast('تخصیص ثبت شد ✓');
    } catch (e) { setToast(e.message); } finally { setBusy(false); }
  };

  const unassign = async (id) => {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/dispatch/assignments/${id}`, { method: 'DELETE' });
      await refresh();
    } catch (e) { setToast(e.message); } finally { setBusy(false); }
  };

  const openBrief = async (visitId, role) => {
    setBrief({ visitId, role, text: '' });
    try {
      const d = await api(`/dispatch/visits/${visitId}/briefing?role=${role}`);
      setBrief({ visitId, role, text: d.text, roleLabel: d.roleLabel });
    } catch (e) { setToast(e.message); setBrief(null); }
  };

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast('متن کپی شد ✓');
    } catch {
      // Safariِ قدیمی و بسترهای بدونِ clipboard API: کاربر خودش انتخاب کند
      setToast('کپیِ خودکار ممکن نشد — متن را دستی انتخاب کنید');
    }
  };

  const setJobRole = async (id, jobRole) => {
    setBusy(true);
    try {
      await api(`/dispatch/staff/${id}/role`, { method: 'PATCH', body: { jobRole: jobRole || null } });
      loadStaff();
      setToast('نقشِ شغلی ذخیره شد ✓');
    } catch (e) { setToast(e.message); } finally { setBusy(false); }
  };

  const visits = board?.visits ?? [];
  const gapCount = (month?.days ?? []).reduce((s, d) => s + d.noTech + d.noDriver, 0);

  return (
    <div className="dp">
      <div className="dp-bg" aria-hidden="true" />
      <header className="dp-head">
        <Link to="/app" className="dp-back"><Back width="15" height="15" /> سامانه</Link>
        <div>
          <h1>چینشِ نیروها</h1>
          <p>
            {month ? `${faNum(month.total)} عمل در ${J_MONTHS[ym.m - 1]}` : 'در حال بارگذاری…'}
            {gapCount > 0 && <em className="dp-gapnote"> — {faNum(gapCount)} مورد نیروی تعیین‌نشده</em>}
          </p>
        </div>
        {user?.level >= 6 && (
          <button type="button" className="dp-staffbtn" onClick={() => setShowStaff((v) => !v)}>
            نقشِ نیروها
          </button>
        )}
      </header>

      {err && <div className="dp-err">{err}</div>}

      {showStaff && (
        <section className="dp-staff">
          <p className="dp-hint">
            نقشِ شغلی از سطحِ دسترسی جداست: سطح می‌گوید چه چیزی را می‌بیند، نقش می‌گوید
            سرِ عمل چه کاری می‌کند. فقط کسانی که نقش‌شان راننده یا پیک باشد در فهرستِ
            تخصیصِ پایین می‌آیند.
          </p>
          {staff.map((s) => (
            <div key={s.id} className="dp-staffrow">
              <b>{s.name}</b>
              <span dir="ltr">{s.phone || '—'}</span>
              <select value={s.jobRole ?? ''} disabled={busy} onChange={(e) => setJobRole(s.id, e.target.value)}>
                <option value="">بدونِ نقش</option>
                {JOB_ROLES.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
              </select>
            </div>
          ))}
        </section>
      )}

      <JGrid
        year={ym.y}
        month={ym.m}
        selected={day}
        onNav={(y, m) => { setYm({ y, m }); setDay(1); }}
        onPickDay={setDay}
        renderDay={(d) => {
          const cell = byDay.get(d);
          if (!cell) return null;
          return (
            <div className="dp-cell">
              <i className="t">{faNum(cell.total)} عمل</i>
              {cell.noTech > 0 && <i className="g" title="بدونِ کارشناس">{faNum(cell.noTech)} بی‌کارشناس</i>}
              {cell.noDriver > 0 && <i className="g" title="بار دارد ولی راننده ندارد">{faNum(cell.noDriver)} بی‌راننده</i>}
            </div>
          );
        }}
      />

      <section className="dp-day">
        <b>{faNum(day)} {J_MONTHS[ym.m - 1]}</b>
        {visits.length === 0 && <div className="dp-empty">عملی برای این روز ثبت نشده</div>}

        {visits.map((v) => (
          <article key={v.id} className="dp-card">
            <header>
              <span className="dp-time" dir="ltr">{v.opStartTime || '—'}</span>
              <div className="dp-title">
                <b>{v.fullName} <i dir="ltr">{v.code}</i></b>
                <small>{[v.hospital?.name, v.procedureName, v.surgeonName].filter(Boolean).join(' · ') || '—'}</small>
              </div>
            </header>

            <div className="dp-cargo">
              {v.cargo.length === 0
                ? <span className="none">حواله‌ای صادر نشده</span>
                : v.cargo.map((c, i) => (
                  <span key={i} className="dp-chip cargo">
                    {c.itemName}{c.lotNo ? ` (${c.lotNo})` : ''} × {faNum(c.quantity)}
                    <em dir="ltr">{c.transferCode}</em>
                  </span>
                ))}
            </div>

            <div className="dp-people">
              <span className={`dp-chip tech${v.tech ? '' : ' miss'}`}>
                کارشناس: {v.tech?.name ?? 'تعیین‌نشده'}
                {v.tech && <button type="button" onClick={() => openBrief(v.id, 'tech')} title="متنِ ابلاغ">✉</button>}
              </span>

              {v.assignments.map((a) => (
                <span key={a.id} className={`dp-chip ${a.role}`}>
                  {a.roleLabel}: {a.name}
                  <button type="button" onClick={() => openBrief(v.id, a.role)} title="متنِ ابلاغ">✉</button>
                  <button type="button" className="x" disabled={busy} onClick={() => unassign(a.id)} title="حذفِ تخصیص">✕</button>
                </span>
              ))}
            </div>

            <div className="dp-pick">
              {ASSIGN_ROLES.map((r) => (
                <label key={r.v}>
                  <span>{r.l}</span>
                  <select value="" disabled={busy} onChange={(e) => assign(v.id, r.v, e.target.value)}>
                    <option value="">افزودن…</option>
                    {pool[r.v].map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
              ))}
              {pool.driver.length === 0 && pool.courier.length === 0 && (
                <em className="dp-nopool">هنوز کسی نقشِ راننده یا پیک ندارد.</em>
              )}
            </div>
          </article>
        ))}
      </section>

      {brief && (
        <div className="dp-overlay" onClick={(e) => { if (e.target === e.currentTarget) setBrief(null); }}>
          <section className="dp-sheet">
            <header>
              <b>متنِ ابلاغ — {brief.roleLabel ?? '…'}</b>
              <button type="button" onClick={() => setBrief(null)} aria-label="بستن">✕</button>
            </header>
            <pre className="dp-brief">{brief.text || 'در حال ساخت…'}</pre>
            <footer>
              {brief.role !== 'tech' && (
                <span className="dp-privacy">راننده و پیک هیچ اطلاعاتِ بیماری دریافت نمی‌کنند.</span>
              )}
              <button type="button" className="dp-copy" disabled={!brief.text} onClick={() => copy(brief.text)}>
                <Copy width="15" height="15" /> کپیِ متن
              </button>
            </footer>
          </section>
        </div>
      )}

      <div className={`dp-toast${toast ? ' on' : ''}`}>{toast}</div>
    </div>
  );
}
