import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { J_MONTHS, jToday, toEnDigits } from '../lib/jalali.js';
import JGrid from './JGrid.jsx';
import './dispatch.css';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' };
const Back = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><path d="M9 6l6 6-6 6" /></svg>);
const Copy = (p) => (<svg viewBox="0 0 24 24" {...S} {...p}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>);

const faNum = (n) => Number(n ?? 0).toLocaleString('fa-IR');

/** فقط این دو از تبِ حمل‌ونقل تخصیص داده می‌شوند. */
const ASSIGN_ROLES = [
  { v: 'driver', l: 'راننده' },
  { v: 'courier', l: 'پیک' },
];

/** ساعتِ HH:MM — همان قاعدهٔ سرور، تا پیش از رفت‌وبرگشت خطا معلوم شود. */
const timeOk = (v) => v === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/**
 * پنلِ چینش — دو تب، چون دو کارِ متفاوت‌اند با دو سؤالِ متفاوت.
 *
 * **کارشناس:** چه کسی سرِ کدام عمل می‌رود و کِی باید آن‌جا باشد.
 * **حمل‌ونقل:** چه دستگاه/ستی، چه ساعتی، به کدام بیمارستان، با چه راننده‌ای.
 *
 * هر دو تب از **یک** endpointِ روز تغذیه می‌شوند و فقط رندرشان فرق می‌کند؛ دو
 * منبعِ داده یعنی دو تعریفِ متفاوت از «عمل‌های امروز» — همان اشتباهی که یک‌بار
 * در آمارِ داشبورد کردیم.
 *
 * ⚠️ متنِ ابلاغ از سرور می‌آید، نه از این‌جا: قاعدهٔ «راننده اطلاعاتِ بیمار
 * نمی‌گیرد» باید یک‌جا اعمال شود تا کانالِ بعدی (بله/پیامک) دورش نزند.
 */
export default function Dispatch() {
  const [ty, tm, td] = jToday();
  const [tab, setTab] = useState('tech');
  const [ym, setYm] = useState({ y: ty, m: tm });
  const [day, setDay] = useState(td);
  const [month, setMonth] = useState(null);
  const [board, setBoard] = useState(null);
  const [staff, setStaff] = useState([]);
  const [techs, setTechs] = useState([]);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [brief, setBrief] = useState(null); // {visitId, role, text}

  useEffect(() => { document.title = 'عمل‌یار — چینش'; }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    api('/dispatch/staff').then(setStaff).catch((e) => setErr(e.message));
    api('/techs').then(setTechs).catch(() => {});
  }, []);

  const loadMonth = useCallback(
    () => api(`/dispatch/month?year=${ym.y}&month=${ym.m}`).then(setMonth).catch((e) => { setErr(e.message); setMonth(null); }),
    [ym],
  );
  useEffect(() => { loadMonth(); }, [loadMonth]);

  const loadDay = useCallback(async () => {
    setErr('');
    try { setBoard(await api(`/dispatch/day?year=${ym.y}&month=${ym.m}&day=${day}`)); }
    catch (e) { setErr(e.message); setBoard(null); }
  }, [ym, day]);
  useEffect(() => { loadDay(); }, [loadDay]);

  const refresh = async () => { await loadDay(); loadMonth(); };

  const byDay = useMemo(() => new Map((month?.days ?? []).map((d) => [d.day, d])), [month]);
  const pool = useMemo(() => {
    const m = {};
    for (const r of ASSIGN_ROLES) m[r.v] = staff.filter((s) => s.role === r.v);
    return m;
  }, [staff]);

  const guard = async (fn, okMsg) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await refresh();
      if (okMsg) setToast(okMsg);
    } catch (e) { setToast(e.message); } finally { setBusy(false); }
  };

  /* کارشناس روی خودِ مراجعه نوشته می‌شود (`Visit.techId`) نه در جدولِ تخصیص —
     همان ستونی که تسویه، گزارش و دامنهٔ دسترسیِ کارشناس از آن می‌خوانند. */
  const setTech = (visitId, techId) =>
    guard(() => api(`/visits/${visitId}`, { method: 'PATCH', body: { techId: techId ? Number(techId) : null } }),
      techId ? 'کارشناس ثبت شد ✓' : 'کارشناس برداشته شد');

  const setTime = (visitId, field, value) => {
    const v = toEnDigits(String(value ?? '')).trim();
    if (!timeOk(v)) { setToast('ساعت باید به شکلِ ۰۸:۳۰ باشد'); return undefined; }
    return guard(() => api(`/visits/${visitId}/times`, { method: 'PATCH', body: { [field]: v } }), 'ساعت ثبت شد ✓');
  };

  const assign = (visitId, role, staffId) =>
    staffId && guard(() => api(`/dispatch/visits/${visitId}/assign`, { method: 'POST', body: { staffId: Number(staffId), role } }), 'تخصیص ثبت شد ✓');

  const unassign = (id) => guard(() => api(`/dispatch/assignments/${id}`, { method: 'DELETE' }));

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

  const visits = board?.visits ?? [];
  const gaps = (month?.days ?? []).reduce(
    (a, d) => ({ tech: a.tech + d.noTech, driver: a.driver + d.noDriver }), { tech: 0, driver: 0 },
  );
  const gapNow = tab === 'tech' ? gaps.tech : gaps.driver;

  return (
    <div className="dp">
      <div className="dp-bg" aria-hidden="true" />
      <header className="dp-head">
        <Link to="/app" className="dp-back"><Back width="15" height="15" /> سامانه</Link>
        <div>
          <h1>چینشِ نیروها</h1>
          <p>
            {month ? `${faNum(month.total)} عمل در ${J_MONTHS[ym.m - 1]}` : 'در حال بارگذاری…'}
            {gapNow > 0 && (
              <em className="dp-gapnote">
                {' — '}{faNum(gapNow)} عمل بدونِ {tab === 'tech' ? 'کارشناس' : 'راننده'}
              </em>
            )}
          </p>
        </div>
      </header>

      <nav className="dp-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'tech'} className={tab === 'tech' ? 'on' : ''} onClick={() => setTab('tech')}>
          کارشناس
        </button>
        <button type="button" role="tab" aria-selected={tab === 'transport'} className={tab === 'transport' ? 'on' : ''} onClick={() => setTab('transport')}>
          حمل و نقل
        </button>
      </nav>

      {err && <div className="dp-err">{err}</div>}

      <JGrid
        year={ym.y}
        month={ym.m}
        selected={day}
        onNav={(y, m) => { setYm({ y, m }); setDay(1); }}
        onPickDay={setDay}
        renderDay={(d) => {
          const cell = byDay.get(d);
          if (!cell) return null;
          const gap = tab === 'tech' ? cell.noTech : cell.noDriver;
          return (
            <div className="dp-cell">
              <i className="t">{faNum(cell.total)} عمل</i>
              {gap > 0 && (
                <i className="g" title={tab === 'tech' ? 'بدونِ کارشناس' : 'بار دارد ولی راننده ندارد'}>
                  {faNum(gap)} بدونِ {tab === 'tech' ? 'کارشناس' : 'راننده'}
                </i>
              )}
            </div>
          );
        }}
      />

      <section className="dp-day">
        <b>{faNum(day)} {J_MONTHS[ym.m - 1]}</b>
        {visits.length === 0 && <div className="dp-empty">عملی برای این روز ثبت نشده</div>}

        {tab === 'tech' && visits.map((v) => (
          <article key={v.id} className={`dp-card${v.tech ? '' : ' gap'}`}>
            <header>
              <span className="dp-time" dir="ltr">{v.opStartTime || '—'}</span>
              <div className="dp-title">
                <b>{v.fullName} <i dir="ltr">{v.code}</i></b>
                <small>{[v.hospital?.name, v.procedureName, v.surgeonName].filter(Boolean).join(' · ') || '—'}</small>
              </div>
            </header>

            <div className="dp-pick">
              <label>
                <span>کارشناس</span>
                <select value={v.tech?.id ?? ''} disabled={busy} onChange={(e) => setTech(v.id, e.target.value)}>
                  <option value="">— تعیین‌نشده —</option>
                  {techs.map((t) => <option key={t.id} value={t.id}>{t.displayName}</option>)}
                </select>
              </label>
              <TimeBox label="ساعتِ حضور" value={v.techArriveTime} disabled={busy} onSave={(x) => setTime(v.id, 'techArriveTime', x)} />
              {v.tech && (
                <button type="button" className="dp-brief-btn" onClick={() => openBrief(v.id, 'tech')}>✉ متنِ ابلاغ</button>
              )}
            </div>
          </article>
        ))}

        {tab === 'transport' && visits.map((v) => {
          const hasDriver = v.assignments.some((a) => a.role === 'driver');
          return (
            <article key={v.id} className={`dp-card${v.cargo.length > 0 && !hasDriver ? ' gap' : ''}`}>
              <header>
                <span className="dp-time" dir="ltr">{v.opStartTime || '—'}</span>
                <div className="dp-title">
                  <b>{v.hospital?.name ?? 'بیمارستان تعیین‌نشده'} <i dir="ltr">{v.code}</i></b>
                  <small>{v.hospital?.address || 'آدرسی ثبت نشده'}</small>
                </div>
              </header>

              {/* «چه دستگاهی، چه ستی» — از حواله‌های همان مراجعه، نه فیلدی جدا */}
              <div className="dp-cargo">
                {v.cargo.length === 0
                  ? <span className="none">حواله‌ای برای این عمل صادر نشده — از انبار حواله بزنید</span>
                  : v.cargo.map((c, i) => (
                    <span key={i} className="dp-chip cargo">
                      {c.category && <em className="cat">{c.category}</em>}
                      {c.itemName}{c.lotNo ? ` (${c.lotNo})` : ''} × {faNum(c.quantity)}
                      <em dir="ltr">{c.transferCode}</em>
                    </span>
                  ))}
                {v.cargo[0]?.toLocation && <span className="dp-dest">محلِ تحویل: {v.cargo[0].toLocation}</span>}
              </div>

              <div className="dp-people">
                {v.assignments.map((a) => (
                  <span key={a.id} className={`dp-chip ${a.role}`}>
                    {a.roleLabel}: {a.name}{a.vehicle ? ` — ${a.vehicle}` : ''}
                    <button type="button" onClick={() => openBrief(v.id, a.role)} title="متنِ ابلاغ">✉</button>
                    <button type="button" className="x" disabled={busy} onClick={() => unassign(a.id)} title="حذفِ تخصیص">✕</button>
                  </span>
                ))}
                {v.assignments.length === 0 && <span className="dp-none">هنوز راننده یا پیکی تعیین نشده</span>}
              </div>

              <div className="dp-pick">
                <TimeBox label="تحویلِ بار تا" value={v.cargoDueTime} disabled={busy} onSave={(x) => setTime(v.id, 'cargoDueTime', x)} />
                {ASSIGN_ROLES.map((r) => (
                  <label key={r.v}>
                    <span>{r.l}</span>
                    <select value="" disabled={busy} onChange={(e) => assign(v.id, r.v, e.target.value)}>
                      <option value="">افزودن…</option>
                      {pool[r.v].map((s) => (
                        <option key={s.id} value={s.id}>{s.name}{s.vehicle ? ` — ${s.vehicle}` : ''}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </article>
          );
        })}

        {tab === 'transport' && pool.driver.length === 0 && pool.courier.length === 0 && (
          <p className="dp-nopool">
            هنوز راننده یا پیکی تعریف نشده — از <Link to="/app/definitions">تعاریفِ پایه › راننده و پیک</Link> اضافه کنید.
          </p>
        )}
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

/**
 * ورودیِ ساعت که فقط هنگام خروج از فیلد ذخیره می‌کند.
 *
 * ذخیره روی هر کلید یعنی «۰۸» به‌عنوان ساعتِ ناقص به سرور می‌رود و خطا می‌گیرد؛
 * ذخیره روی blur یعنی کاربر عدد را کامل می‌کند و بعد یک درخواست می‌رود.
 */
function TimeBox({ label, value, disabled, onSave }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => { setV(value ?? ''); }, [value]);
  return (
    <label className="dp-timebox">
      <span>{label}</span>
      <input
        type="text"
        inputMode="numeric"
        dir="ltr"
        placeholder="۰۸:۳۰"
        value={v}
        disabled={disabled}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { if ((v ?? '') !== (value ?? '')) onSave(v); }}
      />
    </label>
  );
}
